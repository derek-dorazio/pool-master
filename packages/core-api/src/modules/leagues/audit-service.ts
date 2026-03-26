/**
 * AuditService — commissioner audit trail for all administrative actions.
 *
 * Every override, role change, member action, and scoring adjustment
 * is logged with full context for transparency and compliance.
 */

import type { PrismaClient } from '@prisma/client';

export type AuditCategory = 'LEAGUE' | 'CONTEST' | 'DRAFT' | 'SCORING' | 'PAYOUT' | 'MEMBER' | 'COMMUNICATION';

export interface AuditLogEntry {
  id: string;
  leagueId: string;
  contestId?: string;
  actorId: string;
  action: string;
  category: AuditCategory;
  description: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  reason?: string;
  ipAddress?: string;
  createdAt: Date;
}

export interface CreateAuditEntryInput {
  leagueId: string;
  contestId?: string;
  actorId: string;
  action: string;
  category: AuditCategory;
  description: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  reason?: string;
  ipAddress?: string;
}

export interface AuditLogFilters {
  category?: AuditCategory;
  actorId?: string;
  contestId?: string;
  fromDate?: Date;
  toDate?: Date;
}

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Logs a commissioner action to the audit trail. */
  async logAction(input: CreateAuditEntryInput): Promise<AuditLogEntry> {
    const row = await this.prisma.commissionerAuditLog.create({
      data: {
        leagueId: input.leagueId,
        contestId: input.contestId,
        actorId: input.actorId,
        action: input.action,
        category: input.category,
        description: input.description,
        beforeState: input.beforeState as object | undefined,
        afterState: input.afterState as object | undefined,
        reason: input.reason,
        ipAddress: input.ipAddress,
      },
    });
    return mapToEntry(row);
  }

  /** Returns audit log entries for a league, with optional filters. */
  async getLeagueAuditLog(
    leagueId: string,
    filters?: AuditLogFilters,
    limit = 50,
    offset = 0,
  ): Promise<AuditLogEntry[]> {
    const rows = await this.prisma.commissionerAuditLog.findMany({
      where: {
        leagueId,
        ...(filters?.category && { category: filters.category }),
        ...(filters?.actorId && { actorId: filters.actorId }),
        ...(filters?.contestId && { contestId: filters.contestId }),
        ...(filters?.fromDate && { createdAt: { gte: filters.fromDate } }),
        ...(filters?.toDate && { createdAt: { lte: filters.toDate } }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    return rows.map(mapToEntry);
  }

  /** Returns a simplified audit log for regular members (scoring, payout, role changes only). */
  async getMemberAuditLog(leagueId: string, limit = 50): Promise<AuditLogEntry[]> {
    const rows = await this.prisma.commissionerAuditLog.findMany({
      where: {
        leagueId,
        category: { in: ['SCORING', 'PAYOUT', 'MEMBER'] },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(mapToEntry);
  }

  /** Returns audit log entries for a specific contest. */
  async getContestAuditLog(contestId: string, limit = 50): Promise<AuditLogEntry[]> {
    const rows = await this.prisma.commissionerAuditLog.findMany({
      where: { contestId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(mapToEntry);
  }
}

function mapToEntry(row: {
  id: string;
  leagueId: string;
  contestId: string | null;
  actorId: string;
  action: string;
  category: string;
  description: string;
  beforeState: unknown;
  afterState: unknown;
  reason: string | null;
  ipAddress: string | null;
  createdAt: Date;
}): AuditLogEntry {
  return {
    id: row.id,
    leagueId: row.leagueId,
    contestId: row.contestId ?? undefined,
    actorId: row.actorId,
    action: row.action,
    category: row.category as AuditCategory,
    description: row.description,
    beforeState: (row.beforeState as Record<string, unknown>) ?? undefined,
    afterState: (row.afterState as Record<string, unknown>) ?? undefined,
    reason: row.reason ?? undefined,
    ipAddress: row.ipAddress ?? undefined,
    createdAt: row.createdAt,
  };
}
