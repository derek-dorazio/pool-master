/**
 * ContestService — contest creation, retrieval, update, and deletion.
 *
 * Implements the multi-step contest wizard: sport/event, draft config,
 * scoring rules (with template support), payout structure, and scheduling.
 */

import type { PrismaClient } from '@prisma/client';
import type {
  ContestRepository,
  ContestEntryRepository,
  LeagueMembershipRepository,
  LeagueRepository,
  SelectionConfigRepository,
} from '@poolmaster/shared/db';
import type {
  Contest,
  ContestEntry,
  PayoutConfig,
  SelectionConfig,
  ScoringRulesConfig,
  Sport,
} from '@poolmaster/shared/domain';
import {
  ContestStatus,
  ContestType,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';
import type { ContestEntryDto } from '@poolmaster/shared/dto';
import {
  toContestEntryDto,
} from '../../mappers/contests.mapper';
/**
 * Scoring template registry — populated at application startup via
 * `registerScoringTemplates()`. This avoids a cross-package import of
 * scoring-service which lives outside core-api's rootDir.
 */
let _scoringTemplates: Record<string, Record<string, unknown>> = {};

/** Register scoring templates at startup (called from app bootstrap). */
export function registerScoringTemplates(
  templates: Record<string, Record<string, unknown>>,
): void {
  _scoringTemplates = templates;
}

export interface CreateContestInput {
  leagueId: string;
  tenantId: string;
  createdBy: string;
  seasonId?: string;
  name: string;
  sport: Sport;
  contestType: ContestType;
  selectionType: SelectionType;
  selectionConfig: Partial<Omit<SelectionConfig, 'id' | 'contestId' | 'createdAt' | 'updatedAt'>>;
  scoringEngine: ScoringEngine;
  scoringRules?: Record<string, unknown>;
  scoringTemplateKey?: string;
  payoutConfig?: PayoutConfig;
  startsAt?: Date;
  endsAt?: Date;
  lockAt?: Date;
  isExclusive?: boolean;
  scoringStopsOnElimination?: boolean;
}

export interface UpdateContestInput {
  name?: string;
  scoringRules?: Record<string, unknown>;
  payoutConfig?: PayoutConfig;
  startsAt?: Date;
  endsAt?: Date;
  lockAt?: Date;
  isExclusive?: boolean;
}

export class ContestService {
  constructor(
    private readonly contestRepo: ContestRepository,
    private readonly selectionConfigRepo: SelectionConfigRepository,
    private readonly membershipRepo: LeagueMembershipRepository,
    private readonly leagueRepo: LeagueRepository,
    private readonly entryRepo?: ContestEntryRepository,
    private readonly prisma?: PrismaClient,
  ) {}

  /** Creates a contest and its selection configuration atomically. */
  async createContest(
    input: CreateContestInput,
  ): Promise<{ contest: Contest; selectionConfig: SelectionConfig }> {
    const league = await this.leagueRepo.findById(input.leagueId, input.tenantId);
    if (!league) {
      throw new ContestOperationError('League not found');
    }
    const scoringRules = resolveScoringRules(input.scoringRules, input.scoringTemplateKey);
    if (input.payoutConfig) {
      validatePayoutConfig(input.payoutConfig);
    }
    const contest = await this.contestRepo.create({
      leagueId: input.leagueId,
      seasonId: input.seasonId || undefined,
      name: input.name,
      status: ContestStatus.DRAFT,
      sport: input.sport,
      contestType: input.contestType,
      selectionType: input.selectionType,
      scoringEngine: input.scoringEngine,
      isExclusive: input.isExclusive ?? false,
      scoringStopsOnElimination: input.scoringStopsOnElimination ?? false,
      scoringRules: scoringRules as ScoringRulesConfig,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      lockAt: input.lockAt,
    } as Omit<Contest, 'id' | 'createdAt' | 'updatedAt'>);
    const selectionConfig = await this.selectionConfigRepo.create({
      contestId: contest.id,
      selectionType: input.selectionType,
      isExclusive: input.isExclusive ?? false,
      ...input.selectionConfig,
    } as Omit<SelectionConfig, 'id' | 'createdAt' | 'updatedAt'>);
    return { contest, selectionConfig };
  }

  async getContest(
    contestId: string,
    tenantId: string,
  ): Promise<{ contest: Contest; selectionConfig: SelectionConfig | null } | null> {
    const contest = await this.contestRepo.findById(contestId, tenantId);
    if (!contest) {
      return null;
    }
    const selectionConfig = await this.selectionConfigRepo.findByContest(contestId);
    return { contest, selectionConfig };
  }

  async listByLeague(leagueId: string): Promise<Contest[]> {
    return this.contestRepo.findByLeague(leagueId);
  }

  /** Updates a contest. Only allowed when status is DRAFT. */
  async updateContest(
    contestId: string,
    tenantId: string,
    updates: UpdateContestInput,
  ): Promise<Contest> {
    const contest = await this.contestRepo.findById(contestId, tenantId);
    if (!contest) {
      throw new ContestNotFoundError(contestId);
    }
    if (contest.status !== ContestStatus.DRAFT) {
      throw new ContestOperationError('Contest can only be edited in DRAFT status');
    }
    if (updates.payoutConfig) {
      validatePayoutConfig(updates.payoutConfig);
    }
    return this.contestRepo.update(contestId, updates as Partial<Contest>);
  }

  /** Deletes a contest. Only allowed when status is DRAFT. */
  async deleteContest(contestId: string, tenantId: string): Promise<void> {
    const contest = await this.contestRepo.findById(contestId, tenantId);
    if (!contest) {
      throw new ContestNotFoundError(contestId);
    }
    if (contest.status !== ContestStatus.DRAFT) {
      throw new ContestOperationError('Contest can only be deleted in DRAFT status');
    }
    await this.contestRepo.delete(contestId);
  }

  async updateSelectionConfig(
    selectionConfigId: string,
    updates: Partial<SelectionConfig>,
  ): Promise<SelectionConfig> {
    return this.selectionConfigRepo.update(selectionConfigId, updates);
  }

  async listEntries(
    contestId: string,
    tenantId: string,
    userId: string,
  ): Promise<{ entries: ContestEntryDto[]; isJoined: boolean; myEntryId: string | null }> {
    const context = await this.getEntryContext(contestId, tenantId, userId);
    const membershipId = context.membership?.id ?? null;
    const entries = await this.loadEntryDtos(contestId);
    const myEntry = membershipId
      ? entries.find((entry) => entry.leagueMembershipId === membershipId) ?? null
      : null;

    return {
      entries,
      isJoined: myEntry !== null,
      myEntryId: myEntry?.id ?? null,
    };
  }

  async getMyEntry(
    contestId: string,
    tenantId: string,
    userId: string,
  ): Promise<ContestEntryDto | null> {
    const context = await this.getEntryContext(contestId, tenantId, userId);
    if (!context.membership) {
      return null;
    }
    const entries = await this.loadEntryDtos(contestId);
    return entries.find((entry) => entry.leagueMembershipId === context.membership?.id) ?? null;
  }

  async createEntry(
    contestId: string,
    tenantId: string,
    userId: string,
  ): Promise<{ entry: ContestEntryDto; created: boolean }> {
    const context = await this.getEntryContext(contestId, tenantId, userId);
    const membership = context.membership;
    if (!membership) {
      throw new ContestEntryOperationError('You must be a league member to enter this contest');
    }
    if (!isContestJoinable(context.contest.status)) {
      throw new ContestEntryOperationError('Contest entries can only be changed before the contest starts');
    }

    const existing = await this.findEntryByMembership(contestId, membership.id);
    if (existing) {
      const dto = await this.loadEntryDtoById(existing.id);
      return { entry: dto, created: false };
    }

    const ownerDisplayName = await this.getOwnerDisplayName(userId);
    const created = await this.requireEntryRepo().create({
      contestId,
      leagueMembershipId: membership.id,
      name: buildDefaultEntryName(ownerDisplayName),
      totalScore: 0,
      rank: undefined,
      isEliminated: false,
    });
    const dto = await this.loadEntryDtoById(created.id);
    return { entry: dto, created: true };
  }

  async deleteMyEntry(
    contestId: string,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const context = await this.getEntryContext(contestId, tenantId, userId);
    const membership = context.membership;
    if (!membership) {
      throw new ContestEntryOperationError('You must be a league member to leave this contest');
    }
    if (!isContestJoinable(context.contest.status)) {
      throw new ContestEntryOperationError('Contest entries can only be changed before the contest starts');
    }

    const existing = await this.findEntryByMembership(contestId, membership.id);
    if (!existing) {
      throw new ContestEntryNotFoundError(contestId, membership.id);
    }

    const hasSelections = await this.entryHasSelections(existing.id);
    if (hasSelections) {
      throw new ContestEntryOperationError('Cannot leave a contest after making picks or draft selections');
    }

    await this.requireEntryRepo().delete(existing.id);
  }

  private async getEntryContext(
    contestId: string,
    tenantId: string,
    userId: string,
  ): Promise<{ contest: Contest; membership: Awaited<ReturnType<LeagueMembershipRepository['findByLeagueAndUser']>> }> {
    const contest = await this.contestRepo.findById(contestId, tenantId);
    if (!contest) {
      throw new ContestNotFoundError(contestId);
    }
    const membership = await this.membershipRepo.findByLeagueAndUser(contest.leagueId, userId);
    return { contest, membership };
  }

  private async findEntryByMembership(
    contestId: string,
    membershipId: string,
  ): Promise<ContestEntry | null> {
    const entries = await this.requireEntryRepo().findByMember(membershipId);
    return entries.find((entry) => entry.contestId === contestId) ?? null;
  }

  private async loadEntryDtos(contestId: string): Promise<ContestEntryDto[]> {
    const prisma = this.requirePrisma();
    const rows = await prisma.contestEntry.findMany({
      where: { contestId },
      include: {
        membership: {
          include: {
            user: true,
          },
        },
      },
      orderBy: [
        { rank: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    return rows.map((row) =>
      toContestEntryDto(row, {
        id: row.membership.userId,
        displayName: row.membership.user.displayName,
      }),
    );
  }

  private async loadEntryDtoById(entryId: string): Promise<ContestEntryDto> {
    const prisma = this.requirePrisma();
    const row = await prisma.contestEntry.findUnique({
      where: { id: entryId },
      include: {
        membership: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!row) {
      throw new ContestEntryOperationError(`Contest entry not found: ${entryId}`);
    }

    return toContestEntryDto(row, {
      id: row.membership.userId,
      displayName: row.membership.user.displayName,
    });
  }

  private async entryHasSelections(entryId: string): Promise<boolean> {
    const prisma = this.requirePrisma();
    const [rosterPickCount, contestPickCount, bracketCount, draftPickCount] = await Promise.all([
      prisma.rosterPick.count({ where: { entryId } }),
      prisma.contestPick.count({ where: { entryId } }),
      prisma.bracketPrediction.count({ where: { entryId } }),
      prisma.draftPick.count({ where: { entryId } }),
    ]);
    return rosterPickCount + contestPickCount + bracketCount + draftPickCount > 0;
  }

  private async getOwnerDisplayName(userId: string): Promise<string> {
    const prisma = this.requirePrisma();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.displayName) {
      throw new ContestEntryOperationError('Unable to resolve the entry owner');
    }
    return user.displayName;
  }

  private requireEntryRepo(): ContestEntryRepository {
    if (!this.entryRepo) {
      throw new ContestEntryOperationError('Contest entry repository is unavailable');
    }
    return this.entryRepo;
  }

  private requirePrisma(): PrismaClient {
    if (!this.prisma) {
      throw new ContestEntryOperationError('Prisma client is unavailable');
    }
    return this.prisma;
  }
}

/**
 * Resolves scoring rules from either explicit rules or a template key.
 * Template key takes precedence if both are provided.
 */
function resolveScoringRules(
  explicitRules?: Record<string, unknown>,
  templateKey?: string,
): Record<string, unknown> {
  if (templateKey) {
    const template = _scoringTemplates[templateKey];
    if (!template) {
      throw new ContestOperationError(`Scoring template not found: ${templateKey}`);
    }
    return template;
  }
  return explicitRules ?? {};
}

/** Validates payout configuration: percentages sum ≤ 100, unique ranks. */
function validatePayoutConfig(config: PayoutConfig): void {
  if (config.payoutStructure.length === 0) {
    return;
  }
  const ranks = config.payoutStructure.map((s) => s.rank);
  const uniqueRanks = new Set(ranks);
  if (uniqueRanks.size !== ranks.length) {
    throw new ContestOperationError('Payout structure has duplicate ranks');
  }
  const totalPercentage = config.payoutStructure.reduce((sum, s) => sum + s.percentage, 0);
  if (totalPercentage > 100) {
    throw new ContestOperationError(
      `Payout percentages sum to ${totalPercentage}%, which exceeds 100%`,
    );
  }
}

export class ContestNotFoundError extends Error {
  constructor(contestId: string) {
    super(`Contest not found: ${contestId}`);
    this.name = 'ContestNotFoundError';
  }
}

export class ContestOperationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ContestOperationError';
  }
}

export class ContestEntryOperationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ContestEntryOperationError';
  }
}

export class ContestEntryNotFoundError extends Error {
  constructor(contestId: string, membershipId: string) {
    super(`Contest entry not found for contest ${contestId} and membership ${membershipId}`);
    this.name = 'ContestEntryNotFoundError';
  }
}

function buildDefaultEntryName(displayName: string): string {
  return `${displayName}'s Entry`;
}

function isContestJoinable(status: ContestStatus): boolean {
  return status === ContestStatus.DRAFT || status === ContestStatus.OPEN;
}
