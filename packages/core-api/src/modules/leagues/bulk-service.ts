/**
 * BulkService — season bulk setup, copy last season, and CSV member import.
 */

import type {
  ContestRepository,
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
} from '@poolmaster/shared/db';
import type { Contest } from '@poolmaster/shared/domain';
import { ContestStatus, InvitationStatus, InviteType } from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';

export interface BulkContestCopyResult {
  created: Contest[];
  errors: { eventName: string; reason: string }[];
}

// --- Copy Last Season (08-028) ---

export interface CopySeasonInput {
  leagueId: string;
  createdBy: string;
  sourceContestIds: string[];
}

// --- CSV Member Import (08-029) ---

export interface CsvImportRow {
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

export interface CsvImportResult {
  total: number;
  sent: number;
  failed: { email: string; reason: string }[];
  duplicates: string[];
}

export class BulkService {
  constructor(
    private readonly contestRepo: ContestRepository,
    private readonly leagueRepo: LeagueRepository,
    private readonly membershipRepo: LeagueMembershipRepository,
    private readonly invitationRepo: LeagueInvitationRepository,
  ) {}

  /** Copies contests from a previous season, creating new DRAFT versions. */
  async copyLastSeason(input: CopySeasonInput): Promise<BulkContestCopyResult> {
    const created: Contest[] = [];
    const errors: { eventName: string; reason: string }[] = [];
    for (const sourceId of input.sourceContestIds) {
      try {
        const source = await this.contestRepo.findById(sourceId);
        if (!source) {
          errors.push({ eventName: sourceId, reason: 'Source contest not found' });
          continue;
        }
        const contest = await this.contestRepo.create({
          leagueId: input.leagueId,
          sportEventId: source.sportEventId,
          name: `${source.name} (Copy)`,
          status: ContestStatus.DRAFT,
          contestFormat: source.contestFormat,
          selectionType: source.selectionType,
          scoringEngine: source.scoringEngine,
          isExclusive: source.isExclusive,
          scoringStopsOnElimination: source.scoringStopsOnElimination,
        } as Omit<Contest, 'id' | 'createdAt' | 'updatedAt'>);
        created.push(contest);
      } catch (err) {
        errors.push({ eventName: sourceId, reason: (err as Error).message });
      }
    }
    return { created, errors };
  }

  /** Imports members from parsed CSV rows, creating invitations for new emails. */
  async importMembersFromCsv(
    leagueId: string,
    invitedBy: string,
    rows: CsvImportRow[],
  ): Promise<CsvImportResult> {
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      throw new BulkOperationError('League not found', 'LEAGUE_NOT_FOUND');
    }
    let sent = 0;
    const failed: { email: string; reason: string }[] = [];
    const duplicates: string[] = [];
    for (const row of rows) {
      const email = row.email.toLowerCase().trim();
      if (!email || !email.includes('@')) {
        failed.push({ email, reason: 'Invalid email format' });
        continue;
      }
      const existing = await this.invitationRepo.findByEmail(leagueId, email);
      if (existing) {
        duplicates.push(email);
        continue;
      }
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      await this.invitationRepo.create({
        leagueId,
        email,
        inviteCode: randomUUID().replace(/-/g, '').slice(0, 12),
        inviteType: InviteType.EMAIL,
        status: InvitationStatus.PENDING,
        maxUses: 1,
        currentUses: 0,
        invitedBy,
        expiresAt,
      });
      sent++;
    }
    return { total: rows.length, sent, failed, duplicates };
  }
}

// --- Team Reassignment (08-032) ---

export type ReassignmentAction = 'REASSIGN' | 'VACATE' | 'AUTO_PILOT';

export interface TeamReassignmentInput {
  contestId: string;
  originalMemberId: string;
  action: ReassignmentAction;
  newMemberId?: string;
}

export class BulkOperationError extends Error {
  code: string;

  constructor(reason: string, code = 'LEAGUE_BULK_OPERATION_INVALID') {
    super(reason);
    this.name = 'BulkOperationError';
    this.code = code;
  }
}
