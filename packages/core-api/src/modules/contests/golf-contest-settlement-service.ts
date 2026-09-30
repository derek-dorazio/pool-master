import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { ContestStatus, Sport } from '@poolmaster/shared/domain';
import { eventBus, type EventBus } from '@poolmaster/shared/events/event-bus';
import type { ContestCompletedEvent } from '@poolmaster/shared/events/contest';
import type { GolfLeaderboardParticipantRow } from '../../mappers/contests.mapper';
import {
  buildGolfLeaderboardEntry,
  GOLF_CONTEST_CONFIGURATION_SELECT,
  rankGolfLeaderboardEntries,
  resolveGolfLeaderboardCountingRule,
  resolveGolfLeaderboardScoringDefinition,
} from './golf-leaderboard-calculator';
import { loadGolfLeaderboardParticipants } from './golf-leaderboard-participants';

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

export interface GolfContestSettlementSummary {
  sportEventId: string;
  contestsSettled: number;
  contestsCompleted: number;
  standingsUpserted: number;
}

export class GolfContestSettlementService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: LifecycleLogger = createNoopLogger(),
    private readonly bus: EventBus = eventBus,
  ) {}

  async settleCompletedSportEvent(
    sportEventId: string,
    input?: { completedAt?: Date },
  ): Promise<GolfContestSettlementSummary> {
    const sportEvent = await this.prisma.sportEvent.findUnique({
      where: { id: sportEventId },
      select: {
        id: true,
        sport: true,
        status: true,
        name: true,
        endDate: true,
        startDate: true,
      },
    });
    if (!sportEvent || sportEvent.sport !== Sport.GOLF || sportEvent.status !== 'COMPLETED') {
      return {
        sportEventId,
        contestsSettled: 0,
        contestsCompleted: 0,
        standingsUpserted: 0,
      };
    }

    const completedAt = input?.completedAt ?? sportEvent.endDate ?? sportEvent.startDate;
    const participants = await loadGolfLeaderboardParticipants(this.prisma, sportEventId);
    const participantById = new Map(
      participants.map((participant) => [participant.sportEventParticipantId, participant]),
    );
    const asOf = resolveContestStandingAsOf(participants, completedAt);
    // A COMPLETED contest is already settled: its standing is the frozen result, and re-running
    // settlement (the event re-sent as COMPLETED, or a late score correction) must not rewrite
    // it. Reopening a contest (OverrideService.reopenContest) moves it back to ACTIVE, which is
    // the deliberate way to have it settled again.
    const contests = await this.prisma.contest.findMany({
      where: {
        status: { notIn: [ContestStatus.CANCELLED, ContestStatus.COMPLETED] },
        sportEventId,
      },
      include: {
        configuration: {
          select: GOLF_CONTEST_CONFIGURATION_SELECT,
        },
        entries: {
          where: { status: 'ACTIVE' },
          orderBy: [{ entryNumber: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            entryNumber: true,
            name: true,
            status: true,
            squadId: true,
            squad: {
              select: {
                name: true,
              },
            },
            picks: {
              orderBy: [{ slot: 'asc' }, { pickedAt: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                sportEventParticipantId: true,
                pickedAt: true,
                slot: true,
                tier: true,
              },
            },
          },
        },
      },
    });

    let standingsUpserted = 0;
    let contestsCompleted = 0;
    let contestsSettled = 0;
    for (const contest of contests) {
      const countingRule = resolveGolfLeaderboardCountingRule(contest.configuration);
      if (!countingRule) {
        this.logger.error({
          contestId: contest.id,
          sportEventId,
        }, 'Skipped Golf contest settlement because contest has no counting rule');
        continue;
      }
      const scoring = resolveGolfLeaderboardScoringDefinition(contest.configuration);
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
      const rankedEntries = rankGolfLeaderboardEntries(
        contest.entries.map((entry) =>
          buildGolfLeaderboardEntry(entry, participantById, countingRule, scoringDefinition.direction),
        ),
        scoringDefinition.direction,
      );
      contestsSettled++;

      for (const entry of rankedEntries) {
        // The single writer of ContestEntryStanding (and so of its denormalized contestId).
        const standing = {
          contestId: contest.id,
          position: entry.position,
          displayPosition: entry.displayPosition,
          countingPickLimit: entry.countingPickCount,
          scoredPickCount: entry.scoredPickCount,
          asOf,
          settledAt: completedAt,
        };
        const golf = { totalScoreToPar: entry.totalScoreToPar };
        await this.prisma.contestEntryStanding.upsert({
          where: { contestEntryId: entry.entryId },
          create: { contestEntryId: entry.entryId, ...standing, golf: { create: golf } },
          update: { ...standing, golf: { upsert: { create: golf, update: golf } } },
        });
        standingsUpserted++;
      }

      const completion = await this.prisma.contest.updateMany({
        where: {
          id: contest.id,
          status: { not: ContestStatus.COMPLETED },
        },
        data: {
          status: ContestStatus.COMPLETED,
          endsAt: completedAt,
        },
      });
      if (completion.count > 0) {
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

