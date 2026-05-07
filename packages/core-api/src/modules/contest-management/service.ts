import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ContestCoreRepository,
  ContestEntryAggregationRuleRepository,
  ContestPrizeDefinitionRepository,
  ParticipantContestScoringRuleRepository,
  SportEventParticipantRepository,
  SportEventParticipantValuationRepository,
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
  PersistedGolfContestTierDefinition,
  TournamentFormat,
} from '@poolmaster/shared/domain';
import {
  ContestFormat,
  ContestStatus,
  GolfContestConfigMode,
  ScoringEngine,
  SelectionType,
  Sport,
  isContestFormatValidForTournamentFormat,
} from '@poolmaster/shared/domain';
import { mapContestConfigTemplateDto } from '../../mappers/contest-management.mapper';
import { evaluateEventOperationalState } from '../events/operational-timing';

interface CreateContestManagementContext {
  leagueId: string;
}

type LifecycleLogger = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn' | 'error' | 'fatal'>;

interface ContestCreateSportEventState {
  id: string;
  releaseAt: Date;
  fieldLocksAt: Date;
  fieldLocked: boolean;
  sport: Sport;
  tournamentFormat: TournamentFormat;
  participantCount: number | null;
  loadedParticipantCount: number;
}

interface ContestCreateSportEventReader {
  findById(
    sportEventId: string,
  ): Promise<ContestCreateSportEventState | null>;
}

function createNoopLogger(): LifecycleLogger {
  const noop = () => undefined;
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
  };
}

export class ContestManagementService {
  constructor(
    private readonly contestCoreRepo: ContestCoreRepository,
    private readonly contestConfigTemplateRepo: ContestConfigTemplateRepository,
    private readonly contestConfigurationRepo: ContestConfigurationRepository,
    private readonly participantContestScoringRuleRepo: ParticipantContestScoringRuleRepository,
    private readonly contestEntryAggregationRuleRepo: ContestEntryAggregationRuleRepository,
    private readonly _contestPrizeDefinitionRepo: ContestPrizeDefinitionRepository,
    private readonly sportEventParticipantRepo: SportEventParticipantRepository,
    private readonly sportEventParticipantValuationRepo: SportEventParticipantValuationRepository,
    private readonly logger: LifecycleLogger = createNoopLogger(),
    private readonly sportEventReader?: ContestCreateSportEventReader,
  ) {}

  async createContest(
    context: CreateContestManagementContext,
    input: CreateContestManagementRequest,
  ): Promise<ContestManagementDetailDto> {
    this.logger.debug({
      leagueId: context.leagueId,
      sportEventId: input.sportEventId,
      contestFormat: input.contestFormat,
      hasTemplate: 'templateId' in input,
    }, 'contest management create contest start');
    const resolvedConfiguration = await resolveCreateConfiguration(
      input,
      this.contestConfigTemplateRepo,
    );
    const sportEvent = await this.assertSportEventContestEligible(input.sportEventId);
    if (
      sportEvent
      && !isContestFormatValidForTournamentFormat(
        sportEvent.tournamentFormat,
        input.contestFormat,
      )
    ) {
      this.logger.warn({
        sportEventId: input.sportEventId,
        sport: sportEvent.sport,
        tournamentFormat: sportEvent.tournamentFormat,
        contestFormat: input.contestFormat,
      }, 'contest management create contest rejected for invalid sport contest format');
      throw new ContestManagementError(
        'Selected sporting event does not support that contest format.',
        'CONTEST_FORMAT_NOT_ALLOWED',
      );
    }
    this.assertContestCreationSupported(sportEvent, input.contestFormat);
    assertTierConfigurationFitsParticipantCount(
      resolvedConfiguration.configuration,
      sportEvent?.loadedParticipantCount,
    );
    const selectionType = mapSelectionType(resolvedConfiguration.configuration);
    const contest = await this.contestCoreRepo.create({
      leagueId: context.leagueId,
      sportEventId: input.sportEventId,
      name: input.name,
      status: ContestStatus.OPEN,
      contestFormat: input.contestFormat,
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
      ...await deriveLegacyPersistenceFields(
        resolvedConfiguration.configuration,
        input.sportEventId,
        this.sportEventParticipantRepo,
        this.sportEventParticipantValuationRepo,
      ),
    });

    await syncDerivedScoring(
      configuration,
      this.participantContestScoringRuleRepo,
      this.contestEntryAggregationRuleRepo,
    );

    this.logger.info({
      contestId: contest.id,
      leagueId: context.leagueId,
      selectionType,
      configMode: resolvedConfiguration.configuration.mode,
      templateId: resolvedConfiguration.template?.id ?? null,
    }, 'contest management create contest completed');

    return buildContestManagementDetail(contest, configuration);
  }

  async listTemplates(
    input: ListContestConfigTemplatesQuery,
  ): Promise<ContestConfigTemplateDto[]> {
    this.logger.debug({
      sport: input.sport,
      contestFormat: input.contestFormat,
      eventType: input.eventType ?? null,
    }, 'contest management list templates start');
    const templates =
      await this.contestConfigTemplateRepo.listBySportAndContestFormat({
        sport: input.sport as ContestConfigTemplate['sport'],
        contestFormat: input.contestFormat as ContestConfigTemplate['contestFormat'],
        eventType: input.eventType,
      });

    this.logger.info({
      sport: input.sport,
      contestFormat: input.contestFormat,
      templateCount: templates.length,
    }, 'contest management list templates completed');

    return templates.map(mapContestConfigTemplateDto);
  }

  private assertContestCreationSupported(
    sportEvent: ContestCreateSportEventState | null,
    contestFormat: ContestFormat,
  ): void {
    if (contestFormat !== ContestFormat.ROSTER) {
      throw new ContestManagementError(
        'This contest format is not available for managed contest creation yet.',
        'CONTEST_FORMAT_NOT_SUPPORTED',
      );
    }

    if (sportEvent && sportEvent.sport !== Sport.GOLF) {
      throw new ContestManagementError(
        'Managed contest creation currently supports golf events only.',
        'CONTEST_SPORT_NOT_SUPPORTED',
      );
    }
  }

  async getContest(contestId: string): Promise<ContestManagementDetailDto> {
    this.logger.debug({ contestId }, 'contest management get contest start');
    const contest = await this.contestCoreRepo.findById(contestId);
    if (!contest) {
      this.logger.warn({ contestId }, 'contest management get contest missing contest');
      throw new ContestManagementError('Contest not found', 'CONTEST_NOT_FOUND', 404);
    }

    const configuration = await this.contestConfigurationRepo.findByContest(
      contestId,
    );
    if (!configuration) {
      this.logger.warn({ contestId }, 'contest management get contest missing configuration');
      throw new ContestManagementError('Contest configuration not found', 'CONTEST_NOT_FOUND', 404);
    }

    this.logger.info({
      contestId,
      configMode: configuration.configMode ?? null,
      templateId: configuration.templateId ?? null,
    }, 'contest management get contest completed');
    return buildContestManagementDetail(contest, configuration);
  }

  async updateContestConfiguration(
    contestId: string,
    input: UpdateContestConfigurationRequest,
  ): Promise<ContestManagementDetailDto> {
    this.logger.debug({
      contestId,
      configMode: input.mode,
      hasLockAt: Boolean(input.locksAt),
    }, 'contest management update configuration start');
    const configuration = await this.contestConfigurationRepo.findByContest(
      contestId,
    );
    if (!configuration) {
      this.logger.warn({ contestId }, 'contest management update configuration missing configuration');
      throw new ContestManagementError('Contest configuration not found', 'CONTEST_NOT_FOUND', 404);
    }

    const selectionType = mapSelectionType(input);
    const contest = await this.contestCoreRepo.findById(contestId);
    if (!contest) {
      this.logger.warn({ contestId }, 'contest management update configuration missing contest');
      throw new ContestManagementError('Contest not found', 'CONTEST_NOT_FOUND', 404);
    }
    await this.assertTierConfigurationFitsSportEvent(contest.sportEventId, input);

    await this.contestConfigurationRepo.update(configuration.id, {
      selectionType,
      configMode: input.mode,
      configJson: input,
      locksAt: input.locksAt ? new Date(input.locksAt) : undefined,
      maxEntriesPerSquad:
        input.maxEntriesPerSquad === null ? null : input.maxEntriesPerSquad,
      ...await deriveLegacyPersistenceFields(
        input,
        contest.sportEventId,
        this.sportEventParticipantRepo,
        this.sportEventParticipantValuationRepo,
      ),
    });

    const refreshedConfiguration =
      await this.contestConfigurationRepo.findByContest(contestId);
    if (!refreshedConfiguration) {
      this.logger.error({ contestId }, 'contest management update configuration refresh missing configuration');
      throw new ContestManagementError('Contest configuration not found', 'CONTEST_NOT_FOUND', 404);
    }

    await syncDerivedScoring(
      refreshedConfiguration,
      this.participantContestScoringRuleRepo,
      this.contestEntryAggregationRuleRepo,
    );

    this.logger.info({
      contestId,
      selectionType,
      configMode: refreshedConfiguration.configMode ?? null,
    }, 'contest management update configuration completed');
    return buildContestManagementDetail(contest, refreshedConfiguration);
  }

  private async assertSportEventContestEligible(
    sportEventId: string,
  ): Promise<ContestCreateSportEventState | null> {
    if (!this.sportEventReader) {
      return null;
    }

    const sportEvent = await this.sportEventReader.findById(sportEventId);
    if (!sportEvent) {
      this.logger.warn({ sportEventId }, 'contest management create contest missing sport event');
      throw new ContestManagementError(
        'Selected sporting event was not found.',
        'SPORT_EVENT_NOT_FOUND',
        404,
      );
    }

    const operationalState = evaluateEventOperationalState({
      participantCount: sportEvent.loadedParticipantCount,
      releaseAt: sportEvent.releaseAt,
      fieldLocksAt: sportEvent.fieldLocksAt,
      providerFieldLocked: sportEvent.fieldLocked,
    });

    if (operationalState.readinessReasons.includes('EVENT_NOT_RELEASED')) {
      this.logger.warn({
        sportEventId,
        releaseAt: sportEvent.releaseAt.toISOString(),
      }, 'contest management create contest rejected for unreleased sport event');
      throw new ContestManagementError(
        'Selected sporting event is not released for contest creation yet.',
        'SPORT_EVENT_NOT_RELEASED',
      );
    }

    if (operationalState.readinessReasons.includes('FIELD_NOT_LOADED')) {
      this.logger.warn({
        sportEventId,
        loadedParticipantCount: sportEvent.loadedParticipantCount,
        participantCount: sportEvent.participantCount,
      }, 'contest management create contest rejected for missing sport event field');
      throw new ContestManagementError(
        'Selected sporting event field has not loaded yet.',
        'SPORT_EVENT_FIELD_NOT_LOADED',
      );
    }

    if (operationalState.readinessReasons.includes('FIELD_LOCKED')) {
      this.logger.warn({
        sportEventId,
        fieldLocksAt: sportEvent.fieldLocksAt.toISOString(),
        providerFieldLocked: sportEvent.fieldLocked,
      }, 'contest management create contest rejected for locked sport event field');
      throw new ContestManagementError(
        'Selected sporting event field is already locked for contest creation.',
        'SPORT_EVENT_FIELD_LOCKED',
      );
    }

    return sportEvent;
  }

  private async assertTierConfigurationFitsSportEvent(
    sportEventId: string,
    configuration: ContestConfigurationRequest,
  ): Promise<void> {
    if (!this.sportEventReader) {
      return;
    }

    const sportEvent = await this.sportEventReader.findById(sportEventId);
    if (!sportEvent) {
      this.logger.warn({ sportEventId }, 'contest management tier validation missing sport event');
      throw new ContestManagementError(
        'Selected sporting event was not found.',
        'SPORT_EVENT_NOT_FOUND',
        404,
      );
    }

    assertTierConfigurationFitsParticipantCount(
      configuration,
      sportEvent.loadedParticipantCount,
    );
  }
}

export class ContestManagementError extends Error {
  constructor(
    message: string,
    readonly code: string = 'CONTEST_CONFIGURATION_INVALID',
    readonly statusCode: number = 422,
  ) {
    super(message);
    this.name = 'ContestManagementError';
  }
}

function mapSelectionType(
  configuration: ContestConfigurationRequest,
): SelectionType {
  return configuration.mode === GolfContestConfigMode.GOLF_TIERED
    ? SelectionType.TIERED
    : SelectionType.OPEN_SELECTION;
}

function assertTierConfigurationFitsParticipantCount(
  configuration: ContestConfigurationRequest,
  participantCount?: number | null,
): void {
  if (configuration.mode !== GolfContestConfigMode.GOLF_TIERED || participantCount == null) {
    return;
  }

  for (const tier of configuration.tiers) {
    if (tier.startPosition > participantCount) {
      throw new ContestManagementError(
        `${tier.label} starts at field position ${tier.startPosition}, but the selected event only has ${participantCount} participants.`,
        'CONTEST_TIER_FIELD_OUT_OF_RANGE',
      );
    }

    const endPosition = Math.min(tier.endPosition ?? participantCount, participantCount);
    const availableParticipants = endPosition - tier.startPosition + 1;
    if (availableParticipants < tier.pickCount) {
      throw new ContestManagementError(
        `${tier.label} does not contain enough participants for ${tier.pickCount} picks.`,
        'CONTEST_TIER_FIELD_OUT_OF_RANGE',
      );
    }
  }
}

async function deriveLegacyPersistenceFields(
  configuration: ContestConfigurationRequest,
  sportEventId: string,
  sportEventParticipantRepo: SportEventParticipantRepository,
  sportEventParticipantValuationRepo: SportEventParticipantValuationRepository,
): Promise<Partial<ContestConfiguration>> {
  if (configuration.mode === GolfContestConfigMode.GOLF_TIERED) {
    const tierConfig = await derivePersistedTierConfig(
      configuration,
      sportEventId,
      sportEventParticipantRepo,
      sportEventParticipantValuationRepo,
    );

    return {
      tierConfig,
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

interface TierCandidate {
  sportEventParticipantId: string;
  participantId: string;
  odds?: number;
  ranking?: number;
}

async function derivePersistedTierConfig(
  configuration: Extract<ContestConfigurationRequest, { mode: 'GOLF_TIERED' }>,
  sportEventId: string,
  sportEventParticipantRepo: SportEventParticipantRepository,
  sportEventParticipantValuationRepo: SportEventParticipantValuationRepository,
): Promise<PersistedGolfContestTierDefinition[]> {
  const participants = await sportEventParticipantRepo.findBySportEvent(sportEventId);

  if (participants.length === 0) {
    return configuration.tiers.map((tier) => ({
      ...tier,
      participantIds: [],
    }));
  }

  // Pre-rop.78.7: tier sort relies on stored valuation orderIndex only.
  // Per-event ranking/odds will move onto SportEventParticipant in rop.78.5
  // and the new scoring path in rop.78.7 will rebuild this with typed fields.
  const tierCandidates = await Promise.all(
    participants.map(async (participant) => {
      const valuations =
        await sportEventParticipantValuationRepo.findBySportEventParticipant(participant.id);
      const currentValuation = valuations[0];

      return {
        sportEventParticipantId: participant.id,
        participantId: participant.participantId,
        odds: undefined,
        ranking: currentValuation?.orderIndex,
      } satisfies TierCandidate;
    }),
  );

  const orderedCandidates = [...tierCandidates].sort((left, right) =>
    compareTierCandidates(left, right, configuration.tierSource),
  );
  const persistedTiers = configuration.tiers.map((tier, index) => ({
    ...tier,
    tierId: tier.tierKey,
    tierName: tier.label,
    tierNumber: index + 1,
    picksFromTier: tier.pickCount,
    participantIds: [] as string[],
  }));

  for (const [index, candidate] of orderedCandidates.entries()) {
    const orderIndex = index + 1;
    const matchingTier = persistedTiers.find((tier) => {
      const endPosition = tier.endPosition ?? orderedCandidates.length;
      return orderIndex >= tier.startPosition && orderIndex <= endPosition;
    }) ?? persistedTiers[persistedTiers.length - 1];

    matchingTier?.participantIds?.push(candidate.participantId);

    const valuationSource = `AUTO_${configuration.tierSource}`;
    const existingValuations =
      await sportEventParticipantValuationRepo.findBySportEventParticipant(
        candidate.sportEventParticipantId,
      );
    const existing = existingValuations.find(
      (valuation) => valuation.valuationSource === valuationSource,
    );
    const valuationPayload = {
      orderIndex,
      tier: matchingTier?.tierId ?? matchingTier?.tierName ?? matchingTier?.label,
      valuationSource,
    };

    if (existing) {
      await sportEventParticipantValuationRepo.update(existing.id, valuationPayload);
    } else {
      await sportEventParticipantValuationRepo.create({
        sportEventParticipantId: candidate.sportEventParticipantId,
        price: undefined,
        ...valuationPayload,
      });
    }
  }

  return persistedTiers;
}

function compareTierCandidates(
  left: TierCandidate,
  right: TierCandidate,
  tierSource: 'ODDS' | 'WORLD_RANK',
): number {
  if (tierSource === 'WORLD_RANK') {
    const rankingDiff = compareNullableNumbers(left.ranking, right.ranking);
    if (rankingDiff !== 0) {
      return rankingDiff;
    }

    const oddsDiff = compareNullableNumbers(left.odds, right.odds);
    if (oddsDiff !== 0) {
      return oddsDiff;
    }
  } else {
    const oddsDiff = compareNullableNumbers(left.odds, right.odds);
    if (oddsDiff !== 0) {
      return oddsDiff;
    }

    const rankingDiff = compareNullableNumbers(left.ranking, right.ranking);
    if (rankingDiff !== 0) {
      return rankingDiff;
    }
  }

  return left.participantId.localeCompare(right.participantId, undefined, {
    sensitivity: 'base',
  });
}

function compareNullableNumbers(
  left: number | undefined,
  right: number | undefined,
): number {
  if (left == null && right == null) {
    return 0;
  }
  if (left == null) {
    return 1;
  }
  if (right == null) {
    return -1;
  }
  return left - right;
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

  if (template.contestFormat !== input.contestFormat) {
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
