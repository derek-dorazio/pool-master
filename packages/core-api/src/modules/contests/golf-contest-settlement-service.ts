import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestEntryStandingRepository,
  ContestRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import { ContestStatus, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import {
  buildContestEntryStanding,
  rankContestEntryStandings,
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
 * What settlement never touches: a contest already settled or cancelled, and a DRAFT. A draft
 * leaves only by being opened or deleted (#117), so completing one would publish a contest
 * nobody could enter to the league as finished. Its event starting leaves it a draft too.
 */
const NOT_SETTLED: readonly ContestStatus[] = [ContestStatus.CANCELLED, ContestStatus.COMPLETED, ContestStatus.DRAFT];

/** Every status settlement may complete a contest from. */
const SETTLEABLE = Object.values(ContestStatus).filter((status) => !NOT_SETTLED.includes(status));

export interface GolfContestSettlementSummary {
  sportEventId: string;
  contestsSettled: number;
  contestsCompleted: number;
  standingsUpserted: number;
}

export interface GolfContestSettlementDeps extends ContestLeaderboardReadDeps {
  sportEvents: SportEventRepository;
  contests: ContestRepository;
  standings: ContestEntryStandingRepository;
  logger?: LifecycleLogger;
}

export class GolfContestSettlementService {
  private readonly logger: LifecycleLogger;

  constructor(private readonly deps: GolfContestSettlementDeps) {
    this.logger = deps.logger ?? createNoopLogger();
  }

  async settleCompletedSportEvent(
    sportEventId: string,
    input?: { completedAt?: Date },
  ): Promise<GolfContestSettlementSummary> {
    const sportEvent = await this.deps.sportEvents.findById(sportEventId);
    if (!sportEvent || sportEvent.sport !== Sport.GOLF || sportEvent.status !== SportEventStatus.COMPLETED) {
      return {
        sportEventId,
        contestsSettled: 0,
        contestsCompleted: 0,
        standingsUpserted: 0,
      };
    }

    const completedAt = input?.completedAt ?? sportEvent.endDate ?? sportEvent.startDate;
    const participants = toParticipantScores(await loadEventField(this.deps, sportEventId));
    const scoreById = new Map(
      participants.map((participant) => [participant.sportEventParticipantId, participant]),
    );
    const asOf = resolveContestStandingAsOf(participants, completedAt);
    // A COMPLETED contest is already settled: its standing is the frozen result, and re-running
    // settlement (the event re-sent as COMPLETED, or a late score correction) must not rewrite
    // it. Only a contest moved back out of COMPLETED would be settled again, and no route does
    // that today: the reopen endpoint, which nothing called, was deleted.
    const contests = await this.deps.contests.findBySportEvent(sportEventId, {
      excludeStatuses: NOT_SETTLED,
    });

    let standingsUpserted = 0;
    let contestsCompleted = 0;
    let contestsSettled = 0;
    for (const contest of contests) {
      const configuration = await loadContestScoringConfiguration(this.deps, contest.id);
      const countingRule = resolveContestCountingRule(configuration);
      if (!countingRule) {
        this.logger.error({
          contestId: contest.id,
          sportEventId,
        }, 'Skipped Golf contest settlement because contest has no counting rule');
        continue;
      }
      const scoring = resolveContestScoringDefinition(configuration);
      if (!scoring.ok) {
        // Skip rather than guess a direction. Settling with the wrong direction pays the
        // wrong entries, and a payout is hard to undo; a skipped settlement is logged at
        // error and can be run again once the configuration carries a rule naming a known
        // definition. The leaderboard read refuses the same cases with 400, because nothing
        // is paid.
        this.logger.error({
          contestId: contest.id,
          sportEventId,
          reason: scoring.reason,
        }, 'Skipped Golf contest settlement because its participant scoring rule is missing or names an unknown scoring definition');
        continue;
      }
      const scoringDefinition = scoring.definition;
      const entries = await loadContestLeaderboardEntries(this.deps, contest.id);
      const rankedEntries = rankContestEntryStandings(
        entries.map((entry) =>
          buildContestEntryStanding(entry, scoreById, countingRule, scoringDefinition.direction),
        ),
        scoringDefinition.direction,
      );
      contestsSettled++;

      for (const entry of rankedEntries) {
        // The single writer of ContestEntryStanding (and so of its denormalized contestId).
        await this.deps.standings.upsert({
          contestId: contest.id,
          contestEntryId: entry.entryId,
          position: entry.position,
          displayPosition: entry.displayPosition,
          countingPickLimit: entry.countingPickLimit,
          scoredPickCount: entry.scoredPickCount,
          asOf,
          settledAt: completedAt,
          golf: { totalScoreToPar: entry.score },
        });
        standingsUpserted++;
      }

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
    }, 'Golf contest settlement completed from completed sport event');

    return {
      sportEventId,
      contestsSettled,
      contestsCompleted,
      standingsUpserted,
    };
  }
}

function resolveContestStandingAsOf(
  participants: ParticipantScore[],
  fallback: Date,
): Date {
  const latest = participants
    .map((participant) => participant.asOf)
    .filter((asOf): asOf is Date => asOf !== null)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  return latest ?? fallback;
}

