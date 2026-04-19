import type {
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ContestCoreRepository,
  ContestEntryAggregationRuleRepository,
  ContestPrizeDefinitionRepository,
  ParticipantContestScoringRuleRepository,
} from '@poolmaster/shared/db';
import type {
  ContestConfigTemplateDto,
  ContestManagementDetailDto,
  ContestConfigurationRequest,
  CreateContestManagementRequest,
  ListContestConfigTemplatesQuery,
  UpdateContestConfigurationRequest,
} from '@poolmaster/shared/dto';
import type {
  ContestConfigTemplate,
  ContestConfiguration,
  GolfContestConfig,
} from '@poolmaster/shared/domain';
import {
  ContestStatus,
  GolfContestConfigMode,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';

interface CreateContestManagementContext {
  leagueId: string;
}

export class ContestManagementService {
  constructor(
    private readonly contestCoreRepo: ContestCoreRepository,
    private readonly contestConfigTemplateRepo: ContestConfigTemplateRepository,
    private readonly contestConfigurationRepo: ContestConfigurationRepository,
    private readonly participantContestScoringRuleRepo: ParticipantContestScoringRuleRepository,
    private readonly contestEntryAggregationRuleRepo: ContestEntryAggregationRuleRepository,
    private readonly _contestPrizeDefinitionRepo: ContestPrizeDefinitionRepository,
  ) {}

  async createContest(
    context: CreateContestManagementContext,
    input: CreateContestManagementRequest,
  ): Promise<ContestManagementDetailDto> {
    const resolvedConfiguration = await resolveCreateConfiguration(
      input,
      this.contestConfigTemplateRepo,
    );
    const selectionType = mapSelectionType(resolvedConfiguration.configuration);
    const contest = await this.contestCoreRepo.create({
      leagueId: context.leagueId,
      sportEventId: input.sportEventId,
      name: input.name,
      status: ContestStatus.OPEN,
      selectionType,
      scoringEngine: ScoringEngine.STROKE_PLAY,
    });

    const configuration = await this.contestConfigurationRepo.create({
      contestId: contest.id,
      templateId: resolvedConfiguration.template?.id,
      templateVersion: resolvedConfiguration.template?.schemaVersion,
      selectionType,
      configMode: resolvedConfiguration.configuration.mode,
      configJson: resolvedConfiguration.configuration,
      locksAt: resolvedConfiguration.configuration.locksAt
        ? new Date(resolvedConfiguration.configuration.locksAt)
        : undefined,
      maxEntriesPerSquad:
        resolvedConfiguration.configuration.maxEntriesPerSquad === null
          ? null
          : resolvedConfiguration.configuration.maxEntriesPerSquad,
      ...deriveLegacyPersistenceFields(resolvedConfiguration.configuration),
    });

    await syncDerivedScoring(
      configuration,
      this.participantContestScoringRuleRepo,
      this.contestEntryAggregationRuleRepo,
    );

    return buildContestManagementDetail(contest, configuration);
  }

  async listTemplates(
    input: ListContestConfigTemplatesQuery,
  ): Promise<ContestConfigTemplateDto[]> {
    const templates =
      await this.contestConfigTemplateRepo.listBySportAndContestType({
        sport: input.sport as ContestConfigTemplate['sport'],
        contestType: input.contestType as ContestConfigTemplate['contestType'],
        eventType: input.eventType,
      });

    return templates.map(mapContestConfigTemplateDto);
  }

  async getContest(contestId: string): Promise<ContestManagementDetailDto> {
    const contest = await this.contestCoreRepo.findById(contestId);
    if (!contest) {
      throw new ContestManagementError('Contest not found');
    }

    const configuration = await this.contestConfigurationRepo.findByContest(
      contestId,
    );
    if (!configuration) {
      throw new ContestManagementError('Contest configuration not found');
    }

    return buildContestManagementDetail(contest, configuration);
  }

  async updateContestConfiguration(
    contestId: string,
    input: UpdateContestConfigurationRequest,
  ): Promise<ContestManagementDetailDto> {
    const configuration = await this.contestConfigurationRepo.findByContest(
      contestId,
    );
    if (!configuration) {
      throw new ContestManagementError('Contest configuration not found');
    }

    const selectionType = mapSelectionType(input);
    await this.contestConfigurationRepo.update(configuration.id, {
      selectionType,
      configMode: input.mode,
      configJson: input,
      locksAt: input.locksAt ? new Date(input.locksAt) : undefined,
      maxEntriesPerSquad:
        input.maxEntriesPerSquad === null ? null : input.maxEntriesPerSquad,
      ...deriveLegacyPersistenceFields(input),
    });

    const refreshedConfiguration =
      await this.contestConfigurationRepo.findByContest(contestId);
    if (!refreshedConfiguration) {
      throw new ContestManagementError('Contest configuration not found');
    }

    await syncDerivedScoring(
      refreshedConfiguration,
      this.participantContestScoringRuleRepo,
      this.contestEntryAggregationRuleRepo,
    );

    const contest = await this.contestCoreRepo.findById(contestId);
    if (!contest) {
      throw new ContestManagementError('Contest not found');
    }

    return buildContestManagementDetail(contest, refreshedConfiguration);
  }
}

export class ContestManagementError extends Error {}

function mapSelectionType(
  configuration: ContestConfigurationRequest,
): SelectionType {
  return configuration.mode === GolfContestConfigMode.GOLF_TIERED
    ? SelectionType.TIERED
    : SelectionType.OPEN_SELECTION;
}

function deriveLegacyPersistenceFields(
  configuration: ContestConfigurationRequest,
): Partial<ContestConfiguration> {
  if (configuration.mode === GolfContestConfigMode.GOLF_TIERED) {
    return {
      tierConfig: configuration.tiers,
      pickCount: configuration.tiers.reduce(
        (total, tier) => total + tier.pickCount,
        0,
      ),
      rosterSize: configuration.rosterSize,
      isExclusive: false,
    };
  }

  return {
    pickCount: configuration.categories.reduce(
      (total, category) => total + category.pickCount,
      0,
    ),
    isExclusive: false,
  };
}

async function syncDerivedScoring(
  configuration: ContestConfiguration,
  participantRuleRepo: ParticipantContestScoringRuleRepository,
  aggregationRuleRepo: ContestEntryAggregationRuleRepository,
): Promise<void> {
  const typedConfiguration = ensureTypedConfiguration(configuration);
  const existingParticipantRules =
    await participantRuleRepo.findByContestConfiguration(configuration.id);
  await Promise.all(
    existingParticipantRules.map((rule) => participantRuleRepo.delete(rule.id)),
  );

  await participantRuleRepo.create({
    contestConfigurationId: configuration.id,
    participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
    sortOrder: 1,
    config: buildParticipantScoringConfig(typedConfiguration),
    active: true,
  });

  const existingAggregationRule =
    await aggregationRuleRepo.findByContestConfiguration(configuration.id);
  const aggregationPayload = buildAggregationRule(typedConfiguration);

  if (existingAggregationRule) {
    await aggregationRuleRepo.update(
      existingAggregationRule.id,
      aggregationPayload,
    );
  } else {
    await aggregationRuleRepo.create({
      contestConfigurationId: configuration.id,
      ...aggregationPayload,
    });
  }
}

function buildParticipantScoringConfig(
  configuration: GolfContestConfig,
): Record<string, unknown> {
  return {
    cutRule: configuration.cutRule,
    playoffHandling: configuration.playoffHandling,
    displayScoring: configuration.displayScoring,
    tiebreaker: configuration.tiebreaker,
  };
}

function buildAggregationRule(configuration: GolfContestConfig): {
  aggregationDefinitionId: 'SUM_TOP_N_ENTRIES' | 'SUM_ALL_ENTRIES';
  config: Record<string, unknown>;
  active: boolean;
} {
  if (configuration.mode === GolfContestConfigMode.GOLF_TIERED) {
    return {
      aggregationDefinitionId: 'SUM_TOP_N_ENTRIES',
      config: {
        topN: configuration.countedScores,
        lowerIsBetter: true,
      },
      active: true,
    };
  }

  return {
    aggregationDefinitionId: 'SUM_ALL_ENTRIES',
    config: {
      lowerIsBetter: true,
    },
    active: true,
  };
}

function buildContestManagementDetail(
  contest: {
    id: string;
    leagueId: string;
    sportEventId: string;
    name: string;
    status: ContestManagementDetailDto['status'];
    createdAt: Date;
    updatedAt: Date;
  },
  configuration: {
    id: string;
    contestId: string;
    templateId?: string | null;
    templateVersion?: number | null;
    configMode?: string | null;
    configJson?: GolfContestConfig;
    locksAt?: Date | null;
    maxEntriesPerSquad?: number | null;
    selectionType: string;
    rosterSize?: number;
    pickCount?: number;
    tierConfig?: unknown;
  },
): ContestManagementDetailDto {
  const configJson = ensureTypedConfiguration(configuration);
  return {
    id: contest.id,
    leagueId: contest.leagueId,
    sportEventId: contest.sportEventId,
    name: contest.name,
    status: contest.status,
    createdAt: contest.createdAt.toISOString(),
    updatedAt: contest.updatedAt.toISOString(),
    templateId: configuration.templateId ?? null,
    templateVersion: configuration.templateVersion ?? null,
    configuration: {
      id: configuration.id,
      contestId: configuration.contestId,
      ...configJson,
    },
  };
}

function ensureTypedConfiguration(configuration: {
  configMode?: string | null;
  configJson?: GolfContestConfig;
  locksAt?: Date | null;
  maxEntriesPerSquad?: number | null;
  selectionType: string;
  rosterSize?: number;
  pickCount?: number;
  tierConfig?: unknown;
}): GolfContestConfig & {
  locksAt?: string | null;
  maxEntriesPerSquad?: number | null;
} {
  if (configuration.configJson) {
    return {
      ...configuration.configJson,
      locksAt: configuration.locksAt?.toISOString() ?? null,
      maxEntriesPerSquad: configuration.maxEntriesPerSquad ?? null,
    };
  }

  if (configuration.selectionType === SelectionType.TIERED) {
    const tiers = Array.isArray(configuration.tierConfig)
      ? configuration.tierConfig.map((tier, index) => {
          const record = tier as Record<string, unknown>;
          return {
            tierKey: String(record.tierKey ?? record.tierId ?? `T${index + 1}`),
            label: String(
              record.label ??
                record.tierName ??
                record.tierId ??
                `Tier ${index + 1}`,
            ),
            pickCount: Number(record.pickCount ?? record.picksFromTier ?? 1),
            startPosition: Number(record.startPosition ?? index * 10 + 1),
            endPosition:
              record.endPosition == null ? null : Number(record.endPosition),
          };
        })
      : [];

    return {
      mode: GolfContestConfigMode.GOLF_TIERED,
      locksAt: configuration.locksAt?.toISOString() ?? null,
      maxEntriesPerSquad: configuration.maxEntriesPerSquad ?? null,
      rosterSize: configuration.rosterSize ?? configuration.pickCount ?? 6,
      countedScores: Math.min(
        configuration.rosterSize ?? configuration.pickCount ?? 4,
        4,
      ),
      tierSource: 'ODDS',
      tierGeneration: {
        defaultTierSize: 10,
      },
      tiers,
      cutRule: {
        type: 'FIXED_SCORE',
        fixedScore: 80,
      },
      playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
      displayScoring: 'TO_PAR',
      tiebreaker: {
        type: 'PREDICT_WINNING_SCORE',
      },
    };
  }

  throw new ContestManagementError(
    'Contest configuration is missing typed golf contest data',
  );
}

async function resolveCreateConfiguration(
  input: CreateContestManagementRequest,
  templateRepo: ContestConfigTemplateRepository,
): Promise<{
  template?: ContestConfigTemplate;
  configuration: ContestConfigurationRequest;
}> {
  if ('configuration' in input) {
    return { configuration: input.configuration };
  }

  const template = await templateRepo.findById(input.templateId);
  if (!template || !template.active) {
    throw new ContestManagementError('Contest configuration template not found');
  }

  if (template.contestType !== input.contestType) {
    throw new ContestManagementError(
      'Contest configuration template does not match the requested contest type',
    );
  }

  const configuration =
    input.configurationOverrides ??
    (template.configJson as ContestConfigurationRequest);

  if (configuration.mode !== template.configMode) {
    throw new ContestManagementError(
      'Advanced configuration override must use the same configuration mode as the selected template',
    );
  }

  return {
    template,
    configuration,
  };
}

function mapContestConfigTemplateDto(
  template: ContestConfigTemplate,
): ContestConfigTemplateDto {
  return {
    id: template.id,
    sport: template.sport,
    eventType: template.eventType ?? null,
    contestType: template.contestType,
    configMode: template.configMode,
    templateKey: template.templateKey,
    name: template.name,
    description: template.description,
    sortOrder: template.sortOrder,
    isDefault: template.isDefault,
    active: template.active,
    schemaVersion: template.schemaVersion,
    configuration: template.configJson,
  };
}
