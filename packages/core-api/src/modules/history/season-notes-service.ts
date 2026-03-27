/**
 * SeasonNotesService — commissioner-authored season notes and custom trophy awards.
 *
 * Allows commissioners to add markdown notes to seasons and award
 * custom trophies (e.g. "MVP", "Best Draft Pick", "Comeback Kid").
 */

import type { PrismaClient } from '@prisma/client';

export interface SeasonNote {
  id: string;
  leagueId: string;
  season: string;
  content: string;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrophyAward {
  id: string;
  leagueId: string;
  season: string;
  label: string;
  description?: string;
  recipientMemberId: string;
  awardedBy: string;
  createdAt: Date;
}

export class SeasonNotesService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Add a markdown note to a season. */
  async addNote(
    leagueId: string,
    season: string,
    content: string,
    authorId: string,
  ): Promise<SeasonNote> {
    const row = await this.prisma.seasonNote.create({
      data: { leagueId, season, content, authorId },
    });
    return mapNote(row);
  }

  /** Get all notes for a league season. */
  async getNotes(leagueId: string, season: string): Promise<SeasonNote[]> {
    const rows = await this.prisma.seasonNote.findMany({
      where: { leagueId, season },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapNote);
  }

  /** Update a note's content. */
  async updateNote(noteId: string, content: string): Promise<SeasonNote> {
    const row = await this.prisma.seasonNote.update({
      where: { id: noteId },
      data: { content },
    });
    return mapNote(row);
  }

  /** Delete a note. */
  async deleteNote(noteId: string): Promise<void> {
    await this.prisma.seasonNote.delete({ where: { id: noteId } });
  }

  /** Award a custom trophy to a league member. */
  async awardTrophy(
    leagueId: string,
    season: string,
    trophy: { label: string; description?: string; recipientMemberId: string; awardedBy: string },
  ): Promise<TrophyAward> {
    const row = await this.prisma.trophy.create({
      data: {
        leagueId,
        leagueMembershipId: trophy.recipientMemberId,
        trophyType: 'CUSTOM',
        label: trophy.label,
        description: trophy.description,
        awardedAt: new Date(),
        awardedBy: trophy.awardedBy,
        seasonLabel: season,
      },
    });
    return mapTrophyAward(row, season);
  }

  /** Get all custom trophies for a league, optionally filtered by season. */
  async getTrophies(leagueId: string, season?: string): Promise<TrophyAward[]> {
    const where: Record<string, unknown> = { leagueId, trophyType: 'CUSTOM' };
    if (season) where.seasonLabel = season;

    const rows = await this.prisma.trophy.findMany({
      where,
      orderBy: { awardedAt: 'desc' },
    });
    return rows.map((r) => mapTrophyAward(r, r.seasonLabel ?? ''));
  }

  /** Revoke a custom trophy. */
  async revokeTrophy(trophyId: string): Promise<void> {
    await this.prisma.trophy.delete({ where: { id: trophyId } });
  }
}

function mapNote(row: {
  id: string;
  leagueId: string;
  season: string;
  content: string;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
}): SeasonNote {
  return {
    id: row.id,
    leagueId: row.leagueId,
    season: row.season,
    content: row.content,
    authorId: row.authorId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapTrophyAward(
  row: {
    id: string;
    leagueId: string;
    label: string;
    description: string | null;
    leagueMembershipId: string;
    awardedBy: string | null;
    createdAt: Date;
  },
  season: string,
): TrophyAward {
  return {
    id: row.id,
    leagueId: row.leagueId,
    season,
    label: row.label,
    description: row.description ?? undefined,
    recipientMemberId: row.leagueMembershipId,
    awardedBy: row.awardedBy ?? '',
    createdAt: row.createdAt,
  };
}
