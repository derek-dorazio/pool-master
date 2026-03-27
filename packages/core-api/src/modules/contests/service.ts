/**
 * ContestService — contest creation, retrieval, update, and deletion.
 *
 * Implements the multi-step contest wizard: sport/event, draft config,
 * scoring rules (with template support), payout structure, and scheduling.
 */

import type {
  ContestRepository,
  LeagueMembershipRepository,
  LeagueRepository,
  SelectionConfigRepository,
} from '@poolmaster/shared/db';
import type {
  Contest,
  PayoutConfig,
  SelectionConfig,
  ScoringRulesConfig,
} from '@poolmaster/shared/domain';
import {
  ContestStatus,
  ContestType,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';
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
      seasonId: input.seasonId ?? '',
      name: input.name,
      status: ContestStatus.DRAFT,
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
