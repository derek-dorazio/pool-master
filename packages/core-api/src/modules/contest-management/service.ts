import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ContestRepository,
  ContestSeasonLimits,
  ParticipantContestScoringRuleRepository,
} from '@poolmaster/shared/db';
import type { SportEventTierGroup, SportEventTierService } from '../events/sport-event-tier-service';
import type { ContestOpenedNotice } from '../notifications/contest-notices';
import type { DomainEvents } from '../domain-events';
import { ContestLifecycle } from '../contests/contest-lifecycle';
import type { CupService } from '../cups/service';
import type { PlanEntitlementsService } from '../plans/plan-entitlements-service';
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
  CONTEST_BRACKET_SINGLE_EVENT,
  CONTEST_DRAW_SINGLE_EVENT,
  CONTEST_EVENTS_LEAGUE_MISMATCH,
  CONTEST_EVENTS_SEASON_MISMATCH,
  CONTEST_EVENTS_LOCKED,
  CONTEST_BUDGET_UNFILLABLE,
  CONTEST_CONFIGURATION_LOCKED,
  CONTEST_CONFIGURATION_REQUIRED,
  CONTEST_CONFIG_TEMPLATE_LEAGUE_MISMATCH,
  CONTEST_EVENT_NOT_PRICED,
  CONTEST_EVENT_ALREADY_STARTED,
  CONTEST_EVENT_GAME_UNDECIDED,
  CONTEST_EVENT_NOT_A_BRACKET,
  CONTEST_EVENT_HAS_NO_GAMES,
  CONTEST_EVENT_SPREAD_MISSING,
  CONTEST_NOT_DRAFT,
  CONTEST_RULES_SELECTION_TYPE_MISMATCH,
  CONTEST_SCORING_DEFINITION_NOT_ALLOWED,
  CONTEST_SCORING_ROUNDS_MISMATCH,
  CONTEST_SCORING_SETTINGS_REQUIRED,
  CONTEST_SELECTION_TYPE_NOT_ALLOWED,
  CONTEST_SPREAD_NOT_OFFERED,
  CONTEST_SQUARES_GAME_INVALID,
  CONTEST_SQUARES_ONE_ENTRY_PER_SQUAD,
  CONTEST_SQUARES_GAME_REQUIRED,
  CONTEST_SQUARES_SINGLE_EVENT,
} from '@poolmaster/shared/dto';
import type {
  BudgetContestConfig,
  BudgetContestRules,
  Contest,
  ContestConfigTemplate,
  ContestConfiguration,
  ContestRules,
  ContestRoundCoverage,
  ContestScoringSettings,
  ContestSelectionConfig,
  ParticipantContestScoringRule,
  ParticipantType,
  ParticipantScoringDefinitionId,
  ScoringFamily,
  SportEventStatus,
  TieredContestRules,
  Sport,
  CupWeight,
  OneEventSelectionType,
} from '@poolmaster/shared/domain';
import {
  contestRoundCoverage,
  ContestStatus,
  MatchStatus,
  SelectionType,
  canFillBudgetRoster,
  coversOneEvent,
  eventSportDefinition,
  sportAllowsSelectionType,
  getTieredRosterSize,
  contestFormatForSelectionType,
  isContestFormatValidForEvent,
  isSquaresRound,
  UpsetBonusRule,
  PlanCap,
  survivorLivesOf,
  hasSportEventStarted,
} from '@poolmaster/shared/domain';
import { toEffectiveTierDtoList } from '../../mappers/contest-management.mapper';
import { evaluateEventOperationalState } from '../events/operational-timing';
import { ContestCutoffKind, contestCutoff, type ContestCutoff, type EventTiming } from '../contests/entry-window';
import { errorMessage } from '../../core/error-message';

interface CreateContestManagementContext {
  leagueId: string;
}

type LifecycleLogger = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn' | 'error' | 'fatal'>;

export interface ContestCreateSportEventState {
  id: string;
  status: SportEventStatus;
  startDate: Date;
  sport: Sport;
  /** The event's sport league, read through its Season. */
  sportLeagueId: string;
  /** Its Season's championship year (#2003): a majors pool's events share one (#714). */
  championshipYear: number;
  /** Whether the event plays matches (`eventPlaysMatches`): a field-only event takes roster contests only. */
  playsMatches: boolean;
  participantCount: number;
  /** The event's round count, which a knockout round-points table must match (#699); null when unset. */
  rounds: number | null;
  /** The slot definitions its Season slots play (#2010): a contest whose template lists every one covers all its rounds (#2014). */
  slotDefinitionIds: string[];
  /**
   * Whether every slot it plays is a knockout round's (`playsKnockoutRounds`, #2241): then its round
   * count is its knockout's. A soccer tournament's group matchdays are rounds that knockout round
   * points do not score.
   */
  playsOnlyKnockoutRounds: boolean;
  /** The salary cap the event's field was priced against, or null when it never was (#93). */
  salaryCap: number | null;
  /** Its sport league's first round of single games a squares contest can be played on; null for every round (#787). */
  squaresFromRound: number | null;
  /** Its sport league's participant type and scoring family (#2001). Read through `eventSportDefinition`. */
  participantType: ParticipantType;
  scoringFamily: ScoringFamily;
}

export interface ContestCreateSportEventReader {
  findById(
    sportEventId: string,
  ): Promise<ContestCreateSportEventState | null>;
  /** The states of the events found among `sportEventIds`, read together whatever their number (#1355). */
  findByIds(sportEventIds: readonly string[]): Promise<ContestCreateSportEventState[]>;
  /** The prices of the event's active golfers, in whole dollars; unpriced golfers are left out. */
  findActiveFieldPrices(sportEventId: string): Promise<number[]>;
  /** How many games the event has to pick, cancelled games left out (#716). */
  countGames(sportEventId: string): Promise<number>;
  /**
   * How many of those games still have a team to be decided: in every round, or with
   * `openingRoundOnly` in the event's first round, as a playoff survivor pool needs (#785).
   */
  countUndecidedGames(sportEventId: string, options?: { openingRoundOnly: boolean }): Promise<number>;
  /** How many of those games have no spread yet (#720). */
  countGamesWithoutSpread(sportEventId: string): Promise<number>;
  /** Why the event's games cannot be filled in as a bracket, or null when they can (#721). */
  findBracketProblem(sportEventId: string): Promise<string | null>;
  /** Why knockout round points cannot score the event (no knockout round, or knockout games forming no bracket nor a slate of one-off games), or null when they can (#2225, #2241). */
  findKnockoutProblem(sportEventId: string): Promise<string | null>;
  /** How many of the event's knockout rounds, by its rounds' slots, a contest of this coverage covers (#2014, #2241): known before any game is placed. */
  countCoveredRounds(sportEventId: string, coverage: ContestRoundCoverage): Promise<number>;
  /** The status and round of one of the event's games, or null when the game is not the event's (#711). */
  findGame(sportEventId: string, sportEventRoundMatchId: string): Promise<{ status: MatchStatus; roundNumber: number } | null>;
  /** When a contest with this cutoff closes on the event (#721): at its start, or at its squares game's kickoff. */
  findCutoffTiming(sportEvent: ContestCreateSportEventState, cutoff: ContestCutoff): Promise<EventTiming>;
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

export interface ContestManagementServiceDeps {
  contests: ContestRepository;
  configTemplates: ContestConfigTemplateRepository;
  configurations: ContestConfigurationRepository;
  scoringRules: ParticipantContestScoringRuleRepository;
  tiers: SportEventTierService;
  sportEventReader: ContestCreateSportEventReader;
  /** Makes the cup a new contest counts toward, when its league has none yet (#841). */
  cups: Pick<CupService, 'ensureCup'>;
  /** The league's plan caps (#947): how many sports leagues a year its contests may use. */
  planEntitlements: Pick<PlanEntitlementsService, 'forLeague'>;
  logger?: LifecycleLogger;
  /** Tells the league a contest has opened (#845, the "New contest open" email). */
  contestOpened?: ContestOpenedNotice;
  /** What follows a contest's status change (#1949), for the contest writer opening a draft moves it through. */
  domainEvents: Pick<DomainEvents, 'collect' | 'collectEach'>;
  now?: () => Date;
}

/** What the server says when a one-event contest is given more events, one line per such type. */
const ONE_EVENT_REFUSALS: Readonly<Record<OneEventSelectionType, { message: string; code: ApiErrorCode }>> = {
  [SelectionType.RANDOM_DRAW]: {
    message: 'A random-draw contest covers one event: the draw deals that event\'s field.',
    code: CONTEST_DRAW_SINGLE_EVENT,
  },
  [SelectionType.BRACKET]: {
    message: 'A bracket contest covers one event: its knockout, picked to the final.',
    code: CONTEST_BRACKET_SINGLE_EVENT,
  },
  [SelectionType.SQUARES]: {
    message: 'A squares contest covers one event: it is played on one of its games.',
    code: CONTEST_SQUARES_SINGLE_EVENT,
  },
};

export class ContestManagementService {
  private readonly contestRepo: ContestRepository;
  private readonly contestConfigTemplateRepo: ContestConfigTemplateRepository;
  private readonly contestConfigurationRepo: ContestConfigurationRepository;
  private readonly participantContestScoringRuleRepo: ParticipantContestScoringRuleRepository;
  private readonly sportEventTierService: SportEventTierService;
  private readonly sportEventReader: ContestCreateSportEventReader;
  private readonly cups: Pick<CupService, 'ensureCup'>;
  private readonly planEntitlements: Pick<PlanEntitlementsService, 'forLeague'>;
  private readonly logger: LifecycleLogger;
  private readonly contestOpened?: ContestOpenedNotice;
  /** The one writer of a contest's status (#1949). */
  private readonly contestLifecycle: ContestLifecycle;
  private readonly now: () => Date;

  constructor(deps: ContestManagementServiceDeps) {
    this.contestRepo = deps.contests;
    this.contestConfigTemplateRepo = deps.configTemplates;
    this.contestConfigurationRepo = deps.configurations;
    this.participantContestScoringRuleRepo = deps.scoringRules;
    this.sportEventTierService = deps.tiers;
    this.sportEventReader = deps.sportEventReader;
    this.cups = deps.cups;
    this.planEntitlements = deps.planEntitlements;
    this.logger = deps.logger ?? createNoopLogger();
    this.contestOpened = deps.contestOpened;
    this.contestLifecycle = new ContestLifecycle(deps.contests, deps.domainEvents);
    this.now = deps.now ?? (() => new Date());
  }

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
    const sportEvents = await this.assertSportEventsContestEligible(
      input.sportEventIds,
      contestCutoff(resolvedConfiguration.configuration, input.sportEventRoundMatchId),
    );
    await this.assertSquaresGame(input, sportEvents);
    const sportEvent = this.assertOneSportLeague(sportEvents);
    // Every template is one sport league's (#1825), offered only on that league's events.
    const template = resolvedConfiguration.template;
    if (template && template.sportLeagueId !== sportEvent.sportLeagueId) {
      this.logger.warn({
        sportEventId: sportEvent.id,
        eventSportLeagueId: sportEvent.sportLeagueId,
        templateId: template.id,
        templateSportLeagueId: template.sportLeagueId,
      }, 'contest management create contest rejected for another league\'s template');
      throw new ContestManagementError(
        'That template is another sport league\'s preset; it is offered only for that league\'s events.',
        CONTEST_CONFIG_TEMPLATE_LEAGUE_MISMATCH,
      );
    }
    if (
      !isContestFormatValidForEvent(sportEvent.playsMatches, input.contestFormat)
      // A selection type plays one contest format (#716): pick'em is a prediction contest.
      || contestFormatForSelectionType(input.selectionType) !== input.contestFormat
    ) {
      this.logger.warn({
        sportEventId: sportEvent.id,
        sport: sportEvent.sport,
        playsMatches: sportEvent.playsMatches,
        contestFormat: input.contestFormat,
      }, 'contest management create contest rejected for invalid sport contest format');
      throw new ContestManagementError(
        `Selected sporting event does not support a ${input.contestFormat} contest picked by ${input.selectionType}.`,
        'CONTEST_FORMAT_NOT_ALLOWED',
      );
    }
    const { selectionType } = input;
    assertRulesMatchSelectionType(resolvedConfiguration.configuration, selectionType);
    this.assertOneEntryPerSquadForSquares(selectionType, resolvedConfiguration.configuration.maxEntriesPerSquad);
    this.assertEventCountFitsSelectionType(selectionType, sportEvents.length);
    const { configJson, scoring } = await this.resolveContestRules(
      sportEvents,
      resolvedConfiguration.configuration,
      { requested: resolvedConfiguration.scoring, kept: null },
      // The contest covers the slots its template lists (#2014); one made with none, every round.
      { slotDefinitionIds: template ? template.slots.map((slot) => slot.id) : null },
    );
    const sportEventIds = orderContestEvents(sportEvents);
    // Its season is its first event's Season's championship year (#841, #2003): a pick'em season's
    // January playoff weeks keep the season's year, because they are in the same Season.
    const seasonYear = firstContestEvent(sportEvents, sportEvent).championshipYear;
    const limits = await this.seasonLimits(context.leagueId, sportEvent.sportLeagueId);
    const created = await this.contestRepo.create({
      leagueId: context.leagueId,
      sportEventIds,
      seasonYear,
      name: input.name,
      // A new contest is the commissioner's draft (#117): only they see it, nobody can enter,
      // and its settings stay editable until they open it to the league.
      status: ContestStatus.DRAFT,
      contestFormat: input.contestFormat,
      selectionType,
      squaresGameMatchId: input.sportEventRoundMatchId,
    }, limits);
    if (created.status === 'sportsLeagueLimitReached') {
      this.logger.warn({ leagueId: context.leagueId, seasonYear, sportLeagueId: sportEvent.sportLeagueId, used: created.sportLeagueCount, cap: limits.sportLeaguesPerYear }, 'contest management create contest refused past the plan\'s sports leagues a year');
      throw sportsLeagueLimitError(created.sportLeaguesPerYear, seasonYear, created.sportLeagueCount, 'New contests can only be in those.');
    }
    const { contest } = created;

    const configuration = await this.contestConfigurationRepo.create({
      contestId: contest.id,
      templateId: resolvedConfiguration.template?.id,
      templateVersion: resolvedConfiguration.template?.schemaVersion,
      selectionType,
      configJson,
      maxEntriesPerSquad: resolvedConfiguration.configuration.maxEntriesPerSquad,
    });

    await syncDerivedScoring(
      configuration,
      scoring,
      this.participantContestScoringRuleRepo,
    );
    await this.cups.ensureCup({ leagueId: context.leagueId, seasonYear, sportLeagueId: sportEvent.sportLeagueId });

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
   * Only a tiered contest picks by tier, so only its tiers are read, every event's in one read
   * (#1201); any other format's events carry an empty list.
   */
  private async resolveContestSportEvents(contest: Contest, configuration: Pick<ContestConfiguration, 'coveredSlotDefinitionIds'>): Promise<ContestManagementSportEventDto[]> {
    // The set the contest picks from: the first slot it covers holding one (#2044).
    const tiersByEvent = contest.selectionType === SelectionType.TIERED
      ? await this.sportEventTierService.getEffectiveTiersForSportEvents(contest.sportEventIds, { coveredSlotDefinitionIds: contestRoundCoverage(configuration).slotDefinitionIds })
      : new Map<string, SportEventTierGroup[]>();
    return contest.sportEventIds.map((sportEventId) => ({
      sportEventId,
      effectiveTiers: toEffectiveTierDtoList(tiersByEvent.get(sportEventId) ?? []),
    }));
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
      await this.resolveContestSportEvents(contest, configuration),
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
    // to DRAFT. The one exception is squares' box limit, which changes until the digits are drawn
    // (#711, design Q3.3): it limits claims still to come, and takes no box away.
    const squaresBoxLimitOnly = contest.selectionType === SelectionType.SQUARES
      && contest.status === ContestStatus.OPEN
      && contest.drawnAt === undefined;
    if (squaresBoxLimitOnly && (input.maxEntriesPerSquad ?? null) !== (configuration.maxEntriesPerSquad ?? null)) {
      this.logger.warn({ contestId }, 'contest management update configuration refused an entry limit change on an open squares contest');
      throw new ContestManagementError(
        'This contest is open to the league, so only its box limit can change, until the numbers are drawn.',
        CONTEST_CONFIGURATION_LOCKED,
        409,
      );
    }
    if (contest.status !== ContestStatus.DRAFT && !squaresBoxLimitOnly) {
      this.logger.warn({ contestId, status: contest.status }, 'contest management update configuration refused for a contest that is not a draft');
      throw new ContestManagementError(
        'This contest is open to the league, so its settings are locked.',
        CONTEST_CONFIGURATION_LOCKED,
        409,
      );
    }
    assertRulesMatchSelectionType(input, configuration.selectionType);
    this.assertOneEntryPerSquadForSquares(configuration.selectionType, input.maxEntriesPerSquad);
    // A rules change that does not send scoring keeps the contest's (its points table, say).
    const { configJson, scoring } = await this.resolveContestRules(await this.findContestSportEvents(contest), input, {
      requested: input.scoring,
      kept: currentScoring(await this.participantContestScoringRuleRepo.findByContestConfiguration(configuration.id)),
    }, contestRoundCoverage(configuration));

    await this.contestConfigurationRepo.update(configuration.id, {
      configJson,
      maxEntriesPerSquad: input.maxEntriesPerSquad,
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
      await this.resolveContestSportEvents(contest, refreshedConfiguration),
    );
  }

  /**
   * How much a contest counts toward its cup and the league championship (#841). The
   * commissioner can change it until the contest goes final: settlement writes the championship's
   * points with the weight it finds, so a final contest's weight is fixed (409 CONTEST_FINAL).
   */
  async setContestCupWeight(leagueId: string, contestId: string, cupWeight: CupWeight): Promise<ContestManagementDetailDto> {
    this.logger.debug({ leagueId, contestId, cupWeight }, 'contest management set cup weight start');
    const contest = await this.contestRepo.findById(contestId);
    if (!contest || contest.leagueId !== leagueId) {
      this.logger.warn({ leagueId, contestId }, 'contest management set cup weight missing contest');
      throw new ContestManagementError('Contest not found', 'CONTEST_NOT_FOUND', 404);
    }
    const changed = contest.status !== ContestStatus.COMPLETED && await this.contestRepo.setCupWeight(
      contestId,
      cupWeight,
      [ContestStatus.DRAFT, ContestStatus.OPEN, ContestStatus.ACTIVE],
    );
    if (!changed) {
      this.logger.warn({ contestId, status: contest.status }, 'contest management set cup weight refused for a final contest');
      throw new ContestManagementError('This contest is final, so how much it counts is fixed.', 'CONTEST_FINAL', 409);
    }
    this.logger.info({ contestId, cupWeight }, 'contest management set cup weight completed');
    return this.getContest(contestId);
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
    await this.assertCutoffAhead(contestId, sportEvents, contestCutoff(configuration.configJson, contest.squaresGameMatchId));
    // The events may have changed since the rules were saved: their tiers, or which golfers are
    // still in the field. Rules nobody could enter are refused here too.
    await this.resolveContestRules(sportEvents, ensureTypedConfiguration(configuration), {
      kept: currentScoring(await this.participantContestScoringRuleRepo.findByContestConfiguration(configuration.id)),
    }, contestRoundCoverage(configuration));

    // Compare-and-set: of two presses racing, only one moves the contest.
    const openedAt = this.now();
    const opened = await this.contestLifecycle.transition(contestId, {
      from: [ContestStatus.DRAFT],
      to: ContestStatus.OPEN,
      openedAt,
      // The entry reminder sweep works out the first reminder on its next pass (#1170).
      nextReminderAt: openedAt,
    });
    if (!opened) {
      this.logger.warn({ contestId }, 'contest management open contest lost the race to another transition');
      throw contestNotDraftError();
    }
    await this.onContestOpened(contest.id, contest.leagueId);

    return this.getContest(contestId);
  }

  /**
   * Tells the league a contest has opened (#117): the "New contest open" email to every member
   * (#845). The contest is open whatever happens to the email, so a failure is only logged.
   */
  private async onContestOpened(contestId: string, leagueId: string): Promise<void> {
    this.logger.info({ contestId, leagueId }, 'contest opened to league');
    try {
      await this.contestOpened?.contestOpened(contestId);
    } catch (error) {
      this.logger.error({ contestId, leagueId, error: errorMessage(error) }, 'contest opened email could not be queued');
    }
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
    await this.changeSportEvents(contest, sportEventIds);
    return this.getContest(contestId);
  }

  /** Gives `contest`, as read, these events, under the rules a commissioner's edit keeps. */
  private async changeSportEvents(contest: Contest, sportEventIds: readonly string[]): Promise<void> {
    const contestId = contest.id;
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
      contestCutoff(configuration.configJson, contest.squaresGameMatchId),
    );
    const sportEvents = [...kept, ...added];
    // The contest's league is its first event's; the new list must keep to it.
    this.assertOneSportLeague([...current.slice(0, 1), ...sportEvents]);
    this.assertEventCountFitsSelectionType(contest.selectionType, sportEvents.length);

    const storedRules = ensureTypedConfiguration(configuration);
    const { configJson } = await this.resolveContestRules(sportEvents, storedRules, {
      kept: currentScoring(await this.participantContestScoringRuleRepo.findByContestConfiguration(configuration.id)),
    }, contestRoundCoverage(configuration));
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

    // A contest's Season is fixed at creation (#2014): its events change only inside it, so it
    // never moves to another season's cup or past the plan's sports leagues a year there.
    const otherSeason = sportEvents.find((sportEvent) => sportEvent.championshipYear !== contest.seasonYear);
    if (otherSeason) {
      this.logger.warn({ contestId, sportEventId: otherSeason.id, seasonYear: contest.seasonYear, eventSeasonYear: otherSeason.championshipYear }, 'contest management set sport events refused an event of another season');
      throw new ContestManagementError(
        `This contest is in the ${contest.seasonYear} season, so its events must be too.`,
        CONTEST_EVENTS_SEASON_MISMATCH,
      );
    }
    const orderedIds = orderContestEvents(sportEvents);
    await this.contestRepo.replaceSportEvents(contestId, orderedIds);
    // New events move the reminders of a contest already open (#1170).
    await this.contestRepo.recheckReminders({ contestIds: [contestId] }, this.now());
    this.logger.info({
      contestId,
      sportEventIds: orderedIds,
      addedCount: added.length,
      removedCount: removed.length,
    }, 'contest management set sport events completed');
  }

  /** The contest's events in its sequence order, read together (#1355); each must still exist. */
  private async findContestSportEvents(contest: Contest): Promise<ContestCreateSportEventState[]> {
    const byId = new Map((await this.sportEventReader.findByIds(contest.sportEventIds)).map((sportEvent) => [sportEvent.id, sportEvent]));
    return contest.sportEventIds.map((sportEventId) => {
      const sportEvent = byId.get(sportEventId);
      if (!sportEvent) {
        this.logger.warn({ contestId: contest.id, sportEventId }, 'contest management contest event missing');
        throw new ContestManagementError(
          'Selected sporting event was not found.',
          'SPORT_EVENT_NOT_FOUND',
          404,
        );
      }
      return sportEvent;
    });
  }

  /**
   * Refuses opening a contest past its cutoff on any of its events: the event's start, or a
   * squares contest's game's kickoff.
   */
  private async assertCutoffAhead(
    contestId: string,
    sportEvents: readonly ContestCreateSportEventState[],
    cutoff: ContestCutoff,
  ): Promise<void> {
    const timings = await Promise.all(sportEvents.map(async (sportEvent) =>
      ({ sportEvent, timing: await this.sportEventReader.findCutoffTiming(sportEvent, cutoff) })));
    const started = timings.find(({ timing }) => hasSportEventStarted(timing, this.now()))?.sportEvent;
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

  /**
   * A squares contest is played on one game of its event (#711), named at create: it must be one
   * of the event's games, not cancelled, and in a round of single games (#787: not a Champions
   * League two-legged tie); whether it has kicked off is the contest's cutoff, checked with the
   * event. Only a squares contest names a game.
   */
  private async assertSquaresGame(input: CreateContestRequest, sportEvents: readonly ContestCreateSportEventState[]): Promise<void> {
    const gameId = input.sportEventRoundMatchId;
    if (input.selectionType !== SelectionType.SQUARES) {
      if (gameId !== undefined) {
        this.logger.warn({ selectionType: input.selectionType, sportEventRoundMatchId: gameId }, 'contest management create refused a game for a contest that is not squares');
        throw new ContestManagementError('Only a squares contest is played on one game.', CONTEST_SQUARES_GAME_INVALID);
      }
      return;
    }
    if (gameId === undefined) {
      this.logger.warn({ sportEventIds: input.sportEventIds }, 'contest management create refused a squares contest without its game');
      throw new ContestManagementError('Choose the game the squares contest is played on.', CONTEST_SQUARES_GAME_REQUIRED);
    }
    const games = await Promise.all(sportEvents.map(async (sportEvent) => {
      const game = await this.sportEventReader.findGame(sportEvent.id, gameId);
      return game === null ? null : { ...game, squaresFromRound: sportEvent.squaresFromRound };
    }));
    const game = games.find((each) => each !== null) ?? null;
    if (game === null || game.status === MatchStatus.CANCELLED) {
      this.logger.warn({ sportEventIds: input.sportEventIds, sportEventRoundMatchId: gameId, status: game?.status ?? null }, 'contest management create refused a squares game that is not the event\'s or is cancelled');
      throw new ContestManagementError(
        game === null ? 'That game is not one of the event\'s games.' : 'That game was cancelled, so a squares contest can\'t be played on it.',
        CONTEST_SQUARES_GAME_INVALID,
      );
    }
    if (!isSquaresRound(game.squaresFromRound, game.roundNumber)) {
      this.logger.warn({ sportEventIds: input.sportEventIds, sportEventRoundMatchId: gameId, roundNumber: game.roundNumber, squaresFromRound: game.squaresFromRound }, 'contest management create refused a squares game before the sport league\'s first round of single games');
      throw new ContestManagementError(
        'A squares contest can\'t be played on that game: this sport league\'s squares contests start at a later round.',
        CONTEST_SQUARES_GAME_INVALID,
      );
    }
  }

  /** The sports leagues the league's contests use in one season (#947), for Create contest's counter. */
  async listSportLeaguesUsed(leagueId: string, seasonYear: number): Promise<string[]> {
    this.logger.debug({ leagueId, seasonYear }, 'contest management list sports leagues used start');
    return this.contestRepo.findSportLeagueIdsBySeason(leagueId, seasonYear);
  }

  /**
   * A league's plan caps the different sports leagues its contests use in a season (#947), read
   * live: the repository counts them under the league's row lock when a contest is made in a
   * season or moved into one, and over the cap a season still takes the sports leagues it uses.
   */
  private async seasonLimits(leagueId: string, sportLeagueId: string): Promise<ContestSeasonLimits> {
    const { caps } = await this.planEntitlements.forLeague(leagueId);
    const sportLeaguesPerYear = caps[PlanCap.SPORTS_LEAGUES_PER_YEAR];
    return sportLeaguesPerYear === null ? { sportLeaguesPerYear } : { sportLeaguesPerYear, sportLeagueId };
  }

  /**
   * A squares contest takes one entry per squad (#711, design Q3.3): the box limit is per entry, so
   * a second entry would double a squad's boxes. Any other entry limit, or none, is refused.
   */
  private assertOneEntryPerSquadForSquares(selectionType: SelectionType, maxEntriesPerSquad: number | null | undefined): void {
    if (selectionType !== SelectionType.SQUARES || maxEntriesPerSquad === 1) return;
    this.logger.warn({ selectionType, maxEntriesPerSquad }, 'contest management refused a squares contest that allows more than one entry per squad');
    throw new ContestManagementError(
      'A squares contest takes one entry per squad.',
      CONTEST_SQUARES_ONE_ENTRY_PER_SQUAD,
    );
  }

  /**
   * A random draw deals one event's field (#601), so its contest covers exactly one (#713); so does
   * a bracket, which is one knockout picked to its final (#721), and squares, played on one of its
   * event's games (#711).
   */
  private assertEventCountFitsSelectionType(selectionType: SelectionType, eventCount: number): void {
    if (!coversOneEvent(selectionType) || eventCount <= 1) {
      return;
    }
    const refusal = ONE_EVENT_REFUSALS[selectionType];
    this.logger.warn({ selectionType, eventCount }, 'contest management events refused: this selection type covers one event');
    throw new ContestManagementError(refusal.message, refusal.code);
  }

  private async assertSportEventsContestEligible(
    sportEventIds: readonly string[],
    cutoff: ContestCutoff,
  ): Promise<ContestCreateSportEventState[]> {
    const eligible: ContestCreateSportEventState[] = [];
    for (const sportEventId of new Set(sportEventIds)) {
      eligible.push(await this.assertSportEventContestEligible(sportEventId, cutoff));
    }
    return eligible;
  }

  /**
   * Whether a contest can be built on the event: released, its field loaded, and its cutoff still
   * ahead. The cutoff is the event's start, so nothing is built on an event under way, except
   * squares, which closes at its own game's kickoff.
   */
  private async assertSportEventContestEligible(
    sportEventId: string,
    cutoff: ContestCutoff,
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
      participantCount: sportEvent.participantCount,
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
        participantCount: sportEvent.participantCount,
      }, 'contest management create contest rejected for missing sport event field');
      throw new ContestManagementError(
        'Selected sporting event field has not loaded yet.',
        'SPORT_EVENT_FIELD_NOT_LOADED',
      );
    }

    const timing = await this.sportEventReader.findCutoffTiming(sportEvent, cutoff);
    if (hasSportEventStarted(timing, this.now())) {
      this.logger.warn({
        sportEventId,
        status: sportEvent.status,
        cutoff: cutoff.kind,
        cutoffAt: timing.startDate.toISOString(),
      }, 'contest management create contest rejected for a sport event past the contest cutoff');
      throw new ContestManagementError(
        cutoff.kind === ContestCutoffKind.MATCH_START
          ? 'That game has already kicked off, so a squares contest can no longer be played on it.'
          : 'Selected sporting event has already started, so contests can no longer be created on it.',
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
    coverage: ContestRoundCoverage,
  ): Promise<{ configJson: ContestSelectionConfig; scoring: ContestScoringSettings }> {
    // One sport league, so one sport: the first event answers the sport's questions, and every
    // event is checked where the events can differ (tiers, prices, rounds).
    const sportEvent = this.assertOneSportLeague(sportEvents);
    const definition = eventSportDefinition(sportEvent);
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
    if (rules.selectionType === SelectionType.PICK_EM) {
      // A sport's pools are scored against the spread only where its games have one (#792): not soccer.
      if (rules.againstTheSpread && definition.pickEm?.againstTheSpread !== true) {
        this.logger.warn({ sportEventId: sportEvent.id, sport: sportEvent.sport }, 'contest management rules refused against-the-spread picks in a sport without spreads');
        throw new ContestManagementError(
          `A ${definition.name.toLowerCase()} pick'em contest can't be scored against the spread.`,
          CONTEST_SPREAD_NOT_OFFERED,
        );
      }
      // A pick'em entry picks the winner of each game, so every event must have games (#716).
      for (const each of sportEvents) {
        await this.assertEventHasGames(each.id);
        await this.assertEventGamesDecided(each.id);
        // Picks against the spread need every game's spread before the week joins the contest (#720).
        if (rules.againstTheSpread) {
          await this.assertEventGamesSpread(each.id);
        }
      }
      return {
        configJson: { selectionType: rules.selectionType, mode: rules.mode, againstTheSpread: rules.againstTheSpread },
        scoring: this.resolvePickEmScoring(sportEvent, scoringInput),
      };
    }
    if (rules.selectionType === SelectionType.SURVIVOR) {
      // A survivor entry picks one team a week to win its game (#719): every week needs its games,
      // with both teams known. A playoff's rounds are each a week (#785), so only its first round's
      // teams must be known: the later rounds' come from the results. No pick earns points: the
      // leaderboard and settlement count weeks survived. The rule is still stored because every
      // contest carries one (a configuration's scoring is required), so a survivor contest keeps
      // pick'em's one-point default.
      for (const each of sportEvents) {
        await this.assertEventHasGames(each.id);
        await this.assertEventGamesDecided(each.id, { openingRoundOnly: true });
      }
      return {
        configJson: { selectionType: rules.selectionType, reuseTeamsOnceAllUsed: rules.reuseTeamsOnceAllUsed ?? true, lives: survivorLivesOf(rules) },
        scoring: this.resolvePickEmScoring(sportEvent, scoringInput),
      };
    }
    if (rules.selectionType === SelectionType.SQUARES) {
      // A squares box wins by the game's score, not by a pick (#711): no scoring definition applies.
      // Every contest still stores a rule, so squares keeps pick'em's one-point default, as survivor does.
      return {
        configJson: { selectionType: rules.selectionType, maxSquaresPerEntry: rules.maxSquaresPerEntry },
        scoring: this.resolvePickEmScoring(sportEvent, scoringInput),
      };
    }
    const scoring = this.resolveContestScoring(sportEvent, scoringInput);
    for (const each of sportEvents) {
      // Knockout round points score how far a team went (#715): a regular-season week plays no
      // knockout round, so there is no round to reach. Checked before the round values, which a
      // week, with no knockout round to give one to, could never match. A bracket makes the same
      // check below, in its own words, since its entry picks every game.
      if (scoring.participantScoringDefinitionId === 'KNOCKOUT_ROUND_POINTS' && rules.selectionType !== SelectionType.BRACKET) {
        await this.assertEventIsKnockout(each.id);
      }
      await this.assertScoringFitsEvent(each, scoring, coverage);
    }
    switch (rules.selectionType) {
      case SelectionType.TIERED:
        await this.assertTieredRulesFitTierCount(sportEvents.map((each) => each.id), rules, coverage);
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
      case SelectionType.BRACKET:
        // A bracket entry picks every game to the final, so the games must fill in as a bracket (#721).
        for (const each of sportEvents) {
          await this.assertEventIsBracket(each.id);
        }
        return {
          configJson: { selectionType: rules.selectionType },
          scoring,
        };
    }
  }

  private async assertEventIsBracket(sportEventId: string): Promise<void> {
    const problem = await this.sportEventReader.findBracketProblem(sportEventId);
    if (problem === null) {
      return;
    }
    this.logger.warn({ sportEventId, problem }, 'contest management rules refused a bracket event whose games do not fill in as a bracket');
    throw new ContestManagementError(
      `A bracket contest's event must be a knockout every game of which can be picked: ${problem}.`,
      CONTEST_EVENT_NOT_A_BRACKET,
    );
  }

  private async assertEventIsKnockout(sportEventId: string): Promise<void> {
    const problem = await this.sportEventReader.findKnockoutProblem(sportEventId);
    if (problem === null) {
      return;
    }
    this.logger.warn({ sportEventId, problem }, 'contest management scoring refused knockout round points on an event whose games form no bracket');
    throw new ContestManagementError(
      `Knockout round points score a knockout, but this event's games do not form one: ${problem}.`,
      CONTEST_EVENT_NOT_A_BRACKET,
    );
  }

  private async assertEventHasGames(sportEventId: string): Promise<void> {
    if (await this.sportEventReader.countGames(sportEventId) > 0) {
      return;
    }
    this.logger.warn({ sportEventId }, 'contest management rules refused a pick\'em event with no games');
    throw new ContestManagementError(
      'A pick\'em contest\'s events must each have games to pick.',
      CONTEST_EVENT_HAS_NO_GAMES,
    );
  }

  /** A pick names one of a game's two teams, so a week with a team still to be decided could never be submitted. */
  private async assertEventGamesDecided(sportEventId: string, options?: { openingRoundOnly: boolean }): Promise<void> {
    const undecided = await this.sportEventReader.countUndecidedGames(sportEventId, options);
    if (undecided === 0) {
      return;
    }
    this.logger.warn({ sportEventId, undecided }, 'contest management rules refused a pick\'em event with an undecided game');
    throw new ContestManagementError(
      'A pick\'em contest\'s events must have both teams of every game decided.',
      CONTEST_EVENT_GAME_UNDECIDED,
    );
  }

  private async assertEventGamesSpread(sportEventId: string): Promise<void> {
    const unspread = await this.sportEventReader.countGamesWithoutSpread(sportEventId);
    if (unspread === 0) {
      return;
    }
    this.logger.warn({ sportEventId, unspread }, 'contest management rules refused against-the-spread picks on a released event with a game missing its spread');
    throw new ContestManagementError(
      'Every game of a released week needs its spread before a contest can score it against the spread.',
      CONTEST_EVENT_SPREAD_MISSING,
    );
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
    const definition = eventSportDefinition(sportEvent);
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
    const [defaultDefinitionId] = definition.scoringDefinitions;
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
   * A pick'em contest's stored scoring rule. A pick'em pool scores by its mode (#717): a correct
   * pick is worth a point, or its confidence value, whatever rule the contest carries, so the
   * commissioner sets no scoring table and the rule is never checked against a week's rounds. Every
   * contest stores a rule: one sent is held to the definitions the sport offers, like any contest's
   * (`resolveContestScoring`); one the contest already has is kept; otherwise the rule says what
   * straight up scores, one point.
   */
  private resolvePickEmScoring(sportEvent: ContestCreateSportEventState, scoringInput: ContestScoringInput): ContestScoringSettings {
    if (scoringInput.requested) {
      return this.resolveContestScoring(sportEvent, { requested: scoringInput.requested });
    }
    return scoringInput.kept ?? {
      participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
      config: { roundValues: [1], upsetBonus: { rule: UpsetBonusRule.NONE } },
    };
  }

  /**
   * Settings that must agree with the event (#699, design Q3.3): a knockout round-points table has
   * one value per round the contest covers (#2014), so a short table never quietly scores a late
   * round as 0 (422 CONTEST_SCORING_ROUNDS_MISMATCH). A contest covering every round of the event
   * gives one per round of it; one whose template leaves the play-in out, one per round after it.
   * The other definitions' settings fit any event.
   */
  private async assertScoringFitsEvent(sportEvent: ContestCreateSportEventState, scoring: ContestScoringSettings, coverage: ContestRoundCoverage): Promise<void> {
    switch (scoring.participantScoringDefinitionId) {
      case 'GOLF_RELATIVE_TO_PAR_TOTAL':
      case 'FINISH_POSITION_POINTS':
        return;
      case 'KNOCKOUT_ROUND_POINTS': {
        const valueCount = scoring.config.roundValues.length;
        // A contest covering every slot of an event played in knockout rounds only covers all its
        // rounds; one whose template leaves a slot out (a play-in), or an event with group
        // matchdays (#2241), reads which knockout rounds its rounds' slots cover.
        const listed = coverage.slotDefinitionIds;
        const coversAll = listed === null || sportEvent.slotDefinitionIds.every((id) => listed.includes(id));
        const rounds = coversAll && sportEvent.playsOnlyKnockoutRounds
          ? sportEvent.rounds
          : await this.sportEventReader.countCoveredRounds(sportEvent.id, coverage);
        if (valueCount === rounds) {
          return;
        }
        this.logger.warn({
          sportEventId: sportEvent.id,
          rounds,
          roundValues: valueCount,
        }, 'contest management scoring refused: the round values do not match the rounds the contest covers');
        throw new ContestManagementError(
          `The round values give ${valueCount} round(s), but the event has ${rounds ?? 'no'} rounds the contest covers: give one value per round.`,
          CONTEST_SCORING_ROUNDS_MISMATCH,
        );
      }
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
   * against" behavior the old participantCount-based check had. Every event of the contest is
   * checked from one read of their tiers (#1355).
   */
  private async assertTieredRulesFitTierCount(
    sportEventIds: readonly string[],
    rules: TieredContestRules,
    coverage: ContestRoundCoverage,
  ): Promise<void> {
    // Only the tier count matters here, so the tiers alone are read, not who is placed in them:
    // those of the set the contest will pick from (#2044).
    const tierCounts = new Map<string, number>();
    for (const tier of await this.sportEventTierService.listTiersOfEvents(sportEventIds, { coveredSlotDefinitionIds: coverage.slotDefinitionIds })) {
      tierCounts.set(tier.sportEventId, (tierCounts.get(tier.sportEventId) ?? 0) + 1);
    }
    for (const tierCount of tierCounts.values()) {
      assertCountedScoresFitRoster(rules, tierCount);
    }
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

/** A season without room for the contest's sports league (#947); `outcome` says what is refused. */
function sportsLeagueLimitError(cap: number, seasonYear: number, used: number, outcome: string): ContestManagementError {
  return new ContestManagementError(
    `This league's plan allows ${cap} ${cap === 1 ? 'sports league' : 'sports leagues'} a year, and ${seasonYear} already has contests in ${used}. ${outcome}`,
    'PLAN_SPORTS_LEAGUE_LIMIT_REACHED',
    409,
  );
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
 * picksPerTier (#479), so the roster is the event's tier count times picksPerTier.
 * What is left to validate against the event is that countedScores fits that roster.
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
  await participantRuleRepo.deleteByContestConfiguration(configuration.id);

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

type ContestEventOrderKey = Pick<ContestCreateSportEventState, 'id' | 'startDate'>;

/** Contest event sequence order: by start date, then id, so the order is stable. */
function compareContestEvents(left: ContestEventOrderKey, right: ContestEventOrderKey): number {
  return left.startDate.getTime() - right.startDate.getTime() || left.id.localeCompare(right.id);
}

/** The contest's events in sequence order. */
function orderContestEvents(sportEvents: readonly ContestEventOrderKey[]): string[] {
  return [...sportEvents].sort(compareContestEvents).map((sportEvent) => sportEvent.id);
}

/** The contest's first event in sequence order, starting the search from one of its events. */
function firstContestEvent<T extends ContestEventOrderKey>(sportEvents: readonly T[], anyEvent: T): T {
  return sportEvents.reduce((first, event) => (compareContestEvents(event, first) < 0 ? event : first), anyEvent);
}

function buildContestManagementDetail(
  contest: {
    id: string;
    leagueId: string;
    name: string;
    status: ContestManagementDetailDto['status'];
    cupWeight: CupWeight;
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
    cupWeight: contest.cupWeight,
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
