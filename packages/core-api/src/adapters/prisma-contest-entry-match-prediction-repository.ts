import type { PrismaClient } from '@prisma/client';
import type {
  ContestEntryMatchPredictionRepository,
  ContestEntryMatchPredictionSave,
  ContestEntrySeasonPrediction,
} from '@poolmaster/shared/db';
import { ContestEntryStatus, PredictedResult, type ContestEntryMatchPrediction, type PredictedChoice } from '@poolmaster/shared/domain';

type PredictionRow = Awaited<ReturnType<PrismaClient['contestEntryMatchPrediction']['findMany']>>[number];

/**
 * What the row predicts: its team, or a tie. The database's check keeps the team named exactly
 * when the result is TEAM, so a team row without one is a broken row.
 */
function toChoice(row: PredictionRow): PredictedChoice {
  if (row.predictedResult === PredictedResult.TIE) {
    return { predictedResult: PredictedResult.TIE, sportEventParticipantId: null };
  }
  if (row.sportEventParticipantId === null) {
    throw new Error(`Match prediction ${row.id} is a team pick with no team.`);
  }
  return { predictedResult: PredictedResult.TEAM, sportEventParticipantId: row.sportEventParticipantId };
}

function toPrediction(row: PredictionRow): ContestEntryMatchPrediction {
  return {
    id: row.id,
    contestEntryId: row.contestEntryId,
    sportEventMatchId: row.sportEventMatchId,
    ...toChoice(row),
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
      orderBy: [{ contestEntryId: 'asc' }, { sportEventMatch: { matchNumber: 'asc' } }],
    });
    return rows.map(toPrediction);
  }

  async findByEntriesAndEvents(contestEntryIds: readonly string[], sportEventIds: readonly string[]): Promise<ContestEntrySeasonPrediction[]> {
    if (contestEntryIds.length === 0 || sportEventIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.contestEntryMatchPrediction.findMany({
      where: { contestEntryId: { in: [...contestEntryIds] }, sportEventMatch: { sportEventId: { in: [...sportEventIds] } } },
      include: { sportEventMatch: { select: { sportEventId: true } }, sportEventParticipant: { select: { participantId: true } } },
      orderBy: [{ contestEntryId: 'asc' }, { sportEventMatch: { matchNumber: 'asc' } }],
    });
    return rows.map((row): ContestEntrySeasonPrediction => {
      const prediction = toPrediction(row);
      const sportEventId = row.sportEventMatch.sportEventId;
      if (prediction.predictedResult === PredictedResult.TIE) {
        return { ...prediction, sportEventId, participantId: null };
      }
      if (row.sportEventParticipant === null) {
        throw new Error(`Match prediction ${row.id} is a team pick with no team.`);
      }
      return { ...prediction, sportEventId, participantId: row.sportEventParticipant.participantId };
    });
  }

  async hasAnyOnMatch(sportEventMatchId: string): Promise<boolean> {
    const row = await this.prisma.contestEntryMatchPrediction.findFirst({ where: { sportEventMatchId }, select: { id: true } });
    return row !== null;
  }

  async save(change: ContestEntryMatchPredictionSave): Promise<void> {
    const { contestEntryId, sportEventId, saves, clearedMatchIds, eventStatus, tiebreakerValue, at } = change;
    // A saved pick replaces the game's earlier one: both go in one delete, and the saves in one
    // insert, so the write costs the same for one game as for a full slate (#1254).
    const replacedMatchIds = [...clearedMatchIds, ...saves.map((save) => save.sportEventMatchId)];
    await this.prisma.$transaction(async (tx) => {
      if (replacedMatchIds.length > 0) {
        // Touching the entry first takes its row lock, so two saves that write one entry's picks
        // run one after the other: otherwise both could delete a game's pick before either
        // inserts, and the second insert would hit the (entry, game) unique index. A save that
        // only sets the week, as a submit does, writes no pick and needs no lock.
        await tx.contestEntry.update({ where: { id: contestEntryId }, data: { updatedAt: at } });
        await tx.contestEntryMatchPrediction.deleteMany({
          where: { contestEntryId, sportEventMatchId: { in: replacedMatchIds } },
        });
      }
      if (saves.length > 0) {
        await tx.contestEntryMatchPrediction.createMany({
          data: saves.map(({ sportEventMatchId, predictedResult, sportEventParticipantId, confidence }) => ({
            contestEntryId, sportEventMatchId, predictedResult, sportEventParticipantId, confidence, pickedAt: at,
          })),
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
