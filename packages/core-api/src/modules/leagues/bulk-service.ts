/**
 * BulkService — season bulk setup, copy last season, and CSV member import.
 */

import type {
  ContestRepository,
  ContestTemplateRepository,
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
} from '@poolmaster/shared/db';
import type { Contest } from '@poolmaster/shared/domain';
import { ContestStatus, InvitationStatus, InviteType } from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';

// --- Season Bulk Setup (08-027) ---

export interface BulkContestInput {
  leagueId: string;
  tenantId: string;
  createdBy: string;
  templateId: string;
  namingPattern: string;
  events: { name: string; startsAt?: Date; endsAt?: Date }[];
}

export interface BulkContestResult {
  created: Contest[];
  errors: { eventName: string; reason: string }[];
}

// --- Copy Last Season (08-028) ---

export interface CopySeasonInput {
  leagueId: string;
  tenantId: string;
  createdBy: string;
  sourceContestIds: string[];
  seasonId?: string;
}

// --- CSV Member Import (08-029) ---

export interface CsvImportRow {
  email: string;
  displayName?: string;
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
    private readonly templateRepo: ContestTemplateRepository,
    private readonly leagueRepo: LeagueRepository,
    private readonly membershipRepo: LeagueMembershipRepository,
    private readonly invitationRepo: LeagueInvitationRepository,
  ) {}

  /** Creates multiple contests from a template, one per event. */
  async bulkCreateContests(input: BulkContestInput): Promise<BulkContestResult> {
    const template = await this.templateRepo.findById(input.templateId);
    if (!template) {
      throw new BulkOperationError('Template not found');
    }
    const league = await this.leagueRepo.findById(input.leagueId, input.tenantId);
    if (!league) {
      throw new BulkOperationError('League not found');
    }
    await this.templateRepo.incrementUsage(input.templateId);
    const created: Contest[] = [];
    const errors: { eventName: string; reason: string }[] = [];
    for (const event of input.events) {
      try {
        const contestName = input.namingPattern.replace('{event_name}', event.name);
        const contest = await this.contestRepo.create({
          leagueId: input.leagueId,
          seasonId: '',
          name: contestName,
          status: ContestStatus.DRAFT,
          contestType: template.contestType,
          selectionType: (template.draftConfig as Record<string, unknown>).selectionType as string as Contest['selectionType'],
          scoringEngine: (template.scoringConfig as Record<string, unknown>).scoringEngine as string as Contest['scoringEngine'] ?? 'CUMULATIVE' as Contest['scoringEngine'],
          isExclusive: false,
          scoringStopsOnElimination: false,
          scoringRules: template.scoringConfig as Contest['scoringRules'],
          startsAt: event.startsAt,
          endsAt: event.endsAt,
        } as Omit<Contest, 'id' | 'createdAt' | 'updatedAt'>);
        created.push(contest);
      } catch (err) {
        errors.push({ eventName: event.name, reason: (err as Error).message });
      }
    }
    return { created, errors };
  }

  /** Copies contests from a previous season, creating new DRAFT versions. */
  async copyLastSeason(input: CopySeasonInput): Promise<BulkContestResult> {
    const created: Contest[] = [];
    const errors: { eventName: string; reason: string }[] = [];
    for (const sourceId of input.sourceContestIds) {
      try {
        const source = await this.contestRepo.findById(sourceId, input.tenantId);
        if (!source) {
          errors.push({ eventName: sourceId, reason: 'Source contest not found' });
          continue;
        }
        const contest = await this.contestRepo.create({
          leagueId: input.leagueId,
          seasonId: input.seasonId ?? '',
          name: `${source.name} (Copy)`,
          status: ContestStatus.DRAFT,
          contestType: source.contestType,
          selectionType: source.selectionType,
          scoringEngine: source.scoringEngine,
          isExclusive: source.isExclusive,
          scoringStopsOnElimination: source.scoringStopsOnElimination,
          scoringRules: source.scoringRules,
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
    const league = await this.leagueRepo.findById(leagueId, '');
    if (!league) {
      throw new BulkOperationError('League not found');
    }
    const members = await this.membershipRepo.findByLeague(leagueId);
    const currentCount = members.length;
    let sent = 0;
    const failed: { email: string; reason: string }[] = [];
    const duplicates: string[] = [];
    for (const row of rows) {
      const email = row.email.toLowerCase().trim();
      if (!email || !email.includes('@')) {
        failed.push({ email, reason: 'Invalid email format' });
        continue;
      }
      if (currentCount + sent >= league.maxMembers) {
        failed.push({ email, reason: 'League member limit reached' });
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
  constructor(reason: string) {
    super(reason);
    this.name = 'BulkOperationError';
  }
}
