import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { LeagueMembershipRepository, LeagueRepository } from '@poolmaster/shared/db';
import {
  ContestStatus,
  JoinPolicy,
  LeagueIconKey,
  LeagueMembershipStatus,
} from '@poolmaster/shared/domain';
import type {
  LeagueDetailDto,
  LeagueSummaryDto,
} from '@poolmaster/shared/dto';
import { toLeagueDetailDto, toLeagueSummaryDto } from '../../mappers/leagues.mapper';
import { logAdminAction } from './admin-audit-service';
import { LeagueNotFoundError, LeagueOperationError, LeagueService } from '../leagues/service';

const ACTIVE_LEAGUE_CONTEST_STATUSES = [
  ContestStatus.DRAFT,
  ContestStatus.OPEN,
  ContestStatus.DRAFTING,
  ContestStatus.LOCKED,
  ContestStatus.ACTIVE,
] as const;

interface AdminLeagueSearchQuery {
  search?: string;
  isActive?: boolean;
}

interface LeagueSummaryRow {
  id: string;
  leagueCode: string;
  name: string;
  description: string | null;
  isActive: boolean;
  iconKey: LeagueIconKey;
  joinPolicy: JoinPolicy;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number;
  activeContestCount: number;
}

export class AdminLeagueService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly leagueService: LeagueService,
    private readonly leagueRepo: LeagueRepository,
    private readonly membershipRepo: LeagueMembershipRepository,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async searchLeagues(query: AdminLeagueSearchQuery): Promise<LeagueSummaryDto[]> {
    const trimmedSearch = query.search?.trim();

    this.logger?.debug({
      action: 'adminLeagueService.search.start',
      data: {
        hasSearch: Boolean(trimmedSearch),
        isActive: query.isActive ?? null,
      },
    }, 'Searching leagues for root-admin management');

    // #202 — composed from ports instead of one hand-written findMany with nested
    // selects. That query is what let this service invent its own row shape (§2y).
    // Three reads rather than one: the leagues, their active-member counts, and the
    // active-contest counts. Contest has no port for this yet — that is slice 3 — so it
    // is the one raw query left here, and it is marked.
    const leagues = await this.leagueRepo.findAll({
      search: trimmedSearch,
      isActive: query.isActive,
    });
    const leagueIds = leagues.map((league) => league.id);

    const [memberCounts, contestRows] = await Promise.all([
      this.membershipRepo.countActiveByLeagues(leagueIds),
      // SLICE 3 — replace with a ContestRepository count once that cluster has ports.
      leagueIds.length
        ? this.prisma.contest.groupBy({
          by: ['leagueId'],
          where: {
            leagueId: { in: leagueIds },
            status: { in: [...ACTIVE_LEAGUE_CONTEST_STATUSES] },
          },
          _count: { _all: true },
        })
        : Promise.resolve([]),
    ]);
    const contestCountByLeagueId = new Map(
      contestRows.map((row) => [row.leagueId, row._count._all]),
    );

    const summaries = leagues.map((league) => toLeagueSummaryDto(league, {
      memberCount: memberCounts.get(league.id) ?? 0,
      activeContestCount: contestCountByLeagueId.get(league.id) ?? 0,
      memberType: null,
      leagueRelationship: {
        leagueMember: false,
        commissioner: false,
      },
      isRootAdmin: true,
    }));

    this.logger?.info({
      action: 'adminLeagueService.search.success',
      data: {
        hasSearch: Boolean(trimmedSearch),
        returnedCount: summaries.length,
        isActive: query.isActive ?? null,
      },
    }, 'Loaded leagues for root-admin management');

    return summaries;
  }

  async inactivateLeague(
    leagueId: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<LeagueDetailDto> {
    const before = await this.loadLeagueSummaryRow(leagueId);
    const league = await this.leagueService.inactivateLeague(leagueId);
    const updated = await this.loadLeagueSummaryRow(leagueId);

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'league.inactivate',
      resourceType: 'LEAGUE',
      resourceId: leagueId,
      description: `Root-admin inactivated league ${before.leagueCode} (${before.name})`,
      beforeState: {
        isActive: before.isActive,
      },
      afterState: {
        isActive: league.isActive,
      },
    });

    this.logger?.info({
      action: 'adminLeagueService.inactivate.success',
      data: {
        leagueId,
        leagueCode: before.leagueCode,
        actorUserId: rootAdminUserId,
      },
    }, 'Root-admin inactivated league');

    return toLeagueDetailDto(
      {
        id: league.id,
        leagueCode: league.leagueCode,
        name: league.name,
        description: league.description ?? null,
        isActive: league.isActive,
        iconKey: league.iconKey,
        joinPolicy: league.joinPolicy,
        createdAt: league.createdAt,
        updatedAt: league.updatedAt,
      },
      {
        memberCount: updated.memberCount,
        activeContestCount: updated.activeContestCount,
        memberType: null,
        leagueRelationship: {
          leagueMember: false,
          commissioner: false,
        },
        isRootAdmin: true,
      },
    );
  }

  async deleteLeague(
    leagueId: string,
    confirmationLeagueCode: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<void> {
    const before = await this.loadLeagueSummaryRow(leagueId);

    await this.leagueService.deleteInactiveLeague(leagueId, confirmationLeagueCode);

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'league.delete',
      resourceType: 'LEAGUE',
      resourceId: leagueId,
      description: `Root-admin deleted league ${before.leagueCode} (${before.name})`,
      beforeState: {
        leagueCode: before.leagueCode,
        name: before.name,
        isActive: before.isActive,
        memberCount: before.memberCount,
        activeContestCount: before.activeContestCount,
      },
      reason: `Confirmed with league code ${confirmationLeagueCode}`,
    });

    this.logger?.info({
      action: 'adminLeagueService.delete.success',
      data: {
        leagueId,
        leagueCode: before.leagueCode,
        actorUserId: rootAdminUserId,
      },
    }, 'Root-admin deleted league');
  }

  private async loadLeagueSummaryRow(leagueId: string): Promise<LeagueSummaryRow> {
    const league = await this.prisma.league.findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        leagueCode: true,
        name: true,
        description: true,
        isActive: true,
        iconKey: true,
        joinPolicy: true,
        createdAt: true,
        updatedAt: true,
        memberships: {
          where: {
            status: LeagueMembershipStatus.ACTIVE,
          },
          select: {
            id: true,
          },
        },
        contests: {
          where: {
            status: {
              in: [...ACTIVE_LEAGUE_CONTEST_STATUSES],
            },
          },
          select: {
            id: true,
          },
        },
      },
    });

    if (!league) {
      throw new LeagueNotFoundError(leagueId);
    }

    return {
      id: league.id,
      leagueCode: league.leagueCode,
      name: league.name,
      description: league.description,
      isActive: league.isActive,
      iconKey: league.iconKey as LeagueIconKey,
      joinPolicy: league.joinPolicy as JoinPolicy,
      createdAt: league.createdAt,
      updatedAt: league.updatedAt,
      memberCount: league.memberships.length,
      activeContestCount: league.contests.length,
    };
  }
}

export {
  LeagueNotFoundError,
  LeagueOperationError,
};
