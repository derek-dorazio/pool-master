/**
 * Prisma adapter for DraftSessionRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { DraftSessionRepository } from '@poolmaster/shared/db';
import type { DraftPick, DraftSession } from '@poolmaster/shared/domain';

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
        pickDeadline: session.pickDeadline,
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
        ...(updates.pickDeadline !== undefined && { pickDeadline: updates.pickDeadline }),
      },
    });
    return mapToSession(row);
  }

  async getPicks(sessionId: string): Promise<DraftPick[]> {
    const rows = await this.prisma.draftPick.findMany({
      where: { draftSessionId: sessionId },
      orderBy: { pickNumber: 'asc' },
    });
    return rows.map(mapToPick);
  }

  async addPick(pick: Omit<DraftPick, 'id' | 'createdAt' | 'updatedAt'>): Promise<DraftPick> {
    const row = await this.prisma.draftPick.create({
      data: {
        draftSessionId: pick.draftSessionId,
        entryId: pick.entryId,
        participantId: pick.participantId,
        pickNumber: pick.pickNumber,
        round: pick.round,
        pickInRound: pick.pickInRound,
        pickedAt: pick.pickedAt,
        autoPicked: pick.autoPicked,
      },
    });
    return mapToPick(row);
  }
}

function mapToSession(row: {
  id: string;
  contestId: string;
  status: string;
  currentPickNumber: number;
  currentEntryId: string | null;
  startedAt: Date | null;
  pickDeadline: Date | null;
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
    pickDeadline: row.pickDeadline ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapToPick(row: {
  id: string;
  draftSessionId: string;
  entryId: string;
  participantId: string;
  pickNumber: number;
  round: number;
  pickInRound: number;
  pickedAt: Date;
  autoPicked: boolean;
  createdAt: Date;
  updatedAt: Date;
}): DraftPick {
  return {
    id: row.id,
    draftSessionId: row.draftSessionId,
    entryId: row.entryId,
    participantId: row.participantId,
    pickNumber: row.pickNumber,
    round: row.round,
    pickInRound: row.pickInRound,
    pickedAt: row.pickedAt,
    autoPicked: row.autoPicked,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
