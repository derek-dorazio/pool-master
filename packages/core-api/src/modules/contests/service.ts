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
  ContestEntryStandingRepository,
  ContestRepository,
  ContestEntryRepository,
  LeagueMembershipRepository,
  LeagueRepository,
  ParticipantContestScoringRuleRepository,
  ParticipantRepository,
  SportEventMatchRepository,
  SportEventRepository,
  SquadMembershipRepository,
  SquadRepository,
  UserRepository,
} from '@poolmaster/shared/db';
import type {
  Contest,
  ContestEntry,
  LeagueMembership,
  SportEvent,
  SportEventMatch,
  SquadMembership,
  User,
} from '@poolmaster/shared/domain';
import {
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
  getSportDefinition,
} from '@poolmaster/shared/domain';
import { CONTEST_EVENT_NOT_IN_CONTEST, type ContestEntryDto, type ApiErrorCode } from '@poolmaster/shared/dto';
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
  loadContestLeaderboardEntries,
  loadContestScoringConfiguration,
  loadEventField,
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
  type EventTiming,
} from './entry-window';
import type { SportEventParticipantService } from '../events/sport-event-participant-service';
import type { SportEventTierService } from '../events/sport-event-tier-service';
import {
  EntryReceiptKind,
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

interface ContestEntryReceiptData {
  id: string;
  contestId: string;
  name: string;
  squadId: string;
  tiebreakerValue: number | null;
  updatedAt: Date;
  squad: {
    name: string;
  };
  contest: {
    id: string;
    leagueId: string;
    name: string;
    league: {
      name: string;
      leagueCode: string;
    };
  };
  picks: Array<{
    pickedAt: Date;
    sportEventId: string;
    sportEventParticipant: {
      id: string;
      participant: {
        id: string;
        name: string;
      };
    };
  }>;
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
  eventParticipants: Pick<SportEventParticipantService, 'listEventParticipants'>;
  tiers: Pick<SportEventTierService, 'getEffectiveValuationsForSportEvent' | 'listTiers'>;
  logger?: LifecycleLogger;
  email?: EmailService;
  appBaseUrl?: string;
  now?: () => Date;
}

export class ContestService {
  private readonly logger: LifecycleLogger;
  private readonly appBaseUrl: string;
  private readonly now: () => Date;

  constructor(private readonly deps: ContestServiceDeps) {
    this.logger = deps.logger ?? createNoopLogger();
    this.appBaseUrl = deps.appBaseUrl ?? 'http://localhost:5173';
    this.now = deps.now ?? (() => new Date());
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

  /** The league's contests the viewer can see: DRAFT contests only for its commissioners (#117). */
  async listByLeague(leagueId: string, viewer: ContestViewer): Promise<Contest[]> {
    const contests = await this.deps.contests.findByLeague(leagueId);
    if (await this.canSeeDraftContests(leagueId, viewer)) {
      return contests;
    }
    return contests.filter((contest) => contest.status !== ContestStatus.DRAFT);
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
    if (contest.selectionType !== SelectionType.BRACKET && contest.selectionType !== SelectionType.SQUARES) {
      return events.map((event) => ({ event, window: event }));
    }
    const cutoff = contestCutoff((await this.deps.configurations.findByContest(contest.id))?.configJson, contest.squaresGameMatchId);
    if (cutoff.kind === ContestCutoffKind.EVENT_START) {
      return events.map((event) => ({ event, window: event }));
    }
    return Promise.all(events.map(async (event) =>
      ({ event, window: cutoffTiming(cutoff, event, await this.deps.matches.findBySportEvent(event.id)) })));
  }

  /** The ids of the contest's events whose picks everyone may see as of now (#713). */
  private async findRevealedEventIds(contest: Contest): Promise<Set<string>> {
    const now = this.now();
    const windows = await this.findContestWindows(contest, await this.findContestEvents(contest));
    return new Set(windows.filter(({ window }) => areEventPicksRevealed(contest, window, now)).map(({ event }) => event.id));
  }

  /**
   * Entries that submitted at least one event: a draft is not an entry until its owner submits
   * it (#481), and in a contest of several events one submitted event is enough (#713).
   */
  async countEntriesByContest(contestIds: string[]): Promise<Map<string, number>> {
    const counts = new Map(contestIds.map((contestId) => [contestId, 0]));
    if (!contestIds.length) {
      return counts;
    }

    const entryLists = await Promise.all(
      contestIds.map(async (contestId) => ({
        contestId,
        entries: await this.deps.entries.findByContest(contestId),
      })),
    );

    for (const { contestId, entries } of entryLists) {
      counts.set(
        contestId,
        entries.filter(hasSubmittedAnyEvent).length,
      );
    }

    return counts;
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

  async listEntries(
    contestId: string,
    userId: string,
  ): Promise<{
    entries: ContestEntryDto[];
    isJoined: boolean;
    myEntryId: string | null;
    myEntryIds: string[];
    picksRevealed: boolean;
  }> {
    const context = await this.getEntryContext(contestId, userId, 'read');
    const squadId = context.squadMembership?.squadId ?? null;
    const revealedEventIds = await this.findRevealedEventIds(context.contest);
    const picksRevealed = revealedEventIds.size > 0;
    const entries = await this.loadEntryDetailDtos(context.contest, {
      requesterSquadId: squadId,
      revealedEventIds,
    });
    const myEntries = squadId
      ? entries.filter((entry) => entry.squadId === squadId)
      : [];
    const myEntry = myEntries.at(0) ?? null;
    const orderedEntries = [
      ...myEntries,
      ...entries.filter((entry) => entry.squadId !== squadId),
    ];

    return {
      entries: orderedEntries,
      isJoined: myEntry !== null,
      myEntryId: myEntry?.id ?? null,
      myEntryIds: myEntries.map((entry) => entry.id),
      picksRevealed,
    };
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
   * totals are the ones frozen at its settlement.
   */
  async getLeaderboard(
    contestId: string,
    requesterUserId: string,
    requestedSportEventId?: string,
  ): Promise<ContestLeaderboardModel> {
    const { contest } = await this.getEntryContext(contestId, requesterUserId, 'read');
    return this.leaderboardOf(contest, requestedSportEventId);
  }

  /**
   * The same leaderboard for a contest already in hand, with no reader to check: what the live
   * standings emails read (#877), so an email and the page never disagree.
   */
  async leaderboardOf(contest: Contest, requestedSportEventId?: string): Promise<ContestLeaderboardModel> {
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
    const settledEventStandings = await this.deps.eventStandings.findByContest(contestId);

    // Each revealed event's standings: frozen once it settled, else computed from its field. The
    // shown event is always computed too, for its picks' scores.
    const eventScores: ContestEntryEventScore[] = [];
    const eventResults: Array<ContestEntryEventResultRow & { entryId: string }> = [];
    const entriesById = new Map<string, ContestLeaderboardEntryInput>();
    let shown: { field: Awaited<ReturnType<typeof loadEventField>>; rows: ContestEntryStandingRow[]; asOf: Date | null } | null = null;
    for (const event of revealed) {
      const entries = await loadContestLeaderboardEntries(this.deps, contestId, event.id);
      for (const entry of entries) entriesById.set(entry.id, entry);
      const settled = settledEventStandings.filter((standing) => standing.sportEventId === event.id);
      const isShown = event.id === shownEvent.id;
      let rows: ContestEntryStandingRow[] | null = null;
      if (isShown || settled.length === 0) {
        const field = await loadEventField(this.deps, event.id);
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
        eventResults.push({ entryId: result.entryId, sportEventId: event.id, score: result.score, position: result.position, displayPosition: result.displayPosition });
      }
    }
    if (!shown) {
      throw new Error(`Contest ${contestId} leaderboard lost its shown event ${shownEvent.id}`);
    }
    // An entry that missed every revealed event it has a standing for (#714) is on the board by
    // that standing alone, with no picks.
    const standingOnly = new Set(eventScores.map((score) => score.entryId).filter((entryId) => !entriesById.has(entryId)));
    if (standingOnly.size > 0) {
      for (const entry of await this.deps.entries.findByContestWithSquad(contestId)) {
        if (standingOnly.has(entry.id)) {
          entriesById.set(entry.id, toLeaderboardEntryInput(entry, []));
        }
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
        events: revealed.flatMap((event) =>
          eventResults.filter((result) => result.entryId === total.entryId && result.sportEventId === event.id)
            .map(({ entryId: _entryId, ...result }) => result)),
      };
    });

    return {
      contestId,
      sportEventId: shownEvent.id,
      sport: shownEvent.sport,
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
    const nextEntryNumber = (await this.findHighestEntryNumber(contestId, squad.id)) + 1;
    const result = await this.deps.entries.create({
      contestId,
      squadId: squad.id,
      entryNumber: nextEntryNumber,
      name: buildDefaultEntryName(squad.name, nextEntryNumber),
      // Born a draft in each of the contest's events; the owner submits each once its lineup is
      // complete (#481, #713).
    });
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
   */
  async sendEntrySubmittedEmail(
    contestId: string,
    entryId: string,
    sportEventId: string,
  ): Promise<void> {
    if (!this.deps.email) {
      this.logger.debug({
        action: 'contestEntry.emailDelivery.skipped',
        data: { contestId, entryId },
      }, 'Skipped contest entry confirmation email because dependencies are unavailable');
      return;
    }
    const email = this.deps.email;

    const [entry, sportEvent] = await Promise.all([
      this.loadContestEntryReceiptData(entryId),
      this.deps.sportEvents.findById(sportEventId),
    ]);
    if (!entry || entry.contestId !== contestId || !sportEvent) {
      this.logger.warn({
        action: 'contestEntry.emailDelivery.entryMissing',
        data: { contestId, entryId },
      }, 'Skipped contest entry confirmation email because entry data was unavailable');
      return;
    }

    const owners = (await Promise.all((await this.deps.squadMemberships.findBySquad(entry.squadId))
      .map((membership) => this.deps.users.findById(membership.userId))))
      .filter((user): user is User => user !== null && user.isActive);
    const templateKey = 'CONTEST_ENTRY_COMPLETED';
    const league = entry.contest.league;
    const [lineup, configuration] = await Promise.all([
      this.buildEntryLineupForEmail(entry, sportEventId),
      this.deps.configurations.findByContest(contestId),
    ]);
    const rules = configuration?.configJson;
    // A quick pick entry is dealt its picks by the draw (#867): nobody submitted it, and there is
    // nothing left to change.
    const quickPick = rules?.selectionType === SelectionType.RANDOM_DRAW;
    const golf = getSportDefinition(sportEvent.sport).scoringFamily === ScoringFamily.STROKE_PLAY;
    const data = {
      leagueName: league.name,
      contestName: entry.contest.name,
      teamName: entry.squad.name,
      entryName: entry.name,
      entryUrl: buildEntryUrl(this.appBaseUrl, league.leagueCode, contestId, entryId),
      ...(!quickPick && { submittedAt: entry.updatedAt }),
      // Only golf's roster has a tiebreaker: a predicted winning score relative to par. Submit
      // does not require one, so a lineup submitted without it says so; a quick pick shows one
      // only when its entry gave it.
      ...(golf && (!quickPick || entry.tiebreakerValue !== null) && {
        tiebreaker: entry.tiebreakerValue === null
          ? 'None'
          : PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL.format(entry.tiebreakerValue),
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
    for (const user of owners) {
      try {
        await email.send(templateKey, {
          to: { email: user.email, userId: user.id, timeZone: user.timezone },
          // One receipt per submission of the entry in the event.
          about: `${entryId}:${sportEventId}:${entry.updatedAt.toISOString()}`,
          league: { id: entry.contest.leagueId, name: league.name, leagueCode: league.leagueCode },
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

  /**
   * The entry's picks in the submitted event grouped by the tier label SportEventTierService
   * resolves for each golfer (#713: one event's picks per confirmation), and what they cost.
   */
  private async buildEntryLineupForEmail(
    entry: ContestEntryReceiptData,
    sportEventId: string,
  ): Promise<{ tiers: ContestEntryCompletedTierSelection[]; spent: number }> {
    const tierLabelBySportEventParticipantId = new Map<string, string>();
    const priceBySportEventParticipantId = new Map<string, number>();
    const valuations = await this.deps.tiers.getEffectiveValuationsForSportEvent(sportEventId);
    for (const valuation of valuations) {
      if (valuation.tierLabel !== null) {
        tierLabelBySportEventParticipantId.set(valuation.sportEventParticipantId, valuation.tierLabel);
      }
      if (valuation.price !== null) {
        priceBySportEventParticipantId.set(valuation.sportEventParticipantId, valuation.price);
      }
    }
    const picks = entry.picks.filter((pick) => pick.sportEventId === sportEventId);
    return {
      tiers: buildEntryTierSelections({ ...entry, picks }, tierLabelBySportEventParticipantId),
      spent: picks.reduce((total, pick) => total + (priceBySportEventParticipantId.get(pick.sportEventParticipant.id) ?? 0), 0),
    };
  }

  private async loadContestEntryReceiptData(
    entryId: string,
  ): Promise<ContestEntryReceiptData | null> {
    const entry = await this.deps.entries.findByIdWithSquad(entryId);
    if (!entry) {
      return null;
    }
    const contest = await this.deps.contests.findById(entry.contestId);
    if (!contest) {
      return null;
    }
    const [league, picks] = await Promise.all([
      this.deps.leagues.findById(contest.leagueId),
      this.deps.picks.findByEntriesWithParticipant([entry.id]),
    ]);
    if (!league) {
      return null;
    }
    return {
      id: entry.id,
      contestId: entry.contestId,
      name: entry.name,
      squadId: entry.squadId,
      tiebreakerValue: entry.tiebreakerValue ?? null,
      updatedAt: entry.updatedAt,
      squad: { name: entry.squadName },
      contest: {
        id: contest.id,
        leagueId: contest.leagueId,
        name: contest.name,
        league: { name: league.name, leagueCode: league.leagueCode },
      },
      picks: picks.map((pick) => ({
        pickedAt: pick.pickedAt,
        sportEventId: pick.sportEventId,
        sportEventParticipant: {
          id: pick.sportEventParticipantId,
          participant: { id: pick.participant.participantId, name: pick.participant.participantName },
        },
      })),
    };
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

  /** Whether entries can be created, renamed or left now: see entry-window.ts. */
  private async areEntriesOpen(contest: Contest): Promise<boolean> {
    const sportEvents = contest.status === ContestStatus.OPEN ? await this.findContestEvents(contest) : [];
    const windows = await this.findContestWindows(contest, sportEvents);
    return areContestEntriesOpen(contest, windows.map(({ window }) => window), this.now());
  }

  private async findEntriesBySquad(
    contestId: string,
    squadId: string,
  ): Promise<ContestEntry[]> {
    const entries = await this.deps.entries.findBySquad(squadId);
    return entries
      // Drafts and submitted entries alike: both hold one of the squad's entry places.
      .filter((entry) => entry.contestId === contestId)
      .sort((left, right) => left.entryNumber - right.entryNumber);
  }

  /** The highest entry number the squad holds in the contest, whatever its status; 0 for none. */
  private async findHighestEntryNumber(contestId: string, squadId: string): Promise<number> {
    const entries = await this.deps.entries.findBySquad(squadId);
    return entries
      .filter((entry) => entry.contestId === contestId)
      .reduce((highest, entry) => Math.max(highest, entry.entryNumber), 0);
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
  entry: ContestEntryReceiptData,
  tierLabelBySportEventParticipantId: Map<string, string>,
): ContestEntryCompletedTierSelection[] {
  const groups = new Map<string, string[]>();
  for (const pick of entry.picks) {
    const tierName = tierLabelBySportEventParticipantId.get(pick.sportEventParticipant.id) ?? 'Selections';
    const participants = groups.get(tierName) ?? [];
    participants.push(pick.sportEventParticipant.participant.name);
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
