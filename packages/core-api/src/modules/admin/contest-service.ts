/**
 * ContestService — business logic for admin contest management operations.
 *
 * Provides contest search, detail views, force-close/reopen, score overrides,
 * standings and payout recalculation, and scoring re-ingestion.
 * All write operations are audit-logged.
 */

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
    rank: number;
    totalScore: number;
  }[];
  draftStatus?: {
    status: string;
    currentPick: number;
    totalPicks: number;
    startedAt?: Date;
  };
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
  /**
   * Searches contests with filters and pagination.
   *
   * Placeholder: returns mock data. Will query contests table via Prisma.
   */
  async searchContests(
    query: ContestSearchQuery,
  ): Promise<{ items: ContestListItem[]; total: number }> {
    void query;

    // TODO: Replace with Prisma query against contests table
    const mockItems: ContestListItem[] = [
      {
        id: 'contest-001',
        name: 'Masters 2026 Pick Sheet',
        leagueName: 'Golf Buddies League',
        tenantName: "Tiger's Corner",
        sport: 'golf',
        contestType: 'pick_sheet',
        selectionType: 'pick',
        status: 'active',
        entryCount: 24,
        createdAt: new Date('2026-03-01'),
      },
      {
        id: 'contest-002',
        name: 'NFL Survivor Pool',
        leagueName: 'Sunday Funday',
        tenantName: "Tiger's Corner",
        sport: 'nfl',
        contestType: 'survivor',
        selectionType: 'pick',
        status: 'active',
        entryCount: 48,
        createdAt: new Date('2026-01-10'),
      },
      {
        id: 'contest-003',
        name: 'March Madness Bracket',
        leagueName: 'Office Pool',
        tenantName: 'Golf Crew',
        sport: 'ncaa',
        contestType: 'bracket',
        selectionType: 'bracket',
        status: 'closed',
        entryCount: 64,
        createdAt: new Date('2026-03-15'),
      },
      {
        id: 'contest-004',
        name: 'NBA Fantasy Draft',
        leagueName: 'Hoops League',
        tenantName: 'Golf Crew',
        sport: 'nba',
        contestType: 'fantasy_draft',
        selectionType: 'draft',
        status: 'active',
        entryCount: 12,
        createdAt: new Date('2026-02-20'),
      },
      {
        id: 'contest-005',
        name: 'Kentucky Derby Pick',
        leagueName: 'Horse Racing Club',
        tenantName: 'Acme Corp',
        sport: 'horse_racing',
        contestType: 'pick_sheet',
        selectionType: 'pick',
        status: 'pending',
        entryCount: 8,
        createdAt: new Date('2026-03-22'),
      },
      {
        id: 'contest-006',
        name: 'Premier League Weekly',
        leagueName: 'Soccer Fans United',
        tenantName: 'Acme Corp',
        sport: 'soccer',
        contestType: 'weekly',
        selectionType: 'pick',
        status: 'active',
        entryCount: 32,
        createdAt: new Date('2026-03-10'),
      },
    ];

    return { items: mockItems, total: mockItems.length };
  }

  /**
   * Returns the full admin detail view for a single contest.
   *
   * Placeholder: returns mock data. Will aggregate from contests, entries,
   * standings, and draft tables via Prisma.
   */
  async getContestAdminDetail(contestId: string): Promise<ContestAdminView> {
    // TODO: Replace with Prisma queries
    void contestId;

    const now = new Date();

    return {
      id: contestId,
      name: 'Masters 2026 Pick Sheet',
      sport: 'golf',
      contestType: 'pick_sheet',
      selectionType: 'pick',
      scoringEngine: 'golf-standard-v2',
      status: 'active',
      leagueName: 'Golf Buddies League',
      leagueId: 'league-001',
      tenantName: "Tiger's Corner",
      tenantId: '00000000-0000-0000-0000-000000000001',
      entryCount: 24,
      startsAt: new Date('2026-04-10T08:00:00Z'),
      endsAt: new Date('2026-04-13T20:00:00Z'),
      lockAt: new Date('2026-04-10T12:00:00Z'),
      createdAt: new Date('2026-03-01'),
      standings: [
        { entryId: 'entry-001', entryName: 'Alice Picks', ownerEmail: 'alice@example.com', rank: 1, totalScore: 145 },
        { entryId: 'entry-002', entryName: 'Bob Picks', ownerEmail: 'bob@example.com', rank: 2, totalScore: 138 },
        { entryId: 'entry-003', entryName: 'Charlie Picks', ownerEmail: 'charlie@example.com', rank: 3, totalScore: 132 },
      ],
      draftStatus: {
        status: 'completed',
        currentPick: 24,
        totalPicks: 24,
        startedAt: new Date('2026-03-28T19:00:00Z'),
      },
      scoringFreshness: {
        lastStatEvent: new Date(now.getTime() - 5 * 60_000),
        isStale: false,
        staleMinutes: 0,
      },
      statEventCount: 1_247,
      correctionsApplied: 2,
      overrides: [
        {
          id: 'override-001',
          adminEmail: 'ops@poolmaster.com',
          entryId: 'entry-003',
          oldScore: 128,
          newScore: 132,
          reason: 'Scoring correction for missed birdie on hole 14',
          createdAt: new Date('2026-03-25T14:30:00Z'),
        },
      ],
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
    // TODO: Update contest status to 'closed' via Prisma
    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'contest.force_close',
      resourceType: 'CONTEST',
      resourceId: contestId,
      description: `Force-closed contest — reason: ${reason}`,
      afterState: { status: 'closed' },
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
    // TODO: Update contest status to 'active' via Prisma
    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'contest.reopen',
      resourceType: 'CONTEST',
      resourceId: contestId,
      description: `Reopened contest — reason: ${reason}`,
      afterState: { status: 'active' },
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
    // TODO: Look up current score from database via Prisma
    const oldScore = 128; // placeholder — will come from DB lookup

    // TODO: Update entry score via Prisma
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
    // TODO: Trigger actual recalculation via scoring engine
    const result: RecalculationResult = {
      contestId,
      entriesAffected: 3,
      rankChanges: [
        { entryId: 'entry-002', oldRank: 3, newRank: 2 },
        { entryId: 'entry-003', oldRank: 2, newRank: 3 },
        { entryId: 'entry-005', oldRank: 8, newRank: 6 },
      ],
      recalculatedAt: new Date(),
    };

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'contest.recalculate_standings',
      resourceType: 'CONTEST',
      resourceId: contestId,
      description: `Recalculated standings — ${result.entriesAffected} entries affected, ${result.rankChanges.length} rank changes`,
      afterState: {
        entriesAffected: result.entriesAffected,
        rankChanges: result.rankChanges,
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
    // TODO: Trigger payout recalculation via billing/payout engine
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
  ): Promise<void> {
    // TODO: Trigger re-ingestion via scoring-service
    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'contest.re_ingest_scoring',
      resourceType: 'CONTEST',
      resourceId: contestId,
      description: `Re-ingested scoring data for event ${eventId}`,
      afterState: { eventId },
    });
  }
}
