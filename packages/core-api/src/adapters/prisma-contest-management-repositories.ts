import type { PrismaClient } from '@prisma/client';
import type {
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ParticipantContestScoringRuleRepository,
} from '@poolmaster/shared/db';
import type {
  ContestConfigTemplate,
  ContestConfiguration,
  ContestFormat,
  ContestTemplateEventType,
  ParticipantContestScoringRule,
  ParticipantContestScoringRuleCreate,
  SelectionType,
  Sport,
} from '@poolmaster/shared/domain';
import {
  ContestRulesWithEntryLimitSchema,
  ContestSelectionConfigSchema,
  parseContestScoringSettings,
} from '@poolmaster/shared/domain';

export class PrismaContestConfigurationRepository
  implements ContestConfigurationRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findByContest(contestId: string): Promise<ContestConfiguration | null> {
    const row = await this.prisma.contestConfiguration.findUnique({
      where: { contestId },
    });
    return row ? mapContestConfiguration(row) : null;
  }

  async findByTemplateEventSeries(eventSeriesId: string): Promise<ContestConfiguration[]> {
    const series = await this.prisma.eventSeries.findUnique({ where: { id: eventSeriesId } });
    if (!series) {
      return [];
    }
    const rows = await this.prisma.contestConfiguration.findMany({
      where: { template: { sportLeagueId: series.sportLeagueId, eventSeriesNames: { has: series.name } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapContestConfiguration);
  }

  async create(
    configuration: Omit<ContestConfiguration, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestConfiguration> {
    const row = await this.prisma.contestConfiguration.create({
      data: {
        contestId: configuration.contestId,
        templateId: configuration.templateId,
        templateVersion: configuration.templateVersion,
        selectionType: configuration.selectionType,
        configJson: configuration.configJson as object | undefined,
        minimumEntries: configuration.minimumEntries,
        maxEntriesPerSquad: configuration.maxEntriesPerSquad,
        totalPrizePoolAmount: configuration.totalPrizePoolAmount,
      },
    });
    return mapContestConfiguration(row);
  }

  async update(
    id: string,
    updates: Partial<ContestConfiguration>,
  ): Promise<ContestConfiguration> {
    const row = await this.prisma.contestConfiguration.update({
      where: { id },
      data: {
        ...(updates.templateId !== undefined && {
          templateId: updates.templateId,
        }),
        ...(updates.templateVersion !== undefined && {
          templateVersion: updates.templateVersion,
        }),
        ...(updates.selectionType !== undefined && {
          selectionType: updates.selectionType,
        }),
        ...(updates.configJson !== undefined && {
          configJson: updates.configJson as object,
        }),
        ...(updates.minimumEntries !== undefined && {
          minimumEntries: updates.minimumEntries,
        }),
        ...(updates.maxEntriesPerSquad !== undefined && {
          maxEntriesPerSquad: updates.maxEntriesPerSquad,
        }),
        ...(updates.totalPrizePoolAmount !== undefined && {
          totalPrizePoolAmount: updates.totalPrizePoolAmount,
        }),
      },
    });
    return mapContestConfiguration(row);
  }
}

export class PrismaContestConfigTemplateRepository
  implements ContestConfigTemplateRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ContestConfigTemplate | null> {
    const row = await this.prisma.contestConfigTemplate.findUnique({
      where: { id },
    });
    return row ? mapContestConfigTemplate(row) : null;
  }

  async list(input: {
    sport?: ContestConfigTemplate['sport'];
    sportLeagueId?: string;
    eventType?: ContestTemplateEventType | null;
    active?: boolean;
  } = {}): Promise<ContestConfigTemplate[]> {
    const rows = await this.prisma.contestConfigTemplate.findMany({
      where: {
        ...(input.sport !== undefined && { sport: input.sport }),
        AND: [
          // An event type narrows to that type's templates plus the ones for any event type.
          ...(input.eventType !== undefined ? [{ OR: [{ eventType: input.eventType }, { eventType: null }] }] : []),
          // A sport league narrows to that league's templates plus the sport-wide ones.
          ...(input.sportLeagueId !== undefined
            ? [{ OR: [{ sportLeagueId: input.sportLeagueId }, { sportLeagueId: null }] }]
            : []),
        ],
        ...(input.active !== undefined && { active: input.active }),
      },
      orderBy: [
        { sport: 'asc' },
        { contestFormat: 'asc' },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
    });

    return rows.map(mapContestConfigTemplate);
  }

  async update(
    id: string,
    updates: Partial<ContestConfigTemplate>,
  ): Promise<ContestConfigTemplate> {
    const row = await this.prisma.contestConfigTemplate.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.sortOrder !== undefined && { sortOrder: updates.sortOrder }),
        ...(updates.isDefault !== undefined && { isDefault: updates.isDefault }),
        ...(updates.active !== undefined && { active: updates.active }),
        ...(updates.configJson !== undefined && { configJson: updates.configJson as object }),
        ...(updates.schemaVersion !== undefined && { schemaVersion: updates.schemaVersion }),
      },
    });

    return mapContestConfigTemplate(row);
  }
}

export class PrismaParticipantContestScoringRuleRepository
  implements ParticipantContestScoringRuleRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findByContestConfiguration(
    contestConfigurationId: string,
  ): Promise<ParticipantContestScoringRule[]> {
    const rows = await this.prisma.participantContestScoringRule.findMany({
      where: { contestConfigurationId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(mapParticipantScoringRule);
  }

  async create(
    rule: ParticipantContestScoringRuleCreate,
  ): Promise<ParticipantContestScoringRule> {
    const row = await this.prisma.participantContestScoringRule.create({
      data: {
        contestConfigurationId: rule.contestConfigurationId,
        participantScoringDefinitionId: rule.scoring.participantScoringDefinitionId,
        sortOrder: rule.sortOrder,
        config: rule.scoring.config,
        active: rule.active,
      },
    });
    return mapParticipantScoringRule(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.participantContestScoringRule.delete({ where: { id } });
  }
}

function mapContestConfiguration(row: {
  id: string;
  contestId: string;
  templateId: string | null;
  templateVersion: number | null;
  selectionType: SelectionType;
  configJson: unknown;
  minimumEntries: number | null;
  maxEntriesPerSquad: number | null;
  totalPrizePoolAmount: number | null;
  createdAt: Date;
  updatedAt: Date;
}): ContestConfiguration {
  return {
    id: row.id,
    contestId: row.contestId,
    templateId: row.templateId ?? undefined,
    templateVersion: row.templateVersion ?? undefined,
    selectionType: row.selectionType,
    // Parsed, not cast: the rules decide what an entry may pick, so a row that breaks them
    // fails loudly here rather than downstream (#93).
    configJson: row.configJson === null ? undefined : ContestSelectionConfigSchema.parse(row.configJson),
    minimumEntries: row.minimumEntries ?? undefined,
    maxEntriesPerSquad: row.maxEntriesPerSquad ?? undefined,
    totalPrizePoolAmount: row.totalPrizePoolAmount ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapContestConfigTemplate(row: {
  id: string;
  sport: Sport;
  sportLeagueId: string | null;
  eventType: ContestTemplateEventType | null;
  contestFormat: ContestFormat;
  selectionType: SelectionType;
  templateKey: string;
  name: string;
  description: string;
  sortOrder: number;
  isDefault: boolean;
  active: boolean;
  configJson: unknown;
  schemaVersion: number;
  eventSeriesNames: string[];
  createdAt: Date;
  updatedAt: Date;
}): ContestConfigTemplate {
  return {
    id: row.id,
    sport: row.sport,
    sportLeagueId: row.sportLeagueId,
    eventType: row.eventType ?? undefined,
    contestFormat: row.contestFormat,
    selectionType: row.selectionType,
    templateKey: row.templateKey,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    isDefault: row.isDefault,
    active: row.active,
    configJson: ContestRulesWithEntryLimitSchema.parse(row.configJson),
    schemaVersion: row.schemaVersion,
    eventSeriesNames: row.eventSeriesNames,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapParticipantScoringRule(row: {
  id: string;
  contestConfigurationId: string;
  participantScoringDefinitionId: string;
  sortOrder: number;
  config: unknown;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ParticipantContestScoringRule {
  return {
    id: row.id,
    contestConfigurationId: row.contestConfigurationId,
    sortOrder: row.sortOrder,
    // Parsed, not cast: the definition id and config are read through the definition's
    // settings schema, and a row either schema refuses reads as a failed parse.
    scoring: parseContestScoringSettings(row.participantScoringDefinitionId, row.config),
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
