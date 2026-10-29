/**
 * Prisma adapter for the composite family's extension port (#934). A stat line extends a
 * participant round: one row per round and stat, its key a Postgres enum.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { GameStatLineWrite, SportEventParticipantStatLineRepository } from '@poolmaster/shared/db';
import { ParticipantRoundStatus, type SportEventParticipantStatLine, type SportStat } from '@poolmaster/shared/domain';

export class PrismaSportEventParticipantStatLineRepository implements SportEventParticipantStatLineRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * A fixed handful of statements whatever the box score's size (#1183): the stored rounds
   * and lines are read at once, an unchanged line is left alone, and the rest are deleted,
   * updated and created in bulk.
   */
  async replaceGameLines(writes: readonly GameStatLineWrite[]): Promise<void> {
    if (writes.length === 0) return;
    await this.prisma.$transaction(async (tx) => {
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
      for (const write of writes) {
        const existing = storedByKey.get(roundKey(write));
        if (write.stats.length === 0) {
          // No line: the player did not play the game, so they have no round in it either.
          if (existing) cleared.push(existing.id);
        } else if (!existing) {
          added.push(write);
        } else if (existing.status !== ParticipantRoundStatus.COMPLETED || !sameLine(existing.statLines, write.stats)) {
          rewritten.push({ roundId: existing.id, write });
        }
      }

      const replacedRoundIds = [...cleared, ...rewritten.map(({ roundId }) => roundId)];
      if (replacedRoundIds.length > 0) {
        await tx.sportEventParticipantStatLine.deleteMany({ where: { participantRoundId: { in: replacedRoundIds } } });
      }
      if (cleared.length > 0) {
        await tx.sportEventParticipantRound.deleteMany({ where: { id: { in: cleared } } });
      }
      // One game's lines are written together, so they share one completedAt; grouping keeps
      // this one statement either way.
      const rewrittenByCompletedAt = new Map<number, string[]>();
      for (const { roundId, write } of rewritten) {
        const at = write.completedAt.getTime();
        rewrittenByCompletedAt.set(at, [...(rewrittenByCompletedAt.get(at) ?? []), roundId]);
      }
      for (const [at, ids] of rewrittenByCompletedAt) {
        await tx.sportEventParticipantRound.updateMany({ where: { id: { in: ids } }, data: { status: ParticipantRoundStatus.COMPLETED, completedAt: new Date(at) } });
      }
      const created = added.length === 0 ? [] : await tx.sportEventParticipantRound.createManyAndReturn({
        data: added.map(({ sportEventParticipantId, sportEventRoundId, completedAt }) => ({ sportEventParticipantId, sportEventRoundId, status: ParticipantRoundStatus.COMPLETED, completedAt })),
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
