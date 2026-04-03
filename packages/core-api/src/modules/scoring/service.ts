/**
 * ScoringService — reads from ScoreStore and returns formatted leaderboard data.
 */

import type { PrismaClient } from '@prisma/client';
import type { ScoreStore, EntryContestScore, ParticipantEventScore } from './storage/score-store';
import type { StandingsRollup, RollupResult } from './rollup/standings-rollup';
import { assignRanks } from './rollup/standings-rollup';

// --- Response Types ---

export interface LeaderboardEntry {
  entryId: string;
  rank: number;
  totalScore: number;
  isTied: boolean;
}

export interface EntryScoreDetail {
  entryId: string;
  contestId: string;
  totalScore: number;
  timeline: EntryContestScore[];
}

export interface ParticipantScoreHistory {
  participantId: string;
  contestId: string;
  scores: ParticipantEventScore[];
  totalPoints: number;
}

export interface HealthDetail {
  status: string;
  service: string;
  rollupRunning: boolean;
  activeContests: number;
  timestamp: string;
}

// --- Service ---

export interface ScoringServiceDeps {
  scoreStore: ScoreStore;
  standingsRollup: StandingsRollup;
  prisma: PrismaClient;
}

/** Service layer for leaderboard and scoring queries. */
export class ScoringService {
  private readonly scoreStore: ScoreStore;
  private readonly standingsRollup: StandingsRollup;
  private readonly prisma: PrismaClient;

  constructor(deps: ScoringServiceDeps) {
    this.scoreStore = deps.scoreStore;
    this.standingsRollup = deps.standingsRollup;
    this.prisma = deps.prisma;
  }

  /** Get full leaderboard for a contest with ranks. */
  async getLeaderboard(contestId: string): Promise<LeaderboardEntry[]> {
    const leaderboard = await this.scoreStore.getLeaderboard(contestId);
    return assignRanks(leaderboard);
  }

  /** Get detailed score breakdown for a specific entry. */
  async getEntryScore(contestId: string, entryId: string): Promise<EntryScoreDetail> {
    const timeline = await this.scoreStore.getEntryTimeline(contestId, entryId);
    const totalScore = await this.scoreStore.getEntryTotal(contestId, entryId);
    const participantIds = Array.from(new Set(
      timeline.flatMap((event) => event.participantBreakdowns.map((breakdown) => breakdown.participantId)),
    ));
    const participants = participantIds.length === 0
      ? []
      : await this.prisma.participant.findMany({
          where: { id: { in: participantIds } },
          select: { id: true, name: true },
        });
    const participantNameById = new Map(participants.map((participant) => [participant.id, participant.name]));

    return {
      entryId,
      contestId,
      totalScore,
      timeline: timeline.map((event) => ({
        ...event,
        participantBreakdowns: event.participantBreakdowns.map((breakdown) => ({
          ...breakdown,
          participantName: participantNameById.get(breakdown.participantId) ?? null,
        })),
      })),
    };
  }

  /** Get participant score history for a contest. */
  async getParticipantScoreHistory(
    contestId: string,
    participantId: string,
  ): Promise<ParticipantScoreHistory> {
    const scores = await this.scoreStore.getParticipantScores(contestId, participantId);
    const totalPoints = scores.reduce((sum, s) => sum + s.points, 0);
    return {
      participantId,
      contestId,
      scores,
      totalPoints,
    };
  }

  /** Trigger manual rollup for a contest. */
  async triggerRollup(contestId: string): Promise<RollupResult> {
    return this.standingsRollup.rollupContest(contestId);
  }

  /** Get detailed health information. */
  getHealth(): HealthDetail {
    return {
      status: 'ok',
      service: 'scoring-service',
      rollupRunning: this.standingsRollup.isRunning(),
      activeContests: this.standingsRollup.getActiveContestIds().size,
      timestamp: new Date().toISOString(),
    };
  }
}
