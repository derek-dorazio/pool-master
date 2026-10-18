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
  ContestManagementSportEventDto,
  ContestConfigurationRequest,
  CreateContestRequest,
  ApiErrorCode,
} from '@poolmaster/shared/dto';
import {
  CONTEST_BUDGET_FIELD_OUT_OF_RANGE,
  CONTEST_BUDGET_SALARY_CAP_MISMATCH,
  CONTEST_DRAW_FIELD_OUT_OF_RANGE,
  CONTEST_DRAW_SINGLE_EVENT,
  CONTEST_EVENTS_LEAGUE_MISMATCH,
  CONTEST_EVENTS_LOCKED,
  CONTEST_BUDGET_UNFILLABLE,
  CONTEST_CONFIGURATION_LOCKED,
  CONTEST_CONFIGURATION_REQUIRED,
  CONTEST_CONFIG_TEMPLATE_LEAGUE_MISMATCH,
  CONTEST_EVENT_NOT_PRICED,
  CONTEST_EVENT_ALREADY_STARTED,
  CONTEST_NOT_DRAFT,
  CONTEST_RULES_SELECTION_TYPE_MISMATCH,
  CONTEST_SCORING_DEFINITION_NOT_ALLOWED,
  CONTEST_SCORING_ROUNDS_MISMATCH,
  CONTEST_SCORING_SETTINGS_REQUIRED,
  CONTEST_SELECTION_TYPE_NOT_ALLOWED,
} from '@poolmaster/shared/dto';
import type {
  BudgetContestConfig,
  BudgetContestRules,
  Contest,
  ContestConfigTemplate,
  ContestConfiguration,
  ContestRules,
  ContestScoringSettings,
  ContestSelectionConfig,
  ParticipantContestScoringRule,
  ParticipantScoringDefinitionId,
  SportEventStatus,
  TieredContestRules,
  TournamentFormat,
  Sport,
} from '@poolmaster/shared/domain';
import {
  ContestStatus,
  SelectionType,
  assertNever,
  canFillBudgetRoster,
  getSportDefinition,
  sportAllowsSelectionType,
  getTieredRosterSize,
  isContestFormatValidForTournamentFormat,
} from '@poolmaster/shared/domain';
import { toEffectiveTierDtoList } from '../../mappers/contest-management.mapper';
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
  /** The event's sport league, read through its series. */
  sportLeagueId: string;
  tournamentFormat: TournamentFormat;
  participantCount: number | null;
  loadedParticipantCount: number;
  /** The event's round count, which a knockout round-points table must match (#699); null when unset. */
  rounds: number | null;
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
    private readonly sportEventReader: ContestCreateSportEventReader,
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
      sportEventIds: input.sportEventIds,
      contestFormat: input.contestFormat,
      selectionType: input.selectionType,
      hasTemplate: input.templateId !== undefined,
      hasConfiguration: input.configuration !== undefined,
    }, 'contest create start');
    const resolvedConfiguration = await resolveCreateConfiguration(
      input,
      this.contestConfigTemplateRepo,
    );
    const sportEvents = await this.assertSportEventsContestEligible(input.sportEventIds);
    const sportEvent = this.assertOneSportLeague(sportEvents);
    const templateLeagueId = resolvedConfiguration.template?.sportLeagueId ?? null;
    if (templateLeagueId !== null && templateLeagueId !== sportEvent.sportLeagueId) {
      this.logger.warn({
        sportEventId: sportEvent.id,
        eventSportLeagueId: sportEvent.sportLeagueId,
        templateId: resolvedConfiguration.template?.id,
        templateSportLeagueId: templateLeagueId,
      }, 'contest management create contest rejected for another league\'s template');
      throw new ContestManagementError(
        'That template is another sport league\'s preset; it is offered only for that league\'s events.',
        CONTEST_CONFIG_TEMPLATE_LEAGUE_MISMATCH,
      );
    }
    if (
      !isContestFormatValidForTournamentFormat(
        sportEvent.tournamentFormat,
        input.contestFormat,
      )
    ) {
      this.logger.warn({
        sportEventId: sportEvent.id,
        sport: sportEvent.sport,
        tournamentFormat: sportEvent.tournamentFormat,
        contestFormat: input.contestFormat,
      }, 'contest management create contest rejected for invalid sport contest format');
      throw new ContestManagementError(
        'Selected sporting event does not support that contest format.',
        'CONTEST_FORMAT_NOT_ALLOWED',
      );
    }
    const { selectionType } = input;
    assertRulesMatchSelectionType(resolvedConfiguration.configuration, selectionType);
    this.assertEventCountFitsSelectionType(selectionType, sportEvents.length);
    const { configJson, scoring } = await this.resolveContestRules(
      sportEvents,
      resolvedConfiguration.configuration,
      { requested: resolvedConfiguration.scoring, kept: null },
    );
    const contest = await this.contestRepo.create({
      leagueId: context.leagueId,
      sportEventIds: orderContestEvents(sportEvents),
      name: input.name,
      // A new contest is the commissioner's draft (#117): only they see it, nobody can enter,
      // and its settings stay editable until they open it to the league.
      status: ContestStatus.DRAFT,
      contestFormat: input.contestFormat,
      selectionType,
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
    });

    await syncDerivedScoring(
      configuration,
      scoring,
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
   * Read-only echo of the tier structure the contest inherits from each of its events
   * (plans/124 §4.6/§5.3, per event since #713). Tiers are event-owned — there is no per-contest
   * override — so every ContestManagementDetailDto carries them so the commissioner UI can show
   * what was inherited without a mode flag. Reads through the same SportEventTierService
   * resolution the root-admin tier routes use; an event with no tiers yet has an empty list.
   */
  private async resolveContestSportEvents(contest: Contest): Promise<ContestManagementSportEventDto[]> {
    return Promise.all(contest.sportEventIds.map(async (sportEventId) => ({
      sportEventId,
      effectiveTiers: toEffectiveTierDtoList(
        await this.sportEventTierService.getEffectiveTiersForSportEvent(sportEventId),
      ),
    })));
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
      await this.resolveContestSportEvents(contest),
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
    // A rules change that does not send scoring keeps the contest's (its points table, say).
    const { configJson, scoring } = await this.resolveContestRules(await this.findContestSportEvents(contest), input, {
      requested: input.scoring,
      kept: currentScoring(await this.participantContestScoringRuleRepo.findByContestConfiguration(configuration.id)),
    });

    await this.contestConfigurationRepo.update(configuration.id, {
      configJson,
      maxEntriesPerSquad:
        input.maxEntriesPerSquad === null ? null : input.maxEntriesPerSquad,
    });

    const refreshedConfiguration =
      await this.contestConfigurationRepo.findByContest(contestId);
    if (!refreshedConfiguration) {
      this.logger.error({ contestId }, 'contest management update configuration refresh missing configuration');
      throw new ContestManagementError('Contest configuration not found', 'CONTEST_NOT_FOUND', 404);
    }

    await syncDerivedScoring(
      refreshedConfiguration,
      scoring,
      this.participantContestScoringRuleRepo,
    );

    this.logger.info({
      contestId,
      selectionType: refreshedConfiguration.selectionType,
    }, 'contest management update configuration completed');
    return buildContestManagementDetail(
      contest,
      refreshedConfiguration,
      await this.resolveContestSportEvents(contest),
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

    const sportEvents = await this.findContestSportEvents(contest);
    this.assertNoSportEventStarted(contestId, sportEvents);
    // The events may have changed since the rules were saved: their tiers, or which golfers are
    // still in the field. Rules nobody could enter are refused here too.
    await this.resolveContestRules(sportEvents, ensureTypedConfiguration(configuration), {
      kept: currentScoring(await this.participantContestScoringRuleRepo.findByContestConfiguration(configuration.id)),
    });

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

  /**
   * "Events in this contest" (#713): sets the events the contest covers to `sportEventIds` and
   * returns the contest as getContest does. An added event must be eligible as at create
   * (released, field loaded, not started) and from the contest's sport league, and the contest's
   * rules must fit it. Events can be added while the contest is a draft, open or live; one can be
   * removed only while none of the contest's events has started, and removing it deletes the
   * picks made on it. The contest keeps its events in start-date order.
   */
  async setContestSportEvents(
    leagueId: string,
    contestId: string,
    sportEventIds: readonly string[],
  ): Promise<ContestManagementDetailDto> {
    this.logger.debug({ leagueId, contestId, sportEventIds }, 'contest management set sport events start');
    const contest = await this.contestRepo.findById(contestId);
    if (!contest || contest.leagueId !== leagueId) {
      this.logger.warn({ leagueId, contestId }, 'contest management set sport events missing contest');
      throw new ContestManagementError('Contest not found', 'CONTEST_NOT_FOUND', 404);
    }
    if (contest.status === ContestStatus.COMPLETED || contest.drawnAt !== undefined) {
      this.logger.warn({ contestId, status: contest.status, drawn: contest.drawnAt !== undefined }, 'contest management set sport events refused for a settled or drawn contest');
      throw new ContestManagementError(
        contest.drawnAt ? 'This contest\'s draw has been dealt, so its event can no longer change.' : 'This contest is finished, so its events can no longer change.',
        CONTEST_EVENTS_LOCKED,
        409,
      );
    }
    const configuration = await this.contestConfigurationRepo.findByContest(contestId);
    if (!configuration) {
      this.logger.warn({ contestId }, 'contest management set sport events missing configuration');
      throw new ContestManagementError('Contest configuration not found', 'CONTEST_NOT_FOUND', 404);
    }

    const current = await this.findContestSportEvents(contest);
    const requestedIds = [...new Set(sportEventIds)];
    const removed = current.filter((sportEvent) => !requestedIds.includes(sportEvent.id));
    const startedEvent = current.find((sportEvent) => hasSportEventStarted(sportEvent, this.now()));
    if (removed.length > 0 && startedEvent) {
      this.logger.warn({
        contestId,
        removedSportEventIds: removed.map((sportEvent) => sportEvent.id),
        startedSportEventId: startedEvent.id,
      }, 'contest management set sport events refused a removal once an event has started');
      throw new ContestManagementError(
        'One of this contest\'s events has started, so events can be added but not removed.',
        CONTEST_EVENTS_LOCKED,
        409,
      );
    }
    const kept = current.filter((sportEvent) => requestedIds.includes(sportEvent.id));
    const added = await this.assertSportEventsContestEligible(
      requestedIds.filter((sportEventId) => !current.some((sportEvent) => sportEvent.id === sportEventId)),
    );
    const sportEvents = [...kept, ...added];
    // The contest's league is its first event's; the new list must keep to it.
    const first = current.at(0);
    this.assertOneSportLeague(first ? [first, ...sportEvents] : sportEvents);
    this.assertEventCountFitsSelectionType(contest.selectionType, sportEvents.length);

    const storedRules = ensureTypedConfiguration(configuration);
    const { configJson } = await this.resolveContestRules(sportEvents, storedRules, {
      kept: currentScoring(await this.participantContestScoringRuleRepo.findByContestConfiguration(configuration.id)),
    });
    // Only a budget contest's rules depend on its events, through their salary cap. A draft takes
    // the new events' cap; an open contest's members entered under the old one.
    if (configJson.selectionType === SelectionType.BUDGET_PICK
      && storedRules.selectionType === SelectionType.BUDGET_PICK
      && configJson.salaryCap !== storedRules.salaryCap) {
      if (contest.status !== ContestStatus.DRAFT) {
        this.logger.warn({ contestId, salaryCap: storedRules.salaryCap, eventSalaryCap: configJson.salaryCap }, 'contest management set sport events refused another salary cap on an open contest');
        throw new ContestManagementError(
          `These events were priced against a $${configJson.salaryCap.toLocaleString('en-US')} salary cap, but this contest's entries are built under $${storedRules.salaryCap.toLocaleString('en-US')}.`,
          CONTEST_BUDGET_SALARY_CAP_MISMATCH,
          409,
        );
      }
      await this.contestConfigurationRepo.update(configuration.id, { configJson });
    }

    await this.contestRepo.replaceSportEvents(contestId, orderContestEvents(sportEvents));
    this.logger.info({
      contestId,
      sportEventIds: orderContestEvents(sportEvents),
      addedCount: added.length,
      removedCount: removed.length,
    }, 'contest management set sport events completed');
    return this.getContest(contestId);
  }

  /** The contest's events, in its sequence order; each must still exist. */
  private async findContestSportEvents(contest: Contest): Promise<ContestCreateSportEventState[]> {
    return Promise.all(contest.sportEventIds.map(async (sportEventId) => {
      const sportEvent = await this.sportEventReader.findById(sportEventId);
      if (!sportEvent) {
        this.logger.warn({ contestId: contest.id, sportEventId }, 'contest management contest event missing');
        throw new ContestManagementError(
          'Selected sporting event was not found.',
          'SPORT_EVENT_NOT_FOUND',
          404,
        );
      }
      return sportEvent;
    }));
  }

  private assertNoSportEventStarted(contestId: string, sportEvents: readonly ContestCreateSportEventState[]): void {
    const started = sportEvents.find((sportEvent) => hasSportEventStarted(sportEvent, this.now()));
    if (started) {
      this.logger.warn({
        contestId,
        sportEventId: started.id,
        status: started.status,
        startDate: started.startDate.toISOString(),
      }, 'contest management open contest refused for an event that has started');
      throw new ContestManagementError(
        'This contest\'s event has already started, so it can no longer be opened.',
        CONTEST_EVENT_ALREADY_STARTED,
        409,
      );
    }
  }

  /**
   * Every event of a contest is from one sport league (#713), so one sport's rules, templates and
   * scoring fit them all. Answers with the first event, whose league stands for the list.
   */
  private assertOneSportLeague(
    sportEvents: readonly ContestCreateSportEventState[],
  ): ContestCreateSportEventState {
    const first = sportEvents.at(0);
    if (!first) {
      throw new ContestManagementError('Choose at least one event for the contest.', 'SPORT_EVENT_NOT_FOUND', 404);
    }
    const other = sportEvents.find((sportEvent) => sportEvent.sportLeagueId !== first.sportLeagueId);
    if (other) {
      this.logger.warn({
        sportEventId: other.id,
        sportLeagueId: other.sportLeagueId,
        contestSportLeagueId: first.sportLeagueId,
      }, 'contest management events refused for mixing sport leagues');
      throw new ContestManagementError(
        'Every event in a contest must be from the same sport league.',
        CONTEST_EVENTS_LEAGUE_MISMATCH,
      );
    }
    return first;
  }

  /** A random draw deals one event's field (#601), so its contest covers exactly one (#713). */
  private assertEventCountFitsSelectionType(selectionType: SelectionType, eventCount: number): void {
    if (selectionType === SelectionType.RANDOM_DRAW && eventCount > 1) {
      this.logger.warn({ selectionType, eventCount }, 'contest management events refused: a random draw covers one event');
      throw new ContestManagementError(
        'A random-draw contest covers one event: the draw deals that event\'s field.',
        CONTEST_DRAW_SINGLE_EVENT,
      );
    }
  }

  private async assertSportEventsContestEligible(
    sportEventIds: readonly string[],
  ): Promise<ContestCreateSportEventState[]> {
    const eligible: ContestCreateSportEventState[] = [];
    for (const sportEventId of new Set(sportEventIds)) {
      eligible.push(await this.assertSportEventContestEligible(sportEventId));
    }
    return eligible;
  }

  private async assertSportEventContestEligible(
    sportEventId: string,
  ): Promise<ContestCreateSportEventState> {
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
   * The rules a contest stores, checked against its event (#93) and its sport's definition
   * (#602): one arm per selection type. Create, rules changes and opening all come through
   * here, so each holds the same rules. Also answers how the contest is scored
   * (`resolveContestScoring`).
   */
  private async resolveContestRules(
    sportEvents: readonly ContestCreateSportEventState[],
    rules: ContestRules,
    scoringInput: ContestScoringInput,
  ): Promise<{ configJson: ContestSelectionConfig; scoring: ContestScoringSettings }> {
    // One sport league, so one sport: the first event answers the sport's questions, and every
    // event is checked where the events can differ (tiers, prices, rounds).
    const sportEvent = this.assertOneSportLeague(sportEvents);
    const definition = getSportDefinition(sportEvent.sport);
    if (!sportAllowsSelectionType(definition, rules.selectionType)) {
      this.logger.warn({
        sportEventId: sportEvent.id,
        sport: sportEvent.sport,
        selectionType: rules.selectionType,
      }, 'contest management rules refused for a selection type the sport does not offer');
      throw new ContestManagementError(
        `A ${sportEvent.sport} contest can't use ${rules.selectionType} selection.`,
        CONTEST_SELECTION_TYPE_NOT_ALLOWED,
      );
    }
    const scoring = this.resolveContestScoring(sportEvent, scoringInput);
    for (const each of sportEvents) {
      this.assertScoringFitsEvent(each, scoring);
    }
    switch (rules.selectionType) {
      case SelectionType.TIERED:
        for (const each of sportEvents) {
          await this.assertTieredRulesFitTierCount(each.id, rules);
        }
        return {
          configJson: {
            selectionType: rules.selectionType,
            picksPerTier: rules.picksPerTier,
            countedScores: rules.countedScores,
          },
          scoring,
        };
      case SelectionType.BUDGET_PICK:
        return {
          configJson: await this.resolveBudgetRulesForEvents(sportEvents, rules),
          scoring,
        };
      case SelectionType.RANDOM_DRAW:
        // The field is checked against the entries when the draw runs (#601): until then nobody
        // knows how many entries it must deal to.
        if (rules.countedScores > rules.picksPerEntry) {
          throw new ContestManagementError(
            `countedScores (${rules.countedScores}) cannot exceed the ${rules.picksPerEntry} the draw deals each entry.`,
            CONTEST_DRAW_FIELD_OUT_OF_RANGE,
          );
        }
        return {
          configJson: {
            selectionType: rules.selectionType,
            picksPerEntry: rules.picksPerEntry,
            countedScores: rules.countedScores,
          },
          scoring,
        };
    }
  }

  /**
   * How a contest is scored: the scoring definition and settings it was sent (or its template
   * presets), else the ones it already has, else its sport's default definition with that
   * definition's default settings. The definition must be one the event's sport offers (422
   * CONTEST_SCORING_DEFINITION_NOT_ALLOWED). A definition whose settings have no default, such as
   * finish-position points, whose points table is the commissioner's choice, must be sent (422
   * CONTEST_SCORING_SETTINGS_REQUIRED). The settings themselves were parsed by their definition's
   * schema on the way in, so they are valid settings of that definition.
   */
  private resolveContestScoring(
    sportEvent: ContestCreateSportEventState,
    { requested, kept }: ContestScoringInput,
  ): ContestScoringSettings {
    const definition = getSportDefinition(sportEvent.sport);
    const offered = (id: ParticipantScoringDefinitionId) => definition.scoringDefinitions.includes(id);
    if (requested) {
      if (!offered(requested.participantScoringDefinitionId)) {
        this.logger.warn({
          sportEventId: sportEvent.id,
          sport: sportEvent.sport,
          participantScoringDefinitionId: requested.participantScoringDefinitionId,
        }, 'contest management scoring refused for a definition the sport does not offer');
        throw new ContestManagementError(
          `A ${sportEvent.sport} contest can't be scored by ${requested.participantScoringDefinitionId}.`,
          CONTEST_SCORING_DEFINITION_NOT_ALLOWED,
        );
      }
      return requested;
    }
    if (kept && offered(kept.participantScoringDefinitionId)) {
      return kept;
    }
    const defaultDefinitionId = definition.scoringDefinitions.at(0);
    if (defaultDefinitionId === undefined) {
      this.logger.warn({
        sportEventId: sportEvent.id,
        sport: sportEvent.sport,
      }, 'contest management scoring refused: the sport offers no scoring definition yet');
      throw new ContestManagementError(
        `A ${sportEvent.sport} contest can't be scored yet.`,
        CONTEST_SCORING_DEFINITION_NOT_ALLOWED,
      );
    }
    const defaults = defaultContestScoringSettings(defaultDefinitionId);
    if (!defaults) {
      this.logger.warn({
        sportEventId: sportEvent.id,
        sport: sportEvent.sport,
        participantScoringDefinitionId: defaultDefinitionId,
      }, 'contest management scoring refused: the definition needs settings and none were sent');
      throw new ContestManagementError(
        `A ${sportEvent.sport} contest is scored by ${defaultDefinitionId}, which needs its settings: send scoring, or create the contest from a template.`,
        CONTEST_SCORING_SETTINGS_REQUIRED,
      );
    }
    return defaults;
  }

  /**
   * Settings that must agree with the event (#699, design Q3.3): a knockout round-points table has
   * one value per round of the event, so a short table never quietly scores a late round as 0
   * (422 CONTEST_SCORING_ROUNDS_MISMATCH). The other definitions' settings fit any event.
   */
  private assertScoringFitsEvent(sportEvent: ContestCreateSportEventState, scoring: ContestScoringSettings): void {
    switch (scoring.participantScoringDefinitionId) {
      case 'GOLF_RELATIVE_TO_PAR_TOTAL':
      case 'FINISH_POSITION_POINTS':
        return;
      case 'KNOCKOUT_ROUND_POINTS': {
        const valueCount = scoring.config.roundValues.length;
        if (valueCount === sportEvent.rounds) {
          return;
        }
        this.logger.warn({
          sportEventId: sportEvent.id,
          rounds: sportEvent.rounds,
          roundValues: valueCount,
        }, 'contest management scoring refused: the round values do not match the event\'s rounds');
        throw new ContestManagementError(
          `The round values give ${valueCount} round(s), but the event has ${sportEvent.rounds ?? 'no'} rounds: give one value per round.`,
          CONTEST_SCORING_ROUNDS_MISMATCH,
        );
      }
      default:
        return assertNever(scoring);
    }
  }

  /**
   * Budget rules against every event of the contest (#713): each must fill the roster under its
   * cap, and they must share one cap, since the rules carry one.
   */
  private async resolveBudgetRulesForEvents(
    sportEvents: readonly ContestCreateSportEventState[],
    rules: BudgetContestRules,
  ): Promise<BudgetContestConfig> {
    const configs: BudgetContestConfig[] = [];
    for (const sportEvent of sportEvents) {
      configs.push(await this.resolveBudgetRules(sportEvent, rules));
    }
    const first = configs.at(0);
    if (!first || configs.some((config) => config.salaryCap !== first.salaryCap)) {
      this.logger.warn({
        salaryCaps: configs.map((config) => config.salaryCap),
      }, 'contest management budget rules refused for events priced against different caps');
      throw new ContestManagementError(
        'Every event in a budget contest must be priced against the same salary cap.',
        CONTEST_BUDGET_SALARY_CAP_MISMATCH,
        409,
      );
    }
    return first;
  }

  /**
   * Tiers are event-owned data now (plans/124 §4.6) — there's no per-contest
   * custom list to validate against, only the event's own tier count. Skips validation when the event has no tiers yet (e.g. a legacy
   * event never run through admin tier setup) — same "nothing to validate
   * against" behavior the old participantCount-based check had.
   */
  private async assertTieredRulesFitTierCount(
    sportEventId: string,
    rules: TieredContestRules,
  ): Promise<void> {
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
    sportEvent: ContestCreateSportEventState,
    rules: BudgetContestRules,
  ): Promise<BudgetContestConfig> {
    const sportEventId = sportEvent.id;
    if (rules.countedScores > rules.rosterSize) {
      throw new ContestManagementError(
        `countedScores (${rules.countedScores}) cannot exceed the roster of ${rules.rosterSize}.`,
        CONTEST_BUDGET_FIELD_OUT_OF_RANGE,
      );
    }
    if (sportEvent.salaryCap === null) {
      this.logger.warn({ sportEventId }, 'contest management budget rules refused for an unpriced event');
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
    readonly code: ApiErrorCode = 'CONTEST_CONFIGURATION_INVALID',
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
      CONTEST_RULES_SELECTION_TYPE_MISMATCH,
    );
  }
}

async function syncDerivedScoring(
  configuration: ContestConfiguration,
  scoring: ContestScoringSettings,
  participantRuleRepo: ParticipantContestScoringRuleRepository,
): Promise<void> {
  // A configuration without typed rules is refused before its scoring rule is replaced.
  ensureTypedConfiguration(configuration);
  const existingParticipantRules =
    await participantRuleRepo.findByContestConfiguration(configuration.id);
  await Promise.all(
    existingParticipantRules.map((rule) => participantRuleRepo.delete(rule.id)),
  );

  await participantRuleRepo.create({
    contestConfigurationId: configuration.id,
    sortOrder: 1,
    scoring,
    active: true,
  });
}

/**
 * The settings a contest's scoring rule is written with when nobody chose any, per scoring
 * definition: its `config` column, typed by `PARTICIPANT_SCORING_SETTINGS_SCHEMAS`. Golf's to-par
 * total takes none, so it writes the empty object. (cutRule/playoffHandling/displayScoring/
 * tiebreaker were dropped in plans/124 §4.6a: each was locked to one value and never changed a
 * score.) Finish-position and knockout round points have no default: the table is the
 * commissioner's choice, or the template's preset, never one the server picks (null).
 */
function defaultContestScoringSettings(
  participantScoringDefinitionId: ParticipantScoringDefinitionId,
): ContestScoringSettings | null {
  switch (participantScoringDefinitionId) {
    case 'GOLF_RELATIVE_TO_PAR_TOTAL':
      return { participantScoringDefinitionId, config: {} };
    // A points table, and a knockout table of one value per round of the event, come from the
    // commissioner or a template, never from the server.
    case 'FINISH_POSITION_POINTS':
    case 'KNOCKOUT_ROUND_POINTS':
      return null;
    default:
      return assertNever(participantScoringDefinitionId);
  }
}

/** What a contest's scoring is resolved from: the settings sent, and the ones it already has. */
interface ContestScoringInput {
  requested?: ContestScoringSettings;
  kept?: ContestScoringSettings | null;
}

/** A configuration's current scoring: its first active rule, when that rule reads as valid. */
function currentScoring(rules: readonly ParticipantContestScoringRule[]): ContestScoringSettings | null {
  const rule = [...rules]
    .filter((candidate) => candidate.active)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .at(0);
  return rule?.scoring.success ? rule.scoring.data : null;
}

/** The contest's events in sequence order: by start date, then id, so the order is stable. */
function orderContestEvents(sportEvents: readonly Pick<ContestCreateSportEventState, 'id' | 'startDate'>[]): string[] {
  return [...sportEvents]
    .sort((left, right) => left.startDate.getTime() - right.startDate.getTime() || left.id.localeCompare(right.id))
    .map((sportEvent) => sportEvent.id);
}

function buildContestManagementDetail(
  contest: {
    id: string;
    leagueId: string;
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
  sportEvents: ContestManagementSportEventDto[],
): ContestManagementDetailDto {
  const configJson = ensureTypedConfiguration(configuration);
  return {
    id: contest.id,
    leagueId: contest.leagueId,
    sportEvents,
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

/**
 * A create's configuration and scoring. The template seeds both, and the request's configuration
 * replaces its rules; the request's scoring, when sent, replaces the template's preset, and when
 * not, the preset still applies, so choosing a template and adjusting its rules keeps its points
 * table.
 */
async function resolveCreateConfiguration(
  input: CreateContestRequest,
  templateRepo: ContestConfigTemplateRepository,
): Promise<{
  template?: ContestConfigTemplate;
  configuration: ContestConfigurationRequest;
  scoring?: ContestScoringSettings;
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
    return { configuration: input.configuration, scoring: input.configuration.scoring };
  }

  const template = await templateRepo.findById(input.templateId);
  if (!template || !template.active) {
    throw new ContestManagementError('Contest configuration template not found');
  }

  if (template.selectionType !== input.selectionType) {
    throw new ContestManagementError(
      'Contest configuration template does not match the requested selection type',
    );
  }

  return {
    template,
    configuration: input.configuration ?? template.configJson,
    scoring: input.configuration?.scoring ?? template.configJson.scoring,
  };
}
