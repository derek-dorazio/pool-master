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
} from '@poolmaster/shared/dto';
import {
  CONTEST_BUDGET_UNFILLABLE,
  CONTEST_CONFIGURATION_LOCKED,
  CONTEST_CONFIGURATION_REQUIRED,
  CONTEST_EVENT_NOT_PRICED,
  CONTEST_EVENT_ALREADY_STARTED,
  CONTEST_NOT_DRAFT,
} from '@poolmaster/shared/dto';
import type {
  BudgetContestConfig,
  BudgetContestRules,
  ContestConfigTemplate,
  ContestConfiguration,
  ContestRules,
  ContestSelectionConfig,
  SportEventStatus,
  TieredContestRules,
  TournamentFormat,
} from '@poolmaster/shared/domain';
import {
  ContestFormat,
  ContestStatus,
  ScoringEngine,
  SelectionType,
  Sport,
  canFillBudgetRoster,
  getTieredRosterSize,
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
  /** The salary cap the event's field was priced against, or null when it never was (#93). */
  salaryCap: number | null;
}

export interface ContestCreateSportEventReader {
  findById(
    sportEventId: string,
  ): Promise<ContestCreateSportEventState | null>;
  /** The prices of the event's active golfers, in whole dollars; unpriced golfers are left out. */
  findActiveFieldPrices(sportEventId: string): Promise<number[]>;
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
    const { selectionType } = input;
    assertRulesMatchSelectionType(resolvedConfiguration.configuration, selectionType);
    const configJson = await this.resolveContestRules(input.sportEventId, resolvedConfiguration.configuration);
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
      configJson,
      maxEntriesPerSquad:
        resolvedConfiguration.configuration.maxEntriesPerSquad === null
          ? null
          : resolvedConfiguration.configuration.maxEntriesPerSquad,
      isExclusive: false,
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
    input: ContestConfigurationRequest,
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
    // members enter against these rules, so they are locked for good: nothing returns a contest
    // to DRAFT.
    if (contest.status !== ContestStatus.DRAFT) {
      this.logger.warn({ contestId, status: contest.status }, 'contest management update configuration refused for a contest that is not a draft');
      throw new ContestManagementError(
        'This contest is open to the league, so its settings are locked.',
        CONTEST_CONFIGURATION_LOCKED,
        409,
      );
    }
    assertRulesMatchSelectionType(input, configuration.selectionType);
    const configJson = await this.resolveContestRules(contest.sportEventId, input);

    await this.contestConfigurationRepo.update(configuration.id, {
      configJson,
      maxEntriesPerSquad:
        input.maxEntriesPerSquad === null ? null : input.maxEntriesPerSquad,
      isExclusive: false,
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
    // The event may have changed since the rules were saved: its tiers, or which golfers are
    // still in the field. Rules nobody could enter are refused here too.
    await this.resolveContestRules(contest.sportEventId, ensureTypedConfiguration(configuration));

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

  /**
   * The rules a contest stores, checked against its event (#93): one arm per selection type.
   * Create, rules changes and opening all come through here, so each holds the same rules.
   */
  private async resolveContestRules(
    sportEventId: string | undefined,
    rules: ContestRules,
  ): Promise<ContestSelectionConfig> {
    const sportEvent = await this.findRulesSportEvent(sportEventId);
    switch (rules.selectionType) {
      case SelectionType.TIERED:
        await this.assertTieredRulesFitTierCount(sportEventId, rules);
        return {
          selectionType: rules.selectionType,
          picksPerTier: rules.picksPerTier,
          countedScores: rules.countedScores,
        };
      case SelectionType.BUDGET_PICK:
        return this.resolveBudgetRules(sportEventId, sportEvent, rules);
    }
  }

  private async findRulesSportEvent(
    sportEventId: string | undefined,
  ): Promise<ContestCreateSportEventState | null> {
    if (!this.sportEventReader || !sportEventId) {
      return null;
    }

    const sportEvent = await this.sportEventReader.findById(sportEventId);
    if (!sportEvent) {
      this.logger.warn({ sportEventId }, 'contest management rules validation missing sport event');
      throw new ContestManagementError(
        'Selected sporting event was not found.',
        'SPORT_EVENT_NOT_FOUND',
        404,
      );
    }
    return sportEvent;
  }

  /**
   * Tiers are event-owned data now (plans/124 §4.6) — there's no per-contest
   * custom list to validate against, only the event's own tier count. Skips validation when the event has no tiers yet (e.g. a legacy
   * event never run through admin tier setup) — same "nothing to validate
   * against" behavior the old participantCount-based check had.
   */
  private async assertTieredRulesFitTierCount(
    sportEventId: string | undefined,
    rules: TieredContestRules,
  ): Promise<void> {
    if (!sportEventId) {
      return;
    }
    const tiers = await this.sportEventTierService.getEffectiveTiersForSportEvent(sportEventId);
    if (tiers.length === 0) {
      return;
    }
    assertCountedScoresFitRoster(rules, tiers.length);
  }

  /**
   * Budget rules take the event's salary cap, so the event must have been priced, and the
   * cheapest roster of `rosterSize` active golfers must fit under it: a contest nobody could
   * submit an entry to is refused here, not discovered by its members.
   */
  private async resolveBudgetRules(
    sportEventId: string | undefined,
    sportEvent: ContestCreateSportEventState | null,
    rules: BudgetContestRules,
  ): Promise<BudgetContestConfig> {
    if (rules.countedScores > rules.rosterSize) {
      throw new ContestManagementError(
        `countedScores (${rules.countedScores}) cannot exceed the roster of ${rules.rosterSize}.`,
        'CONTEST_BUDGET_FIELD_OUT_OF_RANGE',
      );
    }
    if (!sportEventId || !sportEvent || sportEvent.salaryCap === null || !this.sportEventReader) {
      this.logger.warn({ sportEventId: sportEventId ?? null }, 'contest management budget rules refused for an unpriced event');
      throw new ContestManagementError(
        'This event\'s golfers have no prices, so it can\'t run a budget contest.',
        CONTEST_EVENT_NOT_PRICED,
        409,
      );
    }
    const { salaryCap } = sportEvent;
    const prices = await this.sportEventReader.findActiveFieldPrices(sportEventId);
    if (!canFillBudgetRoster(prices, rules.rosterSize, salaryCap)) {
      this.logger.warn({
        sportEventId,
        rosterSize: rules.rosterSize,
        salaryCap,
        pricedGolferCount: prices.length,
      }, 'contest management budget rules refused for a roster nobody could afford');
      throw new ContestManagementError(
        `No ${rules.rosterSize} golfers in this event's field fit under its $${salaryCap.toLocaleString('en-US')} salary cap. Pick a smaller roster.`,
        CONTEST_BUDGET_UNFILLABLE,
        409,
      );
    }
    return {
      selectionType: rules.selectionType,
      rosterSize: rules.rosterSize,
      salaryCap,
      countedScores: rules.countedScores,
    };
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
 * Tiers are event-owned (plans/124 §4.6) and every tier takes the contest's
 * picksPerTier (#479), so the roster is the event's tier count times
 * picksPerTier. The only thing left to validate against the event is that
 * countedScores doesn't exceed that roster.
 */
function assertCountedScoresFitRoster(
  configuration: TieredContestRules,
  tierCount: number,
): void {
  const rosterSize = getTieredRosterSize(tierCount, configuration.picksPerTier);
  if (configuration.countedScores > rosterSize) {
    throw new ContestManagementError(
      `countedScores (${configuration.countedScores}) cannot exceed the roster of ${rosterSize} (${tierCount} tier(s) × ${configuration.picksPerTier} pick(s) per tier).`,
      'CONTEST_TIER_FIELD_OUT_OF_RANGE',
    );
  }
}

/**
 * A contest's rules are its own selection type's shape: tiered rules on a budget contest would
 * be read as nonsense by every engine downstream.
 */
function assertRulesMatchSelectionType(rules: ContestRules, selectionType: SelectionType): void {
  if (rules.selectionType !== selectionType) {
    throw new ContestManagementError(
      `This contest is ${selectionType}, so its rules must be ${selectionType} rules, not ${rules.selectionType}.`,
      'CONTEST_RULES_SELECTION_TYPE_MISMATCH',
    );
  }
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
  _configuration: ContestSelectionConfig,
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
    configJson?: ContestSelectionConfig;
    maxEntriesPerSquad?: number | null;
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
 * A configuration's typed rules. Every tiered and budget configuration carries them: the one
 * create writes them, and #479's and #93's migrations wrote them for older rows.
 */
function ensureTypedConfiguration(configuration: {
  configJson?: ContestSelectionConfig;
  maxEntriesPerSquad?: number | null;
}): ContestSelectionConfig & {
  maxEntriesPerSquad: number | null;
} {
  if (configuration.configJson) {
    return {
      ...configuration.configJson,
      maxEntriesPerSquad: configuration.maxEntriesPerSquad ?? null,
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
    configuration: input.configuration ?? template.configJson,
  };
}
