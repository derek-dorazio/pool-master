/**
 * Prisma adapter for the read-only ContestEntryPickRepository port. There is no insert here on
 * purpose: `ContestEntryPickService.createPick` is the single insert path (plans/117 §7.1).
 */

import type { PrismaClient } from '@prisma/client';
import type {
  ContestEntryPickRepository,
  ContestEntryPickWithParticipant,
} from '@poolmaster/shared/db';
import type { ContestEntryPick, ParticipantInactiveReason } from '@poolmaster/shared/domain';
import { mapContestEntryPickRowToDomain } from '../mappers/contest-entry-picks.mapper';

const PICK_ORDER = [{ pickedAt: 'asc' as const }, { id: 'asc' as const }];

export class PrismaContestEntryPickRepository implements ContestEntryPickRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEntries(entryIds: readonly string[]): Promise<ContestEntryPick[]> {
    if (entryIds.length === 0) return [];
    const rows = await this.prisma.contestEntryPick.findMany({
      where: { entryId: { in: [...entryIds] } },
      orderBy: PICK_ORDER,
    });
    return rows.map(mapContestEntryPickRowToDomain);
  }

  async findByEntriesWithParticipant(entryIds: readonly string[]): Promise<ContestEntryPickWithParticipant[]> {
    if (entryIds.length === 0) return [];
    const rows = await this.prisma.contestEntryPick.findMany({
      where: { entryId: { in: [...entryIds] } },
      include: {
        sportEventParticipant: {
          select: {
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

  async findByContestAndParticipant(
    contestId: string,
    sportEventParticipantId: string,
  ): Promise<ContestEntryPick[]> {
    const rows = await this.prisma.contestEntryPick.findMany({
      where: { sportEventParticipantId, entry: { contestId } },
      orderBy: PICK_ORDER,
    });
    return rows.map(mapContestEntryPickRowToDomain);
  }

  async countByContest(contestId: string): Promise<number> {
    return this.prisma.contestEntryPick.count({ where: { entry: { contestId } } });
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
