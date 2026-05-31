import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { ContestStatus, Sport } from '@poolmaster/shared/domain';
import { eventBus, type EventBus } from '@poolmaster/shared/events/event-bus';
import type { ContestCompletedEvent } from '@poolmaster/shared/events/contest';
import type { GolfLeaderboardParticipantRow } from '../../mappers/contests.mapper';
import {
  buildGolfLeaderboardEntry,
  buildGolfRoundColumns,
  mapGolfLeaderboardStatus,
  rankGolfLeaderboardEntries,
  resolveGolfLeaderboardCountingRule,
} from './golf-leaderboard-calculator';

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
    const participants = await this.loadGolfLeaderboardParticipants(sportEventId);
    const participantById = new Map(
      participants.map((participant) => [participant.sportEventParticipantId, participant]),
    );
    const asOf = resolveContestStandingAsOf(participants, completedAt);
    const contests = await this.prisma.contest.findMany({
      where: {
        status: { not: ContestStatus.CANCELLED },
        OR: [
          { sportEventId },
          { contestSportEvents: { some: { sportEventId } } },
        ],
      },
      include: {
        configuration: {
          select: {
            configJson: true,
            rosterSize: true,
            pickCount: true,
            rounds: true,
          },
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
      const rankedEntries = rankGolfLeaderboardEntries(
        contest.entries.map((entry) =>
          buildGolfLeaderboardEntry(entry, participantById, countingRule),
        ),
      );
      contestsSettled++;

      for (const entry of rankedEntries) {
        await this.prisma.contestEntryGolfStanding.upsert({
          where: { contestEntryId: entry.entryId },
          create: {
            contestId: contest.id,
            contestEntryId: entry.entryId,
            totalScoreToPar: entry.totalScoreToPar,
            position: entry.position,
            displayPosition: entry.displayPosition,
            countingPickCount: entry.countingPickCount,
            scoredPickCount: entry.scoredPickCount,
            status: 'FINAL',
            asOf,
            settledAt: completedAt,
          },
          update: {
            contestId: contest.id,
            totalScoreToPar: entry.totalScoreToPar,
            position: entry.position,
            displayPosition: entry.displayPosition,
            countingPickCount: entry.countingPickCount,
            scoredPickCount: entry.scoredPickCount,
            status: 'FINAL',
            asOf,
            settledAt: completedAt,
          },
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

  private async loadGolfLeaderboardParticipants(
    sportEventId: string,
  ): Promise<GolfLeaderboardParticipantRow[]> {
    const rows = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId },
      include: {
        participant: true,
        golfStanding: true,
        golfRounds: {
          orderBy: { round: 'asc' },
        },
      },
      orderBy: [{ seedNumber: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => {
      const standing = row.golfStanding;
      return {
        sportEventParticipantId: row.id,
        participantId: row.participantId,
        name: row.participant.name,
        shortName: row.participant.shortName ?? null,
        participantStatus: row.status ?? null,
        worldRanking: row.worldRanking ?? null,
        oddsToWin: decimalToNumber(row.oddsToWin),
        seedNumber: row.seedNumber ?? null,
        totalScoreToPar: standing?.eventScoreToPar ?? null,
        totalStrokes: standing?.eventStrokes ?? null,
        thru: standing?.currentRoundThru ?? null,
        currentRound: standing?.currentRound ?? null,
        status: standing ? mapGolfLeaderboardStatus(String(standing.status)) : 'active',
        position: standing?.position ?? null,
        displayPosition: standing?.displayPosition ?? null,
        asOf: standing?.asOf ?? null,
        rounds: buildGolfRoundColumns(row.golfRounds),
      };
    });
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

function decimalToNumber(value: { toNumber: () => number } | number | null): number | null {
  if (value === null) return null;
  if (typeof value === 'number') return value;
  return value.toNumber();
}
