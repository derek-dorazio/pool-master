/**
 * Prisma adapters for the golf extension ports (#236). A golf row is always read with its core
 * row and written with it in one transaction, so neither exists alone.
 */

import { randomUUID } from 'node:crypto';
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
import { rewriteStandingRanks, rewriteStandings } from './prisma-standing-rewrite';

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

  /**
   * Every write in a fixed number of statements, however many golfers (#1252). Missing round
   * rows are inserted together, existing ones written the same progress share one update, and
   * the golf rows, which nothing points at, are deleted and inserted again (keeping their ids
   * and creation times). Then the written rounds are read back in one read, in the order given.
   */
  async upsertMany(writes: readonly GolfRoundWrite[]): Promise<GolfRoundResult[]> {
    // A round written twice keeps the later write, as two upserts in a row would leave it.
    const latest = [...new Map(writes.map((write) => [roundKey(write), write])).values()];
    if (latest.length === 0) return [];
    const ids = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.sportEventParticipantRound.findMany({
        where: {
          sportEventParticipantId: { in: latest.map((write) => write.sportEventParticipantId) },
          sportEventRoundId: { in: latest.map((write) => write.sportEventRoundId) },
        },
        include: { golf: true },
      });
      const existingByKey = new Map(existing.map((row) => [roundKey(row), row]));
      const created: Prisma.SportEventParticipantRoundCreateManyInput[] = [];
      const idsByProgress = new Map<string, { status: GolfRoundWrite['status']; completedAt: Date | null; ids: string[] }>();
      const golfRows: Prisma.SportEventParticipantGolfRoundCreateManyInput[] = [];
      const roundIds: string[] = [];
      for (const write of latest) {
        const before = existingByKey.get(roundKey(write));
        const id = before?.id ?? randomUUID();
        roundIds.push(id);
        if (!before) {
          created.push({ id, sportEventParticipantId: write.sportEventParticipantId, sportEventRoundId: write.sportEventRoundId, status: write.status, completedAt: write.completedAt });
        } else {
          const progressKey = `${write.status}|${write.completedAt?.toISOString() ?? ''}`;
          const group = idsByProgress.get(progressKey) ?? { status: write.status, completedAt: write.completedAt, ids: [] };
          group.ids.push(id);
          idsByProgress.set(progressKey, group);
        }
        golfRows.push({
          ...(before?.golf && { id: before.golf.id, createdAt: before.golf.createdAt }),
          participantRoundId: id,
          strokes: write.strokes,
          scoreToPar: write.scoreToPar,
          thru: write.thru,
        });
      }
      if (created.length > 0) await tx.sportEventParticipantRound.createMany({ data: created });
      // poolmaster-allow-query-in-loop: one updateMany per distinct (status, completion time), a handful per round
      await Promise.all([...idsByProgress.values()].map(({ status, completedAt, ids: progressIds }) => tx.sportEventParticipantRound.updateMany({
        where: { id: { in: progressIds } },
        data: { status, completedAt },
      })));
      const golfIds = existing.flatMap((row) => (row.golf ? [row.golf.id] : []));
      if (golfIds.length > 0) await tx.sportEventParticipantGolfRound.deleteMany({ where: { id: { in: golfIds } } });
      await tx.sportEventParticipantGolfRound.createMany({ data: golfRows });
      return roundIds;
    });
    const rows = await this.prisma.sportEventParticipantRound.findMany({
      where: { id: { in: ids } },
      include: GOLF_ROUND_INCLUDE,
    });
    const rowById = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = rowById.get(id);
      return row ? toGolfRoundResult(row) : [];
    });
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

  /** Every write in a fixed number of statements, however many golfers (#1252), answered in the order given. */
  async upsertMany(writes: readonly GolfStandingWrite[]): Promise<GolfStandingResult[]> {
    if (writes.length === 0) return [];
    const rows = await this.prisma.$transaction((tx) => rewriteStandings(tx, writes.map((write) => ({
      sportEventParticipantId: write.sportEventParticipantId,
      standing: { currentRound: write.currentRound, status: write.status, asOf: write.asOf },
      golf: { eventScoreToPar: write.eventScoreToPar, eventStrokes: write.eventStrokes, currentRoundThru: write.currentRoundThru },
    }))));
    return rows.flatMap(toGolfStandingResult);
  }

  /** Every rank in a fixed number of statements, however many golfers (#1252). */
  async updateRanks(ranks: ReadonlyArray<StandingRankWrite>): Promise<void> {
    if (ranks.length === 0) return;
    await this.prisma.$transaction((tx) => rewriteStandingRanks(tx, ranks));
  }
}

/** A round row's identity: its field row and its event round. */
function roundKey(row: { sportEventParticipantId: string; sportEventRoundId: string }): string {
  return `${row.sportEventParticipantId}|${row.sportEventRoundId}`;
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
