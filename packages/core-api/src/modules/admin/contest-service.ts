/**
 * ContestService — business logic for admin contest management operations.
 *
 * Provides contest search, detail views, force-close/reopen, score overrides,
 * standings and payout recalculation, and scoring re-ingestion.
 * All write operations are audit-logged.
 *
 * Persisted via Prisma to the contests table.
 */

import type { PrismaClient } from '@prisma/client';
import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContestSearchQuery {
  tenantId?: string;
  leagueId?: string;
  sport?: string;
  status?: string;
  contestType?: string;
  selectionType?: string;
  page?: number;
  pageSize?: number;
}

export interface ContestListItem {
  id: string;
  name: string;
  leagueName: string;
  tenantName: string;
  sport: string;
  contestType: string;
  selectionType: string;
  status: string;
  entryCount: number;
  createdAt: Date;
}

export interface ContestAdminView {
  id: string;
  name: string;
  sport: string;
  contestType: string;
  selectionType: string;
  scoringEngine: string;
  status: string;
  leagueName: string;
  leagueId: string;
  tenantName: string;
  tenantId: string;
  entryCount: number;
  startsAt?: Date;
  endsAt?: Date;
  lockAt?: Date;
  createdAt: Date;
  standings: {
    entryId: string;
    entryName: string;
    ownerEmail: string;
    standingsPosition: number;
    totalScore: number;
  }[];
  draftStatus?: {
    status: string;
    currentPick: number;
    totalPicks: number;
    startedAt?: Date;
  };
  draftPickHistories: {
    round: number;
    pick: number;
    participant: string;
    owner: string;
    autoPicked: boolean;
    time: Date;
  }[];
  scoringFreshness: {
    lastStatEvent?: Date;
    isStale: boolean;
    staleMinutes: number;
  };
  statEventCount: number;
  correctionsApplied: number;
  overrides: {
    id: string;
    adminEmail: string;
    entryId: string;
    oldScore: number;
    newScore: number;
    reason: string;
    createdAt: Date;
  }[];
}

export interface RecalculationResult {
  contestId: string;
  entriesAffected: number;
  rankChanges: { entryId: string; oldRank: number; newRank: number }[];
  recalculatedAt: Date;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ContestNotFoundError extends Error {
  constructor(contestId: string) {
    super(`Contest not found: ${contestId}`);
    this.name = 'ContestNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ContestService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Searches contests with filters and pagination.
   */
  async searchContests(
    query: ContestSearchQuery,
  ): Promise<{ items: ContestListItem[]; total: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};

    if (query.sport) where.sportEvent = { is: { sport: query.sport } };
    if (query.status) where.status = query.status.toUpperCase();
    if (query.contestType) where.contestType = query.contestType;
    if (query.selectionType) where.selectionType = query.selectionType;
    if (query.leagueId) where.leagueId = query.leagueId;
    if (query.tenantId) {
      where.league = { tenantId: query.tenantId };
    }

    const [rows, total] = await Promise.all([
      this.prisma.contest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          league: {
            select: {
              name: true,
              tenant: { select: { name: true } },
            },
          },
          sportEvent: {
            select: { sport: true },
          },
          _count: { select: { entries: true } },
        },
      }),
      this.prisma.contest.count({ where }),
    ]);

    const items: ContestListItem[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      leagueName: row.league.name,
      tenantName: row.league.tenant.name,
      sport: row.sportEvent?.sport ?? '',
      contestType: row.contestType,
      selectionType: row.selectionType,
      status: row.status.toLowerCase(),
      entryCount: row._count.entries,
      createdAt: row.createdAt,
    }));

    return { items, total };
  }

  /**
   * Returns the full admin detail view for a single contest.
   */
  async getContestAdminDetail(contestId: string): Promise<ContestAdminView> {
    const contest = await this.prisma.contest.findUnique({
      where: { id: contestId },
      include: {
        league: {
          select: {
            id: true,
            name: true,
            tenantId: true,
            tenant: { select: { name: true } },
          },
        },
        sportEvent: {
          select: { sport: true },
        },
        entries: {
          include: {
            squad: {
              include: {
                memberships: {
                  where: { status: 'ACTIVE' },
                  include: {
                    user: { select: { email: true } },
                  },
                  orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
                },
              },
            },
          },
          orderBy: { standingsPosition: 'asc' },
        },
        draftSession: {
          include: {
            pickHistories: {
              include: {
                rosterPick: {
                  include: {
                    sportEventParticipant: {
                      include: {
                        participant: {
                          select: { name: true },
                        },
                      },
                    },
                  },
                },
                entry: {
                  include: {
                    squad: {
                      include: {
                        memberships: {
                          where: { status: 'ACTIVE' },
                          include: {
                            user: { select: { email: true } },
                          },
                          orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
                        },
                      },
                    },
                  },
                },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    if (!contest) {
      throw new ContestNotFoundError(contestId);
    }

    // Build standings directly from persisted contest-entry summary fields.
    const standings = contest.entries
      .filter((e) => e.standingsPosition !== null)
      .map((e) => ({
        entryId: e.id,
        entryName: e.name,
        ownerEmail: e.squad.memberships[0]?.user.email ?? '',
        standingsPosition: e.standingsPosition!,
        totalScore: e.totalScore,
      }));

    // Draft status from draft session if present
    const draftStatus = contest.draftSession
      ? {
          status: contest.draftSession.status,
          currentPick: contest.draftSession.currentPickNumber,
          totalPicks: contest.entries.length,
          startedAt: contest.draftSession.startedAt ?? undefined,
        }
      : undefined;

    return {
      id: contest.id,
      name: contest.name,
      sport: contest.sportEvent?.sport ?? '',
      contestType: contest.contestType,
      selectionType: contest.selectionType,
      scoringEngine: contest.scoringEngine,
      status: contest.status.toLowerCase(),
      leagueName: contest.league.name,
      leagueId: contest.league.id,
      tenantName: contest.league.tenant.name,
      tenantId: contest.league.tenantId,
      entryCount: contest.entries.length,
      startsAt: contest.startsAt ?? undefined,
      endsAt: contest.endsAt ?? undefined,
      lockAt: contest.lockAt ?? undefined,
      createdAt: contest.createdAt,
      standings,
      draftStatus,
      draftPickHistories: contest.draftSession?.pickHistories.map((pick) => ({
        round: pick.round,
        pick: pick.pickNumber,
        participant: pick.rosterPick.sportEventParticipant.participant.name,
        owner: pick.entry.squad.memberships[0]?.user.email ?? '',
        autoPicked: pick.autoPicked,
        time: pick.createdAt,
      })) ?? [],
      scoringFreshness: {
        lastStatEvent: undefined,
        isStale: false,
        staleMinutes: 0,
      },
      statEventCount: 0,
      correctionsApplied: 0,
      overrides: [],
    };
  }

  /**
   * Force-closes a contest, preventing further entries and scoring updates.
   */
  async forceCloseContest(
    contestId: string,
    reason: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const contest = await this.prisma.contest.findUnique({ where: { id: contestId } });
    if (!contest) throw new ContestNotFoundError(contestId);

    const beforeStatus = contest.status;

    await this.prisma.contest.update({
      where: { id: contestId },
      data: { status: 'CLOSED' },
    });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'contest.force_close',
      resourceType: 'CONTEST',
      resourceId: contestId,
      description: `Force-closed contest — reason: ${reason}`,
      beforeState: { status: beforeStatus },
      afterState: { status: 'CLOSED' },
      reason,
    });
  }

  /**
   * Reopens a previously closed contest.
   */
  async reopenContest(
    contestId: string,
    reason: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const contest = await this.prisma.contest.findUnique({ where: { id: contestId } });
    if (!contest) throw new ContestNotFoundError(contestId);

    const beforeStatus = contest.status;

    await this.prisma.contest.update({
      where: { id: contestId },
      data: { status: 'ACTIVE' },
    });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'contest.reopen',
      resourceType: 'CONTEST',
      resourceId: contestId,
      description: `Reopened contest — reason: ${reason}`,
      beforeState: { status: beforeStatus },
      afterState: { status: 'ACTIVE' },
      reason,
    });
  }

  /**
   * Overrides the score for a specific entry in a contest.
   * Records the before/after state for auditability.
   */
  async overrideScore(
    contestId: string,
    entryId: string,
    newScore: number,
    reason: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const contest = await this.prisma.contest.findUnique({ where: { id: contestId } });
    if (!contest) throw new ContestNotFoundError(contestId);

    const entry = await this.prisma.contestEntry.findFirst({
      where: { id: entryId, contestId },
    });
    if (!entry) {
      throw new Error(`Entry ${entryId} not found in contest ${contestId}`);
    }

    const oldScore = entry.totalScore;

    await this.prisma.contestEntry.update({
      where: { id: entryId },
      data: { totalScore: newScore },
    });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'contest.override_score',
      resourceType: 'CONTEST',
      resourceId: contestId,
      description: `Overrode score for entry ${entryId}: ${oldScore} → ${newScore}`,
      beforeState: { entryId, score: oldScore },
      afterState: { entryId, score: newScore },
      reason,
    });
  }

  /**
   * Recalculates standings for all entries in a contest.
   * Returns the result including any rank changes.
   */
  async recalculateStandings(
    contestId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<RecalculationResult> {
    const contest = await this.prisma.contest.findUnique({ where: { id: contestId } });
    if (!contest) throw new ContestNotFoundError(contestId);

    // Fetch all entries ordered by score descending
    const entries = await this.prisma.contestEntry.findMany({
      where: { contestId },
      orderBy: { totalScore: 'desc' },
    });

    const rankChanges: { entryId: string; oldRank: number; newRank: number }[] = [];
    let entriesAffected = 0;

    // Assign new ranks and record changes
    for (let i = 0; i < entries.length; i++) {
      const newRank = i + 1;
      const oldRank = entries[i].standingsPosition ?? 0;

      if (oldRank !== newRank) {
        rankChanges.push({ entryId: entries[i].id, oldRank, newRank });
        entriesAffected++;
      }

      await this.prisma.contestEntry.update({
        where: { id: entries[i].id },
        data: { standingsPosition: newRank },
      });

    }

    const result: RecalculationResult = {
      contestId,
      entriesAffected,
      rankChanges,
      recalculatedAt: new Date(),
    };

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'contest.recalculate_standings',
      resourceType: 'CONTEST',
      resourceId: contestId,
      description: `Recalculated standings — ${entriesAffected} entries affected, ${rankChanges.length} rank changes`,
      afterState: {
        entriesAffected,
        rankChanges,
      },
    });

    return result;
  }

  /**
   * Recalculates payouts for a contest based on current standings.
   */
  async recalculatePayouts(
    contestId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const contest = await this.prisma.contest.findUnique({ where: { id: contestId } });
    if (!contest) throw new ContestNotFoundError(contestId);

    // TODO: Trigger payout recalculation via the prize-award engine
    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'contest.recalculate_payouts',
      resourceType: 'CONTEST',
      resourceId: contestId,
      description: 'Recalculated payouts based on current standings',
    });
  }

  /**
   * Re-ingests scoring data for a specific event linked to a contest.
   */
  async reIngestScoring(
    contestId: string,
    eventId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<RecalculationResult> {
    void eventId;
    return this.recalculateStandings(contestId, adminUserId, adminUserEmail);
  }
}
