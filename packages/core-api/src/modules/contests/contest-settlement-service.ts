import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestEntryEventStandingRepository,
  ContestEntryStandingRepository,
  ContestRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import { ContestFormat, ContestStatus, SportEventStatus, type Contest } from '@poolmaster/shared/domain';
import {
  buildContestEntryStanding,
  rankContestEntryStandings,
  rankContestTotals,
  type ContestCountingRule,
  resolveContestCountingRule,
  resolveContestScoringDefinition,
  type ParticipantScore,
} from './contest-leaderboard-calculator';
import {
  loadContestLeaderboardEntries,
  loadContestScoringConfiguration,
  loadEventField,
  toParticipantScores,
  type ContestLeaderboardReadDeps,
} from './contest-leaderboard-reads';
import { FINISHED_EVENT_STATUSES } from './entry-window';

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

export interface ContestSettlementDeps extends ContestLeaderboardReadDeps {
  sportEvents: SportEventRepository;
  contests: ContestRepository;
  standings: ContestEntryStandingRepository;
  eventStandings: ContestEntryEventStandingRepository;
  logger?: LifecycleLogger;
}

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
    // The field is the event's, read once; each contest scores it under its own settings below.
    // A cancelled event is never scored, whatever scores it holds.
    const field = cancelled ? [] : await loadEventField(this.deps, sportEventId);
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
      if (contest.contestFormat === ContestFormat.PREDICTION) {
        // Game picks are scored against the games' results, which settlement does not do yet
        // (#717); the contest stays ACTIVE with its picks kept until it can.
        this.logger.info({ contestId: contest.id, sportEventId }, 'Left a prediction contest unsettled: game picks are not scored yet');
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
      const settledEvents = await this.deps.eventStandings.findByContest(contest.id);
      if (!cancelled && !settledEvents.some((standing) => standing.sportEventId === sportEventId)) {
        const entries = await loadContestLeaderboardEntries(this.deps, contest.id, sportEventId);
        const rankedEntries = rankContestEntryStandings(
          entries.map((entry) =>
            buildContestEntryStanding(entry, scoreById, countingRule, scoringDefinition.direction),
          ),
          scoringDefinition.direction,
        );
        for (const entry of rankedEntries) {
          // The single writer of ContestEntryEventStanding.
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

      if (!(await this.allEventsFinished(contest))) {
        this.logger.info({
          contestId: contest.id,
          sportEventId,
        }, 'Settled one event of a contest whose other events are still to finish');
        continue;
      }
      standingsUpserted += await this.settleContestTotals(contest, countingRule, scoringDefinition.direction, completedAt);

      const completed = await this.deps.contests.transitionStatus(contest.id, {
        from: SETTLEABLE,
        to: ContestStatus.COMPLETED,
        endsAt: completedAt,
      });
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

  /** Whether every event the contest covers has completed or been cancelled: then the contest itself settles. */
  private async allEventsFinished(contest: Contest): Promise<boolean> {
    const events = await this.deps.sportEvents.findByIds(contest.sportEventIds);
    return events.length === contest.sportEventIds.length
      && events.every((event) => FINISHED_EVENT_STATUSES.includes(event.status));
  }

  /**
   * The contest's settled total (#713): each entry's frozen event scores summed and ranked, the
   * single writer of ContestEntryStanding (and so of its denormalized contestId). In a one-event
   * contest the total is that event's standing. Answers how many standings it wrote.
   */
  private async settleContestTotals(
    contest: Contest,
    countingRule: ContestCountingRule,
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
    for (const total of totals) {
      await this.deps.standings.upsert({
        contestId: contest.id,
        contestEntryId: total.entryId,
        position: total.position,
        displayPosition: total.displayPosition,
        countingPickLimit: countingRule.count,
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

