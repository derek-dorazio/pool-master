/**
 * LeagueService — league creation, retrieval, and lifecycle management.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type {
  LeagueMembershipRepository,
  LeagueRepository,
  LeagueSearchFilters,
  SquadMembershipRepository,
  SquadRepository,
  UserRepository,
} from '@poolmaster/shared/db';
import type {
  League,
  LeagueMembership,
} from '@poolmaster/shared/domain';
import { ContestStatus, CupPointsScale, LeagueIconKey, LeagueMembershipStatus, LeagueRole, PlanFeature } from '@poolmaster/shared/domain';
import { PlanFeatureNotIncludedError } from '../plans/plan-feature-error';
import { lockContestRows } from '../../adapters';
import { ensureDefaultSquadForLeagueMember } from '../squads/default-squad';
import { RESERVED_LEAGUE_CODES } from '../email';
import type { ApiErrorCode } from '@poolmaster/shared/dto';

export interface CreateLeagueInput {
  createdBy: string;
  name: string;
  leagueCode: string;
  description?: string;
}

export interface UpdateLeagueDetailsInput {
  name: string;
  description?: string;
  iconKey: LeagueIconKey;
}

export interface UpdateLeagueCupSettingsInput {
  cupName: string;
  cupPointsScale: CupPointsScale;
  cupCustomPoints: number[];
  hallOfLameVisible: boolean;
}

// #202 — `UserLeagueView` and `findByUser` are gone. `listLeagues({ scope: 'mine' })` is that
// read, and `LeagueListRow` is its row: the same league-plus-membership pairing, with the counts
// the old one omitted and a nullable membership so the unscoped scope shares the shape.

/**
 * A league in a list, with its counts and the VIEWER's membership in it (#202).
 *
 * `membership` is null only under `scope: 'all'`, for a league the viewer does not belong to.
 * The counts are always real: the member-scoped list used to omit them, so every league it
 * returned reported `memberCount: 0` and `activeContestCount: 0` while the root-admin list
 * reported the truth. One operation computes them once.
 */
export interface LeagueListRow {
  league: League;
  membership: LeagueMembership | null;
  memberCount: number;
  activeContestCount: number;
}

export type LeagueListScope = 'mine' | 'all';

/**
 * Statuses that make a contest count as active for a league's `activeContestCount`. DRAFT is
 * not one (#117): a draft is the commissioner's private setup, not a contest the league has.
 */
const ACTIVE_LEAGUE_CONTEST_STATUSES = [
  ContestStatus.OPEN,
  ContestStatus.ACTIVE,
] as const;

/**
 * Everything LeagueService reads and writes (#211). It replaced a six-parameter positional
 * constructor, where a dependency added mid-list silently shifted every argument after it.
 */
export interface LeagueServiceDeps {
  leagues: LeagueRepository;
  memberships: LeagueMembershipRepository;
  squads?: SquadRepository;
  squadMemberships?: SquadMembershipRepository;
  users: UserRepository;
  prisma?: PrismaClient;
  logger?: FastifyBaseLogger;
}

export class LeagueService {
  private readonly logger?: FastifyBaseLogger;

  constructor(private readonly deps: LeagueServiceDeps) {
    this.logger = deps.logger;
  }

  /** Creates a new league and adds the creator as a commissioner. */
  async createLeague(input: CreateLeagueInput): Promise<{ league: League; membership: LeagueMembership }> {
    this.logger?.debug({
      action: 'league.create.enter',
      data: {
        createdBy: input.createdBy,
        leagueCode: input.leagueCode,
        hasDescription: Boolean(input.description?.trim()),
      },
    }, 'Creating league');
    if (RESERVED_LEAGUE_CODES.has(input.leagueCode.toUpperCase())) {
      this.logger?.warn({
        action: 'league.create.reservedCode',
        data: { createdBy: input.createdBy, leagueCode: input.leagueCode },
      }, 'Rejected a league code that is an email role address');
      throw new LeagueCodeReservedError(input.leagueCode);
    }
    const existingLeague = await this.deps.leagues.findByCode(input.leagueCode);
    if (existingLeague) {
      this.logger?.warn({
        action: 'league.create.conflict',
        data: {
          createdBy: input.createdBy,
          leagueCode: input.leagueCode,
          existingLeagueId: existingLeague.id,
        },
      }, 'Rejected duplicate league code');
      throw new LeagueCodeConflictError(input.leagueCode);
    }
    // #202 — `input.createdBy` is not written to the League. It is the userId that
    // becomes the first COMMISSIONER membership below, which is the authoritative
    // record of who runs the league (§12).
    const league = await this.deps.leagues.create({
      leagueCode: input.leagueCode,
      name: input.name,
      description: input.description?.trim() || undefined,
      isActive: true,
      iconKey: LeagueIconKey.TROPHY,
      // The championship's name until the commissioner renames it (#863).
      cupName: `${input.name} Cup`,
    });
    const membership = await this.deps.memberships.create({
      leagueId: league.id,
      userId: input.createdBy,
      role: LeagueRole.COMMISSIONER,
      status: LeagueMembershipStatus.ACTIVE,
      joinedAt: new Date(),
    });

    await this.ensureDefaultSquad(league.id, input.createdBy);

    this.logger?.info({
      action: 'league.create.success',
      data: {
        leagueId: league.id,
        membershipId: membership.id,
        createdBy: input.createdBy,
      },
    }, 'Created league with commissioner membership');

    return { league, membership };
  }

  async findByCode(leagueCode: string): Promise<League | null> {
    return this.deps.leagues.findByCode(leagueCode.toUpperCase());
  }

  /**
   * The league list — ONE operation, scope as a parameter (#202).
   *
   * This replaced `listLeagues` + `adminListLeagues`, which
   * `docs/DOMAIN-OPERATIONS.md` names as one operation split in two. They disagreed in two
   * ways beyond scope, and both are settled here rather than merged:
   *
   * - **Counts.** The member-scoped list called `toLeagueDto(league)` with no counts, so it
   *   reported `memberCount: 0` and `activeContestCount: 0` for every league; only the
   *   root-admin list computed them. They are computed once now, for both scopes.
   * - **Filters.** `search` and `isActive` existed only on the root-admin half. They are
   *   properties of the query, not of the caller, so they apply to both.
   *
   * `scope: 'all'` is access rule A1's unscoped read; the CALLER of this method is
   * responsible for having established root-admin authority, because a service cannot see
   * the request. The route does that.
   */
  async listLeagues(options: {
    scope: LeagueListScope;
    userId: string;
    filters?: LeagueSearchFilters;
  }): Promise<LeagueListRow[]> {
    const { scope, userId, filters } = options;
    this.logger?.debug({
      action: 'league.list.enter',
      data: {
        scope,
        userId,
        hasSearch: Boolean(filters?.search),
        isActive: filters?.isActive ?? null,
      },
    }, 'Listing leagues');

    // Under 'mine' the viewer's memberships come back with the leagues, so no second read
    // is needed to pair them. Under 'all' the memberships are looked up separately, because
    // most of the returned leagues will have none for this viewer.
    const [leagues, viewerMemberships] = await Promise.all([
      scope === 'all'
        ? this.deps.leagues.findAll(filters)
        : this.deps.leagues.findByUser(userId, filters),
      this.deps.memberships.findByUser(userId),
    ]);

    const membershipByLeagueId = new Map(
      viewerMemberships.map((membership) => [membership.leagueId, membership]),
    );
    const counts = await this.countLeagueActivity(leagues.map((league) => league.id));

    const rows = leagues.map((league) => ({
      league,
      membership: membershipByLeagueId.get(league.id) ?? null,
      memberCount: counts.memberCounts.get(league.id) ?? 0,
      activeContestCount: counts.activeContestCounts.get(league.id) ?? 0,
    }));

    this.logger?.info({
      action: 'league.list.success',
      data: { scope, userId, leagueCount: rows.length },
    }, 'Listed leagues');
    return rows;
  }

  /**
   * Active member and active contest counts for a set of leagues.
   *
   * Public because the single-league reads need it too: they used to send
   * `activeContestCount: 0` unconditionally, which is a value invented by the mapper's
   * default rather than read from the data.
   *
   * Two reads, not one per league. The membership side goes through its port; the contest
   * side is the one raw Prisma query left in this service, because `ContestRepository` has
   * no count — that is slice 3, and it is marked so the sweep finds it.
   */
  async countLeagueActivity(leagueIds: string[]): Promise<{
    memberCounts: Map<string, number>;
    activeContestCounts: Map<string, number>;
  }> {
    if (!leagueIds.length) {
      return { memberCounts: new Map(), activeContestCounts: new Map() };
    }

    const [memberCounts, contestRows] = await Promise.all([
      this.deps.memberships.countActiveByLeagues(leagueIds),
      // SLICE 3 — replace with a ContestRepository count once that cluster has ports.
      this.deps.prisma
        ? this.deps.prisma.contest.groupBy({
          by: ['leagueId'],
          where: {
            leagueId: { in: leagueIds },
            status: { in: [...ACTIVE_LEAGUE_CONTEST_STATUSES] },
          },
          _count: { _all: true },
        })
        : Promise.resolve([]),
    ]);

    return {
      memberCounts,
      activeContestCounts: new Map(
        contestRows.map((row) => [row.leagueId, row._count._all]),
      ),
    };
  }

  async inactivateLeague(leagueId: string): Promise<League> {
    this.logger?.debug({
      action: 'league.inactivate.enter',
      data: { leagueId },
    }, 'Inactivating league');
    const league = await this.deps.leagues.findById(leagueId);
    if (!league) {
      this.logger?.warn({
        action: 'league.inactivate.notFound',
        data: { leagueId },
      }, 'Cannot inactivate missing league');
      throw new LeagueNotFoundError(leagueId);
    }

    if (!league.isActive) {
      this.logger?.warn({
        action: 'league.inactivate.alreadyInactive',
        data: { leagueId },
      }, 'League already inactive');
      throw new LeagueOperationError(
        'League is already inactive',
        'LEAGUE_ALREADY_INACTIVE',
      );
    }

    const updatedLeague = await this.deps.leagues.update(leagueId, { isActive: false });
    this.logger?.info({
      action: 'league.inactivate.success',
      data: { leagueId },
    }, 'Inactivated league');
    return updatedLeague;
  }

  async activateLeague(leagueId: string): Promise<League> {
    this.logger?.debug({
      action: 'league.activate.enter',
      data: { leagueId },
    }, 'Activating league');
    const league = await this.deps.leagues.findById(leagueId);
    if (!league) {
      this.logger?.warn({
        action: 'league.activate.notFound',
        data: { leagueId },
      }, 'Cannot activate missing league');
      throw new LeagueNotFoundError(leagueId);
    }

    if (league.isActive) {
      this.logger?.warn({
        action: 'league.activate.alreadyActive',
        data: { leagueId },
      }, 'League already active');
      throw new LeagueOperationError(
        'League is already active',
        'LEAGUE_ALREADY_ACTIVE',
      );
    }

    const updatedLeague = await this.deps.leagues.update(leagueId, { isActive: true });
    this.logger?.info({
      action: 'league.activate.success',
      data: { leagueId },
    }, 'Activated league');
    return updatedLeague;
  }

  async updateLeagueDetails(leagueId: string, updates: UpdateLeagueDetailsInput): Promise<League> {
    this.logger?.debug({
      action: 'league.updateDetails.enter',
      data: {
        leagueId,
        hasDescription: updates.description !== undefined,
        iconKey: updates.iconKey,
      },
    }, 'Updating league details');
    const league = await this.deps.leagues.findById(leagueId);
    if (!league) {
      this.logger?.warn({
        action: 'league.updateDetails.notFound',
        data: { leagueId },
      }, 'Cannot update details for missing league');
      throw new LeagueNotFoundError(leagueId);
    }

    if (!league.isActive) {
      this.logger?.warn({
        action: 'league.updateDetails.readOnlyInactive',
        data: { leagueId },
      }, 'Rejected detail update for inactive league');
      throw new LeagueOperationError(
        'Inactive leagues are read-only outside lifecycle actions',
        'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE',
      );
    }

    // The details PUT replaces name, description and icon in one write, so a save never lands
    // half-applied. An omitted or blank description clears it, as the request contract
    // documents. `undefined` here would mean "leave it", so clearing is `null`.
    const updatedLeague = await this.deps.leagues.update(leagueId, {
      name: updates.name,
      description: updates.description?.trim() || null,
      iconKey: updates.iconKey,
    });
    this.logger?.info({
      action: 'league.updateDetails.success',
      data: { leagueId },
    }, 'Updated league details');
    return updatedLeague;
  }

  /**
   * The league's championship settings (#841, #863, #873): its name, points table and whether
   * the record book shows its Hall of Lame, replaced together. CUSTOM needs its list, and no other scale takes one. Cups score on read, so they
   * follow the new table at once; the championship keeps what each contest earned at settlement.
   */
  /**
   * Saves the championship settings. `features` are the league's plan features: switching the
   * Hall of Lame belongs to the record book, so without RECORD_BOOK it must stay as it is.
   */
  async updateCupSettings(
    leagueId: string,
    updates: UpdateLeagueCupSettingsInput,
    features: ReadonlySet<PlanFeature>,
  ): Promise<League> {
    this.logger?.debug({
      action: 'league.updateCupSettings.enter',
      data: { leagueId, cupPointsScale: updates.cupPointsScale, customPlaces: updates.cupCustomPoints.length },
    }, 'Updating league cup settings');
    const league = await this.deps.leagues.findById(leagueId);
    if (!league) {
      this.logger?.warn({ action: 'league.updateCupSettings.notFound', data: { leagueId } }, 'Cannot update cup settings for missing league');
      throw new LeagueNotFoundError(leagueId);
    }
    if (!league.isActive) {
      this.logger?.warn({ action: 'league.updateCupSettings.readOnlyInactive', data: { leagueId } }, 'Rejected cup settings update for inactive league');
      throw new LeagueOperationError(
        'Inactive leagues are read-only outside lifecycle actions',
        'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE',
      );
    }
    if (updates.hallOfLameVisible !== league.hallOfLameVisible && !features.has(PlanFeature.RECORD_BOOK)) {
      this.logger?.warn({ action: 'league.updateCupSettings.hallOfLameNotInPlan', data: { leagueId } }, 'Rejected a Hall of Lame switch the league\'s plan lacks');
      throw new PlanFeatureNotIncludedError(PlanFeature.RECORD_BOOK);
    }
    const isCustom = updates.cupPointsScale === CupPointsScale.CUSTOM;
    if (isCustom !== updates.cupCustomPoints.length > 0) {
      this.logger?.warn({
        action: 'league.updateCupSettings.customPointsInvalid',
        data: { leagueId, cupPointsScale: updates.cupPointsScale, customPlaces: updates.cupCustomPoints.length },
      }, 'Rejected cup settings with custom points that do not fit the scale');
      throw new LeagueOperationError(
        isCustom ? 'A custom points table needs points for at least 1st place' : 'Only a custom points table takes its own points',
        'CUP_CUSTOM_POINTS_INVALID',
      );
    }

    const updatedLeague = await this.deps.leagues.update(leagueId, {
      cupName: updates.cupName.trim(),
      cupPointsScale: updates.cupPointsScale,
      cupCustomPoints: updates.cupCustomPoints,
      hallOfLameVisible: updates.hallOfLameVisible,
    });
    this.logger?.info({
      action: 'league.updateCupSettings.success',
      data: { leagueId, cupPointsScale: updates.cupPointsScale, hallOfLameVisible: updates.hallOfLameVisible },
    }, 'Updated league cup settings');
    return updatedLeague;
  }

  async deleteInactiveLeague(
    leagueId: string,
    confirmationLeagueCode: string,
  ): Promise<void> {
    this.logger?.debug({
      action: 'league.delete.enter',
      data: { leagueId, confirmationLeagueCode },
    }, 'Deleting inactive league');
    const league = await this.deps.leagues.findById(leagueId);
    if (!league) {
      this.logger?.warn({
        action: 'league.delete.notFound',
        data: { leagueId },
      }, 'Cannot delete missing league');
      throw new LeagueNotFoundError(leagueId);
    }

    if (league.isActive) {
      this.logger?.warn({
        action: 'league.delete.requiresInactive',
        data: { leagueId },
      }, 'Rejected delete for active league');
      throw new LeagueOperationError(
        'League must be inactive before it can be permanently deleted',
        'LEAGUE_DELETE_REQUIRES_INACTIVE',
      );
    }

    if (league.leagueCode !== confirmationLeagueCode) {
      this.logger?.warn({
        action: 'league.delete.confirmationMismatch',
        data: { leagueId, confirmationLeagueCode },
      }, 'Rejected league delete due to confirmation mismatch');
      throw new LeagueOperationError(
        'League code confirmation must match exactly before permanent delete',
        'LEAGUE_DELETE_CONFIRMATION_MISMATCH',
      );
    }

    if (!this.deps.prisma) {
      this.logger?.error({
        action: 'league.delete.prismaUnavailable',
        data: { leagueId },
      }, 'League deletion requires Prisma access');
      throw new LeagueOperationError(
        'League deletion is not configured correctly',
        'LEAGUE_DELETE_UNAVAILABLE',
        500,
      );
    }

    this.logger?.info({
      action: 'league.delete.transaction.start',
      data: { leagueId },
    }, 'Deleting league-owned records');
    await this.deps.prisma.$transaction(async (tx) => {
      // The contests' row locks come first, the order a random draw takes them in (#646).
      const contests = await tx.contest.findMany({ where: { leagueId }, select: { id: true } });
      await lockContestRows(tx, contests.map((contest) => contest.id));
      await tx.contestEntryPick.deleteMany({
        where: { entry: { contest: { leagueId } } },
      });
      await tx.contestEntry.deleteMany({
        where: { contest: { leagueId } },
      });
      await tx.participantContestScoringRule.deleteMany({
        where: { contestConfiguration: { contest: { leagueId } } },
      });
      await tx.contestPrizeDefinition.deleteMany({
        where: { contestConfiguration: { contest: { leagueId } } },
      });
      await tx.contestConfiguration.deleteMany({
        where: { contest: { leagueId } },
      });
      await tx.contest.deleteMany({
        where: { leagueId },
      });
      await tx.leagueInvitation.deleteMany({
        where: { leagueId },
      });
      await tx.squadOwnerInvitation.deleteMany({
        where: { leagueId },
      });
      await tx.squadMembership.deleteMany({
        where: { leagueId },
      });
      await tx.leagueMembership.deleteMany({
        where: { leagueId },
      });
      await tx.squad.deleteMany({
        where: { leagueId },
      });
      await tx.league.delete({
        where: { id: leagueId },
      });
    });
    this.logger?.info({
      action: 'league.delete.success',
      data: { leagueId },
    }, 'Deleted inactive league');
  }

  /** Returns the league together with its member list. */
  async getLeagueWithMembers(
    leagueId: string,
  ): Promise<{ league: League; members: LeagueMembership[] } | null> {
    const league = await this.deps.leagues.findById(leagueId);
    if (!league) {
      return null;
    }
    const members = await this.deps.memberships.findByLeague(leagueId);
    return { league, members };
  }

  async getLeagueWithMembersByCode(
    leagueCode: string,
  ): Promise<{ league: League; members: LeagueMembership[] } | null> {
    const league = await this.findByCode(leagueCode);
    if (!league) {
      return null;
    }
    const members = await this.deps.memberships.findByLeague(league.id);
    return { league, members };
  }

  private async ensureDefaultSquad(leagueId: string, userId: string): Promise<void> {
    if (!this.deps.squads || !this.deps.squadMemberships) {
      this.logger?.debug({
        action: 'league.ensureDefaultSquad.skipped',
        data: { leagueId, userId },
      }, 'Skipped default squad provisioning because dependencies are unavailable');
      return;
    }

    await ensureDefaultSquadForLeagueMember({
      leagueId,
      userId,
      squadRepo: this.deps.squads,
      squadMembershipRepo: this.deps.squadMemberships,
      users: this.deps.users,
      logger: this.logger,
    });
  }

}

export class LeagueNotFoundError extends Error {
  readonly code: ApiErrorCode = 'LEAGUE_NOT_FOUND';
  readonly statusCode = 404;

  constructor(leagueId: string) {
    super(`League not found: ${leagueId}`);
    this.name = 'LeagueNotFoundError';
  }
}

export class LeagueCodeConflictError extends Error {
  code: ApiErrorCode = 'LEAGUE_CODE_CONFLICT';
  statusCode = 409;

  constructor(leagueCode: string) {
    super(`League code is already in use: ${leagueCode}`);
    this.name = 'LeagueCodeConflictError';
  }
}

/** The league's email comes from `<code>@…`, so a code can't be a role address such as ADMIN (#844). */
export class LeagueCodeReservedError extends Error {
  code: ApiErrorCode = 'LEAGUE_CODE_RESERVED';
  statusCode = 400;

  constructor(leagueCode: string) {
    super(`League code ${leagueCode} is reserved. Choose another code.`);
    this.name = 'LeagueCodeReservedError';
  }
}

export class LeagueOperationError extends Error {
  statusCode = 400;
  code: ApiErrorCode;

  constructor(reason: string, code: ApiErrorCode = 'LEAGUE_OPERATION_INVALID', statusCode = 400) {
    super(reason);
    this.name = 'LeagueOperationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
