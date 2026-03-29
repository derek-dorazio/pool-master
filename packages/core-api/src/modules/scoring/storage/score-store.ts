/**
 * ScoreStore — in-memory NoSQL-style score storage.
 *
 * v1 implementation: Map-backed append-only store.
 * Will be swapped to DynamoDB in production.
 */

import type { ScoreBreakdown } from '../engine/scoring-engine';

// --- Stored Types ---

export interface ParticipantEventScore {
  contestId: string;
  participantId: string;
  eventTimestamp: string;
  stats: Record<string, number>;
  points: number;
  breakdown: ScoreBreakdown;
}

export interface EntryContestScore {
  contestId: string;
  entryId: string;
  eventTimestamp: string;
  pointsEarned: number;
  runningTotal: number;
  participantBreakdowns: ScoreBreakdown[];
}

// --- Store ---

export class ScoreStore {
  private participantScores: Map<string, ParticipantEventScore[]> = new Map();
  private entryScores: Map<string, EntryContestScore[]> = new Map();

  /** Append a participant's score event. */
  async appendParticipantScore(score: ParticipantEventScore): Promise<void> {
    const key = `${score.contestId}#${score.participantId}`;
    const existing = this.participantScores.get(key) ?? [];
    existing.push(score);
    this.participantScores.set(key, existing);
  }

  /** Append an entry's score event. */
  async appendEntryScore(score: EntryContestScore): Promise<void> {
    const key = `${score.contestId}#${score.entryId}`;
    const existing = this.entryScores.get(key) ?? [];
    existing.push(score);
    this.entryScores.set(key, existing);
  }

  /** Get running total for an entry in a contest. */
  async getEntryTotal(contestId: string, entryId: string): Promise<number> {
    const key = `${contestId}#${entryId}`;
    const scores = this.entryScores.get(key);
    if (!scores || scores.length === 0) return 0;
    return scores[scores.length - 1].runningTotal;
  }

  /** Get leaderboard for a contest (all entries sorted by total descending). */
  async getLeaderboard(contestId: string): Promise<{ entryId: string; total: number }[]> {
    const prefix = `${contestId}#`;
    const entries: { entryId: string; total: number }[] = [];

    for (const [key, scores] of this.entryScores) {
      if (!key.startsWith(prefix)) continue;
      if (scores.length === 0) continue;

      const entryId = key.slice(prefix.length);
      const total = scores[scores.length - 1].runningTotal;
      entries.push({ entryId, total });
    }

    return entries.sort((a, b) => b.total - a.total);
  }

  /** Get timeline for an entry (all score events in order). */
  async getEntryTimeline(contestId: string, entryId: string): Promise<EntryContestScore[]> {
    const key = `${contestId}#${entryId}`;
    return this.entryScores.get(key) ?? [];
  }

  /** Get participant scores in a contest. */
  async getParticipantScores(
    contestId: string,
    participantId: string,
  ): Promise<ParticipantEventScore[]> {
    const key = `${contestId}#${participantId}`;
    return this.participantScores.get(key) ?? [];
  }

  /** Clear all stored data — useful for testing. */
  clear(): void {
    this.participantScores.clear();
    this.entryScores.clear();
  }
}

export const scoreStore = new ScoreStore();
