import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ContestRepository,
  ParticipantContestScoringRuleRepository,
} from '@poolmaster/shared/db';
import type { SportEventTierService } from '../events/sport-event-tier-service';
import type {
  ContestManagementDetailDto,
  ContestConfigurationRequest,
  CreateContestRequest,
  GolfEffectiveTierDto,
  UpdateContestConfigurationRequest,
} from '@poolmaster/shared/dto';
import {
  CONTEST_CONFIGURATION_LOCKED,
  CONTEST_CONFIGURATION_REQUIRED,
  CONTEST_EVENT_ALREADY_STARTED,
  CONTEST_NOT_DRAFT,
} from '@poolmaster/shared/dto';
import type {
  ContestConfigTemplate,
  ContestConfiguration,
  GolfContestConfig,
  SportEventStatus,
  TournamentFormat,
} from '@poolmaster/shared/domain';
import {
  ContestFormat,
  ContestStatus,
  ScoringEngine,
  SelectionType,
  Sport,
  isContestFormatValidForTournamentFormat,
} from '@poolmaster/shared/domain';
import { toGolfEffectiveTierDtoList } from '../../mappers/contest-management.mapper';
import { evaluateEventOperationalState, hasSportEventStarted } from '../events/operational-timing';

interface CreateContestManagementContext {
  leagueId: string;
}

type LifecycleLogger = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn' | 'error' | 'fatal'>;

export interface ContestCreateSportEventState {
  id: string;
  status: SportEventStatus;
  startDate: Date;
  sport: Sport;
  tournamentFormat: TournamentFormat;
  participantCount: number | null;
  loadedParticipantCount: number;
}

export interface ContestCreateSportEventReader {
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
    private readonly contestRepo: ContestRepository,
    private readonly contestConfigTemplateRepo: ContestConfigTemplateRepository,
    private readonly contestConfigurationRepo: ContestConfigurationRepository,
    private readonly participantContestScoringRuleRepo: ParticipantContestScoringRuleRepository,
    private readonly sportEventTierService: SportEventTierService,
    private readonly logger: LifecycleLogger = createNoopLogger(),
    private readonly sportEventReader?: ContestCreateSportEventReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * The one way a contest is created (#245). The configuration comes from the named template,
   * from `configuration`, or from both — the template seeding it and `configuration` replacing
   * it. Returns the new contest's id; the route answers with the canonical contest read.
   */
  async createContest(
    context: CreateContestManagementContext,
    input: CreateContestRequest,
  ): Promise<string> {
    this.logger.debug({
      leagueId: context.leagueId,
      sportEventId: input.sportEventId,
      contestFormat: input.contestFormat,
      selectionType: input.selectionType,
      hasTemplate: input.templateId !== undefined,
      hasConfiguration: input.configuration !== undefined,
    }, 'contest create start');
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
    const { selectionType } = input;
    const contest = await this.contestRepo.create({
      leagueId: context.leagueId,
      sportEventId: input.sportEventId,
      name: input.name,
      // A new contest is the commissioner's draft (#117): only they see it, nobody can enter,
      // and its settings stay editable until they open it to the league.
      status: ContestStatus.DRAFT,
      contestFormat: input.contestFormat,
      selectionType,
      scoringEngine: ScoringEngine.STROKE_PLAY,
    });

    const configuration = await this.contestConfigurationRepo.create({
      contestId: contest.id,
      templateId: resolvedConfiguration.template?.id,
      templateVersion: resolvedConfiguration.template?.schemaVersion,
      selectionType,
      configJson: toStoredGolfConfig(resolvedConfiguration.configuration),
      maxEntriesPerSquad:
        resolvedConfiguration.configuration.maxEntriesPerSquad === null
          ? null
          : resolvedConfiguration.configuration.maxEntriesPerSquad,
      ...deriveLegacyPersistenceFields(resolvedConfiguration.configuration),
    });

    await syncDerivedScoring(
      configuration,
      this.participantContestScoringRuleRepo,
    );

    this.logger.info({
      contestId: contest.id,
      leagueId: context.leagueId,
      selectionType,
      templateId: resolvedConfiguration.template?.id ?? null,
    }, 'contest create completed');

    return contest.id;
  }

  /**
   * Read-only echo of the tier structure the contest inherits from its
   * linked SportEvent (plans/124 §4.6/§5.3). Tiers are event-owned — there
   * is no per-contest override — so every ContestManagementDetailDto carries
   * this so the commissioner UI can show what was inherited without a mode
   * flag. Reads through the same SportEventTierService resolution the root-admin
   * tier routes use. Returns [] when the contest has no linked event or the
   * event has no tiers defined yet.
   */
  private async resolveEffectiveTiers(
    sportEventId: string | null | undefined,
  ): Promise<GolfEffectiveTierDto[]> {
    if (!sportEventId) {
      return [];
    }
    const tiers = await this.sportEventTierService.getEffectiveTiersForSportEvent(sportEventId);
    return toGolfEffectiveTierDtoList(tiers);
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
    const contest = await this.contestRepo.findById(contestId);
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
      selectionType: configuration.selectionType,
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
    this.logger.debug({ contestId }, 'contest management update configuration start');
    const configuration = await this.contestConfigurationRepo.findByContest(
      contestId,
    );
    if (!configuration) {
      this.logger.warn({ contestId }, 'contest management update configuration missing configuration');
      throw new ContestManagementError('Contest configuration not found', 'CONTEST_NOT_FOUND', 404);
    }

    const contest = await this.contestRepo.findById(contestId);
    if (!contest) {
      this.logger.warn({ contestId }, 'contest management update configuration missing contest');
      throw new ContestManagementError('Contest not found', 'CONTEST_NOT_FOUND', 404);
    }
    // Only a draft's configuration can change (#117). Once the contest is open to the league,
    // members enter against these rules, so they are locked for good — there is no path back:
    // OverrideService.reopenContest returns a contest to ACTIVE, never to DRAFT.
    if (contest.status !== ContestStatus.DRAFT) {
      this.logger.warn({ contestId, status: contest.status }, 'contest management update configuration refused for a contest that is not a draft');
      throw new ContestManagementError(
        'This contest is open to the league, so its settings are locked.',
        CONTEST_CONFIGURATION_LOCKED,
        409,
      );
    }
    await this.assertTierConfigurationFitsSportEvent(contest.sportEventId, input);

    await this.contestConfigurationRepo.update(configuration.id, {
      configJson: toStoredGolfConfig(input),
      maxEntriesPerSquad:
        input.maxEntriesPerSquad === null ? null : input.maxEntriesPerSquad,
      ...deriveLegacyPersistenceFields(input),
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
    );

    this.logger.info({
      contestId,
      selectionType: refreshedConfiguration.selectionType,
    }, 'contest management update configuration completed');
    return buildContestManagementDetail(
      contest,
      refreshedConfiguration,
      await this.resolveEffectiveTiers(contest.sportEventId),
    );
  }

  /**
   * "Open to league" (#117): the commissioner releases a draft contest, DRAFT → OPEN, and
   * members can enter it. There is no undo. Refused when the contest is not a draft, when its
   * event has started, or when its stored configuration no longer fits the event's tiers.
   * The field need not be ready: entries already wait on it.
   */
  async openContest(leagueId: string, contestId: string): Promise<ContestManagementDetailDto> {
    this.logger.debug({ leagueId, contestId }, 'contest management open contest start');
    const contest = await this.contestRepo.findById(contestId);
    // The route's gate proves the caller commissions `leagueId`; a contest in another league is
    // not theirs to open, and answers as missing.
    if (!contest || contest.leagueId !== leagueId) {
      this.logger.warn({ leagueId, contestId }, 'contest management open contest missing contest');
      throw new ContestManagementError('Contest not found', 'CONTEST_NOT_FOUND', 404);
    }
    if (contest.status !== ContestStatus.DRAFT) {
      this.logger.warn({ contestId, status: contest.status }, 'contest management open contest refused for a contest that is not a draft');
      throw contestNotDraftError();
    }
    const configuration = await this.contestConfigurationRepo.findByContest(contestId);
    if (!configuration) {
      this.logger.warn({ contestId }, 'contest management open contest missing configuration');
      throw new ContestManagementError('Contest configuration not found', 'CONTEST_NOT_FOUND', 404);
    }

    await this.assertSportEventNotStarted(contestId, contest.sportEventId);
    await this.assertTierConfigurationFitsSportEvent(
      contest.sportEventId,
      ensureTypedConfiguration(configuration),
    );

    // Compare-and-set: of two presses racing, only one moves the contest.
    const opened = await this.contestRepo.transitionStatus(contestId, {
      from: [ContestStatus.DRAFT],
      to: ContestStatus.OPEN,
    });
    if (!opened) {
      this.logger.warn({ contestId }, 'contest management open contest lost the race to another transition');
      throw contestNotDraftError();
    }
    this.onContestOpened(contest.id, contest.leagueId);

    return this.getContest(contestId);
  }

  /**
   * The seam for telling the league a contest has opened (#117). The League Feed post and the
   * member email attach here when they are built; today it only records the fact.
   */
  private onContestOpened(contestId: string, leagueId: string): void {
    this.logger.info({ contestId, leagueId }, 'contest opened to league');
  }

  private async assertSportEventNotStarted(
    contestId: string,
    sportEventId: string | undefined,
  ): Promise<void> {
    if (!this.sportEventReader || !sportEventId) {
      return;
    }
    const sportEvent = await this.sportEventReader.findById(sportEventId);
    if (!sportEvent) {
      this.logger.warn({ contestId, sportEventId }, 'contest management open contest missing sport event');
      throw new ContestManagementError(
        'Selected sporting event was not found.',
        'SPORT_EVENT_NOT_FOUND',
        404,
      );
    }
    if (hasSportEventStarted(sportEvent, this.now())) {
      this.logger.warn({
        contestId,
        sportEventId,
        status: sportEvent.status,
        startDate: sportEvent.startDate.toISOString(),
      }, 'contest management open contest refused for an event that has started');
      throw new ContestManagementError(
        'This contest\'s event has already started, so it can no longer be opened.',
        CONTEST_EVENT_ALREADY_STARTED,
        409,
      );
    }
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
      status: sportEvent.status,
      startDate: sportEvent.startDate,
      participantCount: sportEvent.loadedParticipantCount,
      now: this.now(),
    });

    if (operationalState.readinessReasons.includes('EVENT_NOT_RELEASED')) {
      this.logger.warn({
        sportEventId,
        status: sportEvent.status,
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

    if (operationalState.readinessReasons.includes('EVENT_STARTED')) {
      this.logger.warn({
        sportEventId,
        status: sportEvent.status,
        startDate: sportEvent.startDate.toISOString(),
      }, 'contest management create contest rejected for a sport event that has started');
      throw new ContestManagementError(
        'Selected sporting event has already started, so contests can no longer be created on it.',
        'SPORT_EVENT_ALREADY_STARTED',
      );
    }

    return sportEvent;
  }

  private async assertTierConfigurationFitsSportEvent(
    sportEventId: string | undefined,
    configuration: ContestConfigurationRequest,
  ): Promise<void> {
    if (!this.sportEventReader || !sportEventId) {
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
    if (!sportEventId) {
      return;
    }
    const tiers = await this.sportEventTierService.getEffectiveTiersForSportEvent(sportEventId);
    if (tiers.length === 0) {
      return;
    }
    assertRosterSizeFitsTierCount(configuration, tiers.length);
  }
}

function contestNotDraftError(): ContestManagementError {
  return new ContestManagementError(
    'This contest is already open to the league.',
    CONTEST_NOT_DRAFT,
    409,
  );
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
  if (tierCount === 0) {
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

function deriveLegacyPersistenceFields(
  configuration: ContestConfigurationRequest,
): Partial<ContestConfiguration> {
  // Tiers are event-owned, never a per-contest override (plans/124 §4.6) —
  // SportEventTierService.getEffectiveTiersForSportEvent is the one path to a
  // contest's effective tiers now; this function no longer computes or
  // persists a contest-specific tierConfig snapshot.
  return {
    pickCount: configuration.rosterSize,
    rosterSize: configuration.rosterSize,
    isExclusive: false,
  };
}

async function syncDerivedScoring(
  configuration: ContestConfiguration,
  participantRuleRepo: ParticipantContestScoringRuleRepository,
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
}

/**
 * cutRule/playoffHandling/displayScoring/tiebreaker dropped (plans/124
 * §4.6a) — each was locked to exactly one possible value and had zero real
 * reads downstream (verified: nothing in golf-contest-settlement-service.ts
 * or contest-leaderboard-calculator.ts reads this config blob). The
 * participantScoringRule row is still created — syncDerivedScoring's
 * caller relies on the row existing — it just carries no config now.
 */
function buildParticipantScoringConfig(
  _configuration: GolfContestConfig,
): Record<string, unknown> {
  return {};
}

function buildContestManagementDetail(
  contest: {
    id: string;
    leagueId: string;
    sportEventId?: string;
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
    configJson?: GolfContestConfig;
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
    // Every contest the one create makes has an event (#245); only rows from before it can lack
    // one. The response field is a required string, and the serializer always rendered a missing
    // value as "" — kept as is here rather than hidden behind a cast.
    sportEventId: contest.sportEventId ?? '',
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

/**
 * The part of a configuration request that configJson stores: GolfContestConfig's own fields.
 * The entry cap has its own column, so a copy here could only drift from it. Rows saved before
 * #416 kept the whole request, a lock time included, and reading through this drops those keys.
 */
function toStoredGolfConfig(configuration: GolfContestConfig): GolfContestConfig {
  return {
    rosterSize: configuration.rosterSize,
    countedScores: configuration.countedScores,
  };
}

function ensureTypedConfiguration(configuration: {
  configJson?: GolfContestConfig;
  maxEntriesPerSquad?: number | null;
  selectionType: string;
  rosterSize?: number;
  pickCount?: number;
  tierConfig?: unknown;
}): GolfContestConfig & {
  maxEntriesPerSquad?: number | null;
} {
  if (configuration.configJson) {
    return {
      ...toStoredGolfConfig(configuration.configJson),
      maxEntriesPerSquad: configuration.maxEntriesPerSquad ?? null,
    };
  }

  if (configuration.selectionType === SelectionType.TIERED) {
    // Tier definitions themselves are event-owned now (plans/124 §4.6) —
    // SportEventTierService.getEffectiveTiersForSportEvent is the one path to
    // them; this fallback (for a contest with no typed configJson, e.g. one
    // created through the legacy tierConfig-based create path) only needs
    // to synthesize the trimmed { rosterSize, countedScores } shape.
    return {
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
  input: CreateContestRequest,
  templateRepo: ContestConfigTemplateRepository,
): Promise<{
  template?: ContestConfigTemplate;
  configuration: ContestConfigurationRequest;
}> {
  if (input.templateId === undefined) {
    if (input.configuration === undefined) {
      // The route's refine refuses this first; kept so the service holds the rule on its own.
      throw new ContestManagementError(
        'Name a template, supply a configuration, or both.',
        CONTEST_CONFIGURATION_REQUIRED,
        400,
      );
    }
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

  if (template.selectionType !== input.selectionType) {
    throw new ContestManagementError(
      'Contest configuration template does not match the requested selection type',
    );
  }

  return {
    template,
    configuration: input.configuration ?? (template.configJson as ContestConfigurationRequest),
  };
}
