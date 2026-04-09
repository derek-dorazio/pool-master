/**
 * Prisma adapter for DraftSessionRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { DraftSessionRepository } from '@poolmaster/shared/db';
import type { DraftPickHistory, DraftSession } from '@poolmaster/shared/domain';

export class PrismaDraftSessionRepository implements DraftSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<DraftSession | null> {
    const row = await this.prisma.draftSession.findUnique({ where: { id } });
    return row ? mapToSession(row) : null;
  }

  async findByContest(contestId: string): Promise<DraftSession | null> {
    const row = await this.prisma.draftSession.findUnique({ where: { contestId } });
    return row ? mapToSession(row) : null;
  }

  async create(session: Omit<DraftSession, 'id' | 'createdAt' | 'updatedAt'>): Promise<DraftSession> {
    const row = await this.prisma.draftSession.create({
      data: {
        contestId: session.contestId,
        status: session.status,
        currentPickNumber: session.currentPickNumber,
        currentEntryId: session.currentEntryId,
        startedAt: session.startedAt,
        currentTurnStartedAt: session.currentTurnStartedAt,
      },
    });
    return mapToSession(row);
  }

  async update(id: string, updates: Partial<DraftSession>): Promise<DraftSession> {
    const row = await this.prisma.draftSession.update({
      where: { id },
      data: {
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.currentPickNumber !== undefined && { currentPickNumber: updates.currentPickNumber }),
        ...(updates.currentEntryId !== undefined && { currentEntryId: updates.currentEntryId }),
        ...(updates.currentTurnStartedAt !== undefined && { currentTurnStartedAt: updates.currentTurnStartedAt }),
      },
    });
    return mapToSession(row);
  }

  async getPickHistories(sessionId: string): Promise<DraftPickHistory[]> {
    const rows = await this.prisma.draftPickHistory.findMany({
      where: { draftSessionId: sessionId },
      orderBy: { pickNumber: 'asc' },
    });
    return rows.map(mapToPickHistory);
  }

  async addPickHistory(
    pickHistory: Omit<DraftPickHistory, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<DraftPickHistory> {
    const row = await this.prisma.draftPickHistory.create({
      data: {
        draftSessionId: pickHistory.draftSessionId,
        rosterPickId: pickHistory.rosterPickId,
        entryId: pickHistory.entryId,
        pickNumber: pickHistory.pickNumber,
        round: pickHistory.round,
        pickInRound: pickHistory.pickInRound,
        autoPicked: pickHistory.autoPicked,
      },
    });
    return mapToPickHistory(row);
  }
}

function mapToSession(row: {
  id: string;
  contestId: string;
  status: string;
  currentPickNumber: number;
  currentEntryId: string | null;
  startedAt: Date | null;
  currentTurnStartedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): DraftSession {
  return {
    id: row.id,
    contestId: row.contestId,
    status: row.status as DraftSession['status'],
    currentPickNumber: row.currentPickNumber,
    currentEntryId: row.currentEntryId ?? undefined,
    startedAt: row.startedAt ?? undefined,
    currentTurnStartedAt: row.currentTurnStartedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapToPickHistory(row: {
  id: string;
  draftSessionId: string;
  rosterPickId: string;
  entryId: string;
  pickNumber: number;
  round: number;
  pickInRound: number;
  autoPicked: boolean;
  createdAt: Date;
  updatedAt: Date;
}): DraftPickHistory {
  return {
    id: row.id,
    draftSessionId: row.draftSessionId,
    rosterPickId: row.rosterPickId,
    entryId: row.entryId,
    pickNumber: row.pickNumber,
    round: row.round,
    pickInRound: row.pickInRound,
    autoPicked: row.autoPicked,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
