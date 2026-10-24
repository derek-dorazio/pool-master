/**
 * Prisma adapter for the composite family's extension port (#934). A stat line extends a
 * participant round: one row per round and stat, its key a Postgres enum.
 */

import type { PrismaClient } from '@prisma/client';
import type { SportEventParticipantStatLineRepository } from '@poolmaster/shared/db';
import type { SportEventParticipantStatLine } from '@poolmaster/shared/domain';

export class PrismaSportEventParticipantStatLineRepository implements SportEventParticipantStatLineRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySportEvent(sportEventId: string): Promise<SportEventParticipantStatLine[]> {
    const rows = await this.prisma.sportEventParticipantStatLine.findMany({
      where: { participantRound: { sportEventParticipant: { sportEventId } } },
      orderBy: [{ participantRoundId: 'asc' }, { stat: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      participantRoundId: row.participantRoundId,
      stat: row.stat,
      value: row.value,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}
