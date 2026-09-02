/**
 * SeasonService — cross-sport Season CRUD (plans/124 §3.2/§4.2/§4.3). A
 * Season is purely a tournament-calendar grouping now, not a roster
 * boundary — the roster lives on SportLeague (sport-league-service.ts).
 *
 * cloneSeasonTournaments (plans/124 §4.2a) is not implemented here — it
 * calls the same internal creation function adminCreateGolfTournament uses,
 * which doesn't exist until that admin-golf-routes slice ships.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Sport } from '@poolmaster/shared/domain';
import { SportCatalogError } from './errors';

export interface SeasonRow {
  id: string;
  sportLeagueId: string;
  name: string;
  year: number;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeasonSummary extends SeasonRow {
  tournamentCount: number;
}

export interface SeasonDetail extends SeasonSummary {
  isCurrent: boolean;
}

export class SeasonService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async listSeasons(
    sport: Sport,
    options: { isActive?: boolean; sportLeagueId?: string } = {},
  ): Promise<SeasonSummary[]> {
    const seasons = await this.prisma.season.findMany({
      where: {
        sportLeague: { sport: { name: sport } },
        ...(options.isActive !== undefined ? { isActive: options.isActive } : {}),
        ...(options.sportLeagueId ? { sportLeagueId: options.sportLeagueId } : {}),
      },
      orderBy: [{ sportLeagueId: 'asc' }, { year: 'desc' }],
      include: { _count: { select: { sportEvents: true } } },
    });
    return seasons.map((season) => ({
      ...toSeasonRow(season),
      tournamentCount: season._count.sportEvents,
    }));
  }

  async createSeason(input: {
    sportLeagueId: string;
    name: string;
    year: number;
    startDate: Date;
    endDate: Date;
  }): Promise<SeasonRow> {
    const existing = await this.prisma.season.findUnique({
      where: { sportLeagueId_year: { sportLeagueId: input.sportLeagueId, year: input.year } },
    });
    if (existing) {
      throw new SportCatalogError(
        `This league already has a season for ${input.year}.`,
        'SEASON_YEAR_ALREADY_EXISTS',
        409,
      );
    }

    const season = await this.prisma.season.create({
      data: {
        sportLeagueId: input.sportLeagueId,
        name: input.name,
        year: input.year,
        startDate: input.startDate,
        endDate: input.endDate,
      },
    });
    this.logger?.info({ seasonId: season.id, sportLeagueId: input.sportLeagueId, year: input.year }, 'Created season');
    return toSeasonRow(season);
  }

  async getSeason(seasonId: string): Promise<SeasonDetail | null> {
    const season = await this.prisma.season.findUnique({
      where: { id: seasonId },
      include: {
        sportLeague: { select: { currentSeasonId: true } },
        _count: { select: { sportEvents: true } },
      },
    });
    if (!season) {
      return null;
    }
    return {
      ...toSeasonRow(season),
      tournamentCount: season._count.sportEvents,
      isCurrent: season.sportLeague.currentSeasonId === season.id,
    };
  }

  async updateSeason(
    seasonId: string,
    updates: { name?: string; startDate?: Date; endDate?: Date; isActive?: boolean },
  ): Promise<SeasonRow> {
    const season = await this.prisma.season.update({
      where: { id: seasonId },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.startDate !== undefined && { startDate: updates.startDate }),
        ...(updates.endDate !== undefined && { endDate: updates.endDate }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
      },
    });
    return toSeasonRow(season);
  }

  /**
   * A single atomic write on the parent SportLeague row — no separate
   * "unset the old one" step, so there is never a window where a league has
   * zero or two current seasons (plans/124 §5.2).
   */
  async setCurrentSeason(seasonId: string): Promise<{ sportLeagueId: string; currentSeasonId: string }> {
    const season = await this.prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
    await this.prisma.sportLeague.update({
      where: { id: season.sportLeagueId },
      data: { currentSeasonId: seasonId },
    });
    return { sportLeagueId: season.sportLeagueId, currentSeasonId: seasonId };
  }

  /**
   * Ordinary foreign-key-target validation for a caller-supplied seasonId —
   * rejects a season that doesn't resolve to the expected sport (plans/124
   * §4.3). Not yet called by anything; the admin tournament-creation route
   * that needs this lands in a later slice.
   */
  async assertSeasonBelongsToSport(seasonId: string, sport: Sport): Promise<SeasonRow> {
    const season = await this.prisma.season.findUnique({
      where: { id: seasonId },
      include: { sportLeague: { include: { sport: true } } },
    });
    if (!season) {
      throw new SportCatalogError(`Season ${seasonId} was not found.`, 'SEASON_NOT_FOUND', 404);
    }
    if (season.sportLeague.sport.name !== sport) {
      throw new SportCatalogError(
        `Season ${seasonId} belongs to ${season.sportLeague.sport.name}, not ${sport}.`,
        'SEASON_SPORT_MISMATCH',
        422,
      );
    }
    return toSeasonRow(season);
  }
}

function toSeasonRow(season: {
  id: string;
  sportLeagueId: string;
  name: string;
  year: number;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SeasonRow {
  return {
    id: season.id,
    sportLeagueId: season.sportLeagueId,
    name: season.name,
    year: season.year,
    startDate: season.startDate,
    endDate: season.endDate,
    isActive: season.isActive,
    createdAt: season.createdAt,
    updatedAt: season.updatedAt,
  };
}
