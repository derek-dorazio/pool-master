/**
 * ContestTemplateService — save, load, and manage reusable contest configurations.
 */

import type { ContestTemplateRepository } from '@poolmaster/shared/db';
import type { ContestTemplate, ContestType, Sport } from '@poolmaster/shared/domain';

export interface CreateTemplateInput {
  leagueId: string;
  createdBy: string;
  name: string;
  description?: string;
  sport: Sport;
  contestType: ContestType;
  draftConfig: Record<string, unknown>;
  scoringConfig: Record<string, unknown>;
  payoutConfig: Record<string, unknown>;
  poolConfig: Record<string, unknown>;
  sharedWithTenant?: boolean;
}

export class ContestTemplateService {
  constructor(private readonly templateRepo: ContestTemplateRepository) {}

  async createTemplate(input: CreateTemplateInput): Promise<ContestTemplate> {
    return this.templateRepo.create({
      leagueId: input.leagueId,
      createdBy: input.createdBy,
      name: input.name,
      description: input.description,
      sport: input.sport,
      contestType: input.contestType,
      draftConfig: input.draftConfig,
      scoringConfig: input.scoringConfig,
      payoutConfig: input.payoutConfig,
      poolConfig: input.poolConfig,
      sharedWithTenant: input.sharedWithTenant ?? false,
      isPlatformTemplate: false,
      timesUsed: 0,
    });
  }

  /** Returns league-specific templates combined with platform templates. */
  async listTemplates(leagueId: string): Promise<ContestTemplate[]> {
    const [leagueTemplates, platformTemplates] = await Promise.all([
      this.templateRepo.findByLeague(leagueId),
      this.templateRepo.findPlatformTemplates(),
    ]);
    return [...leagueTemplates, ...platformTemplates];
  }

  async getTemplate(id: string): Promise<ContestTemplate | null> {
    return this.templateRepo.findById(id);
  }

  /** Updates a template. Platform templates are read-only. */
  async updateTemplate(
    id: string,
    updates: Partial<ContestTemplate>,
  ): Promise<ContestTemplate> {
    const template = await this.templateRepo.findById(id);
    if (!template) {
      throw new TemplateNotFoundError(id);
    }
    if (template.isPlatformTemplate) {
      throw new TemplateOperationError('Platform templates cannot be modified');
    }
    return this.templateRepo.update(id, updates);
  }

  /** Deletes a template. Platform templates cannot be deleted. */
  async deleteTemplate(id: string): Promise<void> {
    const template = await this.templateRepo.findById(id);
    if (!template) {
      throw new TemplateNotFoundError(id);
    }
    if (template.isPlatformTemplate) {
      throw new TemplateOperationError('Platform templates cannot be deleted');
    }
    await this.templateRepo.delete(id);
  }

  /** Increments the usage counter and returns the template for pre-filling contest creation. */
  async useTemplate(id: string): Promise<ContestTemplate> {
    const template = await this.templateRepo.findById(id);
    if (!template) {
      throw new TemplateNotFoundError(id);
    }
    await this.templateRepo.incrementUsage(id);
    return template;
  }
}

export class TemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`Contest template not found: ${id}`);
    this.name = 'TemplateNotFoundError';
  }
}

export class TemplateOperationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'TemplateOperationError';
  }
}
