/**
 * TemplateConfigService — in-memory CRUD for scoring and selection templates.
 *
 * Loads seed data from the scoring-service and draft-service template
 * registries on init. Changes are persisted in-memory (production would
 * write to the database).
 */

import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types — mirrors the shapes from scoring-service and draft-service
// ---------------------------------------------------------------------------

export interface ScoringTemplateEntry {
  id: string;
  sport: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SelectionTemplateEntry {
  id: string;
  name: string;
  description: string;
  sport: string;
  contestType: string;
  selectionType: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScoringTemplateInput {
  id: string;
  sport: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
}

export interface UpdateScoringTemplateInput {
  sport?: string;
  name?: string;
  description?: string;
  config?: Record<string, unknown>;
}

export interface CreateSelectionTemplateInput {
  id: string;
  name: string;
  description: string;
  sport: string;
  contestType: string;
  selectionType: string;
  config: Record<string, unknown>;
}

export interface UpdateSelectionTemplateInput {
  name?: string;
  description?: string;
  sport?: string;
  contestType?: string;
  selectionType?: string;
  config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TemplateNotFoundError extends Error {
  constructor(kind: string, id: string) {
    super(`${kind} template not found: ${id}`);
    this.name = 'TemplateNotFoundError';
  }
}

export class TemplateAlreadyExistsError extends Error {
  constructor(kind: string, id: string) {
    super(`${kind} template already exists: ${id}`);
    this.name = 'TemplateAlreadyExistsError';
  }
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

function seedScoringTemplates(): Map<string, ScoringTemplateEntry> {
  const now = new Date();
  const templates = new Map<string, ScoringTemplateEntry>();

  const seeds: Array<{ id: string; sport: string; name: string; description: string }> = [
    { id: 'nfl-standard', sport: 'NFL', name: 'NFL Standard', description: 'Standard NFL fantasy scoring' },
    { id: 'nfl-ppr', sport: 'NFL', name: 'NFL PPR', description: 'NFL point-per-reception scoring' },
    { id: 'golf-stroke-play', sport: 'GOLF', name: 'Golf Stroke Play', description: 'Standard stroke play scoring for golf tournaments' },
    { id: 'golf-stableford', sport: 'GOLF', name: 'Golf Stableford', description: 'Modified Stableford scoring for golf' },
    { id: 'f1-constructor', sport: 'F1', name: 'F1 Constructor', description: 'F1 constructor championship scoring' },
    { id: 'f1-driver', sport: 'F1', name: 'F1 Driver', description: 'F1 driver championship scoring' },
    { id: 'nascar-finish', sport: 'NASCAR', name: 'NASCAR Finish Position', description: 'Points by finish position for NASCAR' },
    { id: 'ncaa-bracket', sport: 'NCAA_BASKETBALL', name: 'NCAA Bracket', description: 'March Madness bracket scoring with round multipliers' },
    { id: 'nba-standard', sport: 'NBA', name: 'NBA Standard', description: 'Standard NBA fantasy scoring' },
    { id: 'tennis-match', sport: 'TENNIS', name: 'Tennis Match', description: 'Tennis tournament match scoring' },
    { id: 'horse-racing-finish', sport: 'HORSE_RACING', name: 'Horse Racing Finish', description: 'Points by finish position for horse racing' },
    { id: 'soccer-standard', sport: 'SOCCER', name: 'Soccer Standard', description: 'Standard soccer fantasy scoring' },
  ];

  for (const seed of seeds) {
    templates.set(seed.id, {
      id: seed.id,
      sport: seed.sport,
      name: seed.name,
      description: seed.description,
      config: {},
      createdAt: now,
      updatedAt: now,
    });
  }

  return templates;
}

function seedSelectionTemplates(): Map<string, SelectionTemplateEntry> {
  const now = new Date();
  const templates = new Map<string, SelectionTemplateEntry>();

  const seeds: Array<Omit<SelectionTemplateEntry, 'createdAt' | 'updatedAt'>> = [
    { id: 'golf-snake-4rd', name: 'Golf Snake Draft (4 rounds)', description: 'Classic snake draft with 4 rounds for golf tournaments.', sport: 'GOLF', contestType: 'SINGLE_EVENT', selectionType: 'SNAKE_DRAFT', config: { rounds: 4, timePerPickSeconds: 120, draftMode: 'ASYNC' } },
    { id: 'golf-tiered-6pick4', name: 'Golf 6-Tier Pick (Use Best 4)', description: 'Pick one golfer from each of 6 tiers. Best 4 of 6 scores count.', sport: 'GOLF', contestType: 'SINGLE_EVENT', selectionType: 'TIERED', config: { tierCount: 6, picksPerTier: 1, bestBallN: 4, isExclusive: false, tierAssignmentMethod: 'ODDS' } },
    { id: 'nfl-snake-15rd', name: 'NFL Snake Draft (15 rounds)', description: 'Standard 15-round snake draft for fantasy football.', sport: 'NFL', contestType: 'SEASON_LONG', selectionType: 'SNAKE_DRAFT', config: { rounds: 15, timePerPickSeconds: 60, draftMode: 'LIVE' } },
    { id: 'nfl-survivor', name: 'NFL Survivor Pool', description: 'Pick one team per week to win. Survive or go home.', sport: 'NFL', contestType: 'SEASON_LONG', selectionType: 'PICK_EM', config: { picksPerPeriod: 1, oneEntityPerSeason: true, strikesBeforeElimination: 0 } },
    { id: 'ncaa-bracket-64', name: 'NCAA Bracket (Full 64)', description: 'Full March Madness bracket.', sport: 'NCAA_BASKETBALL', contestType: 'SINGLE_EVENT', selectionType: 'BRACKET_PICK_EM', config: { roundValues: [1, 2, 4, 8, 16, 32], startRound: 'ROUND_OF_64' } },
    { id: 'nba-snake-12rd', name: 'NBA Snake Draft (12 rounds)', description: 'Season-long NBA fantasy with 12-round snake draft.', sport: 'NBA', contestType: 'SEASON_LONG', selectionType: 'SNAKE_DRAFT', config: { rounds: 12, timePerPickSeconds: 90, draftMode: 'LIVE' } },
    { id: 'f1-budget-weekly', name: 'F1 Budget Cap (Race Weekend)', description: 'Build a driver lineup under salary cap for a single Grand Prix.', sport: 'F1', contestType: 'SINGLE_EVENT', selectionType: 'BUDGET_PICK', config: { budget: 10000000, rosterSize: 5, pricingMethod: 'WORLD_RANKING' } },
    { id: 'tennis-slam-bracket', name: 'Grand Slam Bracket', description: 'Predict the draw bracket for a Grand Slam.', sport: 'TENNIS', contestType: 'SINGLE_EVENT', selectionType: 'BRACKET_PICK_EM', config: { roundValues: [1, 2, 4, 8, 16, 32, 64], startRound: 'ROUND_OF_128' } },
    { id: 'soccer-season-snake', name: 'EPL Season-Long Snake Draft', description: 'Draft players for the Premier League season.', sport: 'SOCCER', contestType: 'SEASON_LONG', selectionType: 'SNAKE_DRAFT', config: { rounds: 11, timePerPickSeconds: 90, draftMode: 'LIVE' } },
    { id: 'nascar-snake-4rd', name: 'NASCAR Snake Draft (4 rounds)', description: 'Draft 4 drivers for a race.', sport: 'NASCAR', contestType: 'SINGLE_EVENT', selectionType: 'SNAKE_DRAFT', config: { rounds: 4, timePerPickSeconds: 120, draftMode: 'ASYNC' } },
    { id: 'hr-tiered-odds', name: 'Horse Racing Odds Tiers', description: 'Pick horses from odds-based tiers.', sport: 'HORSE_RACING', contestType: 'SINGLE_EVENT', selectionType: 'TIERED', config: { tierCount: 4, picksPerTier: 1, isExclusive: false, tierAssignmentMethod: 'ODDS' } },
  ];

  for (const seed of seeds) {
    templates.set(seed.id, { ...seed, createdAt: now, updatedAt: now });
  }

  return templates;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TemplateConfigService {
  private scoringTemplates: Map<string, ScoringTemplateEntry> = seedScoringTemplates();
  private selectionTemplates: Map<string, SelectionTemplateEntry> = seedSelectionTemplates();

  // --- Scoring Templates ---

  async listScoringTemplates(): Promise<ScoringTemplateEntry[]> {
    return Array.from(this.scoringTemplates.values());
  }

  async getScoringTemplate(id: string): Promise<ScoringTemplateEntry> {
    const template = this.scoringTemplates.get(id);
    if (!template) {
      throw new TemplateNotFoundError('Scoring', id);
    }
    return template;
  }

  async createScoringTemplate(
    input: CreateScoringTemplateInput,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<ScoringTemplateEntry> {
    if (this.scoringTemplates.has(input.id)) {
      throw new TemplateAlreadyExistsError('Scoring', input.id);
    }

    const now = new Date();
    const template: ScoringTemplateEntry = {
      id: input.id,
      sport: input.sport,
      name: input.name,
      description: input.description,
      config: input.config,
      createdAt: now,
      updatedAt: now,
    };

    this.scoringTemplates.set(template.id, template);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'config.scoring_template.create',
      resourceType: 'SCORING_TEMPLATE',
      resourceId: template.id,
      description: `Created scoring template "${template.name}" (${template.id})`,
      afterState: template as unknown as Record<string, unknown>,
    });

    return template;
  }

  async updateScoringTemplate(
    id: string,
    updates: UpdateScoringTemplateInput,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<ScoringTemplateEntry> {
    const template = this.scoringTemplates.get(id);
    if (!template) {
      throw new TemplateNotFoundError('Scoring', id);
    }

    const beforeState = { ...template };

    if (updates.sport !== undefined) template.sport = updates.sport;
    if (updates.name !== undefined) template.name = updates.name;
    if (updates.description !== undefined) template.description = updates.description;
    if (updates.config !== undefined) template.config = updates.config;
    template.updatedAt = new Date();

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'config.scoring_template.update',
      resourceType: 'SCORING_TEMPLATE',
      resourceId: id,
      description: `Updated scoring template "${template.name}" (${id})`,
      beforeState: beforeState as unknown as Record<string, unknown>,
      afterState: template as unknown as Record<string, unknown>,
    });

    return template;
  }

  async deleteScoringTemplate(
    id: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const template = this.scoringTemplates.get(id);
    if (!template) {
      throw new TemplateNotFoundError('Scoring', id);
    }

    this.scoringTemplates.delete(id);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'config.scoring_template.delete',
      resourceType: 'SCORING_TEMPLATE',
      resourceId: id,
      description: `Deleted scoring template "${template.name}" (${id})`,
      beforeState: template as unknown as Record<string, unknown>,
    });
  }

  // --- Selection Templates ---

  async listSelectionTemplates(): Promise<SelectionTemplateEntry[]> {
    return Array.from(this.selectionTemplates.values());
  }

  async getSelectionTemplate(id: string): Promise<SelectionTemplateEntry> {
    const template = this.selectionTemplates.get(id);
    if (!template) {
      throw new TemplateNotFoundError('Selection', id);
    }
    return template;
  }

  async createSelectionTemplate(
    input: CreateSelectionTemplateInput,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<SelectionTemplateEntry> {
    if (this.selectionTemplates.has(input.id)) {
      throw new TemplateAlreadyExistsError('Selection', input.id);
    }

    const now = new Date();
    const template: SelectionTemplateEntry = {
      id: input.id,
      name: input.name,
      description: input.description,
      sport: input.sport,
      contestType: input.contestType,
      selectionType: input.selectionType,
      config: input.config,
      createdAt: now,
      updatedAt: now,
    };

    this.selectionTemplates.set(template.id, template);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'config.selection_template.create',
      resourceType: 'SELECTION_TEMPLATE',
      resourceId: template.id,
      description: `Created selection template "${template.name}" (${template.id})`,
      afterState: template as unknown as Record<string, unknown>,
    });

    return template;
  }

  async updateSelectionTemplate(
    id: string,
    updates: UpdateSelectionTemplateInput,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<SelectionTemplateEntry> {
    const template = this.selectionTemplates.get(id);
    if (!template) {
      throw new TemplateNotFoundError('Selection', id);
    }

    const beforeState = { ...template };

    if (updates.name !== undefined) template.name = updates.name;
    if (updates.description !== undefined) template.description = updates.description;
    if (updates.sport !== undefined) template.sport = updates.sport;
    if (updates.contestType !== undefined) template.contestType = updates.contestType;
    if (updates.selectionType !== undefined) template.selectionType = updates.selectionType;
    if (updates.config !== undefined) template.config = updates.config;
    template.updatedAt = new Date();

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'config.selection_template.update',
      resourceType: 'SELECTION_TEMPLATE',
      resourceId: id,
      description: `Updated selection template "${template.name}" (${id})`,
      beforeState: beforeState as unknown as Record<string, unknown>,
      afterState: template as unknown as Record<string, unknown>,
    });

    return template;
  }

  async deleteSelectionTemplate(
    id: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const template = this.selectionTemplates.get(id);
    if (!template) {
      throw new TemplateNotFoundError('Selection', id);
    }

    this.selectionTemplates.delete(id);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'config.selection_template.delete',
      resourceType: 'SELECTION_TEMPLATE',
      resourceId: id,
      description: `Deleted selection template "${template.name}" (${id})`,
      beforeState: template as unknown as Record<string, unknown>,
    });
  }
}
