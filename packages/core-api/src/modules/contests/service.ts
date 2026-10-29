/**
 * ContestService — contest creation, retrieval, update, and deletion.
 *
 * Implements the multi-step contest wizard: sport/event, draft config,
 * scoring rules, payout structure, and scheduling.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestConfigurationRepository,
  ContestEntryMatchPredictionRepository,
  ContestEntryPickRepository,
  ContestEntryPickWithParticipant,
  ContestEntryEventStandingRepository,
  ContestEntryEventStandingResult,
  ContestEntryStandingRepository,
  ContestRepository,
  ContestEntryRepository,
  ContestEntryTotals,
  LeagueMembershipRepository,
  LeagueRepository,
  ParticipantContestScoringRuleRepository,
  ParticipantRepository,
  SportEventMatchRepository,
  SportEventRepository,
  SportLeagueRepository,
  SquadMembershipRepository,
  SquadRepository,
  UserRepository,
  ContestExpansionRepository,
} from '@poolmaster/shared/db';
import type {
  Contest,
  ContestConfiguration,
  ContestEntry,
  LeagueMembership,
  ParticipantScoringDefinitionId,
  RankedContestEntry,
  SportEvent,
  SportEventMatch,
  SquadMembership,
} from '@poolmaster/shared/domain';
import {
  championshipYearStart,
  ContestFormat,
  ContestStatus,
  SelectionType,
  ContestEntryStatus,
  contestEntryEventStatus,
  contestEntryEventTiebreaker,
  deriveLegacyParticipantStatus,
  hasSubmittedAnyEvent,
  LeagueMembershipStatus,
  LeagueRole,
  SportEventStatus,
  SquadMembershipStatus,
  SurvivorWeekOutcome,
  PARTICIPANT_SCORING_DEFINITIONS,
  ScoringFamily,
  eventSportDefinition,
} from '@poolmaster/shared/domain';
import { CONTEST_EVENT_NOT_IN_CONTEST, type ContestEntryDto, type ApiErrorCode, type OpenContestUsageDto } from '@poolmaster/shared/dto';
import {
  toContestEntryDto,
  type ContestEntryEventResultRow,
  type ContestEntryParticipantRow,
  type ContestEntryStandingRow,
  type ContestLeaderboardEntryRow,
  type ContestLeaderboardModel,
} from '../../mappers/contests.mapper';
import type { BracketLeaderboardEntryRow, BracketLeaderboardModel } from '../../mappers/bracket-leaderboard.mapper';
import type { PickEmLeaderboardEntryRow, PickEmLeaderboardModel } from '../../mappers/pick-em-leaderboard.mapper';
import { BracketScoringUnavailableError, loadBracketStandings, type BracketEntryStanding } from './bracket-standings';
import { ContestLeaderboardCache } from './contest-leaderboard-cache';
import { loadPickEmScoring, loadPickEmWeekStandings, pickEmWeekGames } from './pick-em-standings';
import { loadSurvivorSeason, survivorWeekKey } from './survivor-standings';
import type { SurvivorLeaderboardModel } from '../../mappers/survivor-leaderboard.mapper';
import {
  applySettledContestStandings,
  applySettledContestTotals,
  buildContestEntryStanding,
  rankContestEntryStandings,
  rankContestTotals,
  resolveContestCountingRule,
  resolveContestScoringDefinition,
  type ContestCountingRule,
  type ContestEntryEventScore,
  type ContestLeaderboardEntryInput,
  type ContestScoringResolutionFailure,
  type ParticipantScore,
} from './contest-leaderboard-calculator';
import {
  loadContestScoringConfiguration,
  loadEventField,
  loadEventPicks,
  submittedLeaderboardEntries,
  toLeaderboardEntryInput,
  toParticipantScores,
} from './contest-leaderboard-reads';
import {
  ContestCutoffKind,
  areContestEntriesOpen,
  PickWindow,
  areEventPicksRevealed,
  areMatchPicksRevealed,
  contestCutoff,
  cutoffTiming,
  type ContestCutoff,
  type EventTiming,
} from './entry-window';
import type { SportEventParticipantService, SportEventParticipantView } from '../events/sport-event-participant-service';
import type { ParticipantValuationView, SportEventTierService } from '../events/sport-event-tier-service';
import { contestEntriesCap, type PlanEntitlementsService } from '../plans/plan-entitlements-service';
import {
  emailRecipientOf,
  EntryReceiptKind,
  buildEmailEventHeader,
  buildEntryUrl,
  formatUserName,
  type ContestEntryCompletedEmailData,
  type ContestEntryCompletedTierSelection,
  type EmailService,
} from '../email';
/** Who is reading contests, for what they may see: DRAFT contests are commissioner-only (#117). */
export interface ContestViewer {
  userId: string;
  isRootAdmin: boolean;
}

export interface UpdateContestInput {
  name?: string;
  startsAt?: Date;
  endsAt?: Date;
}

/**
 * What the selection room already holds when it sends entry receipts (#1196), so the receipt
 * reads none of it again.
 */
export interface EntrySubmittedReceiptInput {
  contest: Contest;
  sportEvent: SportEvent;
  configuration: ContestConfiguration | null;
  /** The event's effective valuations: each pick's tier label and price. */
  valuations: readonly ParticipantValuationView[];
  /** The active memberships of the entries' squads, in join order: who gets each receipt. */
  squadMemberships: readonly SquadMembership[];
  /** The submitted entries, each one sent its own receipt. */
  entryIds: readonly string[];
}

type LifecycleLogger = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn' | 'error' | 'fatal'>;

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

/**
 * Everything ContestService reads and writes, all through ports (#247). It replaced a
 * ten-parameter positional constructor whose optional repositories and raw PrismaClient were
 * checked at run time; every repository here is required.
 */
export interface ContestServiceDeps {
  contests: ContestRepository;
  configurations: ContestConfigurationRepository;
  scoringRules: ParticipantContestScoringRuleRepository;
  entries: ContestEntryRepository;
  picks: ContestEntryPickRepository;
  predictions: Pick<ContestEntryMatchPredictionRepository, 'findByEntriesAndEvent' | 'findByEntriesAndEvents'>;
  matches: Pick<SportEventMatchRepository, 'findBySportEvent' | 'findBySportEvents'>;
  /** A survivor leaderboard's picked teams' names (#719). */
  participants: Pick<ParticipantRepository, 'findByIds'>;
  standings: ContestEntryStandingRepository;
  eventStandings: ContestEntryEventStandingRepository;
  memberships: LeagueMembershipRepository;
  squads: SquadRepository;
  squadMemberships: SquadMembershipRepository;
  leagues: LeagueRepository;
  users: UserRepository;
  sportEvents: SportEventRepository;
  /** An event's sport league, named on an entry receipt. */
  sportLeagues: Pick<SportLeagueRepository, 'findById'>;
  eventParticipants: Pick<SportEventParticipantService, 'listEventParticipants' | 'listCachedEventParticipants'>;
  tiers: Pick<SportEventTierService, 'listTiers'>;
  /** The league's plan caps (#947): how many entries a contest may hold. */
  planEntitlements: Pick<PlanEntitlementsService, 'forLeague'>;
  /** Each contest's expansion (#987), for the cap a contest read shows. */
  expansions: Pick<ContestExpansionRepository, 'findHighestBands'>;
  logger?: LifecycleLogger;
  email?: EmailService;
  appBaseUrl?: string;
  now?: () => Date;
  /**
   * The leaderboards computed lately (#1162), shared by every contest service in the container;
   * a service built without one keeps its own.
   */
  leaderboardCache?: ContestLeaderboardCache;
}

/** A settled contest's final places, as `ContestService.finalStandingsOf` reads them. */
export interface ContestFinalStandings {
  /** A roster contest's scoring definition, whose format writes its totals; null for a count. */
  scoringDefinitionId: ParticipantScoringDefinitionId | null;
  /** Best first. */
  entries: Array<{ entryId: string; entryName: string; squadId: string; squadName: string; position: number | null; displayPosition: string | null; score: number | null }>;
}

export class ContestService {
  private readonly logger: LifecycleLogger;
  private readonly appBaseUrl: string;
  private readonly now: () => Date;
  private readonly leaderboardCache: ContestLeaderboardCache;

  constructor(private readonly deps: ContestServiceDeps) {
    this.logger = deps.logger ?? createNoopLogger();
    this.appBaseUrl = deps.appBaseUrl ?? 'http://localhost:5173';
    this.now = deps.now ?? (() => new Date());
    this.leaderboardCache = deps.leaderboardCache ?? new ContestLeaderboardCache();
  }

  /**
   * Reads a contest. With a `viewer`, a DRAFT contest answers as missing unless the viewer can
   * see drafts in its league (#117): only its commissioners and root admins can.
   */
  async getContest(
    contestId: string,
    viewer?: ContestViewer,
  ): Promise<Contest | null> {
    this.logger.debug({ contestId }, 'contest get start');
    const contest = await this.deps.contests.findById(contestId);
    if (!contest) {
      this.logger.warn({ contestId }, 'contest get missing contest');
      return null;
    }
    if (
      viewer
      && contest.status === ContestStatus.DRAFT
      && !(await this.canSeeDraftContests(contest.leagueId, viewer))
    ) {
      this.logger.warn({ contestId, userId: viewer.userId }, 'contest get hid a draft contest from a member');
      return null;
    }
    this.logger.info({ contestId }, 'contest get completed');
    return contest;
  }

  /**
   * The league's contests the viewer can see (#1161): the current ones, or, given
   * `finishedYear`, the ones that went final in that championship year. DRAFT contests only for
   * its commissioners (#117).
   */
  async listByLeague(leagueId: string, viewer: ContestViewer, finishedYear?: number): Promise<Contest[]> {
    const contests = finishedYear === undefined
      ? await this.deps.contests.findCurrentByLeague(leagueId, this.now())
      : await this.deps.contests.findFinishedByLeague(leagueId, championshipYearStart(finishedYear), championshipYearStart(finishedYear + 1));
    if (await this.canSeeDraftContests(leagueId, viewer)) {
      return contests;
    }
    return contests.filter((contest) => contest.status !== ContestStatus.DRAFT);
  }

  /** Each championship year a contest of the league went final in, newest first (#1161). */
  async listFinishedYears(leagueId: string): Promise<number[]> {
    return this.deps.contests.findFinishedYearsByLeague(leagueId);
  }

  /**
   * The league's contests still taking entries (#972), newest first, each with every entry it
   * holds, drafts included, as the plan's entry cap counts them (#947): what the commissioner
   * Plan page warns a lower plan would stop.
   */
  async listOpenContestUsage(leagueId: string): Promise<OpenContestUsageDto[]> {
    this.logger.debug({ leagueId }, 'contest open usage list start');
    const contests = await this.deps.contests.findByLeague(leagueId, [ContestStatus.OPEN]);
    const open = await this.filterEntriesOpen(contests);
    const counts = await this.deps.entries.countByContests(open.map((contest) => contest.id));
    return open.map((contest) => ({ contestId: contest.id, name: contest.name, entryCount: counts.get(contest.id) ?? 0 }));
  }

  /** A draft contest is its commissioners' alone until they open it (#117); root admins see all. */
  private async canSeeDraftContests(leagueId: string, viewer: ContestViewer): Promise<boolean> {
    if (viewer.isRootAdmin) {
      return true;
    }
    const membership = await this.deps.memberships.findByLeagueAndUser(leagueId, viewer.userId);
    return membership?.status === LeagueMembershipStatus.ACTIVE
      && membership.role === LeagueRole.COMMISSIONER;
  }

  /** The contests' sport events, by id, read once each (#577); every event of each contest (#713). */
  async findEventsForContests(contests: readonly Contest[]): Promise<Map<string, SportEvent>> {
    const eventIds = [...new Set(contests.flatMap((contest) => contest.sportEventIds))];
    const events = await this.deps.sportEvents.findByIds(eventIds);
    return new Map(events.map((event) => [event.id, event]));
  }

  /** The contest's events, in its sequence order. */
  private async findContestEvents(contest: Contest): Promise<SportEvent[]> {
    const eventsById = await this.findEventsForContests([contest]);
    return contest.sportEventIds.flatMap((sportEventId) => eventsById.get(sportEventId) ?? []);
  }

  /**
   * Each event's timing as the contest's window runs on it (#721): the event's own, or, for a
   * second-chance bracket, its starting round's first game, and for squares its game's kickoff
   * (#711). Only those two read their rules for it.
   */
  private async findContestWindows<Event extends SportEvent>(contest: Contest, events: readonly Event[]): Promise<Array<{ event: Event; window: EventTiming }>> {
    return (await this.findWindowsOfContests([contest], () => events)).get(contest.id) ?? [];
  }

  /**
   * `findContestWindows` for several contests, by contest id, in the same few reads however many
   * there are (#1248): their rules in one read and their cutoff games in one more. `eventsOf`
   * gives each contest's events, already read.
   */
  private async findWindowsOfContests<Event extends SportEvent>(
    contests: readonly Contest[],
    eventsOf: (contest: Contest) => readonly Event[],
  ): Promise<Map<string, Array<{ event: Event; window: EventTiming }>>> {
    const cutoffs = await this.findCutoffs(contests);
    const gameEventIds = contests.filter((contest) => cutoffs.has(contest.id)).flatMap((contest) => eventsOf(contest).map((event) => event.id));
    const games = gameEventIds.length === 0 ? [] : await this.deps.matches.findBySportEvents([...new Set(gameEventIds)]);
    return new Map(contests.map((contest) => {
      const cutoff = cutoffs.get(contest.id);
      return [contest.id, eventsOf(contest).map((event) => ({
        event,
        window: cutoff === undefined ? event : cutoffTiming(cutoff, event, games.filter((game) => game.sportEventId === event.id)),
      }))];
    }));
  }

  /**
   * The cutoff of each contest whose window does not close at its events' start, by contest id:
   * a second-chance bracket's and a squares grid's (#711, #721). Only those two read their rules
   * for it, a lone contest through its remembered point read (#1176) and several in one read.
   */
  private async findCutoffs(contests: readonly Contest[]): Promise<Map<string, ContestCutoff>> {
    const ruled = contests.filter((contest) => contest.selectionType === SelectionType.BRACKET || contest.selectionType === SelectionType.SQUARES);
    const configurations = ruled.length === 1
      ? [await this.deps.configurations.findByContest(ruled[0].id)].filter((configuration) => configuration !== null)
      : await this.deps.configurations.findByContests(ruled.map((contest) => contest.id));
    const rulesOf = new Map(configurations.map((configuration) => [configuration.contestId, configuration.configJson]));
    return new Map(ruled.flatMap((contest) => {
      const cutoff = contestCutoff(rulesOf.get(contest.id), contest.squaresGameMatchId);
      return cutoff.kind === ContestCutoffKind.EVENT_START ? [] : [[contest.id, cutoff] as const];
    }));
  }

  /** The ids of the contest's events whose picks everyone may see as of now (#713). */
  private async findRevealedEventIds(contest: Contest): Promise<Set<string>> {
    const now = this.now();
    const windows = await this.findContestWindows(contest, await this.findContestEvents(contest));
    return new Set(windows.filter(({ window }) => areEventPicksRevealed(contest, window, now)).map(({ event }) => event.id));
  }

  /**
   * Each contest's entry cap (#987): its league plan's, raised by its expansion. Read for showing;
   * an entry is checked against the cap under the contest's lock (`createEntry`).
   */
  async findEntryCaps(contests: readonly Contest[]): Promise<Map<string, number | null>> {
    const leagueIds = [...new Set(contests.map((contest) => contest.leagueId))];
    const [bands, entitlements] = await Promise.all([
      this.deps.expansions.findHighestBands(contests.map((contest) => contest.id)),
      Promise.all(leagueIds.map(async (leagueId) => [leagueId, await this.deps.planEntitlements.forLeague(leagueId)] as const)),
    ]);
    const byLeague = new Map(entitlements);
    return new Map(contests.flatMap((contest) => {
      const leagueEntitlements = byLeague.get(contest.leagueId);
      return leagueEntitlements ? [[contest.id, contestEntriesCap(leagueEntitlements, bands.get(contest.id) ?? null)] as const] : [];
    }));
  }

  /**
   * Entries that submitted at least one event: a draft is not an entry until its owner submits
   * it (#481), and in a contest of several events one submitted event is enough (#713).
   */
  async countEntriesByContest(contestIds: string[]): Promise<Map<string, number>> {
    return this.deps.entries.countSubmittedByContests(contestIds);
  }

  /** Updates a contest. Only allowed when status is DRAFT. */
  async updateContest(
    contestId: string,
    updates: UpdateContestInput,
  ): Promise<Contest> {
    this.logger.debug({ contestId, updates }, 'contest update start');
    const contest = await this.deps.contests.findById(contestId);
    if (!contest) {
      this.logger.warn({ contestId }, 'contest update missing contest');
      throw new ContestNotFoundError(contestId);
    }
    if (contest.status !== ContestStatus.DRAFT) {
      this.logger.warn({ contestId, status: contest.status }, 'contest update invalid status');
      throw new ContestOperationError(
        'Contest can only be edited in DRAFT status',
        'CONTEST_EDIT_STATUS_INVALID',
      );
    }
    const updatedContest = await this.deps.contests.update(contestId, updates as Partial<Contest>);
    this.logger.info({ contestId }, 'contest update completed');
    return updatedContest;
  }

  /** Deletes a contest. Only allowed when status is DRAFT. */
  async deleteContest(contestId: string): Promise<void> {
    this.logger.debug({ contestId }, 'contest delete start');
    const contest = await this.deps.contests.findById(contestId);
    if (!contest) {
      this.logger.warn({ contestId }, 'contest delete missing contest');
      throw new ContestNotFoundError(contestId);
    }
    if (contest.status !== ContestStatus.DRAFT) {
      this.logger.warn({ contestId, status: contest.status }, 'contest delete invalid status');
      throw new ContestOperationError(
        'Contest can only be deleted in DRAFT status',
        'CONTEST_DELETE_STATUS_INVALID',
      );
    }
    await this.deps.contests.delete(contestId);
    this.logger.info({ contestId }, 'contest delete completed');
  }

  /**
   * Every entry of the contest, the requester's own squad's first. Each lists its picks: all of
   * the requester's own squad's, and only the revealed events' picks of everyone else's.
   */
  async listEntries(
    contestId: string,
    userId: string,
  ): Promise<{ entries: ContestEntryDto[]; picksRevealed: boolean }> {
    const context = await this.getEntryContext(contestId, userId, 'read');
    const squadId = context.squadMembership?.squadId ?? null;
    const revealedEventIds = await this.findRevealedEventIds(context.contest);
    const entries = await this.loadEntryDetailDtos(context.contest, {
      requesterSquadId: squadId,
      revealedEventIds,
    });

    return {
      entries: [
        ...entries.filter((entry) => entry.squadId === squadId),
        ...entries.filter((entry) => entry.squadId !== squadId),
      ],
      picksRevealed: revealedEventIds.size > 0,
    };
  }

  /**
   * What a single-contest read adds to the contest (#1197): its entries counted, and the ids of
   * the viewer's own squad's entries, drafts included, in entry-number order. A viewer without
   * an active squad in the league has none.
   */
  async getContestEntrySummary(
    contest: Contest,
    userId: string,
  ): Promise<{ totals: ContestEntryTotals; myEntryIds: string[] }> {
    const [totals, myEntryIds] = await Promise.all([
      this.deps.entries.countForContest(contest.id),
      this.findActiveSquadId(contest.leagueId, userId)
        .then((squadId) => (squadId ? this.deps.entries.findIdsByContestAndSquad(contest.id, squadId) : [])),
    ]);
    return { totals, myEntryIds };
  }

  /**
   * The viewer's own squad's entries, drafts included, in each of the league's OPEN and ACTIVE
   * contests (#1197), without their picks: what league home, the Contests page's "My entries"
   * and My team show, in a fixed number of reads however many contests are current.
   */
  async listMyLeagueEntries(leagueId: string, userId: string): Promise<ContestEntryDto[]> {
    const squadId = await this.findActiveSquadId(leagueId, userId);
    if (!squadId) {
      return [];
    }
    const contests = await this.deps.contests.findByLeague(leagueId, [ContestStatus.OPEN, ContestStatus.ACTIVE]);
    const rows = await this.deps.entries.findBySquadAndContests(squadId, contests.map((contest) => contest.id));
    const pickCounts = await this.deps.picks.countByEntries(rows.map((row) => row.id));
    const contestsById = new Map(contests.map((contest) => [contest.id, contest]));
    return rows.flatMap((row) => {
      const contest = contestsById.get(row.contestId);
      return contest
        ? [toContestEntryDto({ ...withContestEventOrder(row, contest), picksCount: pickCounts.get(row.id) ?? 0 }, { name: row.squadName })]
        : [];
    });
  }

  /**
   * The viewer's squad in the league, while their squad membership is active. Both callers sit
   * behind the route's active league membership gate, which has already read the league
   * membership, and leaving a league ends the squad membership with it.
   */
  private async findActiveSquadId(leagueId: string, userId: string): Promise<string | null> {
    const squadMembership = await this.deps.squadMemberships.findByLeagueAndUser(leagueId, userId);
    return squadMembership?.status === SquadMembershipStatus.ACTIVE ? squadMembership.squadId : null;
  }

  async getEntryDetail(
    contestId: string,
    entryId: string,
    requesterUserId: string,
  ): Promise<{ entry: ContestEntryDto; picksRevealed: boolean }> {
    const context = await this.getEntryContext(contestId, requesterUserId, 'read');
    const requesterSquadId = context.squadMembership?.squadId ?? null;
    const revealedEventIds = await this.findRevealedEventIds(context.contest);
    const picksRevealed = revealedEventIds.size > 0;

    const found = await this.deps.entries.findByIdWithSquad(entryId);
    const row = found?.contestId === contestId ? found : null;
    if (!row) {
      throw new ContestEntryNotFoundError(contestId, entryId);
    }

    // pool-master-dxd.13 — non-owning squad members see an entry's picks only in the events
    // whose picks are revealed (#713); owning squad members see all of their own picks
    // regardless of contest status.
    const isOwner = requesterSquadId !== null && row.squadId === requesterSquadId;
    const picks = await this.deps.picks.findByEntriesWithParticipant([row.id]);
    const visiblePicks = isOwner ? picks : picks.filter((pick) => revealedEventIds.has(pick.sportEventId));

    const entry = toContestEntryDto(
      {
        ...withContestEventOrder(row, context.contest),
        picksCount: picks.length,
      },
      {
        name: row.squadName,
      },
      // Another squad's entry lists no picks at all (rather than none) until an event is revealed.
      isOwner || picksRevealed ? visiblePicks.map(toContestEntryParticipantRow) : null,
    );

    return { entry, picksRevealed };
  }

  /**
   * The contest leaderboard (#713): every entry's contest total and its result in each revealed
   * event, with its picks in one shown event — `sportEventId`, else the latest revealed one. A
   * completed event answers from the standings frozen when it settled; a COMPLETED contest's
   * totals are the ones frozen at its settlement. Every viewer polls it, so a board computed in
   * the last 30 seconds answers for its contest (#1162); the reader is checked each time.
   */
  async getLeaderboard(
    contestId: string,
    requesterUserId: string,
    requestedSportEventId?: string,
  ): Promise<ContestLeaderboardModel> {
    const { contest } = await this.getEntryContext(contestId, requesterUserId, 'read');
    return this.cachedLeaderboardOf(contest, requestedSportEventId);
  }

  /** A viewer's board: computed from the event fields every contest on the event shares (#1163). */
  private cachedLeaderboardOf(contest: Contest, requestedSportEventId?: string): Promise<ContestLeaderboardModel> {
    return this.leaderboardCache.get(contest.id, requestedSportEventId, this.now(), () => this.boardOf(
      contest,
      requestedSportEventId,
      (sportEventId) => this.deps.eventParticipants.listCachedEventParticipants(sportEventId),
    ));
  }

  /**
   * The same leaderboard for a contest already in hand, with no reader to check: what the live
   * standings emails read (#877), computed afresh from fields read now, so an email never
   * reports a board older than the scores that queued it.
   */
  leaderboardOf(contest: Contest, requestedSportEventId?: string): Promise<ContestLeaderboardModel> {
    return this.boardOf(contest, requestedSportEventId, (sportEventId) => loadEventField(this.deps, sportEventId));
  }

  private async boardOf(
    contest: Contest,
    requestedSportEventId: string | undefined,
    readField: (sportEventId: string) => Promise<SportEventParticipantView[]>,
  ): Promise<ContestLeaderboardModel> {
    const contestId = contest.id;
    const now = this.now();
    // No event's picks are revealed while the contest takes entries, unless a draw dealt them.
    if (contest.drawnAt === undefined && (contest.status === ContestStatus.DRAFT || contest.status === ContestStatus.OPEN)) {
      throw new ContestOperationError(
        'The leaderboard is not available until contest picks are revealed.',
        'CONTEST_LEADERBOARD_PICKS_HIDDEN',
      );
    }
    const events = await this.findContestEvents(contest);
    if (events.length === 0) {
      throw new ContestOperationError(
        'The leaderboard requires a contest sport event.',
        'CONTEST_LEADERBOARD_EVENT_REQUIRED',
      );
    }
    if (requestedSportEventId !== undefined && !events.some((event) => event.id === requestedSportEventId)) {
      throw new ContestOperationError(
        'That event is not one this contest covers.',
        CONTEST_EVENT_NOT_IN_CONTEST,
      );
    }
    const revealed = events.filter((event) => areEventPicksRevealed(contest, event, now));
    const shownEvent = requestedSportEventId === undefined
      ? revealed.at(-1)
      : revealed.find((event) => event.id === requestedSportEventId);
    if (!shownEvent) {
      throw new ContestOperationError(
        'The leaderboard is not available until contest picks are revealed.',
        'CONTEST_LEADERBOARD_PICKS_HIDDEN',
      );
    }

    if (contest.contestFormat !== ContestFormat.ROSTER) {
      throw new ContestOperationError(
        contest.contestFormat === ContestFormat.SQUARES
          ? 'A squares contest\'s entries claim boxes, not a lineup: its grid is its leaderboard.'
          : 'A prediction contest\'s entries pick games, not a lineup: a bracket and a pick\'em pool each have their own leaderboard.',
        'CONTEST_FORMAT_MISMATCH',
      );
    }
    const configuration = await loadContestScoringConfiguration(this.deps, contestId);
    const countingRule = resolveContestCountingRule(configuration);
    if (!countingRule) {
      throw new ContestOperationError(
        'The leaderboard requires a contest configuration with countedScores.',
        'CONTEST_LEADERBOARD_COUNTING_RULE_MISSING',
      );
    }
    const scoring = resolveContestScoringDefinition(configuration);
    if (!scoring.ok) {
      const refusal = LEADERBOARD_SCORING_REFUSALS[scoring.reason];
      throw new ContestOperationError(refusal.message, refusal.code);
    }
    const { id: scoringDefinitionId, definition: scoringDefinition } = scoring;
    const { direction } = scoringDefinition;
    const settledByEvent = new Map<string, ContestEntryEventStandingResult[]>();
    for (const standing of await this.deps.eventStandings.findByContest(contestId)) {
      const settled = settledByEvent.get(standing.sportEventId) ?? [];
      settled.push(standing);
      settledByEvent.set(standing.sportEventId, settled);
    }

    // The contest's entries and their picks are read once for every event (#1162), and picks
    // only in the events scored live here: the shown one, and each other one not settled or
    // cancelled. A settled event answers from its frozen standings alone.
    const contestEntries = await this.deps.entries.findByContestWithSquad(contestId);
    const scoredLive = revealed.filter((event) => event.id === shownEvent.id
      || (!settledByEvent.has(event.id) && event.status !== SportEventStatus.CANCELLED));
    const picks = await loadEventPicks(this.deps, contestEntries.map((entry) => entry.id), scoredLive.map((event) => event.id));

    // Each revealed event's standings: frozen once it settled, else computed from its field. The
    // shown event is always computed too, for its picks' scores.
    const eventScores: ContestEntryEventScore[] = [];
    const resultsByEntry = new Map<string, ContestEntryEventResultRow[]>();
    const entriesById = new Map<string, ContestLeaderboardEntryInput>();
    let shown: { field: SportEventParticipantView[]; rows: ContestEntryStandingRow[]; asOf: Date | null } | null = null;
    for (const event of revealed) {
      const entries = submittedLeaderboardEntries(contestEntries, event.id, picks);
      for (const entry of entries) entriesById.set(entry.id, entry);
      const settled = settledByEvent.get(event.id) ?? [];
      const isShown = event.id === shownEvent.id;
      let rows: ContestEntryStandingRow[] | null = null;
      if (isShown || (settled.length === 0 && event.status !== SportEventStatus.CANCELLED)) {
        const field = await readField(event.id);
        const scores = toParticipantScores(field, event, scoring.scoring);
        rows = rankEventStandings(entries, scores, countingRule, direction);
        if (settled.length > 0) {
          rows = applySettledContestStandings(rows, settled.map(toSettledStanding));
        }
        if (isShown) {
          shown = { field, rows, asOf: settled.at(0)?.asOf ?? latestAsOf(scores) };
        }
      }
      // A cancelled event counts for nothing (#743): its picks still show, but no result of it
      // reaches an entry's events or its total.
      if (event.status === SportEventStatus.CANCELLED) continue;
      // A settled event answers from its frozen standings, which also hold the entries that
      // missed it (#714); a live one from the rows computed above.
      const results = rows && settled.length === 0
        ? rows.map((row) => ({ entryId: row.entryId, score: row.score, position: row.position, displayPosition: row.displayPosition, scoredPickCount: row.scoredPickCount }))
        : settled.map((standing) => ({
          entryId: standing.contestEntryId,
          score: standing.totalScore,
          position: standing.position,
          displayPosition: standing.displayPosition,
          scoredPickCount: standing.scoredPickCount,
        }));
      for (const result of results) {
        eventScores.push({ entryId: result.entryId, sportEventId: event.id, score: result.score, scoredPickCount: result.scoredPickCount });
        // Pushed in the contest's event order, so each entry's results read in that order.
        const entryResults = resultsByEntry.get(result.entryId) ?? [];
        entryResults.push({ sportEventId: event.id, score: result.score, position: result.position, displayPosition: result.displayPosition });
        resultsByEntry.set(result.entryId, entryResults);
      }
    }
    if (!shown) {
      throw new Error(`Contest ${contestId} leaderboard lost its shown event ${shownEvent.id}`);
    }
    // An entry that missed every revealed event it has a standing for (#714) is on the board by
    // that standing alone, with no picks.
    for (const entry of contestEntries) {
      if (!entriesById.has(entry.id) && resultsByEntry.has(entry.id)) {
        entriesById.set(entry.id, toLeaderboardEntryInput(entry, []));
      }
    }
    const shownRows = new Map(shown.rows.map((row) => [row.entryId, row]));

    let totals = rankContestTotals([...entriesById.values()], eventScores, direction);
    // A settled contest answers from its frozen totals and the counting rule it settled under
    // (#246); a live one sums its events under the live configuration.
    let shownCountingRule = countingRule;
    const frozenCountingPickLimits = new Map<string, number>();
    if (contest.status === ContestStatus.COMPLETED) {
      const standings = await this.deps.standings.findByContest(contestId);
      const firstStanding = standings.at(0);
      if (firstStanding) {
        totals = applySettledContestTotals(totals, standings.map(toSettledStanding));
        shownCountingRule = { type: 'BEST_N', count: firstStanding.countingPickLimit };
        for (const standing of standings) {
          frozenCountingPickLimits.set(standing.contestEntryId, standing.countingPickLimit);
        }
      } else if (events.every((event) => event.status === SportEventStatus.CANCELLED)) {
        // Every event was cancelled (#743): the contest completed with no standings by design.
        this.logger.debug({ contestId }, 'completed contest had every event cancelled; leaderboard lists entries unscored');
      } else {
        this.logger.warn({ contestId }, 'completed contest has no settled standings; leaderboard computed live');
      }
    }

    const leaderboardEntries: ContestLeaderboardEntryRow[] = totals.map((total) => {
      const entry = entriesById.get(total.entryId);
      const shownRow = shownRows.get(total.entryId);
      return {
        entryId: total.entryId,
        entryName: total.entryName,
        entryNumber: total.entryNumber,
        squadId: entry?.squadId ?? '',
        squadName: entry?.squad.name ?? '',
        score: total.score,
        position: total.position,
        displayPosition: total.displayPosition,
        countingPickLimit: frozenCountingPickLimits.get(total.entryId) ?? shownRow?.countingPickLimit ?? shownCountingRule.count,
        scoredPickCount: shownRow?.scoredPickCount ?? 0,
        picks: shownRow?.picks ?? [],
        events: resultsByEntry.get(total.entryId) ?? [],
      };
    });

    return {
      contestId,
      sportEventId: shownEvent.id,
      sport: shownEvent.sport,
      participantType: shownEvent.participantType ?? null,
      scoringFamily: shownEvent.scoringFamily ?? null,
      scoringDefinitionId,
      countingRule: shownCountingRule,
      participants: shown.field,
      entries: leaderboardEntries,
      asOf: shown.asOf,
    };
  }

  /**
   * A bracket contest's leaderboard (#721): every submitted entry's points, the most it can still
   * reach, and its place, once the event has started and picks are revealed. A COMPLETED contest
   * answers from the standings frozen at settlement, so a later result correction does not change
   * a settled place.
   */
  async getBracketLeaderboard(contestId: string, requesterUserId: string): Promise<BracketLeaderboardModel> {
    const { contest } = await this.getEntryContext(contestId, requesterUserId, 'read');
    return (await this.bracketStandingsOf(contest)).leaderboard;
  }

  /**
   * The same bracket leaderboard for a contest already in hand, with no reader to check, and each
   * entry's champion pick: what the bracket round emails read (#877).
   */
  async bracketStandingsOf(contest: Contest): Promise<{
    leaderboard: BracketLeaderboardModel;
    /** Each entry's pick to win the final, by entry id, for entries with one standing. */
    champions: Map<string, NonNullable<BracketEntryStanding['champion']>>;
  }> {
    const contestId = contest.id;
    if (contest.selectionType !== SelectionType.BRACKET) {
      throw new ContestOperationError(
        'Only a bracket contest has a bracket leaderboard.',
        'CONTEST_FORMAT_MISMATCH',
      );
    }
    const event = (await this.findContestEvents(contest)).at(0);
    const window = event ? (await this.findContestWindows(contest, [event])).at(0)?.window : undefined;
    if (!event || !window || !areEventPicksRevealed(contest, window, this.now())) {
      throw new ContestOperationError(
        'The leaderboard is not available until contest picks are revealed.',
        'CONTEST_LEADERBOARD_PICKS_HIDDEN',
      );
    }
    let standings: Awaited<ReturnType<typeof loadBracketStandings>>;
    try {
      standings = await loadBracketStandings(this.deps, contestId, event);
    } catch (error) {
      if (!(error instanceof BracketScoringUnavailableError)) throw error;
      this.logger.error({ contestId, reason: error.reason }, 'bracket leaderboard refused: the contest cannot be scored');
      // A rule naming another definition than knockout round points is one a bracket does not know.
      const refusal = LEADERBOARD_SCORING_REFUSALS[error.reason === 'NOT_KNOCKOUT_ROUND_POINTS' ? 'DEFINITION_UNKNOWN' : error.reason];
      throw new ContestOperationError(refusal.message, refusal.code);
    }
    const frozen = contest.status === ContestStatus.COMPLETED
      ? new Map((await this.deps.standings.findByContest(contestId)).map((standing) => [standing.contestEntryId, standing]))
      : new Map<string, never>();
    const entries = standings.entries.map((standing): BracketLeaderboardEntryRow => {
      const settled = frozen.get(standing.entry.id);
      return {
        entryId: standing.entry.id,
        entryName: standing.entry.name,
        entryNumber: standing.entry.entryNumber,
        squadId: standing.entry.squadId,
        squadName: standing.entry.squadName,
        position: settled?.position ?? standing.position,
        displayPosition: settled?.displayPosition ?? standing.displayPosition,
        points: settled?.totalScore ?? standing.score.points,
        maxPossiblePoints: settled?.totalScore ?? standing.score.maxPossiblePoints,
        // Not frozen at settlement: a result corrected after it can move this count, never the place or points.
        correctPickCount: standing.score.correctPickCount,
        tiebreakerValue: contestEntryEventTiebreaker(standing.entry, event.id),
      };
    }).sort((left, right) => left.position - right.position || left.entryNumber - right.entryNumber || left.entryName.localeCompare(right.entryName));
    return {
      leaderboard: {
        contestId,
        sportEventId: event.id,
        eventCancelled: standings.eventCancelled,
        gameCount: standings.gameCount,
        finalTotalPoints: standings.finalTotalPoints,
        entries,
      },
      champions: new Map(standings.entries.flatMap(({ entry, champion }) => (champion ? [[entry.id, champion] as const] : []))),
    };
  }

  /**
   * Each ranked entry's place in a contest as it stands, by squad: what a cup's "if it ended now"
   * projection reads (#841), off the same leaderboard the contest page shows. Before any picks are
   * revealed nothing is ranked yet, so it is empty, as it is for squares, whose grid has no places
   * until the contest settles. An entry with nothing scored has no place and is left out.
   */
  async livePositionsOf(contestId: string): Promise<RankedContestEntry[]> {
    const contest = await this.deps.contests.findById(contestId);
    if (!contest) {
      throw new ContestNotFoundError(contestId);
    }
    let entries: readonly { squadId: string; position: number | null }[];
    try {
      entries = await this.liveBoardOf(contest);
    } catch (error) {
      if (!(error instanceof ContestOperationError) || error.code !== 'CONTEST_LEADERBOARD_PICKS_HIDDEN') throw error;
      this.logger.debug({ contestId }, 'live positions: picks are not revealed yet, so nothing is ranked');
      return [];
    }
    return entries.flatMap(({ squadId, position }) => (position === null ? [] : [{ squadId, position }]));
  }

  private async liveBoardOf(contest: Contest): Promise<readonly { squadId: string; position: number | null }[]> {
    switch (contest.selectionType) {
      case SelectionType.TIERED:
      case SelectionType.BUDGET_PICK:
      case SelectionType.RANDOM_DRAW:
        return (await this.cachedLeaderboardOf(contest)).entries;
      case SelectionType.PICK_EM:
        return (await this.pickEmLeaderboardOf(contest)).entries;
      case SelectionType.SURVIVOR:
        return (await this.survivorLeaderboardOf(contest)).entries;
      case SelectionType.BRACKET:
        return (await this.bracketStandingsOf(contest)).leaderboard.entries;
      case SelectionType.SQUARES:
        return [];
    }
  }

  /**
   * A settled contest's final places, best first, from the standings frozen at settlement: what
   * the final results email reads (#845 F1). Empty for a contest that ended with no scores. A
   * roster contest names its scoring definition, whose format writes its totals; every other
   * format's totals are counts (points, weeks survived, quarters won).
   */
  async finalStandingsOf(contest: Contest): Promise<ContestFinalStandings> {
    const [standings, entries] = await Promise.all([
      this.deps.standings.findByContest(contest.id),
      this.deps.entries.findByContestWithSquad(contest.id),
    ]);
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    const scoring = contest.contestFormat === ContestFormat.ROSTER && standings.length > 0
      ? resolveContestScoringDefinition(await loadContestScoringConfiguration(this.deps, contest.id))
      : null;
    return {
      scoringDefinitionId: scoring?.ok ? scoring.id : null,
      entries: standings
        .flatMap((standing) => {
          const entry = entryById.get(standing.contestEntryId);
          return entry ? [{ standing, entry }] : [];
        })
        .sort((left, right) =>
          (left.standing.position ?? Number.MAX_SAFE_INTEGER) - (right.standing.position ?? Number.MAX_SAFE_INTEGER)
          || left.entry.entryNumber - right.entry.entryNumber
          || left.entry.name.localeCompare(right.entry.name))
        .map(({ standing, entry }) => ({
          entryId: entry.id,
          entryName: entry.name,
          squadId: entry.squadId,
          squadName: entry.squadName,
          position: standing.position,
          displayPosition: standing.displayPosition,
          score: standing.totalScore,
        })),
    };
  }

  /**
   * A pick'em contest's season leaderboard (#717): each entry that submitted a week, with its
   * points and place in every week that has started and its season total. A settled week answers
   * from the standings frozen at its settlement, with its winners marked; a week under way is
   * scored live, and a pick only scores once its game is played, so a live week shows nothing a
   * game's kickoff has not revealed. A COMPLETED contest's totals and places are the frozen ones.
   */
  async getPickEmLeaderboard(contestId: string, requesterUserId: string): Promise<PickEmLeaderboardModel> {
    const { contest } = await this.getEntryContext(contestId, requesterUserId, 'read');
    return this.pickEmLeaderboardOf(contest);
  }

  /** The same pick'em leaderboard for a contest already in hand, with no reader to check: what the week results emails read (#877). */
  async pickEmLeaderboardOf(contest: Contest): Promise<PickEmLeaderboardModel> {
    const contestId = contest.id;
    if (contest.selectionType !== SelectionType.PICK_EM) {
      throw new ContestOperationError(
        'Only a pick\'em contest has a pick\'em leaderboard.',
        'CONTEST_FORMAT_MISMATCH',
      );
    }
    const scoring = await loadPickEmScoring(this.deps, contestId);
    const now = this.now();
    const [events, entries, frozenWeeks] = await Promise.all([
      this.findContestEvents(contest),
      this.deps.entries.findByContestWithSquad(contestId),
      this.deps.eventStandings.findByContest(contestId),
    ]);
    const counted = entries.filter(hasSubmittedAnyEvent);
    // Every week's games in one read (#762): a week's game count and tiebreaker total need no more.
    const matchesByEvent = new Map<string, SportEventMatch[]>();
    for (const match of await this.deps.matches.findBySportEvents(events.map((event) => event.id))) {
      const weekMatches = matchesByEvent.get(match.sportEventId);
      if (weekMatches) weekMatches.push(match);
      else matchesByEvent.set(match.sportEventId, [match]);
    }

    const weeks = await Promise.all(events.map(async (event) => {
      const weekMatches = matchesByEvent.get(event.id) ?? [];
      const games = pickEmWeekGames(event, weekMatches);
      const frozen = frozenWeeks.filter((standing) => standing.sportEventId === event.id);
      const started = areEventPicksRevealed(contest, event, now);
      // A week settles by freezing its submitted entries; a cancelled week, or a completed one no
      // entry submitted, has none to freeze and counts as settled as it stands.
      const settled = frozen.length > 0
        || games.eventCancelled
        || (event.status === SportEventStatus.COMPLETED
          && !entries.some((entry) => contestEntryEventStatus(entry, event.id) === ContestEntryStatus.SUBMITTED));
      // Only a week under way is scored live: a settled week answers from its frozen standings,
      // and one not started shows no points (#762).
      const live = started && !settled ? await loadPickEmWeekStandings(this.deps, contestId, event, scoring, weekMatches) : null;
      const cells = new Map<string, { points: number | null; position: number | null; displayPosition: string | null }>(
        settled
          ? frozen.map((standing) => [standing.contestEntryId, {
            points: standing.totalScore,
            position: standing.position,
            displayPosition: standing.displayPosition,
          }])
          : (live?.entries ?? []).map((standing) => [standing.entry.id, {
            points: standing.score.points,
            position: standing.position,
            displayPosition: standing.displayPosition,
          }]),
      );
      const winnerEntryIds = settled ? frozen.filter((standing) => standing.position === 1).map((standing) => standing.contestEntryId) : [];
      return { event, games, started, settled, cells, winnerEntryIds };
    }));

    const totals = new Map(rankContestTotals(
      counted,
      weeks.flatMap(({ event, cells }) => [...cells].map(([entryId, cell]) => ({
        entryId,
        sportEventId: event.id,
        score: cell.points,
        scoredPickCount: 0,
      }))),
      'HIGHER_IS_BETTER',
    ).map((total) => [total.entryId, total]));
    const seasonFrozen = contest.status === ContestStatus.COMPLETED
      ? new Map((await this.deps.standings.findByContest(contestId)).map((standing) => [standing.contestEntryId, standing]))
      : new Map<string, never>();

    const rows = counted.map((entry): PickEmLeaderboardEntryRow => {
      const total = totals.get(entry.id);
      const settled = seasonFrozen.get(entry.id);
      return {
        entryId: entry.id,
        entryName: entry.name,
        entryNumber: entry.entryNumber,
        squadId: entry.squadId,
        squadName: entry.squadName,
        // Unranked until the entry has a started week.
        position: settled?.position ?? total?.position ?? null,
        displayPosition: settled?.displayPosition ?? total?.displayPosition ?? null,
        totalPoints: settled?.totalScore ?? total?.score ?? 0,
        weeks: weeks.map(({ event, cells, winnerEntryIds }) => {
          const cell = cells.get(entry.id);
          return {
            sportEventId: event.id,
            submitted: contestEntryEventStatus(entry, event.id) === ContestEntryStatus.SUBMITTED,
            points: cell?.points ?? null,
            position: cell?.position ?? null,
            displayPosition: cell?.displayPosition ?? null,
            weeklyWinner: winnerEntryIds.includes(entry.id),
          };
        }),
      };
    }).sort((left, right) =>
      (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER)
      || left.entryNumber - right.entryNumber
      || left.entryName.localeCompare(right.entryName));

    return {
      contestId,
      mode: scoring.mode,
      againstTheSpread: scoring.againstTheSpread,
      weeks: weeks.map(({ event, games, started, settled, winnerEntryIds }) => ({
        sportEventId: event.id,
        name: event.name,
        startDate: event.startDate,
        status: event.status,
        started,
        settled,
        gameCount: games.games.length,
        tiebreakerTotalPoints: games.tiebreakerTotalPoints,
        winnerEntryIds,
      })),
      entries: rows,
    };
  }

  /**
   * A survivor contest's leaderboard (#719): each entry that submitted a week, whether it is still
   * in or the week that put it out, and its weeks survived, entries still in first. Each week shows
   * the entry's outcome and, once its game has kicked off, the team it picked. Read live from the
   * results; a COMPLETED contest's places are the ones frozen at settlement.
   */
  async getSurvivorLeaderboard(contestId: string, requesterUserId: string): Promise<SurvivorLeaderboardModel> {
    const { contest } = await this.getEntryContext(contestId, requesterUserId, 'read');
    return this.survivorLeaderboardOf(contest);
  }

  /** The same survivor leaderboard for a contest already in hand, with no reader to check: what the week results emails read (#877). */
  async survivorLeaderboardOf(contest: Contest): Promise<SurvivorLeaderboardModel> {
    const contestId = contest.id;
    if (contest.selectionType !== SelectionType.SURVIVOR) {
      throw new ContestOperationError(
        'Only a survivor contest has a survivor leaderboard.',
        'CONTEST_FORMAT_MISMATCH',
      );
    }
    const now = this.now();
    const season = await loadSurvivorSeason(this.deps, contest, now);
    const openingRoundOf = new Map<string, number>();
    for (const { event, roundNumber } of season.weeks) openingRoundOf.set(event.id, Math.min(openingRoundOf.get(event.id) ?? roundNumber, roundNumber));
    const gameById = new Map(season.weeks.flatMap(({ event, games }) => games.map((game) => [game.id, { event, game }] as const)));
    const isRevealed = (sportEventMatchId: string) => {
      const found = gameById.get(sportEventMatchId);
      return found !== undefined
        && areMatchPicksRevealed(PickWindow.UNTIL_MATCH_START, contest, found.event, found.game, openingRoundOf.get(found.event.id) ?? found.game.roundNumber, now);
    };
    const revealedParticipantIds = new Set(season.entries.flatMap(({ picks }) =>
      [...picks.values()].filter((pick) => isRevealed(pick.sportEventMatchId)).map((pick) => pick.participantId)));
    const nameById = new Map((await this.deps.participants.findByIds([...revealedParticipantIds]))
      .map((participant) => [participant.id, participant.name]));
    const settled = contest.status === ContestStatus.COMPLETED
      ? new Map((await this.deps.standings.findByContest(contestId)).map((standing) => [standing.contestEntryId, standing]))
      : new Map<string, never>();

    const entries = season.entries.map(({ entry, run, picks, alive, position, displayPosition }) => {
      const frozen = settled.get(entry.id);
      return {
        entryId: entry.id,
        entryName: entry.name,
        entryNumber: entry.entryNumber,
        squadId: entry.squadId,
        squadName: entry.squadName,
        alive,
        eliminatedInWeek: run.eliminatedAt === null ? null : run.eliminatedAt + 1,
        weeksSurvived: run.weeksSurvived,
        position: frozen?.position ?? position,
        displayPosition: frozen?.displayPosition ?? displayPosition,
        weeks: season.weeks.map(({ event, roundNumber }, index) => {
          const pick = picks.get(survivorWeekKey({ sportEventId: event.id, roundNumber }));
          return {
            sportEventId: event.id,
            roundNumber,
            outcome: run.weeks[index]?.outcome ?? null,
            // Only a submitted week's pick is shown: a draft one never counted, and the entry is out for not submitting.
            team: pick !== undefined && contestEntryEventStatus(entry, event.id) === ContestEntryStatus.SUBMITTED && isRevealed(pick.sportEventMatchId)
              ? nameById.get(pick.participantId) ?? null
              : null,
          };
        }),
      };
    }).sort((left, right) => left.position - right.position || left.entryNumber - right.entryNumber || left.entryName.localeCompare(right.entryName));

    return {
      contestId,
      weeks: season.weeks.map(({ event, roundNumber, roundCount, weekNumber, started, cancelled }, index) => ({
        sportEventId: event.id,
        weekNumber,
        roundNumber,
        roundCount,
        name: event.name,
        startDate: event.startDate,
        status: event.status,
        started,
        aliveCount: started && !cancelled
          // Still in after the week: those who survived it, and those whose game is still to finish.
          ? season.entries.filter(({ run }) => {
            const outcome = run.weeks[index]?.outcome ?? null;
            return outcome === SurvivorWeekOutcome.SURVIVED || outcome === SurvivorWeekOutcome.PENDING;
          }).length
          : 0,
      })),
      entries,
    };
  }

  async createEntry(
    contestId: string,
    userId: string,
  ): Promise<ContestEntryDto> {
    this.logger.debug({ contestId, userId }, 'contest entry create start');
    const context = await this.getEntryContext(contestId, userId, 'act');
    if (!(await this.areEntriesOpen(context.contest))) {
      this.logger.warn({ contestId, userId, status: context.contest.status }, 'contest entry create locked contest');
      throw entriesLockedError();
    }
    await this.assertEntryFieldReady(context.contest, userId);

    const squad = await this.requireSquadForEntry(
      context.contest.leagueId,
      context.squadMembership,
    );
    const existingEntries = await this.findEntriesBySquad(contestId, squad.id);
    const maxEntriesPerSquad = await this.getMaxEntriesPerSquad(contestId);

    if (maxEntriesPerSquad !== null && existingEntries.length >= maxEntriesPerSquad) {
      this.logger.warn({
        contestId,
        userId,
        squadId: squad.id,
        existingEntryCount: existingEntries.length,
        maxEntriesPerSquad,
      }, 'contest entry create entry limit reached');
      throw new ContestEntryOperationError(
        'You already have the most entries this contest allows',
        'CONTEST_ENTRY_LIMIT_REACHED',
      );
    }

    // Past the highest number the squad holds in this contest, not its entry count: leaving
    // deletes the first entry and keeps the later ones, so a count would reuse a number still
    // taken, and (contest, squad, entry number) is unique.
    const nextEntryNumber = existingEntries.reduce((highest, entry) => Math.max(highest, entry.entryNumber), 0) + 1;
    // Checked live against the plan the league is on now (#947): a contest keeps no plan of its
    // own, only its expansion (#980), which the repository reads under the contest's lock.
    const entitlements = await this.deps.planEntitlements.forLeague(context.contest.leagueId);
    const result = await this.deps.entries.create({
      contestId,
      squadId: squad.id,
      entryNumber: nextEntryNumber,
      name: buildDefaultEntryName(squad.name, nextEntryNumber),
      // Born a draft in each of the contest's events; the owner submits each once its lineup is
      // complete (#481, #713).
    }, { entriesPerContest: (expandedTo) => contestEntriesCap(entitlements, expandedTo) });
    if (result.status === 'contestFull') {
      this.logger.warn({
        contestId,
        userId,
        entriesPerContest: result.entriesPerContest,
      }, 'contest entry create contest full');
      throw new ContestEntryOperationError('This contest is full', 'CONTEST_FULL');
    }
    // The draw closed entries after the window check above: it ran while this entry was on its way in.
    if (result.status === 'contestDrawn') {
      this.logger.warn({ contestId, userId }, 'contest entry create locked by draw');
      throw entriesLockedError();
    }
    const dto = await this.loadEntryDtoById(result.entry.id);
    this.logger.info({
      contestId,
      userId,
      squadId: squad.id,
      entryId: dto.id,
      entryNumber: nextEntryNumber,
    }, 'contest entry create completed');
    return dto;
  }

  async deleteMyEntry(
    contestId: string,
    userId: string,
  ): Promise<void> {
    this.logger.debug({ contestId, userId }, 'contest entry delete start');
    const context = await this.getEntryContext(contestId, userId, 'act');
    if (!(await this.areEntriesOpen(context.contest))) {
      this.logger.warn({ contestId, userId, status: context.contest.status }, 'contest entry delete locked contest');
      throw entriesLockedError();
    }
    if (!context.squadMembership) {
      // The same code the route's requireOwnSquad gate answers, so the state reads one way
      // whoever reaches it (a root admin passes the gate and lands here).
      this.logger.warn({ contestId, userId }, 'contest entry delete missing squad');
      throw new ContestEntryAccessError(
        'You must be an active member of this league to do this',
        'SQUAD_MEMBERSHIP_REQUIRED',
      );
    }

    const existing = await this.findPrimaryEntryBySquad(contestId, context.squadMembership.squadId);
    if (!existing) {
      this.logger.warn({ contestId, userId, squadId: context.squadMembership.squadId }, 'contest entry delete missing entry');
      throw new ContestEntryNotFoundError(contestId, context.squadMembership.squadId);
    }

    const hasSelections = await this.entryHasSelections(existing.id);
    if (hasSelections) {
      this.logger.warn({ contestId, userId, entryId: existing.id }, 'contest entry delete blocked by selections');
      throw new ContestEntryOperationError(
        'Cannot leave a contest after making picks or draft selections',
        'CONTEST_ENTRY_SELECTIONS_EXIST',
      );
    }

    const deleted = await this.deps.entries.delete(existing.id);
    if (deleted.status === 'contestDrawn') {
      this.logger.warn({ contestId, userId, entryId: existing.id }, 'contest entry delete locked by draw');
      throw entriesLockedError();
    }
    this.logger.info({ contestId, userId, entryId: existing.id }, 'contest entry delete completed');
  }

  async updateEntry(
    contestId: string,
    entryId: string,
    userId: string,
    updates: { name?: string; tiebreakerValue?: number | null },
  ): Promise<ContestEntryDto> {
    this.logger.debug({
      contestId,
      entryId,
      userId,
      updateKeys: Object.keys(updates),
    }, 'contest entry update start');
    const context = await this.getEntryContext(contestId, userId, 'act');
    if (!(await this.areEntriesOpen(context.contest))) {
      this.logger.warn({ contestId, entryId, userId, status: context.contest.status }, 'contest entry update locked contest');
      throw entriesLockedError();
    }
    if (!context.squadMembership) {
      this.logger.warn({ contestId, entryId, userId }, 'contest entry update missing squad manager');
      throw new ContestEntryAccessError(
        'You do not manage a squad in this league',
        'SQUAD_MANAGER_REQUIRED',
      );
    }

    const entries = await this.findEntriesBySquad(contestId, context.squadMembership.squadId);
    const existing = entries.find((entry) => entry.id === entryId);
    if (!existing) {
      this.logger.warn({ contestId, entryId, userId }, 'contest entry update missing owned entry');
      throw new ContestEntryNotFoundError(contestId, context.squadMembership.squadId);
    }

    const pendingUpdates: Partial<ContestEntry> = {};

    if (updates.name !== undefined) {
      const sanitizedName = updates.name.trim();
      if (!sanitizedName) {
        this.logger.warn({ contestId, entryId, userId }, 'contest entry update missing name');
        throw new ContestEntryOperationError(
          'Contest entry name is required',
          'CONTEST_ENTRY_NAME_REQUIRED',
        );
      }

      const normalizedName = sanitizedName.toLocaleLowerCase();
      const duplicateEntry = entries.find(
        (entry) => entry.id !== entryId && entry.name.trim().toLocaleLowerCase() === normalizedName,
      );
      if (duplicateEntry) {
        this.logger.warn({ contestId, entryId, userId, duplicateEntryId: duplicateEntry.id }, 'contest entry update duplicate name');
        throw new ContestEntryOperationError(
          'You already have another entry with that name in this contest',
          'CONTEST_ENTRY_NAME_DUPLICATE',
        );
      }

      pendingUpdates.name = sanitizedName;
    }

    if (updates.tiebreakerValue !== undefined) {
      // A bracket's tiebreaker rides with its picks, where its status is kept (#721).
      if (context.contest.contestFormat !== ContestFormat.ROSTER) {
        this.logger.warn({ contestId, entryId, userId }, 'contest entry update refused a tiebreaker outside a roster contest');
        throw new ContestEntryOperationError(
          context.contest.contestFormat === ContestFormat.SQUARES
            ? 'A squares contest has no tiebreaker: its boxes win by the game\'s score.'
            : 'A prediction contest\'s tiebreaker is saved with its game picks.',
          'CONTEST_FORMAT_MISMATCH',
        );
      }
      pendingUpdates.tiebreakerValue = updates.tiebreakerValue;
    }

    await this.deps.entries.update(entryId, pendingUpdates);
    const dto = await this.loadEntryDtoById(entryId);
    this.logger.info({ contestId, entryId, userId }, 'contest entry update completed');
    return dto;
  }

  /**
   * The "Entry submitted" confirmation, sent by the selection room when an entry is submitted
   * (#481), to every owner of the entry's squad (#845, catalog row D3), with when picks close so
   * they know how long it can still change. The selection room only calls it once the lineup has
   * passed the submit check, so it does not judge the lineup again. A quick pick contest's draw
   * sends it for every entry it dealt (#867), listing the dealt picks.
   *
   * The room passes what it already read for the pick (#1196): the contest, the event, the
   * configuration, the event's valuations and the squads' memberships. What is read here is
   * only what it does not hold: the entries with their squad names, their picks in the event,
   * the league, the sport league and the owners. One read of each, however many entries a draw
   * dealt.
   */
  async sendEntrySubmittedEmails(input: EntrySubmittedReceiptInput): Promise<void> {
    const { contest, sportEvent, entryIds } = input;
    const contestId = contest.id;
    if (!this.deps.email) {
      this.logger.debug({
        action: 'contestEntry.emailDelivery.skipped',
        data: { contestId, entryIds },
      }, 'Skipped contest entry confirmation email because dependencies are unavailable');
      return;
    }
    if (entryIds.length === 0) return;
    const email = this.deps.email;

    // One entry is read by id; a draw's entries are the contest's, read in one go.
    const [entryRows, league, sportLeague, picks] = await Promise.all([
      entryIds.length === 1
        ? this.deps.entries.findByIdWithSquad(entryIds[0]).then((row) => (row ? [row] : []))
        : this.deps.entries.findByContestWithSquad(contestId),
      this.deps.leagues.findById(contest.leagueId),
      this.deps.sportLeagues.findById(sportEvent.sportLeagueId),
      this.deps.picks.findByEntriesWithParticipant(entryIds, { sportEventId: sportEvent.id }),
    ]);
    const entryById = new Map(entryRows.filter((row) => row.contestId === contestId).map((row) => [row.id, row]));
    if (!league) {
      this.logger.warn({
        action: 'contestEntry.emailDelivery.entryMissing',
        data: { contestId, entryIds },
      }, 'Skipped contest entry confirmation email because entry data was unavailable');
      return;
    }

    const ownedSquadIds = new Set([...entryById.values()].map((entry) => entry.squadId));
    const ownerIds = [...new Set(input.squadMemberships
      .filter((membership) => ownedSquadIds.has(membership.squadId))
      .map((membership) => membership.userId))];
    const userById = new Map((await this.deps.users.findByIds(ownerIds))
      .filter((user) => user.isActive)
      .map((user) => [user.id, user]));
    const picksByEntryId = new Map<string, ContestEntryPickWithParticipant[]>();
    for (const pick of picks) {
      picksByEntryId.set(pick.entryId, [...(picksByEntryId.get(pick.entryId) ?? []), pick]);
    }

    const tierLabelBySportEventParticipantId = new Map<string, string>();
    const priceBySportEventParticipantId = new Map<string, number>();
    for (const valuation of input.valuations) {
      if (valuation.tierLabel !== null) {
        tierLabelBySportEventParticipantId.set(valuation.sportEventParticipantId, valuation.tierLabel);
      }
      if (valuation.price !== null) {
        priceBySportEventParticipantId.set(valuation.sportEventParticipantId, valuation.price);
      }
    }
    const rules = input.configuration?.configJson;
    // A quick pick entry is dealt its picks by the draw (#867): nobody submitted it, and there is
    // nothing left to change.
    const quickPick = rules?.selectionType === SelectionType.RANDOM_DRAW;
    const golf = eventSportDefinition(sportEvent).scoringFamily === ScoringFamily.STROKE_PLAY;
    const templateKey = 'CONTEST_ENTRY_COMPLETED';

    for (const entryId of entryIds) {
      const entry = entryById.get(entryId);
      if (!entry) {
        this.logger.warn({
          action: 'contestEntry.emailDelivery.entryMissing',
          data: { contestId, entryId },
        }, 'Skipped contest entry confirmation email because entry data was unavailable');
        continue;
      }
      const entryPicks = picksByEntryId.get(entryId) ?? [];
      const lineup = {
        tiers: buildEntryTierSelections(entryPicks, tierLabelBySportEventParticipantId),
        spent: entryPicks.reduce((total, pick) => total + (priceBySportEventParticipantId.get(pick.sportEventParticipantId) ?? 0), 0),
      };
      const tiebreakerValue = entry.tiebreakerValue ?? null;
      const data = {
        leagueName: league.name,
        event: buildEmailEventHeader(this.appBaseUrl, sportEvent, sportLeague?.name ?? ''),
        contestName: contest.name,
        teamName: entry.squadName,
        entryName: entry.name,
        entryUrl: buildEntryUrl(this.appBaseUrl, league.leagueCode, contestId, entryId),
        ...(!quickPick && { submittedAt: entry.updatedAt }),
        // Only golf's roster has a tiebreaker: a predicted winning score relative to par. Submit
        // does not require one, so a lineup submitted without it says so; a quick pick shows one
        // only when its entry gave it.
        ...(golf && (!quickPick || tiebreakerValue !== null) && {
          tiebreaker: tiebreakerValue === null
            ? 'None'
            : PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL.format(tiebreakerValue),
        }),
        receipt: quickPick
          ? { kind: EntryReceiptKind.QUICK_PICK, picks: lineup.tiers.flatMap((tier) => tier.participantNames) }
          : {
            kind: EntryReceiptKind.LINEUP,
            tiers: lineup.tiers,
            ...(rules?.selectionType === SelectionType.BUDGET_PICK && { budget: { spent: lineup.spent, salaryCap: rules.salaryCap } }),
            // A roster contest's picks close when its event starts.
            changeUntil: sportEvent.startDate,
          },
      } satisfies Omit<ContestEntryCompletedEmailData, 'userName'>;
      const owners = input.squadMemberships
        .filter((membership) => membership.squadId === entry.squadId)
        .flatMap((membership) => userById.get(membership.userId) ?? []);
      for (const user of owners) {
        try {
          await email.send(templateKey, {
            to: emailRecipientOf(user),
            // One receipt per submission of the entry in the event.
            about: `${entryId}:${sportEvent.id}:${entry.updatedAt.toISOString()}`,
            league: { id: contest.leagueId, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
            refs: { contestId, entryId },
            data: { userName: formatUserName(user), ...data },
          });
          this.logger.info({
            action: 'contestEntry.emailDelivery.success',
            data: { contestId, entryId, userId: user.id, templateKey },
          }, 'Queued contest entry confirmation email');
        } catch (err) {
          this.logger.error({
            action: 'contestEntry.emailDelivery.failure',
            data: {
              contestId,
              entryId,
              userId: user.id,
              templateKey,
              error: err instanceof Error ? err.message : String(err),
            },
          }, 'Failed to queue contest entry confirmation email');
        }
      }
    }
  }

  /**
   * The one resolver behind every entry operation (#291): the contest, and the caller's league
   * and squad memberships in its league. **Only ACTIVE memberships are returned.** An inactive
   * row is a relation that has ended — leaving a league keeps both rows as INACTIVE — and it
   * confers nothing, so no caller can act on one by forgetting to check its status.
   *
   * `access` says what the operation does with them:
   * - `'read'` — inactive rows confer nothing and nothing is refused here. League access for the
   *   reads is the route's `requireMemberOfLeague` pre-check, which also carries the root-admin
   *   bypass; a caller with no active squad simply owns nothing.
   * - `'act'` — the operation acts for the caller's squad, so the caller must be an ACTIVE league
   *   member (403 `LEAGUE_MEMBERSHIP_REQUIRED` absent, `LEAGUE_MEMBERSHIP_INACTIVE` ended), and a
   *   squad membership that has ended is refused (`SQUAD_MEMBERSHIP_INACTIVE`). Having *no* squad
   *   membership is left to the caller: creating an entry and changing one name it differently.
   *   Entering and leaving are also gated at the route by `requireOwnSquad` (#458); changing an
   *   entry by id is not, so these checks are its only ones.
   */
  private async getEntryContext(
    contestId: string,
    userId: string,
    access: 'read' | 'act',
  ): Promise<{
    contest: Contest;
    membership: LeagueMembership | null;
    squadMembership: SquadMembership | null;
  }> {
    const contest = await this.deps.contests.findById(contestId);
    if (!contest) {
      this.logger.warn({ contestId, userId }, 'contest entry context missing contest');
      throw new ContestNotFoundError(contestId);
    }
    const leagueRow = await this.deps.memberships.findByLeagueAndUser(contest.leagueId, userId);
    const squadRow = leagueRow
      ? await this.deps.squadMemberships.findByLeagueAndUser(contest.leagueId, userId)
      : null;
    const membership = leagueRow?.status === LeagueMembershipStatus.ACTIVE ? leagueRow : null;
    const squadMembership = membership && squadRow?.status === SquadMembershipStatus.ACTIVE
      ? squadRow
      : null;

    if (access === 'act') {
      if (!leagueRow) {
        this.logger.warn({ contestId, userId }, 'contest entry access missing league membership');
        throw new ContestEntryAccessError(
          'You must be an active member of this league to change its contest entries',
          'LEAGUE_MEMBERSHIP_REQUIRED',
        );
      }
      if (!membership) {
        this.logger.warn({ contestId, userId, status: leagueRow.status }, 'contest entry access inactive league membership');
        throw new ContestEntryAccessError(
          'Your membership in this league is inactive',
          'LEAGUE_MEMBERSHIP_INACTIVE',
        );
      }
      if (squadRow && !squadMembership) {
        this.logger.warn({ contestId, userId, squadId: squadRow.squadId, status: squadRow.status }, 'contest entry access inactive squad membership');
        throw new ContestEntryAccessError(
          'Your membership in this league has ended',
          'SQUAD_MEMBERSHIP_INACTIVE',
        );
      }
    }
    return { contest, membership, squadMembership };
  }

  /**
   * Whether entries can be created, renamed or left now: see entry-window.ts. Also how long the
   * contest can be expanded (#987).
   */
  async areEntriesOpen(contest: Contest): Promise<boolean> {
    return (await this.filterEntriesOpen([contest])).length > 0;
  }

  /**
   * The contests whose entries are open now, as `areEntriesOpen` judges each, in the same few
   * reads however many there are (#1248). Only an OPEN contest's events are read: no other takes
   * entries.
   */
  private async filterEntriesOpen(contests: readonly Contest[]): Promise<Contest[]> {
    const open = contests.filter((contest) => contest.status === ContestStatus.OPEN);
    const eventsById = open.length === 0 ? new Map<string, SportEvent>() : await this.findEventsForContests(open);
    const windows = await this.findWindowsOfContests(contests, (contest) => (contest.status === ContestStatus.OPEN
      ? contest.sportEventIds.flatMap((sportEventId) => eventsById.get(sportEventId) ?? [])
      : []));
    const now = this.now();
    return contests.filter((contest) => areContestEntriesOpen(contest, (windows.get(contest.id) ?? []).map(({ window }) => window), now));
  }

  private async findEntriesBySquad(
    contestId: string,
    squadId: string,
  ): Promise<ContestEntry[]> {
    // Drafts and submitted entries alike: both hold one of the squad's entry places.
    return this.deps.entries.findByContestAndSquad(contestId, squadId);
  }

  private async findPrimaryEntryBySquad(
    contestId: string,
    squadId: string,
  ): Promise<ContestEntry | null> {
    const entries = await this.findEntriesBySquad(contestId, squadId);
    return entries[0] ?? null;
  }

  private async loadEntryDetailDtos(
    contest: Contest,
    options: { requesterSquadId: string | null; revealedEventIds: ReadonlySet<string> },
  ): Promise<ContestEntryDto[]> {
    const rows = await this.deps.entries.findByContestWithSquad(contest.id);

    const entryIds = rows.map((row) => row.id);
    const [pickCountByEntry, picks] = await Promise.all([
      this.deps.picks.countByEntries(entryIds),
      this.deps.picks.findByEntriesWithParticipant(entryIds),
    ]);

    // Which picks each entry lists: all of the requester's own squad's (owners see their picks
    // pre-reveal), and everyone else's in the events whose picks are revealed (#713).
    const ownEntryIds = new Set(options.requesterSquadId
      ? rows.filter((row) => row.squadId === options.requesterSquadId).map((row) => row.id)
      : []);
    const participantsByEntry = new Map<string, ContestEntryParticipantRow[]>();
    for (const pick of picks) {
      if (!ownEntryIds.has(pick.entryId) && !options.revealedEventIds.has(pick.sportEventId)) continue;
      participantsByEntry.set(pick.entryId, [...(participantsByEntry.get(pick.entryId) ?? []), toContestEntryParticipantRow(pick)]);
    }

    return rows.map((row) => toContestEntryDto(
      {
        ...withContestEventOrder(row, contest),
        picksCount: pickCountByEntry.get(row.id) ?? 0,
      },
      { name: row.squadName },
      // Another squad's entry lists no picks at all (rather than none) until an event is revealed.
      ownEntryIds.has(row.id) || options.revealedEventIds.size > 0 ? (participantsByEntry.get(row.id) ?? []) : null,
    ));
  }

  private async loadEntryDtoById(entryId: string): Promise<ContestEntryDto> {
    const row = await this.deps.entries.findByIdWithSquad(entryId);
    if (!row) {
      throw new ContestEntryOperationError(
        `Contest entry not found: ${entryId}`,
        'CONTEST_ENTRY_NOT_FOUND',
      );
    }

    const [pickCounts, contest] = await Promise.all([
      this.deps.picks.countByEntries([row.id]),
      this.deps.contests.findById(row.contestId),
    ]);
    return toContestEntryDto({
      ...(contest ? withContestEventOrder(row, contest) : row),
      picksCount: pickCounts.get(row.id) ?? 0,
    }, {
      name: row.squadName,
    });
  }

  /** An entry waits on its contest's first event's field: entering before any golfer is known is refused. */
  private async assertEntryFieldReady(contest: Contest, userId: string): Promise<void> {
    const firstSportEventId = contest.sportEventIds.at(0);
    if (!firstSportEventId) {
      return;
    }

    const loadedParticipantCount = (await this.deps.sportEvents.countParticipants([firstSportEventId]))
      .get(firstSportEventId) ?? 0;
    if (loadedParticipantCount > 0) {
      return;
    }

    this.logger.warn({
      contestId: contest.id,
      sportEventId: firstSportEventId,
      userId,
    }, 'contest entry create rejected because event participant field is not loaded');
    throw new ContestEntryOperationError(
      'Contest entries are not available until the event participant field has loaded.',
      'CONTEST_ENTRY_FIELD_NOT_LOADED',
    );
  }

  private async entryHasSelections(entryId: string): Promise<boolean> {
    // Picks alone decide whether an entry has selections.
    const pickCounts = await this.deps.picks.countByEntries([entryId]);
    return (pickCounts.get(entryId) ?? 0) > 0;
  }

  private async requireSquadForEntry(
    // Retained for the call-site's readability at service.ts:464, where the id is
    // the obvious thing to pass; the body narrowed to needing only the membership.
    _leagueId: string,
    existingSquadMembership: Awaited<ReturnType<SquadMembershipRepository['findByLeagueAndUser']>>,
  ) {
    if (existingSquadMembership?.status === SquadMembershipStatus.ACTIVE) {
      const squad = await this.deps.squads.findById(existingSquadMembership.squadId);
      if (squad) {
        return squad;
      }
    }

    throw new ContestEntryAccessError(
      'You must be an active member of this league to enter a contest',
      'SQUAD_MEMBERSHIP_REQUIRED',
    );
  }

  private async getMaxEntriesPerSquad(contestId: string): Promise<number | null> {
    const configuration = await this.deps.configurations.findByContest(contestId);
    if (!configuration) {
      return 1;
    }

    // A configuration with typed rules treats a missing limit as unlimited; one without rules (no
    // tiered or budget selection) as a single entry.
    if (!configuration.configJson) {
      return configuration.maxEntriesPerSquad ?? 1;
    }

    return configuration.maxEntriesPerSquad ?? null;
  }


}

export class ContestNotFoundError extends Error {
  readonly code: ApiErrorCode = 'CONTEST_NOT_FOUND';
  readonly statusCode = 404;

  constructor(contestId: string) {
    super(`Contest not found: ${contestId}`);
    this.name = 'ContestNotFoundError';
  }
}

/** Why a leaderboard cannot be ranked under the contest's scoring rule, as the 400 it answers. */
const LEADERBOARD_SCORING_REFUSALS: Readonly<Record<ContestScoringResolutionFailure, { message: string; code: ApiErrorCode }>> = {
  RULE_MISSING: {
    message: 'The leaderboard requires the contest configuration to carry a participant scoring rule.',
    code: 'CONTEST_LEADERBOARD_SCORING_RULE_MISSING',
  },
  DEFINITION_UNKNOWN: {
    message: 'The leaderboard requires a participant scoring rule with a known scoring definition.',
    code: 'CONTEST_LEADERBOARD_SCORING_DEFINITION_UNKNOWN',
  },
  SETTINGS_INVALID: {
    message: 'The leaderboard requires the participant scoring rule\'s settings to be valid for its scoring definition.',
    code: 'CONTEST_LEADERBOARD_SCORING_SETTINGS_INVALID',
  },
};

export class ContestOperationError extends Error {
  code: ApiErrorCode;

  constructor(reason: string, code: ApiErrorCode = 'CONTEST_OPERATION_INVALID') {
    super(reason);
    this.name = 'ContestOperationError';
    this.code = code;
  }
}

export class ContestEntryOperationError extends Error {
  code: ApiErrorCode;

  constructor(reason: string, code: ApiErrorCode = 'CONTEST_ENTRY_OPERATION_INVALID') {
    super(reason);
    this.name = 'ContestEntryOperationError';
    this.code = code;
  }
}

/**
 * The caller is not entitled to act on a contest entry: no active league membership, or no
 * active squad to act for. Routes answer 403, the same status the league pre-checks use.
 */
export class ContestEntryAccessError extends Error {
  code: ApiErrorCode;

  constructor(reason: string, code: ApiErrorCode) {
    super(reason);
    this.name = 'ContestEntryAccessError';
    this.code = code;
  }
}

export class ContestEntryNotFoundError extends Error {
  readonly code: ApiErrorCode = 'CONTEST_ENTRY_NOT_FOUND';
  readonly statusCode = 404;

  constructor(contestId: string, squadId: string) {
    super(`Contest entry not found for contest ${contestId} and squad ${squadId}`);
    this.name = 'ContestEntryNotFoundError';
  }
}

function entriesLockedError(): ContestEntryOperationError {
  return new ContestEntryOperationError(
    'Contest entries can only be changed before the contest starts',
    'CONTEST_ENTRY_LOCKED',
  );
}

function buildDefaultEntryName(squadName: string, entryNumber: number): string {
  return `${squadName} Entry ${entryNumber}`;
}

/** A pick as a contest entry shows it: the pick and the participant it points at. */
function toContestEntryParticipantRow(pick: ContestEntryPickWithParticipant): ContestEntryParticipantRow {
  return {
    pickId: pick.id,
    sportEventParticipantId: pick.sportEventParticipantId,
    sportEventId: pick.sportEventId,
    participantId: pick.participant.participantId,
    participantName: pick.participant.participantName,
    participantStatus: deriveLegacyParticipantStatus(
      pick.participant.isActive,
      pick.participant.inactiveReason,
    ),
    role: pick.participant.role,
    teamAffiliation: pick.participant.teamAffiliation,
    pickedAt: pick.pickedAt,
  };
}

function buildEntryTierSelections(
  picks: readonly ContestEntryPickWithParticipant[],
  tierLabelBySportEventParticipantId: Map<string, string>,
): ContestEntryCompletedTierSelection[] {
  const groups = new Map<string, string[]>();
  for (const pick of picks) {
    const tierName = tierLabelBySportEventParticipantId.get(pick.sportEventParticipantId) ?? 'Selections';
    const participants = groups.get(tierName) ?? [];
    participants.push(pick.participant.participantName);
    groups.set(tierName, participants);
  }
  return Array.from(groups.entries()).map(([tierName, participantNames]) => ({
    tierName,
    participantNames,
  }));
}

/** The entry with its event statuses in the contest's event order (#713). */
function withContestEventOrder<Entry extends ContestEntry>(entry: Entry, contest: Pick<Contest, 'sportEventIds'>): Entry {
  const order = (sportEventId: string) => {
    const index = contest.sportEventIds.indexOf(sportEventId);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return { ...entry, events: [...entry.events].sort((left, right) => order(left.sportEventId) - order(right.sportEventId)) };
}

/** One event's entry standings, live: each submitted entry's picks scored against the event's field and ranked. */
function rankEventStandings(
  entries: readonly ContestLeaderboardEntryInput[],
  scores: readonly ParticipantScore[],
  countingRule: ContestCountingRule,
  direction: Parameters<typeof rankContestEntryStandings>[1],
): ContestEntryStandingRow[] {
  const scoreById = new Map(scores.map((score) => [score.sportEventParticipantId, score]));
  return rankContestEntryStandings(
    entries.map((entry) => buildContestEntryStanding(entry, scoreById, countingRule, direction)),
    direction,
  );
}

function latestAsOf(scores: readonly ParticipantScore[]): Date | null {
  return scores.reduce<Date | null>((latest, participant) => {
    if (!participant.asOf) return latest;
    if (!latest || participant.asOf.getTime() > latest.getTime()) return participant.asOf;
    return latest;
  }, null);
}

function toSettledStanding(standing: {
  contestEntryId: string;
  position: number | null;
  displayPosition: string | null;
  countingPickLimit: number;
  scoredPickCount: number;
  totalScore: number | null;
}) {
  return {
    contestEntryId: standing.contestEntryId,
    position: standing.position,
    displayPosition: standing.displayPosition,
    countingPickLimit: standing.countingPickLimit,
    scoredPickCount: standing.scoredPickCount,
    score: standing.totalScore,
  };
}
