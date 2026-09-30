import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestEntryStandingRepository,
  ContestRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import { ContestStatus, Sport } from '@poolmaster/shared/domain';
import { eventBus, type EventBus } from '@poolmaster/shared/events/event-bus';
import type { ContestCompletedEvent } from '@poolmaster/shared/events/contest';
import type { GolfLeaderboardParticipantRow } from '../../mappers/contests.mapper';
import {
  buildGolfLeaderboardEntry,
  rankGolfLeaderboardEntries,
  resolveGolfLeaderboardCountingRule,
  resolveGolfLeaderboardScoringDefinition,
} from './golf-leaderboard-calculator';
import {
  loadGolfContestConfiguration,
  loadGolfLeaderboardEntries,
  loadGolfLeaderboardParticipants,
  type GolfContestReadDeps,
} from './golf-leaderboard-reads';

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


/** Every status settlement may complete a contest from: anything it is not already. */
const NOT_COMPLETED = Object.values(ContestStatus).filter((status) => status !== ContestStatus.COMPLETED);
export interface GolfContestSettlementSummary {
  sportEventId: string;
  contestsSettled: number;
  contestsCompleted: number;
  standingsUpserted: number;
}

export interface GolfContestSettlementDeps extends GolfContestReadDeps {
  sportEvents: SportEventRepository;
  contests: ContestRepository;
  standings: ContestEntryStandingRepository;
  logger?: LifecycleLogger;
  bus?: EventBus;
}

export class GolfContestSettlementService {
  private readonly logger: LifecycleLogger;
  private readonly bus: EventBus;

  constructor(private readonly deps: GolfContestSettlementDeps) {
    this.logger = deps.logger ?? createNoopLogger();
    this.bus = deps.bus ?? eventBus;
  }

  async settleCompletedSportEvent(
    sportEventId: string,
    input?: { completedAt?: Date },
  ): Promise<GolfContestSettlementSummary> {
    const sportEvent = await this.deps.sportEvents.findById(sportEventId);
    if (!sportEvent || sportEvent.sport !== Sport.GOLF || sportEvent.status !== 'COMPLETED') {
      return {
        sportEventId,
        contestsSettled: 0,
        contestsCompleted: 0,
        standingsUpserted: 0,
      };
    }

    const completedAt = input?.completedAt ?? sportEvent.endDate ?? sportEvent.startDate;
    const participants = await loadGolfLeaderboardParticipants(this.deps, sportEventId);
    const participantById = new Map(
      participants.map((participant) => [participant.sportEventParticipantId, participant]),
    );
    const asOf = resolveContestStandingAsOf(participants, completedAt);
    // A COMPLETED contest is already settled: its standing is the frozen result, and re-running
    // settlement (the event re-sent as COMPLETED, or a late score correction) must not rewrite
    // it. Reopening a contest (OverrideService.reopenContest) moves it back to ACTIVE, which is
    // the deliberate way to have it settled again.
    const contests = await this.deps.contests.findBySportEvent(sportEventId, {
      excludeStatuses: [ContestStatus.CANCELLED, ContestStatus.COMPLETED],
    });

    let standingsUpserted = 0;
    let contestsCompleted = 0;
    let contestsSettled = 0;
    for (const contest of contests) {
      const configuration = await loadGolfContestConfiguration(this.deps, contest.id);
      const countingRule = resolveGolfLeaderboardCountingRule(configuration);
      if (!countingRule) {
        this.logger.error({
          contestId: contest.id,
          sportEventId,
        }, 'Skipped Golf contest settlement because contest has no counting rule');
        continue;
      }
      const scoring = resolveGolfLeaderboardScoringDefinition(configuration);
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
      const entries = await loadGolfLeaderboardEntries(this.deps, contest.id);
      const rankedEntries = rankGolfLeaderboardEntries(
        entries.map((entry) =>
          buildGolfLeaderboardEntry(entry, participantById, countingRule, scoringDefinition.direction),
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
          countingPickLimit: entry.countingPickCount,
          scoredPickCount: entry.scoredPickCount,
          asOf,
          settledAt: completedAt,
          golf: { totalScoreToPar: entry.totalScoreToPar },
        });
        standingsUpserted++;
      }

      const completed = await this.deps.contests.transitionStatus(contest.id, {
        from: NOT_COMPLETED,
        to: ContestStatus.COMPLETED,
        endsAt: completedAt,
      });
      if (completed) {
        contestsCompleted++;
        await this.publishContestCompleted(contest.id, rankedEntries, completedAt);
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

  private async publishContestCompleted(
    contestId: string,
    rankedEntries: Array<{
      position: number | null;
      squadId: string;
    }>,
    completedAt: Date,
  ): Promise<void> {
    const firstPlaceEntries = rankedEntries.filter((entry) => entry.position === 1);
    const event: ContestCompletedEvent = {
      id: randomUUID(),
      type: 'contest.completed',
      sourceService: 'core-api',
      contestId,
      timestamp: completedAt.toISOString(),
      ...(firstPlaceEntries.length === 1 ? { winnerTeamId: firstPlaceEntries[0].squadId } : {}),
    };
    await this.bus.publish('contest.completed', event);
  }
}

function resolveContestStandingAsOf(
  participants: GolfLeaderboardParticipantRow[],
  fallback: Date,
): Date {
  const latest = participants
    .map((participant) => participant.asOf)
    .filter((asOf): asOf is Date => asOf !== null)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  return latest ?? fallback;
}

