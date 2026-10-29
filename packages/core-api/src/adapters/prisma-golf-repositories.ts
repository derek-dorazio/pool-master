/**
 * Prisma adapters for the golf extension ports (#236). A golf row is always read with
 * its core row and written with it, in one nested write, so neither exists alone.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  GolfRoundWrite,
  GolfStandingWrite,
  StandingRankWrite,
  SportEventParticipantGolfRoundRepository,
  SportEventParticipantGolfStandingRepository,
} from '@poolmaster/shared/db';
import type {
  GolfRoundResult,
  GolfStandingResult,
  SportEventParticipantGolfRound,
  SportEventParticipantGolfStanding,
} from '@poolmaster/shared/domain';

const GOLF_ROUND_INCLUDE = {
  golf: true,
  sportEventRound: { select: { roundNumber: true } },
} as const;

type GolfRoundRow = Prisma.SportEventParticipantRoundGetPayload<{ include: typeof GOLF_ROUND_INCLUDE }>;
type GolfStandingRow = Prisma.SportEventParticipantStandingGetPayload<{ include: { golf: true } }>;

const BY_PARTICIPANT_THEN_ROUND = [
  { sportEventParticipantId: 'asc' as const },
  { sportEventRound: { roundNumber: 'asc' as const } },
];

export class PrismaSportEventParticipantGolfRoundRepository implements SportEventParticipantGolfRoundRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySportEventRound(sportEventRoundId: string): Promise<GolfRoundResult[]> {
    const rows = await this.prisma.sportEventParticipantRound.findMany({
      where: { sportEventRoundId, golf: { isNot: null } },
      include: GOLF_ROUND_INCLUDE,
      orderBy: { sportEventParticipantId: 'asc' },
    });
    return rows.flatMap(toGolfRoundResult);
  }

  async findBySportEventParticipants(sportEventParticipantIds: readonly string[]): Promise<GolfRoundResult[]> {
    if (sportEventParticipantIds.length === 0) return [];
    const rows = await this.prisma.sportEventParticipantRound.findMany({
      where: { sportEventParticipantId: { in: [...sportEventParticipantIds] }, golf: { isNot: null } },
      include: GOLF_ROUND_INCLUDE,
      orderBy: BY_PARTICIPANT_THEN_ROUND,
    });
    return rows.flatMap(toGolfRoundResult);
  }

  async upsert(write: GolfRoundWrite): Promise<GolfRoundResult> {
    const [result] = toGolfRoundResult(await this.golfRoundUpsert(write));
    return result;
  }

  async upsertMany(writes: readonly GolfRoundWrite[]): Promise<GolfRoundResult[]> {
    if (writes.length === 0) return [];
    // poolmaster-allow-query-in-loop: one event's field, one round each (per-row values, one transaction)
    const rows = await this.prisma.$transaction(writes.map((write) => this.golfRoundUpsert(write)));
    return rows.flatMap(toGolfRoundResult);
  }

  private golfRoundUpsert(write: GolfRoundWrite) {
    const golf = { strokes: write.strokes, scoreToPar: write.scoreToPar, thru: write.thru };
    const { sportEventParticipantId, sportEventRoundId } = write;
    return this.prisma.sportEventParticipantRound.upsert({
      where: { sportEventParticipantId_sportEventRoundId: { sportEventParticipantId, sportEventRoundId } },
      create: {
        sportEventParticipantId,
        sportEventRoundId,
        status: write.status,
        completedAt: write.completedAt,
        golf: { create: golf },
      },
      update: {
        status: write.status,
        completedAt: write.completedAt,
        golf: { upsert: { create: golf, update: golf } },
      },
      include: GOLF_ROUND_INCLUDE,
    });
  }
}

export class PrismaSportEventParticipantGolfStandingRepository implements SportEventParticipantGolfStandingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySportEvent(sportEventId: string): Promise<GolfStandingResult[]> {
    const rows = await this.prisma.sportEventParticipantStanding.findMany({
      where: { sportEventParticipant: { sportEventId }, golf: { isNot: null } },
      include: { golf: true },
      orderBy: { sportEventParticipantId: 'asc' },
    });
    return rows.flatMap(toGolfStandingResult);
  }

  async findBySportEventParticipants(sportEventParticipantIds: readonly string[]): Promise<GolfStandingResult[]> {
    if (sportEventParticipantIds.length === 0) return [];
    const rows = await this.prisma.sportEventParticipantStanding.findMany({
      where: { sportEventParticipantId: { in: [...sportEventParticipantIds] }, golf: { isNot: null } },
      include: { golf: true },
      orderBy: { sportEventParticipantId: 'asc' },
    });
    return rows.flatMap(toGolfStandingResult);
  }

  async upsertMany(writes: readonly GolfStandingWrite[]): Promise<GolfStandingResult[]> {
    if (writes.length === 0) return [];
    const rows = await this.prisma.$transaction(writes.map((write) => {
      const golf = {
        eventScoreToPar: write.eventScoreToPar,
        eventStrokes: write.eventStrokes,
        currentRoundThru: write.currentRoundThru,
      };
      const core = { currentRound: write.currentRound, status: write.status, asOf: write.asOf };
      // poolmaster-allow-query-in-loop: one event's field (per-row values, one transaction)
      return this.prisma.sportEventParticipantStanding.upsert({
        where: { sportEventParticipantId: write.sportEventParticipantId },
        create: { sportEventParticipantId: write.sportEventParticipantId, ...core, golf: { create: golf } },
        update: { ...core, golf: { upsert: { create: golf, update: golf } } },
        include: { golf: true },
      });
    }));
    return rows.flatMap(toGolfStandingResult);
  }

  async updateRanks(ranks: ReadonlyArray<StandingRankWrite>): Promise<void> {
    if (ranks.length === 0) return;
    // poolmaster-allow-query-in-loop: one event's field (per-row values, one transaction)
    await this.prisma.$transaction(ranks.map((rank) => this.prisma.sportEventParticipantStanding.update({
      where: { id: rank.standingId },
      data: { position: rank.position, displayPosition: rank.displayPosition },
    })));
  }
}

/** A core row with no golf row has not been scored; it has no golf result. */
function toGolfRoundResult(row: GolfRoundRow): GolfRoundResult[] {
  if (!row.golf) return [];
  return [{
    participantRound: {
      id: row.id,
      sportEventParticipantId: row.sportEventParticipantId,
      sportEventRoundId: row.sportEventRoundId,
      roundNumber: row.sportEventRound.roundNumber,
      status: row.status,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    golf: toGolfRound(row.golf),
  }];
}

function toGolfStandingResult(row: GolfStandingRow): GolfStandingResult[] {
  if (!row.golf) return [];
  return [{
    standing: {
      id: row.id,
      sportEventParticipantId: row.sportEventParticipantId,
      position: row.position,
      displayPosition: row.displayPosition,
      status: row.status,
      asOf: row.asOf,
      currentRound: row.currentRound,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    golf: toGolfStanding(row.golf),
  }];
}

export function toGolfRound(row: Prisma.SportEventParticipantGolfRoundGetPayload<object>): SportEventParticipantGolfRound {
  return {
    id: row.id,
    participantRoundId: row.participantRoundId,
    strokes: row.strokes,
    scoreToPar: row.scoreToPar,
    thru: row.thru,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toGolfStanding(row: Prisma.SportEventParticipantGolfStandingGetPayload<object>): SportEventParticipantGolfStanding {
  return {
    id: row.id,
    standingId: row.standingId,
    eventScoreToPar: row.eventScoreToPar,
    eventStrokes: row.eventStrokes,
    currentRoundThru: row.currentRoundThru,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
