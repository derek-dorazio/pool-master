import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { AdminTeamSummaryDto } from '@poolmaster/shared/dto';
import { SquadMembershipStatus } from '@poolmaster/shared/domain';

interface AdminTeamSearchQuery {
  search?: string;
  leagueCode?: string;
  isActive?: boolean;
}

export class AdminTeamService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async searchTeams(query: AdminTeamSearchQuery): Promise<AdminTeamSummaryDto[]> {
    const trimmedSearch = query.search?.trim();
    const trimmedLeagueCode = query.leagueCode?.trim();

    this.logger?.debug({
      action: 'adminTeamService.search.start',
      data: {
        hasSearch: Boolean(trimmedSearch),
        leagueCode: trimmedLeagueCode ?? null,
        isActive: query.isActive ?? null,
      },
    }, 'Searching teams for root-admin management');

    const rows = await this.prisma.squad.findMany({
      where: {
        ...(trimmedSearch
          ? {
              name: {
                contains: trimmedSearch,
                mode: 'insensitive',
              },
            }
          : {}),
        ...(trimmedLeagueCode
          ? {
              league: {
                leagueCode: {
                  equals: trimmedLeagueCode,
                  mode: 'insensitive',
                },
              },
            }
          : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      },
      orderBy: [
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        leagueId: true,
        name: true,
        iconKey: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        league: {
          select: {
            leagueCode: true,
            name: true,
          },
        },
        memberships: {
          where: {
            status: SquadMembershipStatus.ACTIVE,
          },
          orderBy: {
            createdAt: 'asc',
          },
          select: {
            userId: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    const teams = rows.map((row) => ({
      id: row.id,
      leagueId: row.leagueId,
      leagueCode: row.league.leagueCode,
      leagueName: row.league.name,
      name: row.name,
      iconKey: row.iconKey,
      isActive: row.isActive,
      ownerCount: row.memberships.length,
      owners: row.memberships.map((membership) => ({
        userId: membership.userId,
        firstName: membership.user.firstName ?? undefined,
        lastName: membership.user.lastName ?? undefined,
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    this.logger?.info({
      action: 'adminTeamService.search.success',
      data: {
        hasSearch: Boolean(trimmedSearch),
        leagueCode: trimmedLeagueCode ?? null,
        isActive: query.isActive ?? null,
        returnedCount: teams.length,
      },
    }, 'Loaded teams for root-admin management');

    return teams;
  }
}
