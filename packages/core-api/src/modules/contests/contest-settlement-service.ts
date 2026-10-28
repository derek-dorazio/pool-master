import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestEntryEventStandingRepository,
  ContestEntryStandingRepository,
  ContestRepository,
  ContestSquaresRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import {
  ContestStatus,
  MatchStatus,
  SelectionType,
  SportEventStatus,
  SurvivorWeekOutcome,
  matchPeriodsOf,
  hasEverySquaresScoringMoment,
  squaresScoringMoments,
  squaresWinners,
  type Contest,
  type SportEvent,
} from '@poolmaster/shared/domain';
import { loadPickEmScoring, loadPickEmWeekStandings, PickEmRulesMissingError } from './pick-em-standings';
import type { GamePickScoring } from '../scoring-families/head-to-head/game-picks';
import { loadSurvivorSeason, type SurvivorStandingsReadDeps } from './survivor-standings';
import {
  BracketScoringUnavailableError,
  loadBracketStandings,
  type BracketStandingsReadDeps,
} from './bracket-standings';
import {
  buildContestEntryStanding,
  buildMissedEventStanding,
  rankContestEntryStandings,
  rankContestTotals,
  type ContestEntryTotal,
  resolveContestCountingRule,
  resolveContestScoringDefinition,
  type ParticipantScore,
} from './contest-leaderboard-calculator';
import {
  loadContestLeaderboardEntries,
  loadContestScoringConfiguration,
  loadEventField,
  loadMissedEventEntries,
  scoreMissedLineup,
  toParticipantScores,
} from './contest-leaderboard-reads';
import { FINISHED_EVENT_STATUSES } from './entry-window';
import { readEventMatchesOnce, readEventsOnce, readOncePerKey } from '../events/event-reads';
import type { ChampionshipService } from '../championship/service';
import type { ContestSettledNotice } from '../notifications/contest-notices';

type LifecycleLogger = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn' | 'error' | 'fatal'>;

function createNoopLogger(): LifecycleLogger {
  const noop = () => undefined;
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
  };
}


/**
 * What settlement never touches: a contest already settled, and a DRAFT. A draft
 * leaves only by being opened or deleted (#117), so completing one would publish a contest
 * nobody could enter to the league as finished. Its event starting leaves it a draft too.
 */
const NOT_SETTLED: readonly ContestStatus[] = [ContestStatus.COMPLETED, ContestStatus.DRAFT];

/** Every status settlement may complete a contest from. */
const SETTLEABLE = Object.values(ContestStatus).filter((status) => !NOT_SETTLED.includes(status));

/*
 * A CANCELLED event counts as settled with no result for anyone (#743): it writes no standings
 * and adds nothing to any total, so a contest whose events are each completed or cancelled
 * (`FINISHED_EVENT_STATUSES`) settles on the completed ones. A contest whose every event is
 * cancelled completes with no standings.
 */

export interface ContestSettlementSummary {
  sportEventId: string;
  contestsSettled: number;
  contestsCompleted: number;
  standingsUpserted: number;
}

export interface ContestSettlementDeps extends BracketStandingsReadDeps {
  predictions: BracketStandingsReadDeps['predictions'] & SurvivorStandingsReadDeps['predictions'];
  matches: BracketStandingsReadDeps['matches'] & SurvivorStandingsReadDeps['matches'];
  sportEvents: SportEventRepository;
  contests: ContestRepository;
  standings: ContestEntryStandingRepository;
  eventStandings: ContestEntryEventStandingRepository;
  squares: Pick<ContestSquaresRepository, 'findSquares' | 'findDraw' | 'replaceWinners'>;
  championship: Pick<ChampionshipService, 'recordContest'>;
  /** The final results email (#845 F1, F2), queued once a contest completes. */
  contestSettled?: ContestSettledNotice;
  logger?: LifecycleLogger;
}

/**
 * The reads a settlement fan-out shares across its contests (#1199): the events, their matches
 * and fields, each read once however many contests are on the event.
 */
type SettlementReads = Omit<ContestSettlementDeps, 'sportEvents'> & {
  sportEvents: Pick<SportEventRepository, 'findByIds'>;
};

export class ContestSettlementService {
  private readonly logger: LifecycleLogger;

  constructor(private readonly deps: ContestSettlementDeps) {
    this.logger = deps.logger ?? createNoopLogger();
  }

  /** Settles the contests of a finished event: one that completed, or one that was cancelled. */
  async settleFinishedSportEvent(
    sportEventId: string,
    input?: { completedAt?: Date },
  ): Promise<ContestSettlementSummary> {
    const sportEvent = await this.deps.sportEvents.findById(sportEventId);
    if (!sportEvent || !FINISHED_EVENT_STATUSES.includes(sportEvent.status)) {
      return {
        sportEventId,
        contestsSettled: 0,
        contestsCompleted: 0,
        standingsUpserted: 0,
      };
    }

    const completedAt = input?.completedAt ?? sportEvent.endDate ?? sportEvent.startDate;
    const cancelled = sportEvent.status === SportEventStatus.CANCELLED;
    const reads = this.sharedReads(sportEvent);
    // The field is the event's, read once; each contest scores it under its own settings below.
    // A cancelled event is never scored, whatever scores it holds.
    const field = cancelled ? [] : await loadEventField(reads, sportEventId);
    // A COMPLETED contest is already settled: its standing is the frozen result, and re-running
    // settlement (the event re-sent as COMPLETED, or a late score correction) must not rewrite
    // it. Only a contest moved back out of COMPLETED would be settled again, and no route does
    // that today: the reopen endpoint, which nothing called, was deleted. In a contest of several
    // events (#713) each event's standings freeze the same way when that event settles, and the
    // contest itself settles when its last event does.
    const contests = await this.deps.contests.findBySportEvent(sportEventId, {
      excludeStatuses: NOT_SETTLED,
    });

    let standingsUpserted = 0;
    let contestsCompleted = 0;
    let contestsSettled = 0;
    for (const contest of contests) {
      if (contest.selectionType === SelectionType.BRACKET) {
        const settled = await this.settleBracketContest(reads, contest, sportEvent, completedAt);
        if (settled) {
          contestsSettled++;
          standingsUpserted += settled.standingsUpserted;
          if (settled.completed) contestsCompleted++;
        }
        continue;
      }
      if (contest.selectionType === SelectionType.SURVIVOR) {
        const settled = await this.settleSurvivorWeek(reads, contest, sportEvent, completedAt);
        contestsSettled++;
        standingsUpserted += settled.standingsUpserted;
        if (settled.completed) contestsCompleted++;
        continue;
      }
      if (contest.selectionType === SelectionType.SQUARES) {
        // Its game normally settles it first (`settleFinishedGame`); an event finished without
        // that game's result leaves it Final with no scores.
        const settled = await this.settleSquaresContest(reads, contest, sportEvent, completedAt);
        contestsSettled++;
        standingsUpserted += settled.standingsUpserted;
        if (settled.completed) contestsCompleted++;
        continue;
      }
      if (contest.selectionType === SelectionType.PICK_EM) {
        const settled = await this.settlePickEmWeek(reads, contest, sportEvent, completedAt);
        if (settled) {
          contestsSettled++;
          standingsUpserted += settled.standingsUpserted;
          if (settled.completed) contestsCompleted++;
        }
        continue;
      }
      const configuration = await loadContestScoringConfiguration(this.deps, contest.id);
      const countingRule = resolveContestCountingRule(configuration);
      if (!countingRule) {
        this.logger.error({
          contestId: contest.id,
          sportEventId,
        }, 'Skipped contest settlement because contest has no counting rule');
        continue;
      }
      const scoring = resolveContestScoringDefinition(configuration);
      if (!scoring.ok) {
        // Skip rather than guess a direction or settings. Settling with the wrong direction or
        // under rules the commissioner did not set pays the wrong entries, and a payout is hard
        // to undo; a skipped settlement is logged at error and can be run again once the
        // configuration carries a rule naming a known definition with valid settings. The
        // leaderboard read refuses the same cases with 400, because nothing is paid.
        this.logger.error({
          contestId: contest.id,
          sportEventId,
          reason: scoring.reason,
        }, 'Skipped contest settlement because its participant scoring rule is missing, names an unknown scoring definition, or carries invalid settings');
        continue;
      }
      const scoringDefinition = scoring.definition;
      // Scored per contest: a contest's settings (a points table) change its participants' scores.
      const participants = toParticipantScores(field, sportEvent, scoring.scoring);
      const scoreById = new Map(
        participants.map((participant) => [participant.sportEventParticipantId, participant]),
      );
      const asOf = resolveContestStandingAsOf(participants, completedAt);
      // poolmaster-allow-query-in-loop: #1172
      const settledEvents = await this.deps.eventStandings.findByContest(contest.id);
      if (!cancelled && !settledEvents.some((standing) => standing.sportEventId === sportEventId)) {
        const entries = await loadContestLeaderboardEntries(this.deps, contest.id, sportEventId);
        // In a contest of several events, an entry that missed this one is scored as a missed
        // lineup (#714) and ranked with the rest, so skipping an event never helps its total.
        const missed = await loadMissedEventEntries(this.deps, contest, new Set(entries.map((entry) => entry.id)));
        const missedScore = missed.length > 0
          ? scoreMissedLineup(field, sportEvent, scoring.scoring, countingRule.count)
          : null;
        const rankedEntries = rankContestEntryStandings(
          [
            ...entries.map((entry) =>
              buildContestEntryStanding(entry, scoreById, countingRule, scoringDefinition.direction),
            ),
            ...missed.map((entry) => buildMissedEventStanding(entry, missedScore, countingRule, scoringDefinition.direction)),
          ],
          scoringDefinition.direction,
        );
        for (const entry of rankedEntries) {
          // The single writer of ContestEntryEventStanding.
          // poolmaster-allow-query-in-loop: #1172
          await this.deps.eventStandings.upsert({
            contestId: contest.id,
            contestEntryId: entry.entryId,
            sportEventId,
            position: entry.position,
            displayPosition: entry.displayPosition,
            countingPickLimit: entry.countingPickLimit,
            scoredPickCount: entry.scoredPickCount,
            asOf,
            settledAt: completedAt,
            totalScore: entry.score,
          });
        }
      }
      contestsSettled++;

      if (!(await this.allEventsFinished(reads, contest))) {
        this.logger.info({
          contestId: contest.id,
          sportEventId,
        }, 'Settled one event of a contest whose other events are still to finish');
        continue;
      }
      standingsUpserted += await this.settleContestTotals(contest, countingRule.count, scoringDefinition.direction, completedAt);

      const completed = await this.complete(contest, completedAt);
      if (completed) {
        contestsCompleted++;
      }
    }

    this.logger.info({
      sportEventId,
      sportEventName: sportEvent.name,
      contestsSettled,
      contestsCompleted,
      standingsUpserted,
      cancelled,
    }, 'Contest settlement completed from finished sport event');

    return {
      sportEventId,
      contestsSettled,
      contestsCompleted,
      standingsUpserted,
    };
  }

  /**
   * Settles the squares contests played on one game (#711) once the game is decided: its result is
   * in, or it was cancelled. They settle with their game, not with its event, which may run on for
   * weeks (the Super Bowl is the last game of the NFL playoffs). Answers how many it completed.
   */
  async settleFinishedGame(sportEventId: string, sportEventMatchId: string, input?: { completedAt?: Date }): Promise<number> {
    const sportEvent = await this.deps.sportEvents.findById(sportEventId);
    if (!sportEvent) return 0;
    const contests = (await this.deps.contests.findBySportEvent(sportEventId, { excludeStatuses: NOT_SETTLED }))
      .filter((contest) => contest.selectionType === SelectionType.SQUARES && contest.squaresGameMatchId === sportEventMatchId);
    const reads = this.sharedReads(sportEvent);
    let completed = 0;
    for (const contest of contests) {
      const settled = await this.settleSquaresContest(reads, contest, sportEvent, input?.completedAt ?? new Date(), { waitForEveryPeriod: true });
      if (settled.completed) completed++;
    }
    return completed;
  }

  /**
   * Settles a squares contest (#711): each scoring moment's winning box is frozen (design Q3.7),
   * and each entry holding a box is placed by the moments it won, ties shared. A game not played to
   * a result (cancelled, or its event finished without it), or a grid whose numbers were never
   * drawn, ends the contest Final with no winners and no standings (#743). With
   * `waitForEveryPeriod`, a drawn game whose result is in but a quarter's score is not stays as it
   * is, so the contest settles once that score is entered, with all four winners.
   */
  private async settleSquaresContest(
    reads: SettlementReads,
    contest: Contest,
    sportEvent: SportEvent,
    completedAt: Date,
    options?: { waitForEveryPeriod?: boolean },
  ): Promise<{ standingsUpserted: number; completed: boolean }> {
    const [games, draw] = await Promise.all([
      reads.matches.findBySportEvent(sportEvent.id),
      this.deps.squares.findDraw(contest.id),
    ]);
    const game = games.find((candidate) => candidate.id === contest.squaresGameMatchId);
    const periodCount = matchPeriodsOf(sportEvent.sport, sportEvent.matchPeriodLayout ?? null)?.count;
    let standingsUpserted = 0;
    if (game?.status === MatchStatus.COMPLETED && draw && periodCount !== undefined) {
      const moments = squaresScoringMoments(game, periodCount);
      if (options?.waitForEveryPeriod === true && !hasEverySquaresScoringMoment(moments, periodCount)) {
        this.logger.info({
          contestId: contest.id,
          sportEventId: sportEvent.id,
          sportEventMatchId: contest.squaresGameMatchId,
          scoredPeriods: moments.map((moment) => moment.periodNumber),
        }, 'Squares contest waits for every quarter score before settling');
        return { standingsUpserted: 0, completed: false };
      }
      const boxes = await this.deps.squares.findSquares(contest.id);
      const winners = squaresWinners(draw, moments, boxes);
      await this.deps.squares.replaceWinners(contest.id, winners.map((winner) => ({ ...winner, contestId: contest.id, settledAt: completedAt })));
      const holders = [...new Set(boxes.map((box) => box.contestEntryId))];
      const won = (entryId: string) => winners.filter((winner) => winner.contestEntryId === entryId).length;
      for (const entryId of holders) {
        const score = won(entryId);
        const position = 1 + holders.filter((other) => won(other) > score).length;
        const sharing = holders.filter((other) => won(other) === score).length;
        const boxCount = boxes.filter((box) => box.contestEntryId === entryId).length;
        const frozen = {
          contestId: contest.id,
          contestEntryId: entryId,
          position,
          displayPosition: sharing > 1 ? `T${position}` : String(position),
          // No pick is scored: the closest meaning of the two pick counts is the boxes held.
          countingPickLimit: boxCount,
          scoredPickCount: boxCount,
          asOf: completedAt,
          settledAt: completedAt,
          totalScore: score,
        };
        // poolmaster-allow-query-in-loop: #1172
        await this.deps.eventStandings.upsert({ ...frozen, sportEventId: sportEvent.id });
        // poolmaster-allow-query-in-loop: #1172
        await this.deps.standings.upsert(frozen);
      }
      standingsUpserted = holders.length;
    }
    const completed = await this.complete(contest, completedAt);
    this.logger.info({
      contestId: contest.id,
      sportEventId: sportEvent.id,
      sportEventMatchId: contest.squaresGameMatchId,
      gameStatus: game?.status,
      drawn: draw !== null,
      standingsUpserted,
      completed,
    }, 'Settled a squares contest');
    return { standingsUpserted, completed };
  }

  /**
   * Settles a bracket contest (#721), which covers its one knockout event: each submitted entry's
   * points and place, frozen as both its event standing and its contest standing, then the contest
   * is COMPLETED. Answers what it wrote, or null when a bracket whose scoring rule is not knockout
   * round points is skipped and logged, as a roster contest without a usable rule is. A cancelled
   * event is its only event, so the bracket completes with no standings (#743).
   */
  private async settleBracketContest(
    reads: SettlementReads,
    contest: Contest,
    sportEvent: SportEvent,
    completedAt: Date,
  ): Promise<{ standingsUpserted: number; completed: boolean } | null> {
    const sportEventId = sportEvent.id;
    if (sportEvent.status === SportEventStatus.CANCELLED) {
      const completed = await this.complete(contest, completedAt);
      this.logger.info({ contestId: contest.id, sportEventId, completed }, 'Completed a bracket contest whose event was cancelled, with no standings');
      return { standingsUpserted: 0, completed };
    }
    let standings: Awaited<ReturnType<typeof loadBracketStandings>>;
    try {
      standings = await loadBracketStandings(reads, contest.id, sportEvent);
    } catch (error) {
      if (!(error instanceof BracketScoringUnavailableError)) throw error;
      this.logger.error({ contestId: contest.id, sportEventId, reason: error.reason }, 'Skipped bracket contest settlement because it cannot be scored');
      return null;
    }
    for (const standing of standings.entries) {
      const frozen = {
        contestId: contest.id,
        contestEntryId: standing.entry.id,
        position: standing.position,
        displayPosition: standing.displayPosition,
        // A bracket counts every pick: the limit is its game count, and a pick is scored once decided.
        countingPickLimit: standings.gameCount,
        scoredPickCount: standing.score.decidedPickCount,
        asOf: completedAt,
        settledAt: completedAt,
        totalScore: standing.score.points,
      };
      // poolmaster-allow-query-in-loop: #1172
      await this.deps.eventStandings.upsert({ ...frozen, sportEventId });
      // poolmaster-allow-query-in-loop: #1172
      await this.deps.standings.upsert(frozen);
    }
    const completed = await this.complete(contest, completedAt);
    this.logger.info({ contestId: contest.id, sportEventId, entryCount: standings.entries.length, completed }, 'Settled a bracket contest');
    return { standingsUpserted: standings.entries.length, completed };
  }

  /**
   * Settles one week of a pick'em contest (#717): each submitted entry's points and place for the
   * week, frozen as its event standing, where place 1 is the week's winner. A week settles once:
   * a result corrected after it changes nothing. When the contest's last week settles, the season
   * totals are summed and ranked into contest standings and the contest is COMPLETED. A cancelled
   * week counts for nothing (#743). Answers what it wrote, or null when the contest's rules are not
   * pick'em rules, which is skipped and logged.
   */
  private async settlePickEmWeek(
    reads: SettlementReads,
    contest: Contest,
    sportEvent: SportEvent,
    completedAt: Date,
  ): Promise<{ standingsUpserted: number; completed: boolean } | null> {
    const sportEventId = sportEvent.id;
    let scoring: GamePickScoring;
    try {
      scoring = await loadPickEmScoring(this.deps, contest.id);
    } catch (error) {
      if (!(error instanceof PickEmRulesMissingError)) throw error;
      this.logger.error({ contestId: contest.id, sportEventId }, 'Skipped pick\'em settlement because the contest carries no pick\'em rules');
      return null;
    }
    const settledWeeks = await this.deps.eventStandings.findByContest(contest.id);
    if (sportEvent.status !== SportEventStatus.CANCELLED && !settledWeeks.some((standing) => standing.sportEventId === sportEventId)) {
      const week = await loadPickEmWeekStandings(reads, contest.id, sportEvent, scoring);
      for (const standing of week.entries) {
        // poolmaster-allow-query-in-loop: #1172
        await this.deps.eventStandings.upsert({
          contestId: contest.id,
          contestEntryId: standing.entry.id,
          sportEventId,
          position: standing.position,
          displayPosition: standing.displayPosition,
          // Every pick of the week counts: the limit is its game count, and a pick is scored once decided.
          countingPickLimit: week.gameCount,
          scoredPickCount: standing.score.decidedPickCount,
          asOf: completedAt,
          settledAt: completedAt,
          totalScore: standing.score.points,
        });
      }
      this.logger.info({ contestId: contest.id, sportEventId, entryCount: week.entries.length }, 'Settled one week of a pick\'em contest');
    }
    if (!(await this.allEventsFinished(reads, contest))) {
      return { standingsUpserted: 0, completed: false };
    }
    const weeks = await this.deps.eventStandings.findByContest(contest.id);
    // The season counts every game of its settled weeks.
    const gameCountByWeek = new Map(weeks.map((standing) => [standing.sportEventId, standing.countingPickLimit]));
    const seasonGameCount = [...gameCountByWeek.values()].reduce((sum, count) => sum + count, 0);
    const standingsUpserted = await this.settleContestTotals(contest, seasonGameCount, 'HIGHER_IS_BETTER', completedAt);
    const completed = await this.complete(contest, completedAt);
    this.logger.info({ contestId: contest.id, sportEventId, standingsUpserted, completed }, 'Settled a pick\'em contest\'s season after its last week');
    return { standingsUpserted, completed };
  }

  /**
   * Settles one week of a survivor contest (#719): each entry still in coming into the week is
   * frozen with 1 when it survived the week and 0 when it went out, survivors first. A playoff
   * event is a week per round (#785), so its standing is the rounds the entry survived in it, most
   * first. Entries out before the event have no standing for it, and a cancelled week counts for nothing (#743). A
   * week settles once. When the contest's last week settles, the contest standings are ranked from
   * the season's run, as the live board ranks it (entries still in first, then weeks survived,
   * entries out in the same week sharing a place), and the contest is COMPLETED.
   */
  private async settleSurvivorWeek(
    reads: SettlementReads,
    contest: Contest,
    sportEvent: SportEvent,
    completedAt: Date,
  ): Promise<{ standingsUpserted: number; completed: boolean }> {
    const sportEventId = sportEvent.id;
    const settledWeeks = await this.deps.eventStandings.findByContest(contest.id);
    if (sportEvent.status !== SportEventStatus.CANCELLED && !settledWeeks.some((standing) => standing.sportEventId === sportEventId)) {
      const season = await loadSurvivorSeason(reads, contest, completedAt);
      // A playoff event is several weeks, one per round (#785): its standing counts the rounds survived in it.
      const weekIndexes = season.weeks.flatMap((week, index) => (week.event.id === sportEventId ? [index] : []));
      const decided = season.entries.flatMap(({ entry, run }) => {
        const outcomes = weekIndexes.map((index) => run.weeks[index]?.outcome ?? null);
        const survived = outcomes.filter((outcome) => outcome === SurvivorWeekOutcome.SURVIVED).length;
        return outcomes.some((outcome) => outcome === SurvivorWeekOutcome.SURVIVED || outcome === SurvivorWeekOutcome.ELIMINATED)
          ? [{ entry, survived, decidedCount: outcomes.filter((outcome) => outcome === SurvivorWeekOutcome.SURVIVED || outcome === SurvivorWeekOutcome.ELIMINATED).length }]
          : [];
      });
      const placeOf = (survived: number) => {
        const position = 1 + decided.filter((other) => other.survived > survived).length;
        const sharing = decided.filter((other) => other.survived === survived).length;
        return { position, displayPosition: sharing > 1 ? `T${position}` : String(position) };
      };
      for (const { entry, survived, decidedCount } of decided) {
        // poolmaster-allow-query-in-loop: #1172
        await this.deps.eventStandings.upsert({
          contestId: contest.id,
          contestEntryId: entry.id,
          sportEventId,
          ...placeOf(survived),
          // One pick a week (a round, in a playoff), decided once its game is played.
          countingPickLimit: weekIndexes.length,
          scoredPickCount: decidedCount,
          asOf: completedAt,
          settledAt: completedAt,
          totalScore: survived,
        });
      }
      const survivorCount = decided.filter(({ survived, decidedCount }) => survived === decidedCount).length;
      this.logger.info({ contestId: contest.id, sportEventId, entryCount: decided.length, survivorCount }, 'Settled one week of a survivor contest');
    }
    if (!(await this.allEventsFinished(reads, contest))) {
      return { standingsUpserted: 0, completed: false };
    }
    // Ranked from the season's run, as the live board is, not from the weekly snapshots: a week
    // settled before an earlier week's result was in froze an entry the run later puts out.
    const season = await loadSurvivorSeason(reads, contest, completedAt);
    const playedWeeks = season.weeks.filter((week) => !week.cancelled).length;
    const standingsUpserted = await this.writeContestTotals(contest, season.entries.map(({ entry, run, position, displayPosition }) => ({
      entryId: entry.id,
      position,
      displayPosition,
      score: run.weeksSurvived,
      scoredPickCount: run.weeks.filter(({ outcome }) => outcome === SurvivorWeekOutcome.SURVIVED || outcome === SurvivorWeekOutcome.ELIMINATED).length,
    })), playedWeeks, completedAt, completedAt);
    const completed = await this.complete(contest, completedAt);
    this.logger.info({ contestId: contest.id, sportEventId, standingsUpserted, completed }, 'Settled a survivor contest\'s season after its last week');
    return { standingsUpserted, completed };
  }

  /**
   * The reads of one event's settlement, shared by its contests (#1199). Settlement writes
   * standings and contest statuses, never the events, matches or fields these hold.
   */
  private sharedReads(sportEvent: SportEvent): SettlementReads {
    return {
      ...this.deps,
      sportEvents: readEventsOnce(this.deps.sportEvents, [sportEvent]),
      matches: readEventMatchesOnce(this.deps.matches),
      eventParticipants: { listEventParticipants: readOncePerKey((id) => this.deps.eventParticipants.listEventParticipants(id)) },
    };
  }

  /**
   * Completes a contest whose places are frozen. Its league championship finishes (#863) are
   * written first, so a failure there leaves the contest unsettled, to be settled again, rather
   * than final with no finishes.
   */
  private async complete(contest: Contest, completedAt: Date): Promise<boolean> {
    await this.deps.championship.recordContest(contest, completedAt);
    const completed = await this.deps.contests.transitionStatus(contest.id, {
      from: SETTLEABLE,
      to: ContestStatus.COMPLETED,
      endsAt: completedAt,
    });
    if (completed) await this.tellContestSettled(contest);
    return completed;
  }

  /** F1 or F2, the final results: queued for the league, never failing the settlement. */
  private async tellContestSettled(contest: Contest): Promise<void> {
    try {
      await this.deps.contestSettled?.contestSettled(contest);
    } catch (err) {
      this.logger.error({
        contestId: contest.id,
        leagueId: contest.leagueId,
        error: err instanceof Error ? err.message : String(err),
      }, 'Failed to queue final results emails');
    }
  }

  /** Whether every event the contest covers has completed or been cancelled: then the contest itself settles. */
  private async allEventsFinished(reads: SettlementReads, contest: Contest): Promise<boolean> {
    const events = await reads.sportEvents.findByIds(contest.sportEventIds);
    return events.length === contest.sportEventIds.length
      && events.every((event) => FINISHED_EVENT_STATUSES.includes(event.status));
  }

  /**
   * The contest's settled total (#713): each entry's frozen event scores summed and ranked. In a one-event
   * contest the total is that event's standing. Answers how many standings it wrote.
   */
  private async settleContestTotals(
    contest: Contest,
    countingPickLimit: number,
    direction: Parameters<typeof rankContestTotals>[2],
    completedAt: Date,
  ): Promise<number> {
    const [entries, eventStandings] = await Promise.all([
      this.deps.entries.findByContestWithSquad(contest.id),
      this.deps.eventStandings.findByContest(contest.id),
    ]);
    const settledEntryIds = new Set(eventStandings.map((standing) => standing.contestEntryId));
    const totals = rankContestTotals(
      entries.filter((entry) => settledEntryIds.has(entry.id)),
      eventStandings.map((standing) => ({
        entryId: standing.contestEntryId,
        sportEventId: standing.sportEventId,
        score: standing.totalScore,
        scoredPickCount: standing.scoredPickCount,
      })),
      direction,
    );
    const asOf = eventStandings
      .map((standing) => standing.asOf)
      .filter((value): value is Date => value !== null)
      .sort((left, right) => right.getTime() - left.getTime())
      .at(0) ?? completedAt;
    return this.writeContestTotals(contest, totals, countingPickLimit, asOf, completedAt);
  }

  /** Writes the contest's ranked totals: the one writer of ContestEntryStanding. Answers how many it wrote. */
  private async writeContestTotals(
    contest: Contest,
    totals: readonly Pick<ContestEntryTotal, 'entryId' | 'position' | 'displayPosition' | 'score' | 'scoredPickCount'>[],
    countingPickLimit: number,
    asOf: Date,
    completedAt: Date,
  ): Promise<number> {
    for (const total of totals) {
      // poolmaster-allow-query-in-loop: #1172
      await this.deps.standings.upsert({
        contestId: contest.id,
        contestEntryId: total.entryId,
        position: total.position,
        displayPosition: total.displayPosition,
        countingPickLimit,
        scoredPickCount: total.scoredPickCount,
        asOf,
        settledAt: completedAt,
        totalScore: total.score,
      });
    }
    return totals.length;
  }
}

function resolveContestStandingAsOf(
  participants: ParticipantScore[],
  fallback: Date,
): Date {
  const latest = participants
    .map((participant) => participant.asOf)
    .filter((asOf): asOf is Date => asOf !== null)
    .sort((left, right) => right.getTime() - left.getTime())
    .at(0);
  return latest ?? fallback;
}

