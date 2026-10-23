/**
 * Live standings emails (#877, `plans/email-notifications.md` §3 E): while a roster, pick'em or
 * survivor contest is live, where it stands after each round, event and week.
 *
 * - **Round standings (E2):** a stroke-play round is finished (see `lastFinishedRound`). Not
 *   after an event's last round: the event's result, or the contest's final results, cover it.
 * - **Event results (E6):** one event of a season contest settles, and more events remain. Not
 *   after the last one: the contest's final results cover it.
 * - **Week results (E3):** one week of a pick'em or survivor contest settles, and more weeks
 *   remain: the week's winners and leaders in pick'em, how many are still in for survivor, and
 *   next week's first kickoff. A survivor reader whose entry went out that week is told so in the
 *   same email (E5). A playoff event a survivor contest plays a week per round settles, and is
 *   reported, once, as the event.
 *
 * Each goes once its moment is a buffer old (EMAIL_CONFIG.standingsBufferMinutes, Q3.11), so a
 * late correction lands first, and only within the hour after that: past it the moment is gone.
 * The lifecycle scheduler's "notifications due" step calls `queueDue` on every sweep. The first
 * sweep in that hour queues the email and records the board's places; later sweeps find the email
 * already in the outbox and leave both alone, so the next email's movement is measured from the
 * places this one showed, whatever a correction changes after it. The outbox idempotency key (the
 * contest, the moment and the person) keeps two sweeps that overlap from sending it twice.
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
  LeagueRole,
  PARTICIPANT_SCORING_DEFINITIONS,
  ParticipantRoundStatus,
  SelectionType,
  SportEventStatus,
  type Contest,
  type League,
  type SportEvent,
  type User,
} from '@poolmaster/shared/domain';
import type { ContestLeaderboardEntryRow } from '../../mappers/contests.mapper';
import type { ContestService } from '../contests/service';
import {
  StandingsMomentKind,
  buildContestUrl,
  buildLeaderboardUrl,
  formatUserName,
  type ContestStandingsEmailData,
  type EmailService,
  type StandingsCutNews,
  type StandingsElimination,
  type StandingsLine,
  type StandingsMoment,
  type StandingsNextWeek,
} from '../email';
import type { DueNotifications } from '../events/event-lifecycle-scheduler';
import type { SportEventParticipantService, SportEventParticipantView } from '../events/sport-event-participant-service';
import { sportStoresGolfRoundScores } from '../scoring-families/golf-round-scores';
import { lastFinishedRound } from '../scoring-families/stroke-play/finished-rounds';
import { activeLeagueMembersWithRoles, type LeagueMemberDeps } from './league-members';

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
  leaderboards: Pick<ContestService, 'leaderboardOf' | 'pickEmLeaderboardOf' | 'survivorLeaderboardOf'>;
  positions: StandingsEmailPositionRepository;
  leagues: Pick<LeagueRepository, 'findById'>;
  squadMemberships: Pick<SquadMembershipRepository, 'findBySquads'>;
  email: Pick<EmailService, 'send' | 'hasRecordedForContest'>;
  readConfig: () => Pick<EmailConfig, 'standingsBufferMinutes'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
}

/** Events that will not be played on: once finished, an event is either settled or counts for nothing. */
const FINISHED_EVENT_STATUSES: readonly SportEventStatus[] = [SportEventStatus.COMPLETED, SportEventStatus.CANCELLED];

/** One standings email due for a contest: what it reports on, and how to read its board. */
interface DueStandings {
  contest: Contest;
  sportEvent: SportEvent;
  /** The outbox subject: the contest and the moment. */
  about: string;
  board: (lastPositions: ReadonlyMap<string, number>, league: League) => Promise<StandingsBoard>;
}

/** One entry on a standings email's board. */
interface StandingsBoardRow {
  entryId: string;
  squadId: string;
  /** Its place as a number, for ties and movement; null with nothing scored. */
  position: number | null;
  line: StandingsLine;
}

/** A standings email's board: the moment, the contest's entries best first, and each reader's own news. */
interface StandingsBoard {
  /** The moment as one reader sees it: a pick'em week's leaders mark the reader's entries. */
  momentFor: (ownsSquad: (squadId: string) => boolean) => StandingsMoment;
  rows: StandingsBoardRow[];
  personal: (ownsSquad: (squadId: string) => boolean) => Pick<ContestStandingsEmailData, 'cut' | 'out' | 'picksUrl'>;
}

/** The event of a season contest that settled last, if it is due, and the next one still to play. */
interface LatestSettled {
  latest: SportEvent;
  next: SportEvent;
}

export class LiveStandings implements DueNotifications {
  constructor(private readonly deps: LiveStandingsDeps) {}

  async queueDue(now: Date): Promise<void> {
    const contests = (await this.deps.contests.findByStatuses([ContestStatus.ACTIVE]))
      .filter((contest) => contest.contestFormat === ContestFormat.ROSTER
        || contest.selectionType === SelectionType.PICK_EM
        || contest.selectionType === SelectionType.SURVIVOR);
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
        const due = contest.contestFormat === ContestFormat.ROSTER
          ? [
            ...await this.dueRoundStandings(contest, contestEvents, fieldOf, isDue),
            ...await this.dueEventResults(contest, contestEvents, isDue),
          ]
          : await this.dueWeekResults(contest, contestEvents, isDue);
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
      const roundNumber = finished.roundNumber;
      due.push({
        contest,
        sportEvent,
        about: `${contest.id}:${sportEvent.id}:round-${String(roundNumber)}`,
        board: (lastPositions) => this.rosterBoard(
          contest,
          sportEvent,
          { kind: StandingsMomentKind.ROUND, eventName: sportEvent.name, roundNumber },
          lastPositions,
        ),
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
    const settled = await this.latestSettled(contest, contestEvents, isDue);
    if (!settled) return [];
    const { latest, next } = settled;
    const moment: StandingsMoment = {
      kind: StandingsMomentKind.EVENT,
      eventName: latest.name,
      // A roster contest's picks for an event close at its start.
      nextEvent: {
        name: next.name,
        startsAt: next.startDate,
        ...(next.status === SportEventStatus.SCHEDULED && { picksCloseAt: next.startDate }),
      },
    };
    return [{
      contest,
      sportEvent: latest,
      about: `${contest.id}:${latest.id}:event`,
      board: (lastPositions) => this.rosterBoard(contest, latest, moment, lastPositions),
    }];
  }

  /** E3 (with E5): the week of a pick'em or survivor contest that settled last, while other weeks remain to play. */
  private async dueWeekResults(
    contest: Contest,
    contestEvents: SportEvent[],
    isDue: (at: Date) => boolean,
  ): Promise<DueStandings[]> {
    const settled = await this.latestSettled(contest, contestEvents, isDue);
    if (!settled) return [];
    const { latest, next } = settled;
    // Each game's picks lock at its kickoff, so the week's first kickoff is when its first picks lock.
    const nextWeek: StandingsNextWeek = { name: next.name, firstKickoffAt: next.startDate };
    return [{
      contest,
      sportEvent: latest,
      about: `${contest.id}:${latest.id}:week`,
      board: (lastPositions, league) => {
        const picksUrl = buildContestUrl(this.deps.appBaseUrl, league.leagueCode, contest.id);
        return contest.selectionType === SelectionType.SURVIVOR
          ? this.survivorBoard(contest, latest, nextWeek, picksUrl, lastPositions)
          : this.pickEmBoard(contest, latest, nextWeek, picksUrl, lastPositions);
      },
    }];
  }

  /**
   * The event of a season contest that settled last, by when its standings froze, when that is
   * due and another event remains to play. Not after the last one: the final results cover it.
   */
  private async latestSettled(
    contest: Contest,
    contestEvents: SportEvent[],
    isDue: (at: Date) => boolean,
  ): Promise<LatestSettled | null> {
    if (contestEvents.length < 2) return null;
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
    if (!latest || !latestAt || !isDue(latestAt)) return null;
    const next = contestEvents
      .filter((sportEvent) => !settledAt.has(sportEvent.id) && !FINISHED_EVENT_STATUSES.includes(sportEvent.status))
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime())
      .at(0);
    return next ? { latest, next } : null;
  }

  /** A roster contest's board: its leaderboard as of the event, with cut news for a round. */
  private async rosterBoard(
    contest: Contest,
    sportEvent: SportEvent,
    moment: StandingsMoment,
    lastPositions: ReadonlyMap<string, number>,
  ): Promise<StandingsBoard> {
    const leaderboard = await this.deps.leaderboards.leaderboardOf(contest, sportEvent.id);
    const format = PARTICIPANT_SCORING_DEFINITIONS[leaderboard.scoringDefinitionId].format;
    const resultEventId = moment.kind === StandingsMomentKind.EVENT ? sportEvent.id : null;
    const fieldRows = new Map(leaderboard.participants.map((row) => [row.entry.id, row]));
    return {
      momentFor: () => moment,
      rows: leaderboard.entries.map((row) => ({
        entryId: row.entryId,
        squadId: row.squadId,
        position: row.position,
        line: toLine(row, lastPositions, format, resultEventId),
      })),
      personal: (ownsSquad) => ({
        cut: moment.kind === StandingsMomentKind.ROUND
          ? cutNews(leaderboard.entries.filter((row) => ownsSquad(row.squadId)), fieldRows, moment.roundNumber)
          : [],
        out: [],
      }),
    };
  }

  /** A pick'em contest's board: the season's points, with the week's winners and leaders. */
  private async pickEmBoard(
    contest: Contest,
    sportEvent: SportEvent,
    nextWeek: StandingsNextWeek,
    picksUrl: string,
    lastPositions: ReadonlyMap<string, number>,
  ): Promise<StandingsBoard> {
    const leaderboard = await this.deps.leaderboards.pickEmLeaderboardOf(contest);
    const winnerIds = new Set(leaderboard.weeks.find((week) => week.sportEventId === sportEvent.id)?.winnerEntryIds);
    const weekRows = leaderboard.entries
      .flatMap((entry) => {
        const week = entry.weeks.find((candidate) => candidate.sportEventId === sportEvent.id);
        return week?.position == null ? [] : [{ entry, week, position: week.position }];
      })
      .sort((left, right) => left.position - right.position);
    const weekLeaders = weekRows.slice(0, leaderCount(weekRows));
    return {
      momentFor: (ownsSquad) => ({
        kind: StandingsMomentKind.PICK_EM_WEEK,
        eventName: sportEvent.name,
        winners: leaderboard.entries
          .filter((entry) => winnerIds.has(entry.entryId))
          .map((entry) => ({ entryName: entry.entryName, squadName: entry.squadName })),
        weekLeaders: weekLeaders.map(({ entry, week }) => ({
          place: week.displayPosition,
          entryName: entry.entryName,
          squadName: entry.squadName,
          score: week.points === null ? null : String(week.points),
          movement: null,
          isYours: ownsSquad(entry.squadId),
        })),
        weekEntryCount: weekRows.length,
        nextWeek,
      }),
      rows: leaderboard.entries.map((entry) => ({
        entryId: entry.entryId,
        squadId: entry.squadId,
        position: entry.position,
        line: {
          place: entry.displayPosition,
          entryName: entry.entryName,
          squadName: entry.squadName,
          score: entry.position === null ? null : String(entry.totalPoints),
          movement: movementOf(entry.entryId, entry.position, lastPositions),
          isYours: false,
        },
      })),
      personal: (ownsSquad) => ({
        cut: [],
        out: [],
        // Every week is picked afresh: a reader with an entry has picks to make.
        ...(leaderboard.entries.some((entry) => ownsSquad(entry.squadId)) && { picksUrl }),
      }),
    };
  }

  /** A survivor contest's board: entries still in first, then weeks survived, and the reader's entries out this week. */
  private async survivorBoard(
    contest: Contest,
    sportEvent: SportEvent,
    nextWeek: StandingsNextWeek,
    picksUrl: string,
    lastPositions: ReadonlyMap<string, number>,
  ): Promise<StandingsBoard> {
    const leaderboard = await this.deps.leaderboards.survivorLeaderboardOf(contest);
    const eventWeeks = leaderboard.weeks.filter((week) => week.sportEventId === sportEvent.id);
    const lastWeek = eventWeeks.at(-1);
    const outThisWeek = new Map<string, StandingsElimination>();
    for (const entry of leaderboard.entries) {
      const week = entry.eliminatedInWeek === null ? undefined : leaderboard.weeks.at(entry.eliminatedInWeek - 1);
      if (week?.sportEventId !== sportEvent.id) continue;
      outThisWeek.set(entry.entryId, {
        entryName: entry.entryName,
        team: entry.weeks.find((candidate) => candidate.sportEventId === week.sportEventId && candidate.roundNumber === week.roundNumber)?.team ?? null,
        roundNumber: week.roundCount > 1 ? week.roundNumber : null,
      });
    }
    return {
      momentFor: () => ({
        kind: StandingsMomentKind.SURVIVOR_WEEK,
        eventName: sportEvent.name,
        stillIn: lastWeek?.aliveCount ?? leaderboard.entries.filter((entry) => entry.alive).length,
        nextWeek,
      }),
      rows: leaderboard.entries.map((entry) => ({
        entryId: entry.entryId,
        squadId: entry.squadId,
        position: entry.position,
        line: {
          place: entry.displayPosition,
          entryName: entry.entryName,
          squadName: entry.squadName,
          score: String(entry.weeksSurvived),
          movement: movementOf(entry.entryId, entry.position, lastPositions),
          isYours: false,
          isOut: !entry.alive,
        },
      })),
      personal: (ownsSquad) => {
        const yours = leaderboard.entries.filter((entry) => ownsSquad(entry.squadId));
        return {
          cut: [],
          out: yours.flatMap((entry) => {
            const out = outThisWeek.get(entry.entryId);
            return out ? [out] : [];
          }),
          // Only an entry still in picks next week.
          ...(yours.some((entry) => entry.alive) && { picksUrl }),
        };
      },
    };
  }

  private async queueStandings(due: DueStandings): Promise<void> {
    const { contest, sportEvent } = due;
    if (await this.deps.email.hasRecordedForContest('CONTEST_STANDINGS', contest.id, due.about)) return;
    const league = await this.deps.leagues.findById(contest.leagueId);
    if (!league) return;
    const board = await due.board(await this.deps.positions.findByContest(contest.id), league);
    const { rows } = board;
    const leaders = leaderCount(rows);
    const recipients = await this.recipients(league, rows);
    const leaderboardUrl = buildLeaderboardUrl(this.deps.appBaseUrl, league.leagueCode, contest.id);

    await Promise.all(recipients.map(async ({ user, squadIds }) => {
      const ownsSquad = (squadId: string): boolean => squadIds.has(squadId);
      const lines = rows.map((row) => ({ ...row.line, isYours: ownsSquad(row.squadId) }));
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
            moment: board.momentFor(ownsSquad),
            top: lines.slice(0, leaders),
            yours: lines.slice(leaders).filter((line) => line.isYours),
            entryCount: lines.length,
            leaderboardUrl,
            ...board.personal(ownsSquad),
          },
        });
      } catch (error) {
        this.deps.logger?.error({
          action: 'email.liveStandings.sendFailed',
          data: { contestId: contest.id, leagueId: league.id, userId: user.id, error: error instanceof Error ? error.message : String(error) },
        }, 'Failed to queue a live standings email');
      }
    }));
    // After the emails: the places they showed are the next email's baseline.
    await this.deps.positions.record(rows.map((row) => ({ contestEntryId: row.entryId, position: row.position })));
    this.deps.logger?.info({
      action: 'email.liveStandings.queued',
      data: { contestId: contest.id, leagueId: league.id, sportEventId: sportEvent.id, about: due.about, recipients: recipients.length },
    }, 'Live standings email queued for each recipient');
  }

  /** The league's active commissioners and the active members who own an entry on the board, each once. */
  private async recipients(league: League, rows: readonly StandingsBoardRow[]): Promise<Array<{ user: User; squadIds: Set<string> }>> {
    const [members, owners] = await Promise.all([
      activeLeagueMembersWithRoles(this.deps, league.id),
      this.deps.squadMemberships.findBySquads([...new Set(rows.map((row) => row.squadId))]),
    ]);
    const squadsByOwner = new Map<string, Set<string>>();
    for (const owner of owners) {
      squadsByOwner.set(owner.userId, (squadsByOwner.get(owner.userId) ?? new Set<string>()).add(owner.squadId));
    }
    return members
      .filter(({ user, role }) => role === LeagueRole.COMMISSIONER || squadsByOwner.has(user.id))
      .map(({ user }) => ({ user, squadIds: squadsByOwner.get(user.id) ?? new Set<string>() }));
  }
}

/** The first 10 entries, and any tied with the 10th. */
function leaderCount(entries: ReadonlyArray<{ position: number | null }>): number {
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
  const result = resultEventId === null ? undefined : row.events.find((event) => event.sportEventId === resultEventId);
  return {
    place: row.displayPosition,
    entryName: row.entryName,
    squadName: row.squadName,
    score: row.score === null ? null : format(row.score),
    movement: movementOf(row.entryId, row.position, lastPositions),
    isYours: false,
    ...(result && { eventResult: { place: result.displayPosition, score: result.score === null ? null : format(result.score) } }),
  };
}

/** Places gained since the last standings email; null with no place then or now. */
function movementOf(entryId: string, position: number | null, lastPositions: ReadonlyMap<string, number>): number | null {
  const last = lastPositions.get(entryId);
  return last === undefined || position === null ? null : last - position;
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
