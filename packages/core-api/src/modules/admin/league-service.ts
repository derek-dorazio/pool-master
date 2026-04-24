import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
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

const DEFAULT_LIMIT = 25;
const ACTIVE_LEAGUE_CONTEST_STATUSES = [
  ContestStatus.DRAFT,
  ContestStatus.OPEN,
  ContestStatus.DRAFTING,
  ContestStatus.LOCKED,
  ContestStatus.ACTIVE,
] as const;

interface AdminLeagueSearchQuery {
  search?: string;
  limit?: number;
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
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async searchLeagues(query: AdminLeagueSearchQuery): Promise<LeagueSummaryDto[]> {
    const trimmedSearch = query.search?.trim();
    const limit = query.limit ?? DEFAULT_LIMIT;

    this.logger?.debug({
      action: 'adminLeagueService.search.start',
      data: {
        hasSearch: Boolean(trimmedSearch),
        limit,
      },
    }, 'Searching leagues for root-admin management');

    const rows = await this.prisma.league.findMany({
      where: trimmedSearch
        ? {
            name: {
              contains: trimmedSearch,
              mode: 'insensitive',
            },
          }
        : undefined,
      orderBy: [
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit,
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

    const leagues = rows.map((row) => toLeagueSummaryDto(
      {
        id: row.id,
        leagueCode: row.leagueCode,
        name: row.name,
        description: row.description,
        createdBy: '',
        isActive: row.isActive,
        iconKey: row.iconKey as LeagueIconKey,
        joinPolicy: row.joinPolicy as JoinPolicy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      {
        memberCount: row.memberships.length,
        activeContestCount: row.contests.length,
        memberType: null,
        leagueRelationship: {
          leagueMember: false,
          commissioner: false,
        },
        isRootAdmin: true,
      },
    ));

    this.logger?.info({
      action: 'adminLeagueService.search.success',
      data: {
        hasSearch: Boolean(trimmedSearch),
        returnedCount: leagues.length,
        limit,
      },
    }, 'Loaded leagues for root-admin management');

    return leagues;
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
        createdBy: league.createdBy,
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
