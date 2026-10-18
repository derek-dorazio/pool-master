import type { PrismaClient } from '@prisma/client';
import type {
  ContestEntryMatchPredictionRepository,
  ContestEntryMatchPredictionSave,
} from '@poolmaster/shared/db';
import { ContestEntryStatus, type ContestEntryMatchPrediction } from '@poolmaster/shared/domain';

/** A prediction contest entry's game picks (#716). */
export class PrismaContestEntryMatchPredictionRepository implements ContestEntryMatchPredictionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEntryAndEvent(contestEntryId: string, sportEventId: string): Promise<ContestEntryMatchPrediction[]> {
    const rows = await this.prisma.contestEntryMatchPrediction.findMany({
      where: { contestEntryId, sportEventMatch: { sportEventId } },
      orderBy: { sportEventMatch: { matchNumber: 'asc' } },
    });
    return rows.map((row) => ({
      id: row.id,
      contestEntryId: row.contestEntryId,
      sportEventMatchId: row.sportEventMatchId,
      sportEventParticipantId: row.sportEventParticipantId,
      confidence: row.confidence,
      pickedAt: row.pickedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async save(change: ContestEntryMatchPredictionSave): Promise<void> {
    const { contestEntryId, sportEventId, saves, clearedMatchIds, eventStatus, at } = change;
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
      if (eventStatus !== null) {
        const submittedAt = eventStatus === ContestEntryStatus.SUBMITTED ? at : null;
        await tx.contestEntryEvent.upsert({
          where: { contestEntryId_sportEventId: { contestEntryId, sportEventId } },
          create: { contestEntryId, sportEventId, status: eventStatus, submittedAt },
          update: { status: eventStatus, submittedAt },
        });
      }
    });
  }
}
