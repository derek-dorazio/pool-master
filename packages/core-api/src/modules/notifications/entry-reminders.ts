/**
 * Entry reminders (#845, catalog row D2): 48, 24 and 3 hours before a contest's picks close for
 * an event (the offsets are EMAIL_CONFIG.entryReminderHours), every league member with nothing
 * submitted for that event is told, all at the same moment, with no per-person time zone shift.
 *
 * The lifecycle scheduler's "notifications due" step calls `queueDue` on every sweep. A reminder
 * is queued once: its outbox idempotency key is the contest, the event, the offset and the
 * person, so the next sweep, or the other server task, finds it recorded and skips.
 *
 * Who is told, per contest and event:
 * - While the contest takes entries (OPEN, undrawn, none of its events started): every active
 *   member of the league, entry or not.
 * - Later, such as week 7 of a live pick'em season, when nobody can join: the owners of the
 *   contest's entries.
 * Either way, a person with a submitted entry for the event is not told, and a person who owns
 * two squads, or is also a commissioner, gets one email. Nothing is sent within 6 hours of the
 * contest opening, when the "New contest open" email has just gone out.
 *
 * Formats whose members submit a lineup or a week are reminded. A survivor entry may already be
 * out, a random draw is dealt rather than picked, and a squares member claims boxes: their
 * reminders follow in catalog slice 2.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestConfigurationRepository,
  ContestEntryRepository,
  ContestRepository,
  LeagueRepository,
  SportEventMatchRepository,
  SportEventRepository,
  SquadMembershipRepository,
} from '@poolmaster/shared/db';
import type { EmailConfig } from '@poolmaster/shared/dto';
import {
  ContestEntryStatus,
  ContestStatus,
  SelectionType,
  contestEntryEventStatus,
  type Contest,
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
  type ContestCutoff,
} from '../contests/entry-window';
import { buildContestUrl, formatUserName, type EmailService } from '../email';
import { hasSportEventStarted } from '../events/operational-timing';
import type { DueNotifications } from '../events/event-lifecycle-scheduler';
import { activeLeagueMembers, type LeagueMemberDeps } from './league-members';

/** The formats reminded today: their members pick and submit a lineup, a week or a bracket. */
const REMINDED_SELECTION_TYPES: readonly SelectionType[] = [
  SelectionType.TIERED,
  SelectionType.BUDGET_PICK,
  SelectionType.PICK_EM,
  SelectionType.BRACKET,
];

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
  contests: Pick<ContestRepository, 'findByStatuses'>;
  sportEvents: Pick<SportEventRepository, 'findByIds'>;
  /** A bracket's rules: a second-chance bracket closes at its starting round (#721). */
  configurations: Pick<ContestConfigurationRepository, 'findByContest'>;
  matches: Pick<SportEventMatchRepository, 'findBySportEvent'>;
  entries: Pick<ContestEntryRepository, 'findByContest'>;
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
  sportEvent: SportEvent;
  closesAt: Date;
  hours: number;
  /** Whether the contest still takes entries, so members with none are told too. */
  entriesOpen: boolean;
}

export class EntryReminders implements DueNotifications {
  constructor(private readonly deps: EntryReminderDeps) {}

  async queueDue(now: Date): Promise<void> {
    const reminderHours = this.deps.readConfig().entryReminderHours;
    const contests = (await this.deps.contests.findByStatuses([ContestStatus.OPEN, ContestStatus.ACTIVE]))
      .filter((contest) => REMINDED_SELECTION_TYPES.includes(contest.selectionType));
    if (contests.length === 0) return;
    const sportEvents = new Map((await this.deps.sportEvents.findByIds(
      [...new Set(contests.flatMap((contest) => contest.sportEventIds))],
    )).map((sportEvent) => [sportEvent.id, sportEvent]));

    for (const contest of contests) {
      try {
        const contestEvents = contest.sportEventIds
          .map((id) => sportEvents.get(id))
          .filter((sportEvent): sportEvent is SportEvent => sportEvent !== undefined);
        for (const due of await this.dueReminders(contest, contestEvents, reminderHours, now)) {
          await this.queueReminder(due);
        }
      } catch (error) {
        this.deps.logger?.error({
          action: 'email.entryReminders.failed',
          data: { contestId: contest.id, leagueId: contest.leagueId, error: error instanceof Error ? error.message : String(error) },
        }, 'Failed to queue entry reminders for a contest');
      }
    }
  }

  private async dueReminders(
    contest: Contest,
    contestEvents: SportEvent[],
    reminderHours: readonly number[],
    now: Date,
  ): Promise<DueReminder[]> {
    if (contest.drawnAt !== undefined) return [];
    if (contest.openedAt !== undefined && now.getTime() - contest.openedAt.getTime() < AFTER_OPENED_QUIET_MS) return [];
    const cutoff = await this.cutoffOf(contest);
    // Each event's window closes at the contest's cutoff on it: a second-chance bracket's is its
    // starting round, after the event itself has started.
    const windows = await Promise.all(contestEvents.map(async (sportEvent) => {
      const games: SportEventMatch[] = cutoff.kind === ContestCutoffKind.EVENT_START
        ? []
        : await this.deps.matches.findBySportEvent(sportEvent.id);
      return { sportEvent, window: cutoffTiming(cutoff, sportEvent, games) };
    }));
    const entriesOpen = areContestEntriesOpen(contest, windows.map(({ window }) => window), now);
    return windows.flatMap(({ sportEvent, window }) => {
      const hours = hasSportEventStarted(window, now) ? null : dueReminderHours(window.startDate, reminderHours, now);
      return hours === null ? [] : [{ contest, sportEvent, closesAt: window.startDate, hours, entriesOpen }];
    });
  }

  private async cutoffOf(contest: Contest): Promise<ContestCutoff> {
    if (contest.selectionType !== SelectionType.BRACKET) return { kind: ContestCutoffKind.EVENT_START };
    return contestCutoff((await this.deps.configurations.findByContest(contest.id))?.configJson);
  }

  private async queueReminder(due: DueReminder): Promise<void> {
    const { contest, sportEvent } = due;
    const league = await this.deps.leagues.findById(contest.leagueId);
    if (!league) return;
    const recipients = await this.recipients(due, league);
    const contestUrl = buildContestUrl(this.deps.appBaseUrl, league.leagueCode, contest.id);
    for (const { user, hasDraft } of recipients) {
      await this.deps.email.send('CONTEST_ENTRY_REMINDER', {
        to: { email: user.email, userId: user.id, timeZone: user.timezone },
        about: `${contest.id}:${sportEvent.id}:${due.hours}h`,
        league: { id: league.id, name: league.name, leagueCode: league.leagueCode },
        refs: { contestId: contest.id },
        data: {
          userName: formatUserName(user),
          leagueName: league.name,
          contestName: contest.name,
          eventName: sportEvent.name,
          closesAt: due.closesAt,
          hasDraft,
          contestUrl,
        },
      });
    }
    // Debug: the reminder stays due for its grace hour, so every sweep in it gets here; each email
    // newly queued is logged once, at info, as email.send.queued.
    this.deps.logger?.debug({
      action: 'email.entryReminders.due',
      data: { contestId: contest.id, leagueId: league.id, sportEventId: sportEvent.id, hours: due.hours, recipients: recipients.length },
    }, 'Entry reminder due; recorded for each recipient');
  }

  /**
   * The active members to remind, each once, with whether they hold a draft entry: everyone
   * while entries are open, else the contest's entry owners, less anyone with a submitted entry
   * for the event.
   */
  private async recipients(due: DueReminder, league: League): Promise<Array<{ user: User; hasDraft: boolean }>> {
    const [members, entries] = await Promise.all([
      activeLeagueMembers(this.deps, league.id),
      this.deps.entries.findByContest(due.contest.id),
    ]);
    const owners = await this.deps.squadMemberships.findBySquads([...new Set(entries.map((entry) => entry.squadId))]);
    const ownersBySquad = new Map<string, string[]>();
    for (const owner of owners) {
      ownersBySquad.set(owner.squadId, [...(ownersBySquad.get(owner.squadId) ?? []), owner.userId]);
    }

    const submitted = new Set<string>();
    const drafting = new Set<string>();
    for (const entry of entries) {
      const into = contestEntryEventStatus(entry, due.sportEvent.id) === ContestEntryStatus.SUBMITTED ? submitted : drafting;
      for (const userId of ownersBySquad.get(entry.squadId) ?? []) into.add(userId);
    }

    return members
      .filter((user) => !submitted.has(user.id))
      .filter((user) => due.entriesOpen || drafting.has(user.id))
      .map((user) => ({ user, hasDraft: drafting.has(user.id) }));
  }
}
