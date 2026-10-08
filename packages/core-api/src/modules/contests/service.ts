/**
 * ContestService — contest creation, retrieval, update, and deletion.
 *
 * Implements the multi-step contest wizard: sport/event, draft config,
 * scoring rules, payout structure, and scheduling.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestConfigurationRepository,
  ContestEntryPickRepository,
  ContestEntryPickWithParticipant,
  ContestEntryStandingRepository,
  ContestRepository,
  ContestEntryRepository,
  LeagueMembershipRepository,
  LeagueRepository,
  ParticipantContestScoringRuleRepository,
  SportEventRepository,
  SquadMembershipRepository,
  SquadRepository,
  UserRepository,
} from '@poolmaster/shared/db';
import type {
  Contest,
  ContestEntry,
  ContestConfiguration,
  LeagueMembership,
  SquadMembership,
} from '@poolmaster/shared/domain';
import {
  ContestStatus,
  deriveLegacyParticipantStatus,
  LeagueMembershipStatus,
  LeagueRole,
  Sport,
  SquadMembershipStatus,
  PARTICIPANT_SCORING_DEFINITIONS,
} from '@poolmaster/shared/domain';
import type { ContestEntryDto } from '@poolmaster/shared/dto';
import {
  toContestEntryDto,
  type ContestEntryParticipantRow,
  type ContestLeaderboardModel,
} from '../../mappers/contests.mapper';
import {
  applySettledContestStandings,
  buildContestEntryStanding,
  rankContestEntryStandings,
  resolveContestCountingRule,
  resolveContestScoringDefinition,
} from './contest-leaderboard-calculator';
import {
  loadContestLeaderboardEntries,
  loadContestScoringConfiguration,
  loadEventField,
  toParticipantScores,
} from './contest-leaderboard-reads';
import { areContestEntriesOpen } from './entry-window';
import type { SportEventParticipantService } from '../events/sport-event-participant-service';
import type { SportEventTierService } from '../events/sport-event-tier-service';
import {
  renderSystemEmailTemplate,
  type ContestEntryCompletedTierSelection,
  type MailDeliveryProvider,
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
  isExclusive?: boolean;
}

interface ContestEntryReceiptData {
  id: string;
  contestId: string;
  name: string;
  tiebreakerValue: number | null;
  updatedAt: Date;
  squad: {
    name: string;
  };
  contest: {
    id: string;
    leagueId: string;
    name: string;
    sportEventId: string | null;
    configuration: {
      tierConfig: unknown;
      rosterSize: number | null;
      pickCount: number | null;
      rounds: number | null;
    } | null;
    league: {
      name: string;
      leagueCode: string;
    };
  };
  picks: Array<{
    pickedAt: Date;
    sportEventParticipant: {
      id: string;
      participant: {
        id: string;
        name: string;
      };
    };
  }>;
}

interface EmailTierDefinition {
  tierId: string;
  tierName: string;
  tierNumber: number;
  picksFromTier: number;
  participantIds: string[];
}

interface EmailRecipientUser {
  email: string;
  firstName: string;
  lastName: string;
  username: string;
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
  standings: ContestEntryStandingRepository;
  memberships: LeagueMembershipRepository;
  squads: SquadRepository;
  squadMemberships: SquadMembershipRepository;
  leagues: LeagueRepository;
  users: UserRepository;
  sportEvents: SportEventRepository;
  eventParticipants: Pick<SportEventParticipantService, 'listEventParticipants'>;
  tiers: Pick<SportEventTierService, 'getEffectiveValuationsForSportEvent'>;
  logger?: LifecycleLogger;
  mailDelivery?: MailDeliveryProvider;
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
  ): Promise<{ contest: Contest; contestConfiguration: ContestConfiguration | null } | null> {
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
    const contestConfiguration = await this.deps.configurations.findByContest(contestId);
    this.logger.info({
      contestId,
      hasConfiguration: contestConfiguration !== null,
    }, 'contest get completed');
    return { contest, contestConfiguration };
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
      counts.set(contestId, entries.length);
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
    const picksRevealed = contestPicksRevealed(context.contest.status);
    const entries = await this.loadEntryDetailDtos(contestId, {
      requesterSquadId: squadId,
      revealAll: picksRevealed,
    });
    const myEntries = squadId
      ? entries.filter((entry) => entry.squadId === squadId)
      : [];
    const myEntry = myEntries[0] ?? null;
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

  async getMyEntry(
    contestId: string,
    userId: string,
  ): Promise<ContestEntryDto | null> {
    const context = await this.getEntryContext(contestId, userId, 'read');
    if (!context.squadMembership) {
      return null;
    }
    const entries = await this.loadEntryDtos(contestId);
    return entries.find((entry) => entry.squadId === context.squadMembership?.squadId) ?? null;
  }

  async getEntryDetail(
    contestId: string,
    entryId: string,
    requesterUserId: string,
  ): Promise<{ entry: ContestEntryDto; picksRevealed: boolean }> {
    const context = await this.getEntryContext(contestId, requesterUserId, 'read');
    const requesterSquadId = context.squadMembership?.squadId ?? null;
    const picksRevealed = contestPicksRevealed(context.contest.status);

    const found = await this.deps.entries.findByIdWithSquad(entryId);
    const row = found?.contestId === contestId ? found : null;
    if (!row) {
      throw new ContestEntryNotFoundError(contestId, entryId);
    }

    // pool-master-dxd.13 — non-owning squad members cannot see picks while the
    // contest is still joinable; owning squad members see their own picks
    // regardless of contest status.
    const isOwner = requesterSquadId !== null && row.squadId === requesterSquadId;
    const includeParticipants = picksRevealed || isOwner;
    const picks = await this.deps.picks.findByEntriesWithParticipant([row.id]);

    const entry = toContestEntryDto(
      {
        ...row,
        picksCount: picks.length,
      },
      {
        name: row.squadName,
      },
      includeParticipants ? picks.map(toContestEntryParticipantRow) : null,
    );

    return { entry, picksRevealed };
  }

  async getGolfLeaderboard(
    contestId: string,
    requesterUserId: string,
  ): Promise<ContestLeaderboardModel> {
    const context = await this.getEntryContext(contestId, requesterUserId, 'read');
    if (!contestPicksRevealed(context.contest.status)) {
      throw new ContestOperationError(
        'Golf leaderboard is not available until contest picks are revealed.',
        'CONTEST_GOLF_LEADERBOARD_PICKS_HIDDEN',
      );
    }

    const { contest } = context;
    if (!contest.sportEventId) {
      throw new ContestOperationError(
        'Golf leaderboard requires a contest sport event.',
        'CONTEST_GOLF_LEADERBOARD_EVENT_REQUIRED',
      );
    }
    const sportEvent = await this.deps.sportEvents.findById(contest.sportEventId);
    if (!sportEvent) {
      throw new ContestOperationError(
        'Golf leaderboard requires a contest sport event.',
        'CONTEST_GOLF_LEADERBOARD_EVENT_REQUIRED',
      );
    }
    if (sportEvent.sport !== Sport.GOLF) {
      throw new ContestOperationError(
        'Golf leaderboard is only available for Golf contests.',
        'CONTEST_GOLF_LEADERBOARD_SPORT_UNSUPPORTED',
      );
    }

    const configuration = await loadContestScoringConfiguration(this.deps, contestId);
    const countingRule = resolveContestCountingRule(configuration);
    if (!countingRule) {
      throw new ContestOperationError(
        'Golf leaderboard requires a contest configuration with countedScores, rosterSize, or pickCount.',
        'CONTEST_GOLF_LEADERBOARD_COUNTING_RULE_MISSING',
      );
    }
    const scoring = resolveContestScoringDefinition(configuration);
    if (!scoring.ok) {
      throw scoring.reason === 'RULE_MISSING'
        ? new ContestOperationError(
          'Golf leaderboard requires the contest configuration to carry a participant scoring rule.',
          'CONTEST_GOLF_LEADERBOARD_SCORING_RULE_MISSING',
        )
        : new ContestOperationError(
          'Golf leaderboard requires a participant scoring rule with a known scoring definition.',
          'CONTEST_GOLF_LEADERBOARD_SCORING_DEFINITION_UNKNOWN',
        );
    }
    const { id: scoringDefinitionId, definition: scoringDefinition } = scoring;
    const [field, entries] = await Promise.all([
      loadEventField(this.deps, sportEvent.id),
      loadContestLeaderboardEntries(this.deps, contestId),
    ]);
    const scores = toParticipantScores(field);
    const scoreById = new Map(scores.map((score) => [score.sportEventParticipantId, score]));

    const entryRows = entries.map((entry) =>
      buildContestEntryStanding(entry, scoreById, countingRule, scoringDefinition.direction),
    );
    const rankedEntries = rankContestEntryStandings(entryRows, scoringDefinition.direction);
    const latestAsOf = scores.reduce<Date | null>((latest, participant) => {
      if (!participant.asOf) return latest;
      if (!latest || participant.asOf.getTime() > latest.getTime()) return participant.asOf;
      return latest;
    }, null);

    // A settled contest answers from its frozen standings (#246); a live one computes.
    if (context.contest.status === ContestStatus.COMPLETED) {
      const standings = await this.deps.standings.findByContest(contestId);
      if (standings.length > 0) {
        return {
          contestId,
          sportEventId: sportEvent.id,
          sport: sportEvent.sport,
          scoringDefinitionId,
          countingRule: { type: 'BEST_N_GOLFERS', count: standings[0].countingPickLimit },
          participants: field,
          entries: applySettledContestStandings(
            rankedEntries,
            standings.map((standing) => ({
              contestEntryId: standing.contestEntryId,
              position: standing.position,
              displayPosition: standing.displayPosition,
              countingPickLimit: standing.countingPickLimit,
              scoredPickCount: standing.scoredPickCount,
              score: standing.golf?.totalScoreToPar ?? null,
            })),
          ),
          asOf: standings[0].asOf ?? latestAsOf,
        };
      }
      this.logger.warn({ contestId }, 'completed contest has no settled standings; leaderboard computed live');
    }

    return {
      contestId,
      sportEventId: sportEvent.id,
      sport: sportEvent.sport,
      scoringDefinitionId,
      countingRule,
      participants: field,
      entries: rankedEntries,
      asOf: latestAsOf,
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
      throw new ContestEntryOperationError(
        'Contest entries can only be changed before the contest starts',
        'CONTEST_ENTRY_LOCKED',
      );
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
        'This squad has already reached the entry limit for the contest',
        'CONTEST_ENTRY_LIMIT_REACHED',
      );
    }

    // Past the highest number the squad holds in this contest, not its entry count: leaving
    // deletes the first entry and keeps the later ones, so a count would reuse a number still
    // taken, and (contest, squad, entry number) is unique.
    const nextEntryNumber = (await this.findHighestEntryNumber(contestId, squad.id)) + 1;
    const created = await this.deps.entries.create({
      contestId,
      squadId: squad.id,
      entryNumber: nextEntryNumber,
      name: buildDefaultEntryName(squad.name, nextEntryNumber),
      status: 'ACTIVE',
      isEliminated: false,
    });
    const dto = await this.loadEntryDtoById(created.id);
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
      throw new ContestEntryOperationError(
        'Contest entries can only be changed before the contest starts',
        'CONTEST_ENTRY_LOCKED',
      );
    }
    if (!context.squadMembership) {
      this.logger.warn({ contestId, userId }, 'contest entry delete missing squad manager');
      throw new ContestEntryAccessError(
        'You do not manage a squad in this league',
        'SQUAD_MANAGER_REQUIRED',
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

    await this.deps.entries.delete(existing.id);
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
      throw new ContestEntryOperationError(
        'Contest entries can only be changed before the contest starts',
        'CONTEST_ENTRY_LOCKED',
      );
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
          'This team already has another entry with that name in the contest',
          'CONTEST_ENTRY_NAME_DUPLICATE',
        );
      }

      pendingUpdates.name = sanitizedName;
    }

    if (updates.tiebreakerValue !== undefined) {
      pendingUpdates.tiebreakerValue = updates.tiebreakerValue;
    }

    await this.deps.entries.update(entryId, pendingUpdates);
    const dto = await this.loadEntryDtoById(entryId);
    await this.deliverContestEntryCompletedEmail(contestId, entryId, userId);
    this.logger.info({ contestId, entryId, userId }, 'contest entry update completed');
    return dto;
  }

  private async deliverContestEntryCompletedEmail(
    contestId: string,
    entryId: string,
    userId: string,
  ): Promise<void> {
    if (!this.deps.mailDelivery) {
      this.logger.debug({
        action: 'contestEntry.emailDelivery.skipped',
        data: { contestId, entryId },
      }, 'Skipped contest entry confirmation email because dependencies are unavailable');
      return;
    }

    const [entry, user] = await Promise.all([
      this.loadContestEntryReceiptData(entryId),
      this.deps.users.findById(userId),
    ]);

    if (!entry || entry.contestId !== contestId) {
      this.logger.warn({
        action: 'contestEntry.emailDelivery.entryMissing',
        data: { contestId, entryId },
      }, 'Skipped contest entry confirmation email because entry data was unavailable');
      return;
    }
    if (!user) {
      this.logger.warn({
        action: 'contestEntry.emailDelivery.userMissing',
        data: { contestId, entryId, userId },
      }, 'Skipped contest entry confirmation email because user data was unavailable');
      return;
    }

    const requiredSelections = getRequiredSelectionCount(entry.contest.configuration);
    if (requiredSelections <= 0 || entry.picks.length < requiredSelections) {
      this.logger.debug({
        action: 'contestEntry.emailDelivery.incompleteLineup',
        data: {
          contestId,
          entryId,
          requiredSelections,
          savedSelections: entry.picks.length,
        },
      }, 'Skipped contest entry confirmation email because lineup is incomplete');
      return;
    }

    if (entry.tiebreakerValue === null || entry.tiebreakerValue === undefined) {
      this.logger.debug({
        action: 'contestEntry.emailDelivery.missingTiebreaker',
        data: { contestId, entryId },
      }, 'Skipped contest entry confirmation email because tiebreaker is missing');
      return;
    }

    const message = renderSystemEmailTemplate('CONTEST_ENTRY_COMPLETED', {
      userName: formatUserName(user),
      leagueName: entry.contest.league.name,
      contestName: entry.contest.name,
      teamName: entry.squad.name,
      entryName: entry.name,
      entryUrl: buildEntryUrl(
        this.appBaseUrl,
        entry.contest.league.leagueCode,
        contestId,
        entryId,
      ),
      submittedAt: entry.updatedAt,
      // The tiebreaker is a predicted winning score relative to par.
      tiebreaker: PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL.format(
        entry.tiebreakerValue,
      ),
      tiers: await this.buildEntryTierSelectionsForEmail(entry),
    });

    try {
      await this.deps.mailDelivery.send({
        to: user.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
        metadata: {
          templateKey: message.templateKey,
          leagueId: entry.contest.leagueId,
          contestId,
          entryId,
        },
      });
      this.logger.info({
        action: 'contestEntry.emailDelivery.success',
        data: {
          contestId,
          entryId,
          templateKey: message.templateKey,
        },
      }, 'Delivered contest entry confirmation email');
    } catch (err) {
      this.logger.error({
        action: 'contestEntry.emailDelivery.failure',
        data: {
          contestId,
          entryId,
          templateKey: message.templateKey,
          error: err instanceof Error ? err.message : String(err),
        },
      }, 'Failed to deliver contest entry confirmation email');
    }
  }

  /**
   * Resolves each pick's tier label through SportEventTierService (plans/124
   * §4.6b) rather than the dropped legacy SportEventParticipant.valuations
   * table — the one remaining fallback path for entries whose contest has
   * no typed tierConfig (only the legacy contests/routes.ts create path
   * ever populates tierConfig).
   */
  private async buildEntryTierSelectionsForEmail(
    entry: ContestEntryReceiptData,
  ): Promise<ContestEntryCompletedTierSelection[]> {
    const tierLabelBySportEventParticipantId = new Map<string, string>();
    if (entry.contest.sportEventId) {
      const valuations = await this.deps.tiers.getEffectiveValuationsForSportEvent(entry.contest.sportEventId);
      for (const valuation of valuations) {
        if (valuation.tierLabel !== null) {
          tierLabelBySportEventParticipantId.set(valuation.sportEventParticipantId, valuation.tierLabel);
        }
      }
    }
    return buildEntryTierSelections(entry, tierLabelBySportEventParticipantId);
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
    const [configuration, league, picks] = await Promise.all([
      this.deps.configurations.findByContest(contest.id),
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
      tiebreakerValue: entry.tiebreakerValue ?? null,
      updatedAt: entry.updatedAt,
      squad: { name: entry.squadName },
      contest: {
        id: contest.id,
        leagueId: contest.leagueId,
        name: contest.name,
        sportEventId: contest.sportEventId ?? null,
        configuration: configuration
          ? {
            tierConfig: configuration.tierConfig ?? null,
            rosterSize: configuration.rosterSize ?? null,
            pickCount: configuration.pickCount ?? null,
            rounds: configuration.rounds ?? null,
          }
          : null,
        league: { name: league.name, leagueCode: league.leagueCode },
      },
      picks: picks.map((pick) => ({
        pickedAt: pick.pickedAt,
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
          'Your membership of this team has ended',
          'SQUAD_MEMBERSHIP_INACTIVE',
        );
      }
    }
    return { contest, membership, squadMembership };
  }

  /** Whether entries can change now: see entry-window.ts. */
  private async areEntriesOpen(contest: Contest): Promise<boolean> {
    const sportEvent = contest.status === ContestStatus.OPEN && contest.sportEventId
      ? await this.deps.sportEvents.findById(contest.sportEventId)
      : null;
    return areContestEntriesOpen(contest, sportEvent, this.now());
  }

  private async findEntriesBySquad(
    contestId: string,
    squadId: string,
  ): Promise<ContestEntry[]> {
    const entries = await this.deps.entries.findBySquad(squadId);
    return entries
      .filter((entry) => entry.contestId === contestId && entry.status === 'ACTIVE')
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

  private async loadEntryDtos(contestId: string): Promise<ContestEntryDto[]> {
    const rows = await this.deps.entries.findByContestWithSquad(contestId);
    const pickCountByEntry = await this.deps.picks.countByEntries(rows.map((row) => row.id));

    return rows.map((row) =>
      toContestEntryDto({
        ...row,
        picksCount: pickCountByEntry.get(row.id) ?? 0,
      }, {
        name: row.squadName,
      }),
    );
  }

  private async loadEntryDetailDtos(
    contestId: string,
    options: { requesterSquadId: string | null; revealAll: boolean },
  ): Promise<ContestEntryDto[]> {
    const rows = await this.deps.entries.findByContestWithSquad(contestId);

    const entryIds = rows.map((row) => row.id);
    const pickCountByEntry = await this.deps.picks.countByEntries(entryIds);

    // Determine which entries get participant detail bundled in.
    // - Always include for the requester's own squad (owners see their picks pre-reveal).
    // - When revealAll (post-event-start), include for every entry.
    const ownEntryIds = options.requesterSquadId
      ? rows.filter((row) => row.squadId === options.requesterSquadId).map((row) => row.id)
      : [];
    const entryIdsWithParticipants = new Set<string>(
      options.revealAll ? entryIds : ownEntryIds,
    );

    const participantsByEntry = entryIdsWithParticipants.size === 0
      ? new Map<string, ContestEntryParticipantRow[]>()
      : await this.loadParticipantsForEntries([...entryIdsWithParticipants]);

    return rows.map((row) => {
      const includeParticipants = entryIdsWithParticipants.has(row.id);
      return toContestEntryDto(
        {
          ...row,
          picksCount: pickCountByEntry.get(row.id) ?? 0,
        },
        { name: row.squadName },
        includeParticipants ? (participantsByEntry.get(row.id) ?? []) : null,
      );
    });
  }

  private async loadParticipantsForEntries(
    entryIds: string[],
  ): Promise<Map<string, ContestEntryParticipantRow[]>> {
    const picks = await this.deps.picks.findByEntriesWithParticipant(entryIds);
    const grouped = new Map<string, ContestEntryParticipantRow[]>();
    for (const pick of picks) {
      const list = grouped.get(pick.entryId) ?? [];
      list.push(toContestEntryParticipantRow(pick));
      grouped.set(pick.entryId, list);
    }
    return grouped;
  }

  private async loadEntryDtoById(entryId: string): Promise<ContestEntryDto> {
    const row = await this.deps.entries.findByIdWithSquad(entryId);
    if (!row) {
      throw new ContestEntryOperationError(
        `Contest entry not found: ${entryId}`,
        'CONTEST_ENTRY_NOT_FOUND',
      );
    }

    const pickCounts = await this.deps.picks.countByEntries([row.id]);
    return toContestEntryDto({
      ...row,
      picksCount: pickCounts.get(row.id) ?? 0,
    }, {
      name: row.squadName,
    });
  }

  private async assertEntryFieldReady(contest: Contest, userId: string): Promise<void> {
    if (!contest.sportEventId) {
      return;
    }

    const loadedParticipantCount = (await this.deps.sportEvents.countParticipants([contest.sportEventId]))
      .get(contest.sportEventId) ?? 0;
    if (loadedParticipantCount > 0) {
      return;
    }

    this.logger.warn({
      contestId: contest.id,
      sportEventId: contest.sportEventId,
      userId,
    }, 'contest entry create rejected because event participant field is not loaded');
    throw new ContestEntryOperationError(
      'Contest entries are not available until the event participant field has loaded.',
      'CONTEST_ENTRY_FIELD_NOT_LOADED',
    );
  }

  private async entryHasSelections(entryId: string): Promise<boolean> {
    // Picks alone decide it: every DraftPickHistory row references an existing pick (a required
    // foreign key), so the draft-history count the raw read also added could never be non-zero
    // while the pick count was zero.
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
      'You must have an active team in this league before entering a contest',
      'SQUAD_MEMBERSHIP_REQUIRED',
    );
  }

  private async getMaxEntriesPerSquad(contestId: string): Promise<number | null> {
    const configuration = await this.deps.configurations.findByContest(contestId);
    if (!configuration) {
      return 1;
    }

    // A managed configuration (one with a typed configJson) treats a missing limit as
    // unlimited; an untyped one as a single entry. Same rule as toContestConfigurationDetailDto.
    if (!configuration.configJson) {
      return configuration.maxEntriesPerSquad ?? 1;
    }

    return configuration.maxEntriesPerSquad ?? null;
  }


}

export class ContestNotFoundError extends Error {
  constructor(contestId: string) {
    super(`Contest not found: ${contestId}`);
    this.name = 'ContestNotFoundError';
  }
}

export class ContestOperationError extends Error {
  code: string;

  constructor(reason: string, code = 'CONTEST_OPERATION_INVALID') {
    super(reason);
    this.name = 'ContestOperationError';
    this.code = code;
  }
}

export class ContestEntryOperationError extends Error {
  code: string;

  constructor(reason: string, code = 'CONTEST_ENTRY_OPERATION_INVALID') {
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
  code: string;

  constructor(reason: string, code: string) {
    super(reason);
    this.name = 'ContestEntryAccessError';
    this.code = code;
  }
}

export class ContestEntryNotFoundError extends Error {
  constructor(contestId: string, squadId: string) {
    super(`Contest entry not found for contest ${contestId} and squad ${squadId}`);
    this.name = 'ContestEntryNotFoundError';
  }
}

function buildDefaultEntryName(squadName: string, entryNumber: number): string {
  return `${squadName} Entry ${entryNumber}`;
}

/** A pick as a contest entry shows it: the pick and the participant it points at. */
function toContestEntryParticipantRow(pick: ContestEntryPickWithParticipant): ContestEntryParticipantRow {
  return {
    pickId: pick.id,
    sportEventParticipantId: pick.sportEventParticipantId,
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

function getRequiredSelectionCount(
  configuration: ContestEntryReceiptData['contest']['configuration'],
): number {
  const tierDefinitions = readEmailTierDefinitions(configuration?.tierConfig);
  if (tierDefinitions.length > 0) {
    return tierDefinitions.reduce((sum, tier) => sum + tier.picksFromTier, 0);
  }
  return configuration?.rosterSize ?? configuration?.pickCount ?? configuration?.rounds ?? 0;
}

function buildEntryTierSelections(
  entry: ContestEntryReceiptData,
  tierLabelBySportEventParticipantId: Map<string, string>,
): ContestEntryCompletedTierSelection[] {
  const tierDefinitions = readEmailTierDefinitions(entry.contest.configuration?.tierConfig);
  if (tierDefinitions.length > 0) {
    const picksByParticipantId = new Map<string, string[]>();
    const assignedPickIds = new Set<string>();
    for (const pick of entry.picks) {
      const participantName = pick.sportEventParticipant.participant.name;
      const participantIds = [
        pick.sportEventParticipant.id,
        pick.sportEventParticipant.participant.id,
      ];
      for (const participantId of participantIds) {
        const existing = picksByParticipantId.get(participantId) ?? [];
        existing.push(participantName);
        picksByParticipantId.set(participantId, existing);
      }
    }

    const selections = tierDefinitions.map((tier) => {
      const participantNames: string[] = [];
      for (const participantId of tier.participantIds) {
        participantNames.push(...(picksByParticipantId.get(participantId) ?? []));
      }
      for (const pick of entry.picks) {
        if (participantNames.includes(pick.sportEventParticipant.participant.name)) {
          assignedPickIds.add(pick.sportEventParticipant.id);
        }
      }
      return {
        tierName: tier.tierName,
        participantNames,
      };
    });

    const unassigned = entry.picks
      .filter((pick) => !assignedPickIds.has(pick.sportEventParticipant.id))
      .map((pick) => pick.sportEventParticipant.participant.name);
    if (unassigned.length > 0) {
      selections.push({ tierName: 'Other selections', participantNames: unassigned });
    }
    return selections.filter((selection) => selection.participantNames.length > 0);
  }

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

function readEmailTierDefinitions(tierConfig: unknown): EmailTierDefinition[] {
  if (!Array.isArray(tierConfig)) return [];
  return tierConfig
    .map((tier, index) => {
      const record = tier as Record<string, unknown>;
      return {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- reading legacy/untrusted stored JSON config; the fallback chain is the safety net, not the type.
        tierId: String(record.tierId ?? record.tierName ?? `tier-${index + 1}`),
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- reading legacy/untrusted stored JSON config; the fallback chain is the safety net, not the type.
        tierName: String(record.tierName ?? record.tierId ?? `Tier ${index + 1}`),
        tierNumber: Number(record.tierNumber ?? index + 1),
        picksFromTier: Number(record.picksFromTier ?? record.pickCount ?? 1),
        participantIds: Array.isArray(record.participantIds)
          ? record.participantIds.map((value) => String(value))
          : [],
      };
    })
    .sort((left, right) => left.tierNumber - right.tierNumber);
}

function formatUserName(user: EmailRecipientUser): string {
  const fullName = [user.firstName, user.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
  return fullName || user.username || user.email;
}

function buildEntryUrl(
  appBaseUrl: string,
  leagueCode: string,
  contestId: string,
  entryId: string,
): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/league/${encodeURIComponent(leagueCode)}/contests/${encodeURIComponent(contestId)}/entries/${encodeURIComponent(entryId)}`;
}

/**
 * Whether participant picks on a contest are visible to non-owning squad members.
 *
 * pool-master-dxd.13 — picks are hidden from non-owners until the contest moves past
 * taking entries (DRAFT or OPEN). Once it progresses (DRAFTING, LOCKED, ACTIVE, COMPLETED,
 * CANCELLED), picks are public to every league member.
 */
export function contestPicksRevealed(status: ContestStatus): boolean {
  return status !== ContestStatus.DRAFT && status !== ContestStatus.OPEN;
}

