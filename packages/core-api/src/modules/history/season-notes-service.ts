/**
 * SeasonNotesService — commissioner-authored season notes and custom trophy awards.
 *
 * Uses in-memory storage until Prisma client is regenerated with SeasonNote model.
 */

import crypto from 'node:crypto';

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

const notes = new Map<string, SeasonNote>();
const trophies = new Map<string, TrophyAward>();

export class SeasonNotesService {
  /** Add a markdown note to a season. */
  async addNote(
    leagueId: string,
    season: string,
    content: string,
    authorId: string,
  ): Promise<SeasonNote> {
    const note: SeasonNote = {
      id: crypto.randomUUID(),
      leagueId,
      season,
      content,
      authorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    notes.set(note.id, note);
    return note;
  }

  /** Get all notes for a league season. */
  async getNotes(leagueId: string, season: string): Promise<SeasonNote[]> {
    return Array.from(notes.values())
      .filter((n) => n.leagueId === leagueId && n.season === season)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Update a note's content. */
  async updateNote(noteId: string, content: string): Promise<SeasonNote> {
    const note = notes.get(noteId);
    if (!note) throw new Error(`Note ${noteId} not found`);
    note.content = content;
    note.updatedAt = new Date();
    return note;
  }

  /** Delete a note. */
  async deleteNote(noteId: string): Promise<void> {
    notes.delete(noteId);
  }

  /** Award a custom trophy to a league member. */
  async awardTrophy(
    leagueId: string,
    season: string,
    trophy: { label: string; description?: string; recipientMemberId: string; awardedBy: string },
  ): Promise<TrophyAward> {
    const award: TrophyAward = {
      id: crypto.randomUUID(),
      leagueId,
      season,
      label: trophy.label,
      description: trophy.description,
      recipientMemberId: trophy.recipientMemberId,
      awardedBy: trophy.awardedBy,
      createdAt: new Date(),
    };
    trophies.set(award.id, award);
    return award;
  }

  /** Get all custom trophies for a league, optionally filtered by season. */
  async getTrophies(leagueId: string, season?: string): Promise<TrophyAward[]> {
    return Array.from(trophies.values())
      .filter((t) => t.leagueId === leagueId && (!season || t.season === season))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Revoke a custom trophy. */
  async revokeTrophy(trophyId: string): Promise<void> {
    trophies.delete(trophyId);
  }
}
