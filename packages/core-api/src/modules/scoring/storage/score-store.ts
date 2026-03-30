/**
 * ScoreStore — hybrid Prisma + in-memory score storage.
 *
 * Persistent totals are stored in ContestEntry.totalScore via Prisma.
 * Transient timeline/breakdown data is kept in-memory (acceptable for
 * scoring events that are replayed from the event stream on restart).
 */

import type { PrismaClient } from '@prisma/client';
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
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /** Append a participant's score event (in-memory detail cache). */
  async appendParticipantScore(score: ParticipantEventScore): Promise<void> {
    const key = `${score.contestId}#${score.participantId}`;
    const existing = this.participantScores.get(key) ?? [];
    existing.push(score);
    this.participantScores.set(key, existing);
  }

  /** Append an entry's score event. Persists running total to Prisma. */
  async appendEntryScore(score: EntryContestScore): Promise<void> {
    const key = `${score.contestId}#${score.entryId}`;
    const existing = this.entryScores.get(key) ?? [];
    existing.push(score);
    this.entryScores.set(key, existing);

    await this.prisma.contestEntry.update({
      where: { id: score.entryId },
      data: { totalScore: score.runningTotal },
    });
  }

  /** Get running total for an entry in a contest. */
  async getEntryTotal(contestId: string, entryId: string): Promise<number> {
    const entry = await this.prisma.contestEntry.findUnique({
      where: { id: entryId },
      select: { totalScore: true },
    });
    if (entry) return entry.totalScore;

    // Fall back to in-memory cache
    const key = `${contestId}#${entryId}`;
    const scores = this.entryScores.get(key);
    if (!scores || scores.length === 0) return 0;
    return scores[scores.length - 1].runningTotal;
  }

  /** Get leaderboard for a contest (all entries sorted by total descending). */
  async getLeaderboard(contestId: string): Promise<{ entryId: string; total: number }[]> {
    const entries = await this.prisma.contestEntry.findMany({
      where: { contestId },
      orderBy: { totalScore: 'desc' },
      select: { id: true, totalScore: true },
    });

    return entries.map((e) => ({
      entryId: e.id,
      total: e.totalScore,
    }));
  }

  /** Get timeline for an entry (all score events in order — transient cache). */
  async getEntryTimeline(contestId: string, entryId: string): Promise<EntryContestScore[]> {
    const key = `${contestId}#${entryId}`;
    return this.entryScores.get(key) ?? [];
  }

  /** Get participant scores in a contest (transient detail cache). */
  async getParticipantScores(
    contestId: string,
    participantId: string,
  ): Promise<ParticipantEventScore[]> {
    const key = `${contestId}#${participantId}`;
    return this.participantScores.get(key) ?? [];
  }

  /** Clear in-memory caches — useful for testing. */
  clear(): void {
    this.participantScores.clear();
    this.entryScores.clear();
  }
}
