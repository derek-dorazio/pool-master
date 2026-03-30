/**
 * SeasonNotesService — commissioner-authored season notes and custom trophy awards.
 *
 * Uses Prisma SeasonNote and Trophy models for persistence.
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
      data: {
        leagueId,
        season,
        content,
        authorId,
      },
    });
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

  /** Get all notes for a league season. */
  async getNotes(leagueId: string, season: string): Promise<SeasonNote[]> {
    const rows = await this.prisma.seasonNote.findMany({
      where: { leagueId, season },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      leagueId: row.leagueId,
      season: row.season,
      content: row.content,
      authorId: row.authorId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  /** Update a note's content. */
  async updateNote(noteId: string, content: string): Promise<SeasonNote> {
    const row = await this.prisma.seasonNote.update({
      where: { id: noteId },
      data: { content },
    });
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

  /** Delete a note. */
  async deleteNote(noteId: string): Promise<void> {
    await this.prisma.seasonNote.delete({
      where: { id: noteId },
    });
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
        awardedBy: trophy.awardedBy,
        awardedAt: new Date(),
        seasonLabel: season,
      },
    });
    return {
      id: row.id,
      leagueId: row.leagueId,
      season: row.seasonLabel ?? season,
      label: row.label,
      description: row.description ?? undefined,
      recipientMemberId: row.leagueMembershipId,
      awardedBy: row.awardedBy ?? trophy.awardedBy,
      createdAt: row.createdAt,
    };
  }

  /** Get all custom trophies for a league, optionally filtered by season. */
  async getTrophies(leagueId: string, season?: string): Promise<TrophyAward[]> {
    const rows = await this.prisma.trophy.findMany({
      where: {
        leagueId,
        trophyType: 'CUSTOM',
        ...(season ? { seasonLabel: season } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      leagueId: row.leagueId,
      season: row.seasonLabel ?? '',
      label: row.label,
      description: row.description ?? undefined,
      recipientMemberId: row.leagueMembershipId,
      awardedBy: row.awardedBy ?? '',
      createdAt: row.createdAt,
    }));
  }

  /** Revoke a custom trophy. */
  async revokeTrophy(trophyId: string): Promise<void> {
    await this.prisma.trophy.delete({
      where: { id: trophyId },
    });
  }
}
