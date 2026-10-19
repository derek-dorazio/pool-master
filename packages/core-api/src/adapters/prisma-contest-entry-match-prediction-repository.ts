import type { PrismaClient } from '@prisma/client';
import type {
  ContestEntryMatchPredictionRepository,
  ContestEntryMatchPredictionSave,
} from '@poolmaster/shared/db';
import { ContestEntryStatus, type ContestEntryMatchPrediction } from '@poolmaster/shared/domain';

type PredictionRow = Awaited<ReturnType<PrismaClient['contestEntryMatchPrediction']['findMany']>>[number];

function toPrediction(row: PredictionRow): ContestEntryMatchPrediction {
  return {
    id: row.id,
    contestEntryId: row.contestEntryId,
    sportEventMatchId: row.sportEventMatchId,
    sportEventParticipantId: row.sportEventParticipantId,
    confidence: row.confidence,
    pickedAt: row.pickedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A prediction contest entry's game picks (#716). */
export class PrismaContestEntryMatchPredictionRepository implements ContestEntryMatchPredictionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEntryAndEvent(contestEntryId: string, sportEventId: string): Promise<ContestEntryMatchPrediction[]> {
    const rows = await this.prisma.contestEntryMatchPrediction.findMany({
      where: { contestEntryId, sportEventMatch: { sportEventId } },
      orderBy: { sportEventMatch: { matchNumber: 'asc' } },
    });
    return rows.map(toPrediction);
  }

  async findByEntriesAndEvent(contestEntryIds: readonly string[], sportEventId: string): Promise<ContestEntryMatchPrediction[]> {
    if (contestEntryIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.contestEntryMatchPrediction.findMany({
      where: { contestEntryId: { in: [...contestEntryIds] }, sportEventMatch: { sportEventId } },
      orderBy: [{ sportEventMatch: { matchNumber: 'asc' } }, { contestEntryId: 'asc' }],
    });
    return rows.map(toPrediction);
  }

  async save(change: ContestEntryMatchPredictionSave): Promise<void> {
    const { contestEntryId, sportEventId, saves, clearedMatchIds, eventStatus, tiebreakerValue, at } = change;
    await this.prisma.$transaction(async (tx) => {
      if (clearedMatchIds.length > 0) {
        await tx.contestEntryMatchPrediction.deleteMany({
          where: { contestEntryId, sportEventMatchId: { in: [...clearedMatchIds] } },
        });
      }
      for (const { sportEventMatchId, sportEventParticipantId, confidence } of saves) {
        await tx.contestEntryMatchPrediction.upsert({
          where: { contestEntryId_sportEventMatchId: { contestEntryId, sportEventMatchId } },
          create: { contestEntryId, sportEventMatchId, sportEventParticipantId, confidence, pickedAt: at },
          update: { sportEventParticipantId, confidence, pickedAt: at },
        });
      }
      const statusChange = eventStatus === null
        ? {}
        : { status: eventStatus, submittedAt: eventStatus === ContestEntryStatus.SUBMITTED ? at : null };
      // The event's tiebreaker rides on the entry's row for the event (#717).
      const tiebreakerChange = tiebreakerValue === undefined ? {} : { tiebreakerValue };
      if (eventStatus !== null || tiebreakerValue !== undefined) {
        await tx.contestEntryEvent.upsert({
          where: { contestEntryId_sportEventId: { contestEntryId, sportEventId } },
          create: { contestEntryId, sportEventId, ...statusChange, ...tiebreakerChange },
          update: { ...statusChange, ...tiebreakerChange },
        });
      }
    });
  }
}
