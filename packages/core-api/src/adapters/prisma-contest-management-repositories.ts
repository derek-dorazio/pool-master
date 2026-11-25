import type { PrismaClient } from '@prisma/client';
import { forgettingReads, memoizedRead, ReadMemoKey } from '../core/request-read-memo';
import type {
  ContestConfigTemplateRepository,
  ContestConfigTemplateUpdate,
  ContestConfigurationRepository,
  ParticipantContestScoringRuleRepository,
} from '@poolmaster/shared/db';
import type {
  ContestConfigTemplate,
  ContestConfiguration,
  ContestFormat,
  ContestTemplateSlot,
  LeaguePhase,
  MatchFormat,
  ParticipantContestScoringRule,
  ParticipantContestScoringRuleCreate,
  SelectionType,
  SlotKind,
  TemplateCoverageMode,
} from '@poolmaster/shared/domain';
import {
  compareCoveredSlots,
  ContestRulesWithEntryLimitSchema,
  ContestSelectionConfigSchema,
  parseContestScoringSettings,
} from '@poolmaster/shared/domain';

export class PrismaContestConfigurationRepository
  implements ContestConfigurationRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findByContest(contestId: string): Promise<ContestConfiguration | null> {
    return memoizedRead(this.prisma, `${ReadMemoKey.contestConfiguration}${contestId}`, async () => {
      const row = await this.prisma.contestConfiguration.findUnique({
        where: { contestId },
      });
      return row ? mapContestConfiguration(row) : null;
    });
  }

  async findByContests(contestIds: readonly string[]): Promise<ContestConfiguration[]> {
    if (contestIds.length === 0) return [];
    const rows = await this.prisma.contestConfiguration.findMany({
      where: { contestId: { in: [...contestIds] } },
    });
    return rows.map(mapContestConfiguration);
  }

  async create(
    configuration: Omit<ContestConfiguration, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestConfiguration> {
    const row = await forgettingReads(ReadMemoKey.contestConfiguration, () => this.prisma.contestConfiguration.create({
      data: {
        contestId: configuration.contestId,
        templateId: configuration.templateId,
        templateVersion: configuration.templateVersion,
        selectionType: configuration.selectionType,
        configJson: configuration.configJson,
        minimumEntries: configuration.minimumEntries,
        maxEntriesPerSquad: configuration.maxEntriesPerSquad,
        totalPrizePoolAmount: configuration.totalPrizePoolAmount,
      },
    }));
    return mapContestConfiguration(row);
  }

  async update(
    id: string,
    updates: Partial<ContestConfiguration>,
  ): Promise<ContestConfiguration> {
    const row = await forgettingReads(ReadMemoKey.contestConfiguration, () => this.prisma.contestConfiguration.update({
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
          configJson: updates.configJson,
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
    }));
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
      include: TEMPLATE_INCLUDE,
    });
    return row ? mapContestConfigTemplate(row) : null;
  }

  async list(input: {
    sportLeagueId?: string;
    slotDefinitionIds?: readonly string[];
    active?: boolean;
  } = {}): Promise<ContestConfigTemplate[]> {
    const rows = await this.prisma.contestConfigTemplate.findMany({
      where: {
        ...(input.sportLeagueId !== undefined && { sportLeagueId: input.sportLeagueId }),
        // Covering one of the slot definitions: where the template is offered (#2010).
        ...(input.slotDefinitionIds !== undefined && { slots: { some: { sportLeaguePhaseSlotId: { in: [...input.slotDefinitionIds] } } } }),
        ...(input.active !== undefined && { active: input.active }),
      },
      include: TEMPLATE_INCLUDE,
      orderBy: [
        { sportLeague: { sport: { displayOrder: 'asc' } } },
        { sportLeague: { name: 'asc' } },
        { contestFormat: 'asc' },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
    });

    return rows.map(mapContestConfigTemplate);
  }

  async update(id: string, updates: ContestConfigTemplateUpdate): Promise<ContestConfigTemplate> {
    return this.prisma.$transaction(async (tx) => {
      const { sportLeagueId, selectionType } = await tx.contestConfigTemplate.findUniqueOrThrow({ where: { id }, select: { sportLeagueId: true, selectionType: true } });
      if (updates.isDefault === true) {
        // One default per sport league and selection type, which a partial unique index keeps
        // (#2010): the one that was the default stops being it in the same transaction.
        await tx.contestConfigTemplate.updateMany({
          where: { sportLeagueId, selectionType, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      if (updates.slotDefinitionIds !== undefined) {
        // The composite key keeps every definition in the template's own league.
        await tx.contestConfigTemplateSlot.deleteMany({ where: { templateId: id } });
        await tx.contestConfigTemplateSlot.createMany({
          data: [...new Set(updates.slotDefinitionIds)].map((sportLeaguePhaseSlotId) => ({ sportLeagueId, templateId: id, sportLeaguePhaseSlotId })),
        });
      }
      const row = await tx.contestConfigTemplate.update({
        where: { id },
        data: {
          ...(updates.name !== undefined && { name: updates.name }),
          ...(updates.description !== undefined && { description: updates.description }),
          ...(updates.sortOrder !== undefined && { sortOrder: updates.sortOrder }),
          ...(updates.isDefault !== undefined && { isDefault: updates.isDefault }),
          ...(updates.active !== undefined && { active: updates.active }),
          ...(updates.configJson !== undefined && { configJson: updates.configJson }),
          ...(updates.coverageMode !== undefined && { coverageMode: updates.coverageMode }),
        },
        include: TEMPLATE_INCLUDE,
      });
      return mapContestConfigTemplate(row);
    });
  }

  async findSlotDefinitions(sportLeagueId: string, ids: readonly string[]): Promise<ContestTemplateSlot[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.sportLeaguePhaseSlot.findMany({
      where: { sportLeagueId, id: { in: [...ids] } },
      select: TEMPLATE_SLOT_DEFINITION_SELECT,
    });
    return rows.map(mapTemplateSlot).sort(compareCoveredSlots);
  }
}

export class PrismaParticipantContestScoringRuleRepository
  implements ParticipantContestScoringRuleRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  findByContestConfiguration(
    contestConfigurationId: string,
  ): Promise<ParticipantContestScoringRule[]> {
    return this.findByContestConfigurations([contestConfigurationId]);
  }

  async findByContestConfigurations(
    contestConfigurationIds: readonly string[],
  ): Promise<ParticipantContestScoringRule[]> {
    if (contestConfigurationIds.length === 0) return [];
    const rows = await this.prisma.participantContestScoringRule.findMany({
      where: { contestConfigurationId: { in: [...contestConfigurationIds] } },
      orderBy: [{ contestConfigurationId: 'asc' }, { sortOrder: 'asc' }],
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

  async deleteByContestConfiguration(contestConfigurationId: string): Promise<void> {
    await this.prisma.participantContestScoringRule.deleteMany({ where: { contestConfigurationId } });
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

/** A slot definition as a template lists it (#2010), with its phase's kind. */
const TEMPLATE_SLOT_DEFINITION_SELECT = {
  id: true,
  key: true,
  name: true,
  slotKind: true,
  weekNumber: true,
  matchFormat: true,
  sportLeaguePhaseId: true,
  phase: { select: { phase: true } },
} as const;

/** A slot definition row selected with `TEMPLATE_SLOT_DEFINITION_SELECT`. */
interface TemplateSlotDefinitionRow {
  id: string;
  key: string;
  name: string | null;
  slotKind: SlotKind;
  weekNumber: number | null;
  matchFormat: MatchFormat;
  sportLeaguePhaseId: string;
  phase: { phase: LeaguePhase };
}

/** What every template read joins: the slot definitions it covers (#2010). The event page adapter maps its offers' templates with it too. */
export const TEMPLATE_INCLUDE = { slots: { select: { definition: { select: TEMPLATE_SLOT_DEFINITION_SELECT } } } } as const;

function mapTemplateSlot(row: TemplateSlotDefinitionRow): ContestTemplateSlot {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    slotKind: row.slotKind,
    weekNumber: row.weekNumber,
    sportLeaguePhaseId: row.sportLeaguePhaseId,
    phase: row.phase.phase,
    matchFormat: row.matchFormat,
  };
}

/** A template row as the domain reads it. */
export function mapContestConfigTemplate(row: {
  id: string;
  sportLeagueId: string;
  coverageMode: TemplateCoverageMode;
  slots: readonly { definition: TemplateSlotDefinitionRow }[];
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
  createdAt: Date;
  updatedAt: Date;
}): ContestConfigTemplate {
  return {
    id: row.id,
    sportLeagueId: row.sportLeagueId,
    coverageMode: row.coverageMode,
    slots: row.slots.map(({ definition }) => mapTemplateSlot(definition)).sort(compareCoveredSlots),
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
