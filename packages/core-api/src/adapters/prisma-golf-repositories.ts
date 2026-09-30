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
import type { GolfRoundResult, GolfStandingResult } from '@poolmaster/shared/domain';

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

  async findBySportEvent(sportEventId: string): Promise<GolfRoundResult[]> {
    const rows = await this.prisma.sportEventParticipantRound.findMany({
      where: { sportEventParticipant: { sportEventId }, golf: { isNot: null } },
      include: GOLF_ROUND_INCLUDE,
      orderBy: BY_PARTICIPANT_THEN_ROUND,
    });
    return rows.flatMap(toGolfRoundResult);
  }

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

  async upsertMany(writes: readonly GolfRoundWrite[]): Promise<void> {
    await this.prisma.$transaction(writes.map((write) => this.golfRoundUpsert(write)));
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

  async upsert(write: GolfStandingWrite): Promise<GolfStandingResult> {
    const golf = {
      eventScoreToPar: write.eventScoreToPar,
      eventStrokes: write.eventStrokes,
      currentRoundThru: write.currentRoundThru,
    };
    const core = { currentRound: write.currentRound, status: write.status, asOf: write.asOf };
    const row = await this.prisma.sportEventParticipantStanding.upsert({
      where: { sportEventParticipantId: write.sportEventParticipantId },
      create: { sportEventParticipantId: write.sportEventParticipantId, ...core, golf: { create: golf } },
      update: { ...core, golf: { upsert: { create: golf, update: golf } } },
      include: { golf: true },
    });
    const [result] = toGolfStandingResult(row);
    return result;
  }

  async updateRanks(ranks: ReadonlyArray<StandingRankWrite>): Promise<void> {
    if (ranks.length === 0) return;
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
    golf: {
      id: row.golf.id,
      participantRoundId: row.golf.participantRoundId,
      strokes: row.golf.strokes,
      scoreToPar: row.golf.scoreToPar,
      thru: row.golf.thru,
      createdAt: row.golf.createdAt,
      updatedAt: row.golf.updatedAt,
    },
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
    golf: {
      id: row.golf.id,
      standingId: row.golf.standingId,
      eventScoreToPar: row.golf.eventScoreToPar,
      eventStrokes: row.golf.eventStrokes,
      currentRoundThru: row.golf.currentRoundThru,
      createdAt: row.golf.createdAt,
      updatedAt: row.golf.updatedAt,
    },
  }];
}
