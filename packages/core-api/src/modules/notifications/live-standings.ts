/**
 * Live standings emails (#877, `plans/email-notifications.md` §3 E): while a roster contest is
 * live, where it stands after each round and each event.
 *
 * - **Round standings (E2):** a stroke-play round is finished (see `lastFinishedRound`). Not
 *   after an event's last round: the event's result, or the contest's final results, cover it.
 * - **Event results (E6):** one event of a season contest settles, and more events remain. Not
 *   after the last one: the contest's final results cover it.
 *
 * Each goes once its moment is a buffer old (EMAIL_CONFIG.standingsBufferMinutes, Q3.11), so a
 * late correction lands first, and only within the hour after that: past it the moment is gone.
 * The lifecycle scheduler's "notifications due" step calls `queueDue` on every sweep; the outbox
 * idempotency key (the contest, the moment and the person) keeps a later sweep from sending it
 * twice.
 *
 * It goes to every active league member who owns an entry on the board, plus the league's
 * commissioners, each once. It shows the top 10 (and anyone tied with the 10th), the reader's
 * entries placed below them, and each entry's movement since the contest's last standings email,
 * whose places each email records for the next.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestEntryEventStandingRepository,
  ContestRepository,
  LeagueRepository,
  SportEventRepository,
  SquadMembershipRepository,
  StandingsEmailPositionRepository,
} from '@poolmaster/shared/db';
import type { EmailConfig } from '@poolmaster/shared/dto';
import {
  ContestFormat,
  ContestStatus,
  LeagueMembershipStatus,
  LeagueRole,
  PARTICIPANT_SCORING_DEFINITIONS,
  ParticipantRoundStatus,
  SportEventStatus,
  type Contest,
  type League,
  type SportEvent,
  type User,
} from '@poolmaster/shared/domain';
import type { ContestLeaderboardEntryRow, ContestLeaderboardModel } from '../../mappers/contests.mapper';
import type { ContestService } from '../contests/service';
import {
  StandingsMomentKind,
  buildLeaderboardUrl,
  formatUserName,
  type EmailService,
  type StandingsCutNews,
  type StandingsLine,
  type StandingsMoment,
} from '../email';
import type { DueNotifications } from '../events/event-lifecycle-scheduler';
import type { SportEventParticipantService, SportEventParticipantView } from '../events/sport-event-participant-service';
import { sportStoresGolfRoundScores } from '../scoring-families/golf-round-scores';
import { lastFinishedRound } from '../scoring-families/stroke-play/finished-rounds';
import { activeLeagueMembers, type LeagueMemberDeps } from './league-members';

/** How late a standings email may still go after its time, as for entry reminders. */
const STANDINGS_GRACE_MS = 60 * 60_000;

/** How many leaders a standings email lists, before anyone tied with the last of them. */
const STANDINGS_LEADERS = 10;

export interface LiveStandingsDeps extends LeagueMemberDeps {
  contests: Pick<ContestRepository, 'findByStatuses'>;
  sportEvents: Pick<SportEventRepository, 'findByIds'>;
  /** An event's field, with each golfer's rounds, for when a round finished. */
  eventParticipants: Pick<SportEventParticipantService, 'listEventParticipants'>;
  /** When each event of a season contest settled. */
  eventStandings: Pick<ContestEntryEventStandingRepository, 'findByContest'>;
  leaderboards: Pick<ContestService, 'leaderboardOf'>;
  positions: StandingsEmailPositionRepository;
  leagues: Pick<LeagueRepository, 'findById'>;
  squadMemberships: Pick<SquadMembershipRepository, 'findBySquads'>;
  email: Pick<EmailService, 'send'>;
  readConfig: () => Pick<EmailConfig, 'standingsBufferMinutes'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
}

/** One standings email due for a contest: what it reports on, and the event its board shows. */
interface DueStandings {
  contest: Contest;
  sportEvent: SportEvent;
  moment: StandingsMoment;
  /** The outbox subject: the contest and the moment. */
  about: string;
}

export class LiveStandings implements DueNotifications {
  constructor(private readonly deps: LiveStandingsDeps) {}

  async queueDue(now: Date): Promise<void> {
    const contests = (await this.deps.contests.findByStatuses([ContestStatus.ACTIVE]))
      .filter((contest) => contest.contestFormat === ContestFormat.ROSTER);
    if (contests.length === 0) return;
    const bufferMs = this.deps.readConfig().standingsBufferMinutes * 60_000;
    const sportEvents = new Map((await this.deps.sportEvents.findByIds(
      [...new Set(contests.flatMap((contest) => contest.sportEventIds))],
    )).map((sportEvent) => [sportEvent.id, sportEvent]));
    // One field read per event a sweep, however many contests are on it.
    const fields = new Map<string, Promise<SportEventParticipantView[]>>();
    const fieldOf = (sportEventId: string): Promise<SportEventParticipantView[]> => {
      let field = fields.get(sportEventId);
      if (!field) {
        field = this.deps.eventParticipants.listEventParticipants(sportEventId);
        fields.set(sportEventId, field);
      }
      return field;
    };
    const isDue = (at: Date): boolean => {
      const lateBy = now.getTime() - (at.getTime() + bufferMs);
      return lateBy >= 0 && lateBy <= STANDINGS_GRACE_MS;
    };

    for (const contest of contests) {
      try {
        const contestEvents = contest.sportEventIds
          .map((id) => sportEvents.get(id))
          .filter((sportEvent): sportEvent is SportEvent => sportEvent !== undefined);
        const due = [
          ...await this.dueRoundStandings(contest, contestEvents, fieldOf, isDue),
          ...await this.dueEventResults(contest, contestEvents, isDue),
        ];
        for (const standings of due) {
          await this.queueStandings(standings);
        }
      } catch (error) {
        this.deps.logger?.error({
          action: 'email.liveStandings.failed',
          data: { contestId: contest.id, leagueId: contest.leagueId, error: error instanceof Error ? error.message : String(error) },
        }, 'Failed to queue live standings emails for a contest');
      }
    }
  }

  /** E2: the last finished round of each stroke-play event under way, unless it is the event's last. */
  private async dueRoundStandings(
    contest: Contest,
    contestEvents: SportEvent[],
    fieldOf: (sportEventId: string) => Promise<SportEventParticipantView[]>,
    isDue: (at: Date) => boolean,
  ): Promise<DueStandings[]> {
    const due: DueStandings[] = [];
    for (const sportEvent of contestEvents) {
      if (sportEvent.status !== SportEventStatus.IN_PROGRESS || !sportStoresGolfRoundScores(sportEvent.sport)) continue;
      // With no round count there is no telling the last round, and a one-round event has none to report between.
      if (sportEvent.rounds === undefined || sportEvent.rounds < 2) continue;
      const finished = lastFinishedRound(await fieldOf(sportEvent.id));
      if (!finished || finished.roundNumber >= sportEvent.rounds || !isDue(finished.finishedAt)) continue;
      due.push({
        contest,
        sportEvent,
        moment: { kind: StandingsMomentKind.ROUND, eventName: sportEvent.name, roundNumber: finished.roundNumber },
        about: `${contest.id}:${sportEvent.id}:round-${String(finished.roundNumber)}`,
      });
    }
    return due;
  }

  /** E6: the event of a season contest that settled last, while other events remain to play. */
  private async dueEventResults(
    contest: Contest,
    contestEvents: SportEvent[],
    isDue: (at: Date) => boolean,
  ): Promise<DueStandings[]> {
    if (contestEvents.length < 2) return [];
    const settledAt = new Map<string, Date>();
    for (const standing of await this.deps.eventStandings.findByContest(contest.id)) {
      const earlier = settledAt.get(standing.sportEventId);
      if (!earlier || standing.settledAt < earlier) settledAt.set(standing.sportEventId, standing.settledAt);
    }
    const settled = contestEvents
      .filter((sportEvent) => settledAt.has(sportEvent.id))
      .sort((left, right) => (settledAt.get(left.id)?.getTime() ?? 0) - (settledAt.get(right.id)?.getTime() ?? 0));
    const latest = settled.at(-1);
    const latestAt = latest ? settledAt.get(latest.id) : undefined;
    if (!latest || !latestAt || !isDue(latestAt)) return [];
    const remaining = contestEvents
      .filter((sportEvent) => !settledAt.has(sportEvent.id) && sportEvent.status !== SportEventStatus.CANCELLED)
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
    const next = remaining.at(0);
    if (!next) return [];
    return [{
      contest,
      sportEvent: latest,
      moment: {
        kind: StandingsMomentKind.EVENT,
        eventName: latest.name,
        // A roster contest's picks for an event close at its start.
        nextEvent: {
          name: next.name,
          startsAt: next.startDate,
          ...(next.status === SportEventStatus.SCHEDULED && { picksCloseAt: next.startDate }),
        },
      },
      about: `${contest.id}:${latest.id}:event`,
    }];
  }

  private async queueStandings(due: DueStandings): Promise<void> {
    const { contest, sportEvent, moment } = due;
    const league = await this.deps.leagues.findById(contest.leagueId);
    if (!league) return;
    const [leaderboard, lastPositions] = await Promise.all([
      this.deps.leaderboards.leaderboardOf(contest, sportEvent.id),
      this.deps.positions.findByContest(contest.id),
    ]);
    const format = PARTICIPANT_SCORING_DEFINITIONS[leaderboard.scoringDefinitionId].format;
    const lines = leaderboard.entries.map((row) => toLine(row, lastPositions, format, moment.kind === StandingsMomentKind.EVENT ? sportEvent.id : null));
    const leaders = leaderCount(leaderboard.entries);
    const recipients = await this.recipients(league, leaderboard);
    const leaderboardUrl = buildLeaderboardUrl(this.deps.appBaseUrl, league.leagueCode, contest.id);
    const fieldRows = new Map(leaderboard.participants.map((row) => [row.entry.id, row]));

    await Promise.all(recipients.map(async ({ user, squadIds }) => {
      const isYours = (index: number): boolean => squadIds.has(leaderboard.entries[index].squadId);
      const mark = (line: StandingsLine, index: number): StandingsLine => ({ ...line, isYours: isYours(index) });
      const cut = moment.kind === StandingsMomentKind.ROUND
        ? cutNews(leaderboard.entries.filter((_, index) => isYours(index)), fieldRows, moment.roundNumber)
        : [];
      try {
        await this.deps.email.send('CONTEST_STANDINGS', {
          to: { email: user.email, userId: user.id, timeZone: user.timezone },
          about: due.about,
          league: { id: league.id, name: league.name, leagueCode: league.leagueCode },
          refs: { contestId: contest.id },
          data: {
            userName: formatUserName(user),
            leagueName: league.name,
            contestName: contest.name,
            moment,
            top: lines.slice(0, leaders).map(mark),
            yours: lines.map(mark).slice(leaders).filter((line) => line.isYours),
            entryCount: lines.length,
            cut,
            leaderboardUrl,
          },
        });
      } catch (error) {
        this.deps.logger?.error({
          action: 'email.liveStandings.sendFailed',
          data: { contestId: contest.id, leagueId: league.id, userId: user.id, error: error instanceof Error ? error.message : String(error) },
        }, 'Failed to queue a live standings email');
      }
    }));
    // After the emails, so a sweep that stops part way still measures the rest from the last email.
    await this.deps.positions.record(leaderboard.entries.map((row) => ({ contestEntryId: row.entryId, position: row.position })));
    // Debug: the email stays due for its grace hour, so every sweep in it gets here; each email
    // newly queued is logged once, at info, as email.send.queued.
    this.deps.logger?.debug({
      action: 'email.liveStandings.due',
      data: { contestId: contest.id, leagueId: league.id, sportEventId: sportEvent.id, moment: moment.kind, recipients: recipients.length },
    }, 'Live standings email due; recorded for each recipient');
  }

  /** The league's active commissioners and the active members who own an entry on the board, each once. */
  private async recipients(league: League, leaderboard: ContestLeaderboardModel): Promise<Array<{ user: User; squadIds: Set<string> }>> {
    const [members, memberships, owners] = await Promise.all([
      activeLeagueMembers(this.deps, league.id),
      this.deps.memberships.findByLeague(league.id),
      this.deps.squadMemberships.findBySquads([...new Set(leaderboard.entries.map((row) => row.squadId))]),
    ]);
    const commissioners = new Set(memberships
      .filter((membership) => membership.role === LeagueRole.COMMISSIONER && membership.status === LeagueMembershipStatus.ACTIVE)
      .map((membership) => membership.userId));
    const squadsByOwner = new Map<string, Set<string>>();
    for (const owner of owners) {
      squadsByOwner.set(owner.userId, (squadsByOwner.get(owner.userId) ?? new Set<string>()).add(owner.squadId));
    }
    return members
      .filter((user) => commissioners.has(user.id) || squadsByOwner.has(user.id))
      .map((user) => ({ user, squadIds: squadsByOwner.get(user.id) ?? new Set<string>() }));
  }
}

/** The first 10 entries, and any tied with the 10th. */
function leaderCount(entries: readonly ContestLeaderboardEntryRow[]): number {
  const last = entries.at(STANDINGS_LEADERS - 1);
  if (last?.position == null) return Math.min(STANDINGS_LEADERS, entries.length);
  let count = STANDINGS_LEADERS;
  while (count < entries.length && entries[count].position === last.position) count += 1;
  return count;
}

function toLine(
  row: ContestLeaderboardEntryRow,
  lastPositions: ReadonlyMap<string, number>,
  format: (value: number) => string,
  resultEventId: string | null,
): StandingsLine {
  const last = lastPositions.get(row.entryId);
  const result = resultEventId === null ? undefined : row.events.find((event) => event.sportEventId === resultEventId);
  return {
    place: row.displayPosition,
    entryName: row.entryName,
    squadName: row.squadName,
    score: row.score === null ? null : format(row.score),
    movement: last === undefined || row.position === null ? null : last - row.position,
    isYours: false,
    ...(result && { eventResult: `${result.displayPosition ?? '-'}, ${result.score === null ? '-' : format(result.score)}` }),
  };
}

/** The reader's picks cut in `roundNumber`, by entry. */
function cutNews(
  entries: readonly ContestLeaderboardEntryRow[],
  fieldRows: ReadonlyMap<string, SportEventParticipantView>,
  roundNumber: number,
): StandingsCutNews[] {
  return entries.flatMap((row) => {
    const names = row.picks.flatMap((pick) => {
      const fieldRow = fieldRows.get(pick.sportEventParticipantId);
      const round = fieldRow?.rounds.find((candidate) => candidate.round.roundNumber === roundNumber);
      return fieldRow && round?.round.status === ParticipantRoundStatus.MISSED_CUT ? [fieldRow.participant.name] : [];
    });
    return names.length > 0 ? [{ entryName: row.entryName, names }] : [];
  });
}
