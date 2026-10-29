/**
 * Prisma adapter for the read-only ContestEntryPickRepository port. There is no insert here on
 * purpose: `ContestEntryPickService` is the single insert path (plans/117 §7.1).
 */

import type { PrismaClient } from '@prisma/client';
import type {
  ContestEntryEventPick,
  ContestEntryPickRepository,
  ContestEntryPickWithParticipant,
} from '@poolmaster/shared/db';
import type { ParticipantInactiveReason } from '@poolmaster/shared/domain';
import { mapContestEntryPickRowToDomain } from '../mappers/contest-entry-picks.mapper';

const PICK_ORDER = [{ pickedAt: 'asc' as const }, { id: 'asc' as const }];

export class PrismaContestEntryPickRepository implements ContestEntryPickRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEntriesAndEvents(entryIds: readonly string[], sportEventIds: readonly string[]): Promise<ContestEntryEventPick[]> {
    if (entryIds.length === 0 || sportEventIds.length === 0) return [];
    const rows = await this.prisma.contestEntryPick.findMany({
      where: { entryId: { in: [...entryIds] }, sportEventParticipant: { sportEventId: { in: [...sportEventIds] } } },
      include: { sportEventParticipant: { select: { sportEventId: true } } },
      orderBy: PICK_ORDER,
    });
    return rows.map((row) => ({ ...mapContestEntryPickRowToDomain(row), sportEventId: row.sportEventParticipant.sportEventId }));
  }

  async findByEntriesWithParticipant(
    entryIds: readonly string[],
    options?: { sportEventId?: string },
  ): Promise<ContestEntryPickWithParticipant[]> {
    if (entryIds.length === 0) return [];
    const rows = await this.prisma.contestEntryPick.findMany({
      where: {
        entryId: { in: [...entryIds] },
        ...(options?.sportEventId !== undefined && { sportEventParticipant: { sportEventId: options.sportEventId } }),
      },
      include: {
        sportEventParticipant: {
          select: {
            sportEventId: true,
            participantId: true,
            isActive: true,
            inactiveReason: true,
            participant: { select: { name: true, role: true, teamAffiliation: true } },
          },
        },
      },
      orderBy: PICK_ORDER,
    });
    return rows.map((row) => ({
      ...mapContestEntryPickRowToDomain(row),
      sportEventId: row.sportEventParticipant.sportEventId,
      participant: {
        participantId: row.sportEventParticipant.participantId,
        participantName: row.sportEventParticipant.participant.name,
        isActive: row.sportEventParticipant.isActive,
        inactiveReason: row.sportEventParticipant.inactiveReason as ParticipantInactiveReason | null,
        role: row.sportEventParticipant.participant.role ?? null,
        teamAffiliation: row.sportEventParticipant.participant.teamAffiliation ?? null,
      },
    }));
  }

  async countByEntries(entryIds: readonly string[]): Promise<Map<string, number>> {
    if (entryIds.length === 0) return new Map();
    const rows = await this.prisma.contestEntryPick.groupBy({
      by: ['entryId'],
      where: { entryId: { in: [...entryIds] } },
      _count: { id: true },
    });
    return new Map(rows.map((row) => [row.entryId, row._count.id]));
  }
}
