/**
 * SportLeagueService — cross-sport SportLeague CRUD and league-scoped roster
 * management (plans/124 §3.2/§4.2). Not golf-shaped: the golf admin routes
 * are thin wrappers over this scoped to Sport.GOLF; a future basketball plan
 * reuses it identically, scoped to Sport.BASKETBALL.
 *
 * The roster (ParticipantLeagueAffiliation) is league-scoped, not
 * season-scoped — a golfer's tour membership and world ranking don't reset
 * every year (plans/124 §4.2).
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Sport } from '@poolmaster/shared/domain';
import { SportCatalogError } from './errors';
import { requireSportRow } from './sport-row';

export interface SportLeagueRow {
  id: string;
  sportId: string;
  name: string;
  matchKeyword: string | null;
  currentSeasonId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SportLeagueSummary extends SportLeagueRow {
  rosterSize: number;
  seasonCount: number;
}

export interface LeagueRosterEntry {
  participantId: string;
  name: string;
  shortName: string | null;
  nationality: string | null;
  status: string;
  worldRanking: number | null;
}

export interface LeagueRosterUploadRow {
  participantId?: string;
  externalId?: string;
  playerName?: string;
  worldRanking?: number;
}

export type LeagueRosterUploadResolution = 'MATCHED' | 'UNRESOLVED' | 'AMBIGUOUS';

export interface LeagueRosterUploadPreviewRow {
  row: LeagueRosterUploadRow;
  resolution: LeagueRosterUploadResolution;
  participantId: string | null;
  participantName: string | null;
}

export class SportLeagueService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async listLeagues(sport: Sport, options: { isActive?: boolean } = {}): Promise<SportLeagueSummary[]> {
    const sportRow = await requireSportRow(this.prisma, sport);
    const leagues = await this.prisma.sportLeague.findMany({
      where: {
        sportId: sportRow.id,
        ...(options.isActive !== undefined ? { isActive: options.isActive } : {}),
      },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { affiliations: true, seasons: true } },
      },
    });

    return leagues.map((league) => ({
      ...toSportLeagueRow(league),
      rosterSize: league._count.affiliations,
      seasonCount: league._count.seasons,
    }));
  }

  async createLeague(
    sport: Sport,
    input: { name: string; matchKeyword?: string },
  ): Promise<SportLeagueRow> {
    const sportRow = await requireSportRow(this.prisma, sport);
    const existing = await this.prisma.sportLeague.findUnique({
      where: { sportId_name: { sportId: sportRow.id, name: input.name } },
    });
    if (existing) {
      throw new SportCatalogError(
        `A league named "${input.name}" already exists for ${sport}.`,
        'SPORT_LEAGUE_NAME_ALREADY_EXISTS',
        409,
      );
    }

    const league = await this.prisma.sportLeague.create({
      data: {
        sportId: sportRow.id,
        name: input.name,
        matchKeyword: input.matchKeyword ?? null,
      },
    });
    this.logger?.info({ leagueId: league.id, sport, name: input.name }, 'Created sport league');
    return toSportLeagueRow(league);
  }

  async updateLeague(
    leagueId: string,
    updates: { name?: string; matchKeyword?: string | null; isActive?: boolean },
  ): Promise<SportLeagueRow> {
    const league = await this.prisma.sportLeague.update({
      where: { id: leagueId },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.matchKeyword !== undefined && { matchKeyword: updates.matchKeyword }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
      },
    });
    return toSportLeagueRow(league);
  }

  async getRoster(leagueId: string): Promise<LeagueRosterEntry[]> {
    const affiliations = await this.prisma.participantLeagueAffiliation.findMany({
      where: { sportLeagueId: leagueId },
      orderBy: [{ worldRanking: { sort: 'asc', nulls: 'last' } }, { participant: { name: 'asc' } }],
      include: { participant: true },
    });
    return affiliations.map(toRosterEntry);
  }

  async addRosterEntry(leagueId: string, participantId: string): Promise<LeagueRosterEntry> {
    const existing = await this.prisma.participantLeagueAffiliation.findUnique({
      where: { participantId_sportLeagueId: { participantId, sportLeagueId: leagueId } },
    });
    if (existing) {
      throw new SportCatalogError(
        'This golfer is already on the league roster.',
        'LEAGUE_ROSTER_ENTRY_ALREADY_EXISTS',
        409,
      );
    }

    const affiliation = await this.prisma.participantLeagueAffiliation.create({
      data: { participantId, sportLeagueId: leagueId },
      include: { participant: true },
    });
    return toRosterEntry(affiliation);
  }

  async removeRosterEntry(leagueId: string, participantId: string): Promise<void> {
    await this.prisma.participantLeagueAffiliation.delete({
      where: { participantId_sportLeagueId: { participantId, sportLeagueId: leagueId } },
    });
  }

  async bulkUpdateRoster(
    leagueId: string,
    entries: Array<{ participantId: string; worldRanking: number | null }>,
  ): Promise<LeagueRosterEntry[]> {
    await this.prisma.$transaction(
      entries.map((entry) =>
        this.prisma.participantLeagueAffiliation.update({
          where: { participantId_sportLeagueId: { participantId: entry.participantId, sportLeagueId: leagueId } },
          data: { worldRanking: entry.worldRanking },
        }),
      ),
    );
    return this.getRoster(leagueId);
  }

  /**
   * Dry run — resolves each row to an existing Participant (participantId >
   * externalId > exact case-insensitive playerName, scoped to the league's
   * sport) without writing anything. Never creates a Participant from a row.
   */
  async previewRosterUpload(
    leagueId: string,
    rows: LeagueRosterUploadRow[],
  ): Promise<LeagueRosterUploadPreviewRow[]> {
    const league = await this.prisma.sportLeague.findUniqueOrThrow({ where: { id: leagueId } });
    return Promise.all(rows.map((row) => this.resolveUploadRow(league.sportId, row)));
  }

  /** Applies a previewed upload. Throws when any row is unresolved — all-or-nothing. */
  async applyRosterUpload(
    leagueId: string,
    rows: LeagueRosterUploadRow[],
  ): Promise<LeagueRosterEntry[]> {
    const preview = await this.previewRosterUpload(leagueId, rows);
    const unresolved = preview.filter((row) => row.resolution !== 'MATCHED');
    if (unresolved.length > 0) {
      throw new SportCatalogError(
        `${unresolved.length} roster upload row(s) could not be resolved to a golfer.`,
        'LEAGUE_ROSTER_UPLOAD_UNRESOLVED_ROWS',
        422,
      );
    }

    await this.prisma.$transaction(
      preview.map((resolved) =>
        this.prisma.participantLeagueAffiliation.upsert({
          where: {
            participantId_sportLeagueId: {
              participantId: resolved.participantId as string,
              sportLeagueId: leagueId,
            },
          },
          create: {
            participantId: resolved.participantId as string,
            sportLeagueId: leagueId,
            worldRanking: resolved.row.worldRanking ?? null,
          },
          update: {
            worldRanking: resolved.row.worldRanking ?? null,
          },
        }),
      ),
    );
    return this.getRoster(leagueId);
  }

  private async resolveUploadRow(
    sportId: string,
    row: LeagueRosterUploadRow,
  ): Promise<LeagueRosterUploadPreviewRow> {
    if (row.participantId) {
      const participant = await this.prisma.participant.findFirst({
        where: { id: row.participantId, sportId },
      });
      return participant
        ? { row, resolution: 'MATCHED', participantId: participant.id, participantName: participant.name }
        : { row, resolution: 'UNRESOLVED', participantId: null, participantName: null };
    }

    if (row.externalId) {
      const matches = await this.prisma.participant.findMany({
        where: { sportId, externalId: row.externalId },
      });
      if (matches.length === 1) {
        return { row, resolution: 'MATCHED', participantId: matches[0].id, participantName: matches[0].name };
      }
      return {
        row,
        resolution: matches.length > 1 ? 'AMBIGUOUS' : 'UNRESOLVED',
        participantId: null,
        participantName: null,
      };
    }

    if (row.playerName) {
      const matches = await this.prisma.participant.findMany({
        where: { sportId, name: { equals: row.playerName, mode: 'insensitive' } },
      });
      if (matches.length === 1) {
        return { row, resolution: 'MATCHED', participantId: matches[0].id, participantName: matches[0].name };
      }
      return {
        row,
        resolution: matches.length > 1 ? 'AMBIGUOUS' : 'UNRESOLVED',
        participantId: null,
        participantName: null,
      };
    }

    return { row, resolution: 'UNRESOLVED', participantId: null, participantName: null };
  }

}

function toSportLeagueRow(league: {
  id: string;
  sportId: string;
  name: string;
  matchKeyword: string | null;
  currentSeasonId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SportLeagueRow {
  return {
    id: league.id,
    sportId: league.sportId,
    name: league.name,
    matchKeyword: league.matchKeyword,
    currentSeasonId: league.currentSeasonId,
    isActive: league.isActive,
    createdAt: league.createdAt,
    updatedAt: league.updatedAt,
  };
}

function toRosterEntry(affiliation: {
  participantId: string;
  worldRanking: number | null;
  participant: { name: string; shortName: string | null; nationality: string | null; status: string };
}): LeagueRosterEntry {
  return {
    participantId: affiliation.participantId,
    name: affiliation.participant.name,
    shortName: affiliation.participant.shortName,
    nationality: affiliation.participant.nationality,
    status: affiliation.participant.status,
    worldRanking: affiliation.worldRanking,
  };
}
