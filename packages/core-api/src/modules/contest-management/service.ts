import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ContestCoreRepository,
  ContestEntryAggregationRuleRepository,
  ContestPrizeDefinitionRepository,
  ParticipantContestScoringRuleRepository,
  SportEventParticipantRepository,
} from '@poolmaster/shared/db';
import type { GolfTierService } from '../golf/golf-tier-service';
import type {
  ContestConfigTemplateDto,
  ContestManagementDetailDto,
  ContestConfigurationRequest,
  CreateContestManagementRequest,
  GolfEffectiveTierDto,
  ListContestConfigTemplatesQuery,
  UpdateContestConfigurationRequest,
} from '@poolmaster/shared/dto';
import type {
  ContestConfigTemplate,
  ContestConfiguration,
  GolfContestConfig,
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
import {
  mapContestConfigTemplateDto,
  toGolfEffectiveTierDtoList,
} from '../../mappers/contest-management.mapper';
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
    private readonly golfTierService: GolfTierService,
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
    await this.assertTierConfigurationFitsTierCount(input.sportEventId, resolvedConfiguration.configuration);
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
      ...await deriveLegacyPersistenceFields(resolvedConfiguration.configuration),
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

    return buildContestManagementDetail(
      contest,
      configuration,
      await this.resolveEffectiveTiers(contest.sportEventId),
    );
  }

  /**
   * Read-only echo of the tier structure the contest inherits from its
   * linked SportEvent (plans/124 §4.6/§5.3). Tiers are event-owned — there
   * is no per-contest override — so every ContestManagementDetailDto carries
   * this so the commissioner UI can show what was inherited without a mode
   * flag. Reads through the same golf-tier-service resolution the root-admin
   * tier routes use. Returns [] when the contest has no linked event or the
   * event has no tiers defined yet.
   */
  private async resolveEffectiveTiers(
    sportEventId: string | null | undefined,
  ): Promise<GolfEffectiveTierDto[]> {
    if (!sportEventId) {
      return [];
    }
    const tiers = await this.golfTierService.getEffectiveTiersForSportEvent(sportEventId);
    return toGolfEffectiveTierDtoList(tiers);
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
    return buildContestManagementDetail(
      contest,
      configuration,
      await this.resolveEffectiveTiers(contest.sportEventId),
    );
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
      ...await deriveLegacyPersistenceFields(input),
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
    return buildContestManagementDetail(
      contest,
      refreshedConfiguration,
      await this.resolveEffectiveTiers(contest.sportEventId),
    );
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

    await this.assertTierConfigurationFitsTierCount(sportEventId, configuration);
  }

  /**
   * Tiers are event-owned data now (plans/124 §4.6) — there's no per-contest
   * custom list to validate a rosterSize against, only the event's own tier
   * count. Skips validation when the event has no tiers yet (e.g. a legacy
   * event never run through admin tier setup) — same "nothing to validate
   * against" behavior the old participantCount-based check had.
   */
  private async assertTierConfigurationFitsTierCount(
    sportEventId: string | null | undefined,
    configuration: ContestConfigurationRequest,
  ): Promise<void> {
    if (configuration.mode !== GolfContestConfigMode.GOLF_TIERED || !sportEventId) {
      return;
    }
    const tiers = await this.golfTierService.getEffectiveTiersForSportEvent(sportEventId);
    if (tiers.length === 0) {
      return;
    }
    assertRosterSizeFitsTierCount(configuration, tiers.length);
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
  _configuration: ContestConfigurationRequest,
): SelectionType {
  // GOLF_TIERED is the only managed configuration mode (plans/124 §4.11 removed
  // the GOLF_CATEGORY_PICKS stub); every managed contest is tier-selected.
  return SelectionType.TIERED;
}

/**
 * Tiers are event-owned (plans/124 §4.6) — the contest only ever supplies
 * rosterSize/countedScores, so the only thing left to validate against the
 * event's tier structure is that rosterSize divides evenly across however
 * many tiers the event has (one or more picks per tier, never a partial
 * one) and that countedScores doesn't exceed rosterSize.
 */
function assertRosterSizeFitsTierCount(
  configuration: ContestConfigurationRequest,
  tierCount: number,
): void {
  if (configuration.mode !== GolfContestConfigMode.GOLF_TIERED || tierCount === 0) {
    return;
  }

  if (configuration.rosterSize % tierCount !== 0) {
    throw new ContestManagementError(
      `rosterSize (${configuration.rosterSize}) must divide evenly across the event's ${tierCount} tier(s).`,
      'CONTEST_TIER_FIELD_OUT_OF_RANGE',
    );
  }
  if (configuration.countedScores > configuration.rosterSize) {
    throw new ContestManagementError(
      `countedScores (${configuration.countedScores}) cannot exceed rosterSize (${configuration.rosterSize}).`,
      'CONTEST_TIER_FIELD_OUT_OF_RANGE',
    );
  }
}

async function deriveLegacyPersistenceFields(
  configuration: ContestConfigurationRequest,
): Promise<Partial<ContestConfiguration>> {
  // Tiers are event-owned, never a per-contest override (plans/124 §4.6) —
  // golf-tier-service.getEffectiveTiersForContest is the one path to a
  // contest's effective tiers now; this function no longer computes or
  // persists a contest-specific tierConfig snapshot. GOLF_TIERED is the only
  // managed configuration mode (plans/124 §4.11 removed GOLF_CATEGORY_PICKS).
  return {
    pickCount: configuration.rosterSize,
    rosterSize: configuration.rosterSize,
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

/**
 * cutRule/playoffHandling/displayScoring/tiebreaker dropped (plans/124
 * §4.6a) — each was locked to exactly one possible value and had zero real
 * reads downstream (verified: nothing in golf-contest-settlement-service.ts
 * or golf-leaderboard-calculator.ts reads this config blob). The
 * participantScoringRule row is still created — syncDerivedScoring's
 * caller relies on the row existing — it just carries no config now.
 */
function buildParticipantScoringConfig(
  _configuration: GolfContestConfig,
): Record<string, unknown> {
  return {};
}

function buildAggregationRule(_configuration: GolfContestConfig): {
  aggregationDefinitionId: 'SUM_ALL_ENTRIES';
  config: Record<string, unknown>;
  active: boolean;
} {
  // GOLF_TIERED is the only managed configuration mode (plans/124 §4.11 removed
  // the GOLF_CATEGORY_PICKS stub); every managed contest sums entry totals with
  // lower-is-better golf scoring.
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
  effectiveTiers: GolfEffectiveTierDto[],
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
    effectiveTiers,
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
    // Tier definitions themselves are event-owned now (plans/124 §4.6) —
    // golf-tier-service.getEffectiveTiersForContest is the one path to
    // them; this fallback (for a contest with no typed configJson, e.g. one
    // created through the legacy tierConfig-based create path) only needs
    // to synthesize the trimmed { mode, rosterSize, countedScores } shape.
    return {
      mode: GolfContestConfigMode.GOLF_TIERED,
      locksAt: configuration.locksAt?.toISOString() ?? null,
      maxEntriesPerSquad: configuration.maxEntriesPerSquad ?? null,
      rosterSize: configuration.rosterSize ?? configuration.pickCount ?? 6,
      countedScores: Math.min(
        configuration.rosterSize ?? configuration.pickCount ?? 4,
        4,
      ),
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
