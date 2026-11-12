/**
 * Prisma adapter for the composite family's extension port (#934). A stat line extends a
 * participant round: one row per round and stat, its key a Postgres enum.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { GameStatLineStatus, GameStatLineWrite, GameStatLineWriteOutcome, SportEventParticipantStatLineRepository } from '@poolmaster/shared/db';
import { type BackgroundJobRequest, type SportEventParticipantStatLine, type SportStat } from '@poolmaster/shared/domain';
import { insertBackgroundJobs } from './prisma-background-job-repository';

export class PrismaSportEventParticipantStatLineRepository implements SportEventParticipantStatLineRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * A fixed handful of statements whatever the box score's size (#1183): the stored rounds
   * and lines are read at once, an unchanged line is left alone, and the rest are deleted,
   * updated and created in bulk.
   */
  async replaceGameLines(writes: readonly GameStatLineWrite[], jobs: readonly BackgroundJobRequest[] = []): Promise<GameStatLineWriteOutcome[]> {
    if (writes.length === 0) return [];
    return this.prisma.$transaction(async (tx) => {
      const stored = await tx.sportEventParticipantRound.findMany({
        where: {
          sportEventParticipantId: { in: [...new Set(writes.map((write) => write.sportEventParticipantId))] },
          sportEventRoundId: { in: [...new Set(writes.map((write) => write.sportEventRoundId))] },
        },
        select: { id: true, sportEventParticipantId: true, sportEventRoundId: true, status: true, statLines: { select: { stat: true, value: true } } },
      });
      const storedByKey = new Map(stored.map((round) => [roundKey(round), round]));

      const cleared: string[] = [];
      const rewritten: Array<{ roundId: string; write: GameStatLineWrite }> = [];
      const added: GameStatLineWrite[] = [];
      const outcomes = writes.map((write): GameStatLineWriteOutcome => {
        const existing = storedByKey.get(roundKey(write));
        const { sportEventParticipantId, sportEventRoundId } = write;
        if (write.stats.length === 0) {
          // No line: the player did not play the game, so they have no round in it either.
          if (!existing) return { sportEventParticipantId, sportEventRoundId, disposition: 'UNCHANGED' };
          cleared.push(existing.id);
          return { sportEventParticipantId, sportEventRoundId, disposition: 'DELETED' };
        }
        if (!existing) {
          added.push(write);
          return { sportEventParticipantId, sportEventRoundId, disposition: 'CREATED' };
        }
        if (existing.status !== write.status || !sameLine(existing.statLines, write.stats)) {
          rewritten.push({ roundId: existing.id, write });
          return { sportEventParticipantId, sportEventRoundId, disposition: 'UPDATED' };
        }
        return { sportEventParticipantId, sportEventRoundId, disposition: 'UNCHANGED' };
      });

      const replacedRoundIds = [...cleared, ...rewritten.map(({ roundId }) => roundId)];
      if (replacedRoundIds.length > 0) {
        await tx.sportEventParticipantStatLine.deleteMany({ where: { participantRoundId: { in: replacedRoundIds } } });
      }
      if (cleared.length > 0) {
        await tx.sportEventParticipantRound.deleteMany({ where: { id: { in: cleared } } });
      }
      // One game's lines are written together, so they share one status and completedAt; grouping
      // keeps this one statement a game, however many players it has.
      const rewrittenByState = new Map<string, { status: GameStatLineStatus; completedAt: Date | null; ids: string[] }>();
      for (const { roundId, write } of rewritten) {
        const key = `${write.status}:${write.completedAt?.getTime() ?? ''}`;
        const group = rewrittenByState.get(key) ?? { status: write.status, completedAt: write.completedAt, ids: [] };
        group.ids.push(roundId);
        rewrittenByState.set(key, group);
      }
      for (const { status, completedAt, ids } of rewrittenByState.values()) {
        // poolmaster-allow-query-in-loop: one updateMany per distinct status and completion time; one game's lines share one
        await tx.sportEventParticipantRound.updateMany({ where: { id: { in: ids } }, data: { status, completedAt } });
      }
      const created = added.length === 0 ? [] : await tx.sportEventParticipantRound.createManyAndReturn({
        data: added.map(({ sportEventParticipantId, sportEventRoundId, status, completedAt }) => ({ sportEventParticipantId, sportEventRoundId, status, completedAt })),
        select: { id: true, sportEventParticipantId: true, sportEventRoundId: true },
      });
      const createdIdByKey = new Map(created.map((round) => [roundKey(round), round.id]));

      const lines = [
        ...rewritten.flatMap(({ roundId, write }) => write.stats.map(({ stat, value }) => ({ participantRoundId: roundId, stat, value }))),
        ...added.flatMap((write) => write.stats.map(({ stat, value }) => ({ participantRoundId: createdIdByKey.get(roundKey(write)) as string, stat, value }))),
      ];
      if (lines.length > 0) {
        await tx.sportEventParticipantStatLine.createMany({ data: lines });
      }
      await insertBackgroundJobs(tx, jobs);
      return outcomes;
    });
  }
}

function roundKey(round: { sportEventParticipantId: string; sportEventRoundId: string }): string {
  return `${round.sportEventParticipantId}:${round.sportEventRoundId}`;
}

/** Whether a stored line holds exactly these stats and values. */
function sameLine(stored: ReadonlyArray<{ stat: SportStat; value: number }>, stats: ReadonlyArray<{ stat: SportStat; value: number }>): boolean {
  if (stored.length !== stats.length) return false;
  const storedValues = new Map(stored.map(({ stat, value }) => [stat, value]));
  return stats.every(({ stat, value }) => storedValues.get(stat) === value);
}

export function toStatLine(row: Prisma.SportEventParticipantStatLineGetPayload<object>): SportEventParticipantStatLine {
  return {
    id: row.id,
    participantRoundId: row.participantRoundId,
    stat: row.stat,
    value: row.value,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
