/**
 * Prisma adapter for the composite family's extension port (#934). A stat line extends a
 * participant round: one row per round and stat, its key a Postgres enum.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { GameStatLineWrite, SportEventParticipantStatLineRepository } from '@poolmaster/shared/db';
import type { SportEventParticipantStatLine } from '@poolmaster/shared/domain';

export class PrismaSportEventParticipantStatLineRepository implements SportEventParticipantStatLineRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async replaceGameLines(writes: readonly GameStatLineWrite[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const { sportEventParticipantId, sportEventRoundId, stats, completedAt } of writes) {
        const key = { sportEventParticipantId_sportEventRoundId: { sportEventParticipantId, sportEventRoundId } };
        const existing = await tx.sportEventParticipantRound.findUnique({ where: key, select: { id: true } });
        if (existing) {
          await tx.sportEventParticipantStatLine.deleteMany({ where: { participantRoundId: existing.id } });
        }
        if (stats.length === 0) {
          // No line: the player did not play the game, so they have no round in it either.
          if (existing) await tx.sportEventParticipantRound.delete({ where: { id: existing.id } });
          continue;
        }
        const round = await tx.sportEventParticipantRound.upsert({
          where: key,
          create: { sportEventParticipantId, sportEventRoundId, status: 'COMPLETED', completedAt },
          update: { status: 'COMPLETED', completedAt },
          select: { id: true },
        });
        await tx.sportEventParticipantStatLine.createMany({
          data: stats.map(({ stat, value }) => ({ participantRoundId: round.id, stat, value })),
        });
      }
    });
  }
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
