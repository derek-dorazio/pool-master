/**
 * Entry reminders (#845, catalog row D2): 48, 24 and 3 hours before a contest's picks close for
 * an event (the offsets are EMAIL_CONFIG.entryReminderHours), every league member with nothing
 * submitted for that event is told, all at the same moment, with no per-person time zone shift.
 *
 * The lifecycle scheduler's "notifications due" step calls `queueDue` on every sweep. A sweep
 * reads only the contests whose next reminder check has come (#1170): a contest is checked as it
 * opens, when its events or their times change, and at each reminder time; after a check it
 * waits for its next reminder time, so it is not looked at again in between. A reminder is queued
 * once: its outbox idempotency key is the contest, the event, the offset and the person, so a
 * check repeated after a failure, or the other server task, finds it recorded and skips.
 *
 * Who is told, per contest and event, in a format whose members pick (tiered, budget, pick'em,
 * bracket, survivor):
 * - While the contest takes entries (OPEN, undrawn, none of its events started): every active
 *   member of the league, entry or not.
 * - Later, such as week 7 of a live pick'em season, when nobody can join: the owners of the
 *   contest's entries. A survivor entry that is out has nothing left to pick, so it doesn't count.
 * Either way, a person with a submitted entry for the event is not told, and a person who owns
 * two squads, or is also a commissioner, gets one email. A person with one draft is told how far
 * along it is ("4 of 6 picked") where the format counts picks.
 *
 * A random draw deals its picks, so only members not in it yet are told, while it takes entries.
 * A squares contest's members claim boxes, so only members without a box are told, until the
 * game starts or the numbers are drawn, and nobody once the grid is full. Nothing is sent
 * within 6 hours of the contest opening, when the "New contest open" email has just gone out.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestConfigurationRepository,
  ContestEntryMatchPredictionRepository,
  ContestEntryPickRepository,
  ContestEntryRepository,
  ContestRepository,
  ContestSquaresRepository,
  LeagueRepository,
  ReminderCheck,
  SportEventMatchRepository,
  SportEventRepository,
  SportLeagueRepository,
  SquadMembershipRepository,
} from '@poolmaster/shared/db';
import type { EmailConfig } from '@poolmaster/shared/dto';
import {
  ContestEntryStatus,
  ContestStatus,
  MatchStatus,
  SQUARES_GRID_SIZE,
  SelectionType,
  contestEntryEventStatus,
  getTieredRosterSize,
  getTiersInPlay,
  type Contest,
  type ContestEntry,
  type ContestSelectionConfig,
  type League,
  type SportEvent,
  type SportEventMatch,
  type User,
} from '@poolmaster/shared/domain';
import {
  ContestCutoffKind,
  areContestEntriesOpen,
  contestCutoff,
  cutoffTiming,
} from '../contests/entry-window';
import { loadSurvivorWeeks, survivorPicksByEntry, survivorWeeksOf, type SurvivorSeasonPick } from '../contests/survivor-standings';
import {
  emailRecipientOf,
  EntryReminderKind,
  buildContestUrl,
  buildEmailContestFormat,
  buildEmailEventHeader,
  formatUserName,
  type DraftProgress,
  type EmailService,
  type EntryReminderStanding,
} from '../email';
import { hasSportEventStarted } from '../events/operational-timing';
import type { DueNotifications } from '../events/event-lifecycle-scheduler';
import type { SportEventTierService } from '../events/sport-event-tier-service';
import { contestBracketGames } from '../scoring-families/head-to-head/bracket-picks';
import { survivorRun } from '../scoring-families/head-to-head/survivor';
import { readEventMatchesOnce, readEventsOnce, readOncePerKey } from '../events/event-reads';
import { summarizeContest } from './contest-summary';
import { activeLeagueMembers, type LeagueMemberDeps } from './league-members';

/**
 * How late a reminder may still go after its time. The scheduler sweeps every 5 minutes, and a
 * deploy can pause it; past this, the reminder's moment is gone. A contest opened after one of
 * its reminder times so never sends that reminder: the next one, if any, covers it.
 */
const ENTRY_REMINDER_GRACE_MS = 60 * 60_000;

const HOUR_MS = 60 * 60_000;

/**
 * No reminder lands this soon after the "New contest open" email (D1): a contest opened the day
 * before its picks close has just told everyone, and a reminder hours later is noise.
 */
const AFTER_OPENED_QUIET_MS = 6 * HOUR_MS;

/**
 * The reminder due now for picks closing at `closesAt`, as its offset in hours, or null. When
 * several reminder times have passed, only the latest counts: a sweep never sends the 48-hour
 * reminder after the 24-hour one's time. A reminder more than the grace period late is not sent.
 */
export function dueReminderHours(closesAt: Date, reminderHours: readonly number[], now: Date): number | null {
  if (now >= closesAt) return null;
  const passed = reminderHours.filter((hours) => closesAt.getTime() - hours * HOUR_MS <= now.getTime());
  if (passed.length === 0) return null;
  const latest = Math.min(...passed);
  const lateBy = now.getTime() - (closesAt.getTime() - latest * HOUR_MS);
  return lateBy <= ENTRY_REMINDER_GRACE_MS ? latest : null;
}

export interface EntryReminderDeps extends LeagueMemberDeps {
  contests: Pick<ContestRepository, 'findReminderChecksDue' | 'scheduleReminderChecks'>;
  sportEvents: Pick<SportEventRepository, 'findByIds'>;
  /** The contest's rules: its cutoff, and a draft's roster size. A sweep reads them together. */
  configurations: Pick<ContestConfigurationRepository, 'findByContest' | 'findByContests'>;
  /** By event for cutoffs and a week's games; across events for a survivor season. */
  matches: Pick<SportEventMatchRepository, 'findBySportEvent' | 'findBySportEvents'>;
  entries: Pick<ContestEntryRepository, 'findByContest'>;
  /** A roster draft's picks, for its progress. */
  picks: Pick<ContestEntryPickRepository, 'findByEntriesWithParticipant'>;
  /** A pick'em or bracket draft's picks, for its progress, and a survivor season's, for who is out. */
  predictions: Pick<ContestEntryMatchPredictionRepository, 'findByEntriesAndEvent' | 'findByEntriesAndEvents'>;
  /** A tiered draft's roster size, and the tier count in the contest's rules. */
  tiers: Pick<SportEventTierService, 'getEffectiveTiersForSportEvent'>;
  /** The event's sport league, named on the email. */
  sportLeagues: Pick<SportLeagueRepository, 'findById'>;
  /** Who holds a box on a squares grid. */
  squares: Pick<ContestSquaresRepository, 'findSquares'>;
  leagues: Pick<LeagueRepository, 'findById'>;
  squadMemberships: Pick<SquadMembershipRepository, 'findBySquads'>;
  email: Pick<EmailService, 'send'>;
  readConfig: () => Pick<EmailConfig, 'entryReminderHours'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
}

/** One contest event whose reminder is due. */
interface DueReminder {
  contest: Contest;
  rules: ContestSelectionConfig | undefined;
  sportEvent: SportEvent;
  closesAt: Date;
  hours: number;
  /** Whether the contest still takes entries, so members with none are told too. */
  entriesOpen: boolean;
  now: Date;
}

interface Recipient {
  user: User;
  standing: EntryReminderStanding;
}

export class EntryReminders implements DueNotifications {
  constructor(private readonly deps: EntryReminderDeps) {}

  async queueDue(now: Date): Promise<void> {
    const reminderHours = this.deps.readConfig().entryReminderHours;
    if (reminderHours.length === 0) return;
    // Only the contests whose check has come are read (#1170), not every open and live contest.
    const checked = await this.deps.contests.findReminderChecksDue(now);
    if (checked.length === 0) return;
    const schedule: ReminderCheck[] = [];
    const ready: Contest[] = [];
    for (const contest of checked) {
      const at = checkAgainAt(contest, now);
      if (at === undefined) ready.push(contest);
      else schedule.push({ contestId: contest.id, at });
    }
    if (ready.length > 0) {
      const sportEvents = new Map((await this.deps.sportEvents.findByIds(
        [...new Set(ready.flatMap((contest) => contest.sportEventIds))],
      )).map((sportEvent) => [sportEvent.id, sportEvent]));
      const eventsOf = (contest: Contest): SportEvent[] => contest.sportEventIds
        .map((id) => sportEvents.get(id))
        .filter((sportEvent): sportEvent is SportEvent => sportEvent !== undefined);
      const deps = await this.sweepReads(ready, [...sportEvents.values()]);

      for (const contest of ready) {
        try {
          const { due, next } = await this.remindersOf(deps, contest, eventsOf(contest), reminderHours, now);
          for (const reminder of due) {
            await this.queueReminder(deps, reminder);
          }
          schedule.push({ contestId: contest.id, at: next });
        } catch (error) {
          // The contest keeps its check, so the next sweep tries again.
          this.deps.logger?.error({
            action: 'email.entryReminders.failed',
            data: { contestId: contest.id, leagueId: contest.leagueId, error: error instanceof Error ? error.message : String(error) },
          }, 'Failed to queue entry reminders for a contest');
        }
      }
    }
    await this.deps.contests.scheduleReminderChecks(schedule, now);
  }

  /**
   * The sweep's reads, shared by its contests (#1199): their rules in one read, the events it
   * already holds, and each event's matches, sport league and tiers read once.
   */
  private async sweepReads(contests: Contest[], sportEvents: SportEvent[]): Promise<EntryReminderDeps> {
    const swept = new Set(contests.map((contest) => contest.id));
    const configurations = new Map((await this.deps.configurations.findByContests([...swept]))
      .map((configuration) => [configuration.contestId, configuration]));
    return {
      ...this.deps,
      configurations: {
        findByContest: async (contestId) => (swept.has(contestId)
          ? configurations.get(contestId) ?? null
          : this.deps.configurations.findByContest(contestId)),
        findByContests: (contestIds) => this.deps.configurations.findByContests(contestIds),
      },
      sportEvents: readEventsOnce(this.deps.sportEvents, sportEvents),
      matches: readEventMatchesOnce(this.deps.matches),
      sportLeagues: { findById: readOncePerKey((id) => this.deps.sportLeagues.findById(id)) },
      tiers: { getEffectiveTiersForSportEvent: readOncePerKey((id) => this.deps.tiers.getEffectiveTiersForSportEvent(id)) },
    };
  }

  /**
   * The contest's reminders due now, and when its next one comes: the earliest reminder time
   * still ahead on an event whose picks are still open, or null when none is left.
   */
  private async remindersOf(
    deps: EntryReminderDeps,
    contest: Contest,
    contestEvents: SportEvent[],
    reminderHours: readonly number[],
    now: Date,
  ): Promise<{ due: DueReminder[]; next: Date | null }> {
    const rules = (await deps.configurations.findByContest(contest.id))?.configJson;
    const cutoff = contestCutoff(rules, contest.squaresGameMatchId);
    // Each event's window closes at the contest's cutoff on it: a second-chance bracket's is its
    // starting round, after the event itself has started, and a squares grid's is its game's kickoff.
    const games: SportEventMatch[] = cutoff.kind === ContestCutoffKind.EVENT_START
      ? []
      : await deps.matches.findBySportEvents(contestEvents.map((sportEvent) => sportEvent.id));
    const windows = contestEvents.map((sportEvent) => ({
      sportEvent,
      window: cutoffTiming(cutoff, sportEvent, games.filter((game) => game.sportEventId === sportEvent.id)),
    }));
    const entriesOpen = areContestEntriesOpen(contest, windows.map(({ window }) => window), now);
    const open = windows.filter(({ window }) => !hasSportEventStarted(window, now));
    const due = open.flatMap(({ sportEvent, window }) => {
      const hours = dueReminderHours(window.startDate, reminderHours, now);
      return hours === null ? [] : [{ contest, rules, sportEvent, closesAt: window.startDate, hours, entriesOpen, now }];
    });
    const ahead = open.flatMap(({ window }) => reminderHours
      .map((hours) => window.startDate.getTime() - hours * HOUR_MS)
      .filter((at) => at > now.getTime()));
    return { due, next: ahead.length === 0 ? null : new Date(Math.min(...ahead)) };
  }

  private async queueReminder(deps: EntryReminderDeps, due: DueReminder): Promise<void> {
    const { contest, sportEvent } = due;
    const [league, summary, entries] = await Promise.all([
      this.deps.leagues.findById(contest.leagueId),
      summarizeContest(deps, contest),
      this.deps.entries.findByContest(contest.id),
    ]);
    if (!league) return;
    if (!summary) {
      this.deps.logger?.warn({
        action: 'email.entryReminders.skipped',
        data: { contestId: contest.id, leagueId: league.id, sportEventId: sportEvent.id },
      }, 'Skipped an entry reminder because the contest\'s rules or events are gone');
      return;
    }
    const recipients = await this.recipients(deps, due, league, entries);
    const contestUrl = buildContestUrl(this.deps.appBaseUrl, league.leagueCode, contest.id);
    const event = buildEmailEventHeader(this.deps.appBaseUrl, sportEvent, summary.sportLeagueName);
    const format = buildEmailContestFormat(this.deps.appBaseUrl, contest.selectionType);
    const entryCount = entries.filter((entry) => contestEntryEventStatus(entry, sportEvent.id) === ContestEntryStatus.SUBMITTED).length;
    for (const { user, standing } of recipients) {
      await this.deps.email.send('CONTEST_ENTRY_REMINDER', {
        to: emailRecipientOf(user),
        about: `${contest.id}:${sportEvent.id}:${due.hours}h`,
        league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
        refs: { contestId: contest.id },
        data: {
          userName: formatUserName(user),
          leagueName: league.name,
          contestName: contest.name,
          event,
          format,
          rules: summary.rules,
          entryCount,
          closesAt: due.closesAt,
          hoursBefore: due.hours,
          standing,
          contestUrl,
        },
      });
    }
    // Debug: a check repeated after a failure gets here again; each email newly queued is logged
    // once, at info, as email.send.queued.
    this.deps.logger?.debug({
      action: 'email.entryReminders.due',
      data: { contestId: contest.id, leagueId: league.id, sportEventId: sportEvent.id, hours: due.hours, recipients: recipients.length },
    }, 'Entry reminder due; recorded for each recipient');
  }

  /** The active members to remind, each once, with why they are told. */
  private async recipients(deps: EntryReminderDeps, due: DueReminder, league: League, entries: ContestEntry[]): Promise<Recipient[]> {
    const members = await activeLeagueMembers(this.deps, league.id);
    const owners = await this.deps.squadMemberships.findBySquads([...new Set(entries.map((entry) => entry.squadId))]);
    const ownersBySquad = new Map<string, string[]>();
    for (const owner of owners) {
      ownersBySquad.set(owner.squadId, [...(ownersBySquad.get(owner.squadId) ?? []), owner.userId]);
    }
    const ownersOf = (entry: ContestEntry): string[] => ownersBySquad.get(entry.squadId) ?? [];

    switch (due.contest.selectionType) {
      case SelectionType.RANDOM_DRAW: {
        if (!due.entriesOpen) return [];
        const joined = new Set(entries.flatMap(ownersOf));
        return members
          .filter((user) => !joined.has(user.id))
          .map((user) => ({ user, standing: { kind: EntryReminderKind.NOT_JOINED } }));
      }
      case SelectionType.SQUARES: {
        if (!due.entriesOpen) return [];
        const boxes = await this.deps.squares.findSquares(due.contest.id);
        // A full grid has nothing left to claim.
        if (boxes.length >= SQUARES_GRID_SIZE * SQUARES_GRID_SIZE) return [];
        const boxEntryIds = new Set(boxes.map((box) => box.contestEntryId));
        const holding = new Set(entries.filter((entry) => boxEntryIds.has(entry.id)).flatMap(ownersOf));
        return members
          .filter((user) => !holding.has(user.id))
          .map((user) => ({ user, standing: { kind: EntryReminderKind.NO_BOX } }));
      }
      case SelectionType.TIERED:
      case SelectionType.BUDGET_PICK:
      case SelectionType.PICK_EM:
      case SelectionType.BRACKET:
      case SelectionType.SURVIVOR:
        return this.pickingRecipients(deps, due, members, entries, ownersOf);
    }
  }

  /**
   * In a format whose members pick: everyone while entries are open, else the owners of entries
   * still in play, less anyone with a submitted entry for the event.
   */
  private async pickingRecipients(
    deps: EntryReminderDeps,
    due: DueReminder,
    members: User[],
    entries: ContestEntry[],
    ownersOf: (entry: ContestEntry) => string[],
  ): Promise<Recipient[]> {
    const out = due.contest.selectionType === SelectionType.SURVIVOR
      ? await this.survivorEntriesOut(deps, due, entries)
      : new Set<string>();
    const submitted = new Set<string>();
    const drafts = new Map<string, ContestEntry[]>();
    for (const entry of entries.filter((candidate) => !out.has(candidate.id))) {
      const isSubmitted = contestEntryEventStatus(entry, due.sportEvent.id) === ContestEntryStatus.SUBMITTED;
      for (const userId of ownersOf(entry)) {
        if (isSubmitted) submitted.add(userId);
        else drafts.set(userId, [...(drafts.get(userId) ?? []), entry]);
      }
    }

    const told = members
      .filter((user) => !submitted.has(user.id))
      .filter((user) => due.entriesOpen || drafts.has(user.id));
    const progress = await this.draftProgress(deps, due, told.flatMap((user) => {
      const own = drafts.get(user.id) ?? [];
      return own.length === 1 ? own : [];
    }));
    return told.map((user): Recipient => {
      const own = drafts.get(user.id) ?? [];
      if (own.length === 0) return { user, standing: { kind: EntryReminderKind.NOT_ENTERED } };
      // `own` holds at least one draft here.
      const [onlyDraft] = own;
      const only = own.length === 1 ? progress.get(onlyDraft.id) : undefined;
      return {
        user,
        standing: { kind: EntryReminderKind.DRAFT, drafts: own.length, ...(only !== undefined && { progress: only }) },
      };
    });
  }

  /** The survivor entries already out: a loss, a tie, a week started with no pick, or no team left. */
  private async survivorEntriesOut(deps: EntryReminderDeps, due: DueReminder, entries: ContestEntry[]): Promise<Set<string>> {
    const weeks = await loadSurvivorWeeks(deps, due.contest, due.now);
    const predictions = await this.deps.predictions.findByEntriesAndEvents(entries.map((entry) => entry.id), due.contest.sportEventIds);
    const picksByEntry = survivorPicksByEntry(predictions, weeks);
    return new Set(entries
      .filter((entry) => survivorRun(survivorWeeksOf(entry, weeks, picksByEntry.get(entry.id) ?? new Map<string, SurvivorSeasonPick>())).eliminatedAt !== null)
      .map((entry) => entry.id));
  }

  /**
   * How far along each draft is for the event, by entry, where the format counts picks: a
   * roster's picks of its size, or a pick'em week's or a bracket's picks of its games. A survivor
   * week is one pick, so it has none.
   */
  private async draftProgress(deps: EntryReminderDeps, due: DueReminder, drafts: ContestEntry[]): Promise<Map<string, DraftProgress>> {
    const { rules, sportEvent } = due;
    if (drafts.length === 0 || rules === undefined) return new Map();
    const ids = drafts.map((entry) => entry.id);
    let made: Map<string, number>;
    let of: number;
    switch (rules.selectionType) {
      case SelectionType.TIERED:
      case SelectionType.BUDGET_PICK: {
        const picks = await this.deps.picks.findByEntriesWithParticipant(ids, { sportEventId: sportEvent.id });
        made = countBy(picks.map((pick) => pick.entryId));
        of = rules.selectionType === SelectionType.TIERED
          ? getTieredRosterSize(
            getTiersInPlay((await deps.tiers.getEffectiveTiersForSportEvent(sportEvent.id)).length, rules.tiersUsed),
            rules.picksPerTier,
          )
          : rules.rosterSize;
        break;
      }
      case SelectionType.PICK_EM:
      case SelectionType.BRACKET: {
        const allGames = await deps.matches.findBySportEvent(sportEvent.id);
        const games = rules.selectionType === SelectionType.BRACKET
          ? contestBracketGames(allGames, rules.startsAtRound)
          : allGames.filter((game) => game.status !== MatchStatus.CANCELLED);
        const gameIds = new Set(games.map((game) => game.id));
        const predictions = (await this.deps.predictions.findByEntriesAndEvent(ids, sportEvent.id))
          .filter((prediction) => gameIds.has(prediction.sportEventMatchId));
        made = countBy(predictions.map((prediction) => prediction.contestEntryId));
        of = games.length;
        break;
      }
      case SelectionType.SURVIVOR:
      case SelectionType.RANDOM_DRAW:
      case SelectionType.SQUARES:
        return new Map();
    }
    if (of === 0) return new Map();
    return new Map(ids.map((id) => [id, { made: made.get(id) ?? 0, of }]));
  }
}

/**
 * When to look at the contest again instead of now, or undefined to look now (#1170): never
 * (null) for a contest no longer taking picks or a random draw already dealt, which has nothing
 * to pick, and the end of the quiet hours for one opened less than 6 hours ago.
 */
function checkAgainAt(contest: Contest, now: Date): Date | null | undefined {
  if (contest.status !== ContestStatus.OPEN && contest.status !== ContestStatus.ACTIVE) return null;
  if (contest.drawnAt !== undefined) return null;
  if (contest.openedAt === undefined) return undefined;
  const quietUntil = contest.openedAt.getTime() + AFTER_OPENED_QUIET_MS;
  return now.getTime() < quietUntil ? new Date(quietUntil) : undefined;
}

function countBy(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}
