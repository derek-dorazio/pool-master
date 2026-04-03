/**
 * Prisma adapter for ContestMatchupRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { ContestMatchupRepository } from '@poolmaster/shared/db';
import type { ContestMatchup } from '@poolmaster/shared/domain';

export class PrismaContestMatchupRepository implements ContestMatchupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByContest(contestId: string): Promise<ContestMatchup[]> {
    const rows = await this.prisma.contestMatchup.findMany({
      where: { contestId },
      orderBy: [{ period: 'asc' }, { matchupIndex: 'asc' }],
    });
    return rows.map(mapToContestMatchup);
  }

  async findByPeriod(contestId: string, period: number): Promise<ContestMatchup[]> {
    const rows = await this.prisma.contestMatchup.findMany({
      where: { contestId, period },
      orderBy: { matchupIndex: 'asc' },
    });
    return rows.map(mapToContestMatchup);
  }

  async create(
    matchup: Omit<ContestMatchup, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestMatchup> {
    const row = await this.prisma.contestMatchup.create({
      data: {
        contestId: matchup.contestId,
        eventId: matchup.eventId,
        period: matchup.period,
        matchupIndex: matchup.matchupIndex,
        roundNumber: matchup.roundNumber,
        matchNumber: matchup.matchNumber,
        label: matchup.label,
        homeParticipantId: matchup.homeParticipantId,
        awayParticipantId: matchup.awayParticipantId,
        startsAt: matchup.startsAt,
        lockAt: matchup.lockAt,
        metadata: matchup.metadata as object,
      },
    });
    return mapToContestMatchup(row);
  }

  async createMany(
    matchups: Omit<ContestMatchup, 'id' | 'createdAt' | 'updatedAt'>[],
  ): Promise<number> {
    const result = await this.prisma.contestMatchup.createMany({
      data: matchups.map((matchup) => ({
        contestId: matchup.contestId,
        eventId: matchup.eventId,
        period: matchup.period,
        matchupIndex: matchup.matchupIndex,
        roundNumber: matchup.roundNumber,
        matchNumber: matchup.matchNumber,
        label: matchup.label,
        homeParticipantId: matchup.homeParticipantId,
        awayParticipantId: matchup.awayParticipantId,
        startsAt: matchup.startsAt,
        lockAt: matchup.lockAt,
        metadata: matchup.metadata as object,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async update(id: string, updates: Partial<ContestMatchup>): Promise<ContestMatchup> {
    const row = await this.prisma.contestMatchup.update({
      where: { id },
      data: {
        ...(updates.eventId !== undefined && { eventId: updates.eventId }),
        ...(updates.period !== undefined && { period: updates.period }),
        ...(updates.matchupIndex !== undefined && { matchupIndex: updates.matchupIndex }),
        ...(updates.roundNumber !== undefined && { roundNumber: updates.roundNumber }),
        ...(updates.matchNumber !== undefined && { matchNumber: updates.matchNumber }),
        ...(updates.label !== undefined && { label: updates.label }),
        ...(updates.homeParticipantId !== undefined && { homeParticipantId: updates.homeParticipantId }),
        ...(updates.awayParticipantId !== undefined && { awayParticipantId: updates.awayParticipantId }),
        ...(updates.startsAt !== undefined && { startsAt: updates.startsAt }),
        ...(updates.lockAt !== undefined && { lockAt: updates.lockAt }),
        ...(updates.metadata !== undefined && { metadata: updates.metadata as object }),
      },
    });
    return mapToContestMatchup(row);
  }

  async deleteByContest(contestId: string): Promise<number> {
    const result = await this.prisma.contestMatchup.deleteMany({
      where: { contestId },
    });
    return result.count;
  }
}

function mapToContestMatchup(row: {
  id: string;
  contestId: string;
  eventId: string | null;
  period: number;
  matchupIndex: number;
  roundNumber: number | null;
  matchNumber: number | null;
  label: string | null;
  homeParticipantId: string | null;
  awayParticipantId: string | null;
  startsAt: Date | null;
  lockAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ContestMatchup {
  return {
    id: row.id,
    contestId: row.contestId,
    eventId: row.eventId ?? undefined,
    period: row.period,
    matchupIndex: row.matchupIndex,
    roundNumber: row.roundNumber ?? undefined,
    matchNumber: row.matchNumber ?? undefined,
    label: row.label ?? undefined,
    homeParticipantId: row.homeParticipantId ?? undefined,
    awayParticipantId: row.awayParticipantId ?? undefined,
    startsAt: row.startsAt ?? undefined,
    lockAt: row.lockAt ?? undefined,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
