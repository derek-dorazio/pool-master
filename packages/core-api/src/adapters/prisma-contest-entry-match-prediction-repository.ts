import { insertBackgroundJobs } from './prisma-background-job-repository';
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  ContestEntryMatchPredictionRepository,
  ContestEntryMatchPredictionSave,
  ContestEntryMatchPredictionSaveResult,
  ContestEntrySeasonPrediction,
  LockedPredictionWeek,
} from '@poolmaster/shared/db';
import {
  ContestEntryStatus,
  compareMatchPlaces,
  PredictedResult,
  type ContestEntryMatchPrediction,
  type PredictedChoice,
  type MatchPlace,
} from '@poolmaster/shared/domain';
import { toEntryEventStatus } from './prisma-contest-entry-repository';

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

/** The entry's row for one event, as a change reads and writes it. */
const WEEK_EVENT = { sportEventId: true, status: true, submittedAt: true, tiebreakerValue: true } as const;
/** A pick with its game's round and number, so a week's picks can be put in game order without another read. */
const WITH_MATCH_PLACE = { sportEventRoundMatch: { select: { matchNumber: true, sportEventRound: { select: { roundNumber: true } } } } } as const;
/** Game order: round first, then the match's number within its round (#2161). */
const IN_GAME_ORDER = [
  { sportEventRoundMatch: { sportEventRound: { roundNumber: 'asc' } } },
  { sportEventRoundMatch: { matchNumber: 'asc' } },
] satisfies Prisma.ContestEntryMatchPredictionOrderByWithRelationInput[];

type WithMatchPlace = PredictionRow & { sportEventRoundMatch: { matchNumber: number; sportEventRound: { roundNumber: number } } };

function placeOf(row: WithMatchPlace): MatchPlace {
  return { roundNumber: row.sportEventRoundMatch.sportEventRound.roundNumber, matchNumber: row.sportEventRoundMatch.matchNumber };
}

function inGameOrder(rows: readonly WithMatchPlace[]): ContestEntryMatchPrediction[] {
  return [...rows]
    .sort((left, right) => compareMatchPlaces(placeOf(left), placeOf(right)))
    .map(toPrediction);
}

function toPrediction(row: PredictionRow): ContestEntryMatchPrediction {
  return {
    id: row.id,
    contestEntryId: row.contestEntryId,
    sportEventRoundMatchId: row.sportEventRoundMatchId,
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
      where: { contestEntryId, sportEventRoundMatch: { sportEventId } },
      orderBy: IN_GAME_ORDER,
    });
    return rows.map(toPrediction);
  }

  async findByEntriesAndEvent(contestEntryIds: readonly string[], sportEventId: string): Promise<ContestEntryMatchPrediction[]> {
    if (contestEntryIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.contestEntryMatchPrediction.findMany({
      where: { contestEntryId: { in: [...contestEntryIds] }, sportEventRoundMatch: { sportEventId } },
      orderBy: [{ contestEntryId: 'asc' }, ...IN_GAME_ORDER],
    });
    return rows.map(toPrediction);
  }

  async findByEntriesAndEvents(contestEntryIds: readonly string[], sportEventIds: readonly string[]): Promise<ContestEntrySeasonPrediction[]> {
    if (contestEntryIds.length === 0 || sportEventIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.contestEntryMatchPrediction.findMany({
      where: { contestEntryId: { in: [...contestEntryIds] }, sportEventRoundMatch: { sportEventId: { in: [...sportEventIds] } } },
      include: { sportEventRoundMatch: { select: { sportEventId: true } }, sportEventParticipant: { select: { participantId: true } } },
      orderBy: [{ contestEntryId: 'asc' }, ...IN_GAME_ORDER],
    });
    return rows.map((row): ContestEntrySeasonPrediction => {
      const prediction = toPrediction(row);
      const sportEventId = row.sportEventRoundMatch.sportEventId;
      if (prediction.predictedResult === PredictedResult.TIE) {
        return { ...prediction, sportEventId, participantId: null };
      }
      if (row.sportEventParticipant === null) {
        throw new Error(`Match prediction ${row.id} is a team pick with no team.`);
      }
      return { ...prediction, sportEventId, participantId: row.sportEventParticipant.participantId };
    });
  }

  async hasAnyOnMatch(sportEventRoundMatchId: string): Promise<boolean> {
    const row = await this.prisma.contestEntryMatchPrediction.findFirst({ where: { sportEventRoundMatchId }, select: { id: true } });
    return row !== null;
  }

  async save({ contestEntryId, sportEventId, at, decide }: ContestEntryMatchPredictionSave): Promise<ContestEntryMatchPredictionSaveResult> {
    return this.prisma.$transaction(async (tx) => {
      // Touching the entry first takes its row lock, and the week is read under it, so two
      // changes to one entry's picks run one after the other and each judges the week the other
      // left (#1268). Otherwise both could delete a game's pick before either inserts, hitting
      // the (entry, game) unique index (#1254), or a submit could pass picks a clear was removing.
      const locked = await tx.contestEntry.update({
        where: { id: contestEntryId },
        data: { updatedAt: at },
        select: {
          events: { where: { sportEventId }, select: WEEK_EVENT },
          predictions: { where: { sportEventRoundMatch: { sportEventId } }, include: WITH_MATCH_PLACE },
        },
      });
      const lockedEvent = locked.events.at(0);
      const before: LockedPredictionWeek = {
        predictions: inGameOrder(locked.predictions),
        event: lockedEvent === undefined ? null : toEntryEventStatus(lockedEvent),
      };
      const change = decide(before);
      if (change === null) return { written: null, week: before };

      const { saves, clearedMatchIds, eventStatus, tiebreakerValue, jobs = [] } = change;
      // A saved pick replaces the game's earlier one: both go in one delete, and the saves in one
      // insert, so the write costs the same for one game as for a full slate (#1254).
      const replacedMatchIds = new Set([...clearedMatchIds, ...saves.map((save) => save.sportEventRoundMatchId)]);
      if (replacedMatchIds.size > 0) {
        await tx.contestEntryMatchPrediction.deleteMany({
          where: { contestEntryId, sportEventRoundMatchId: { in: [...replacedMatchIds] } },
        });
      }
      const created = saves.length > 0
        ? await tx.contestEntryMatchPrediction.createManyAndReturn({
          data: saves.map(({ sportEventRoundMatchId, predictedResult, sportEventParticipantId, confidence }) => ({
            contestEntryId, sportEventRoundMatchId, predictedResult, sportEventParticipantId, confidence, pickedAt: at,
          })),
          include: WITH_MATCH_PLACE,
        })
        : [];
      const statusChange = eventStatus === null
        ? {}
        : { status: eventStatus, submittedAt: eventStatus === ContestEntryStatus.SUBMITTED ? at : null };
      // The event's tiebreaker rides on the entry's row for the event (#717).
      const tiebreakerChange = tiebreakerValue === undefined ? {} : { tiebreakerValue };
      const event = eventStatus !== null || tiebreakerValue !== undefined
        ? toEntryEventStatus(await tx.contestEntryEvent.upsert({
          where: { contestEntryId_sportEventId: { contestEntryId, sportEventId } },
          create: { contestEntryId, sportEventId, ...statusChange, ...tiebreakerChange },
          update: { ...statusChange, ...tiebreakerChange },
          select: WEEK_EVENT,
        }))
        : before.event;
      await insertBackgroundJobs(tx, jobs);
      return {
        written: change,
        week: {
          predictions: inGameOrder([
            ...locked.predictions.filter((row) => !replacedMatchIds.has(row.sportEventRoundMatchId)),
            ...created,
          ]),
          event,
        },
      };
    });
  }
}
