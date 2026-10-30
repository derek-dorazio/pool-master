/**
 * Prisma adapter for the finish-position extension port (#622). A race result is keyed 1:1 to
 * its field row. The admin's finishing order writes the results, the race's official flag and
 * each runner's core standing in one transaction, so a reader never sees a result without the
 * place it gives the runner in the event.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { RaceResultApply, SportEventParticipantRaceResultRepository } from '@poolmaster/shared/db';
import type { SportEventParticipantRaceResult } from '@poolmaster/shared/domain';
import { rewriteStandings } from './prisma-standing-rewrite';

export class PrismaSportEventParticipantRaceResultRepository implements SportEventParticipantRaceResultRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySportEvent(sportEventId: string): Promise<SportEventParticipantRaceResult[]> {
    const rows = await this.prisma.sportEventParticipantRaceResult.findMany({
      where: { sportEventParticipant: { sportEventId } },
      orderBy: { sportEventParticipantId: 'asc' },
    });
    return rows.map(toRaceResult);
  }

  /**
   * The results, the official flag and the standings in a fixed number of statements, however
   * big the field (#1252): a result row is pointed at by nothing, so the runners' results are
   * read, deleted and inserted again, each keeping its id and creation time.
   */
  async applyResults(sportEventId: string, apply: RaceResultApply): Promise<void> {
    const { isOfficial } = apply;
    // A runner named twice keeps the later result, as two upserts in a row would leave it.
    const results = [...new Map(apply.results.map((result) => [result.sportEventParticipantId, result])).values()];
    await this.prisma.$transaction(async (tx) => {
      if (results.length > 0) {
        const existing = await tx.sportEventParticipantRaceResult.findMany({
          where: { sportEventParticipantId: { in: results.map((result) => result.sportEventParticipantId) } },
          select: { id: true, sportEventParticipantId: true, createdAt: true },
        });
        const existingById = new Map(existing.map((row) => [row.sportEventParticipantId, row]));
        await tx.sportEventParticipantRaceResult.deleteMany({ where: { id: { in: existing.map((row) => row.id) } } });
        await tx.sportEventParticipantRaceResult.createMany({
          data: results.map((result) => ({ ...existingById.get(result.sportEventParticipantId), ...result, isOfficial })),
        });
      }
      // The race is official as a whole: the flag moves for the runners not named as well.
      await tx.sportEventParticipantRaceResult.updateMany({
        where: { sportEventParticipant: { sportEventId }, isOfficial: !isOfficial },
        data: { isOfficial },
      });
      await rewriteStandings(tx, apply.standings.map(({ sportEventParticipantId, ...standing }) => ({ sportEventParticipantId, standing })));
    });
  }
}

export function toRaceResult(row: Prisma.SportEventParticipantRaceResultGetPayload<object>): SportEventParticipantRaceResult {
  return {
    id: row.id,
    sportEventParticipantId: row.sportEventParticipantId,
    finishPosition: row.finishPosition,
    startPosition: row.startPosition,
    resultStatus: row.resultStatus,
    isOfficial: row.isOfficial,
    riderName: row.riderName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
