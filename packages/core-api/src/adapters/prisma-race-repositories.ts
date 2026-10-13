/**
 * Prisma adapter for the finish-position extension port (#622). A race result is keyed 1:1 to
 * its field row. The admin's finishing order writes the results, the race's official flag and
 * each runner's core standing in one transaction, so a reader never sees a result without the
 * place it gives the runner in the event.
 */

import type { PrismaClient } from '@prisma/client';
import type { RaceResultApply, SportEventParticipantRaceResultRepository } from '@poolmaster/shared/db';
import type { SportEventParticipantRaceResult } from '@poolmaster/shared/domain';

export class PrismaSportEventParticipantRaceResultRepository implements SportEventParticipantRaceResultRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySportEvent(sportEventId: string): Promise<SportEventParticipantRaceResult[]> {
    const rows = await this.prisma.sportEventParticipantRaceResult.findMany({
      where: { sportEventParticipant: { sportEventId } },
      orderBy: { sportEventParticipantId: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      sportEventParticipantId: row.sportEventParticipantId,
      finishPosition: row.finishPosition,
      startPosition: row.startPosition,
      resultStatus: row.resultStatus,
      isOfficial: row.isOfficial,
      riderName: row.riderName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async applyResults(sportEventId: string, apply: RaceResultApply): Promise<void> {
    const { isOfficial } = apply;
    await this.prisma.$transaction([
      ...apply.results.map((result) => {
        const { sportEventParticipantId, ...values } = result;
        return this.prisma.sportEventParticipantRaceResult.upsert({
          where: { sportEventParticipantId },
          create: { sportEventParticipantId, ...values, isOfficial },
          update: { ...values, isOfficial },
        });
      }),
      // The race is official as a whole: the flag moves for the runners not named as well.
      this.prisma.sportEventParticipantRaceResult.updateMany({
        where: { sportEventParticipant: { sportEventId }, isOfficial: !isOfficial },
        data: { isOfficial },
      }),
      ...apply.standings.map((standing) => {
        const { sportEventParticipantId, ...values } = standing;
        return this.prisma.sportEventParticipantStanding.upsert({
          where: { sportEventParticipantId },
          create: { sportEventParticipantId, ...values },
          update: values,
        });
      }),
    ]);
  }
}
