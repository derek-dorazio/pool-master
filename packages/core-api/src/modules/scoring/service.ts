/**
 * ScoringService — reads from ScoreStore and returns formatted leaderboard data.
 */

import type { PrismaClient } from '@prisma/client';
import { SelectionType } from '@poolmaster/shared/domain';
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

interface BreakdownContext {
  contextLabel: string | null;
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
    const [participants, contextByParticipantId] = await Promise.all([
      participantIds.length === 0
        ? Promise.resolve([])
        : this.prisma.participant.findMany({
            where: { id: { in: participantIds } },
            select: { id: true, name: true },
          }),
      this.getBreakdownContext(contestId, entryId),
    ]);
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
          contextLabel: contextByParticipantId.get(breakdown.participantId)?.contextLabel ?? null,
        })),
      })),
    };
  }

  private async getBreakdownContext(
    contestId: string,
    entryId: string,
  ): Promise<Map<string, BreakdownContext>> {
    const contest = await this.prisma.contest.findUnique({
      where: { id: contestId },
      select: { selectionType: true },
    });
    if (!contest) {
      return new Map();
    }

    switch (contest.selectionType) {
      case SelectionType.PICK_EM:
        return this.getPickEmBreakdownContext(contestId, entryId);
      case SelectionType.BRACKET_PICK_EM:
        return this.getBracketBreakdownContext(contestId, entryId);
      default:
        return new Map();
    }
  }

  private async getPickEmBreakdownContext(
    contestId: string,
    entryId: string,
  ): Promise<Map<string, BreakdownContext>> {
    const [contestPicks, contestMatchups] = await Promise.all([
      this.prisma.contestPick.findMany({
        where: { contestId, entryId },
        select: {
          participantId: true,
          period: true,
          matchupIndex: true,
          periodLabel: true,
          eventId: true,
        },
      }),
      this.prisma.contestMatchup.findMany({
        where: { contestId },
        select: {
          eventId: true,
          period: true,
          matchupIndex: true,
          label: true,
        },
      }),
    ]);

    const matchupByPeriod = new Map(
      contestMatchups.map((matchup) => [`${matchup.period}:${matchup.matchupIndex}`, matchup]),
    );
    const matchupByEventId = new Map(
      contestMatchups
        .filter((matchup) => matchup.eventId)
        .map((matchup) => [matchup.eventId!, matchup]),
    );
    const picksByParticipantId = new Map<string, typeof contestPicks>();

    for (const pick of contestPicks) {
      const existing = picksByParticipantId.get(pick.participantId) ?? [];
      existing.push(pick);
      picksByParticipantId.set(pick.participantId, existing);
    }

    const contextByParticipantId = new Map<string, BreakdownContext>();
    for (const [participantId, picks] of picksByParticipantId.entries()) {
      if (picks.length !== 1) {
        continue;
      }

      const pick = picks[0];
      const matchup = pick.eventId
        ? matchupByEventId.get(pick.eventId) ?? matchupByPeriod.get(`${pick.period}:${pick.matchupIndex}`)
        : matchupByPeriod.get(`${pick.period}:${pick.matchupIndex}`);
      const contextLabel = matchup?.label
        ?? (pick.periodLabel
          ? `${pick.periodLabel} Matchup ${pick.matchupIndex}`
          : `Period ${pick.period} Matchup ${pick.matchupIndex}`);

      contextByParticipantId.set(participantId, { contextLabel });
    }

    return contextByParticipantId;
  }

  private async getBracketBreakdownContext(
    contestId: string,
    entryId: string,
  ): Promise<Map<string, BreakdownContext>> {
    const [prediction, contestMatchups] = await Promise.all([
      this.prisma.bracketPrediction.findUnique({
        where: { entryId },
        select: { predictions: true },
      }),
      this.prisma.contestMatchup.findMany({
        where: { contestId },
        select: {
          roundNumber: true,
          matchNumber: true,
          label: true,
        },
      }),
    ]);

    const predictionRows = Array.isArray(prediction?.predictions)
      ? prediction.predictions as Array<Record<string, unknown>>
      : [];
    const matchupByRound = new Map(
      contestMatchups.map((matchup) => [`${matchup.roundNumber ?? 0}:${matchup.matchNumber ?? 0}`, matchup]),
    );
    const predictionsByParticipantId = new Map<string, Array<{ roundNumber: number; matchNumber: number }>>();

    for (const row of predictionRows) {
      const predictedWinnerId = typeof row.predictedWinnerId === 'string' ? row.predictedWinnerId : null;
      const roundNumber = typeof row.roundNumber === 'number' ? row.roundNumber : null;
      const matchNumber = typeof row.matchNumber === 'number' ? row.matchNumber : null;
      if (!predictedWinnerId || roundNumber === null || matchNumber === null) {
        continue;
      }

      const existing = predictionsByParticipantId.get(predictedWinnerId) ?? [];
      existing.push({ roundNumber, matchNumber });
      predictionsByParticipantId.set(predictedWinnerId, existing);
    }

    const contextByParticipantId = new Map<string, BreakdownContext>();
    for (const [participantId, predictions] of predictionsByParticipantId.entries()) {
      if (predictions.length !== 1) {
        continue;
      }

      const predictionItem = predictions[0];
      const matchup = matchupByRound.get(`${predictionItem.roundNumber}:${predictionItem.matchNumber}`);
      const contextLabel = matchup?.label
        ?? `Round ${predictionItem.roundNumber} Match ${predictionItem.matchNumber}`;
      contextByParticipantId.set(participantId, { contextLabel });
    }

    return contextByParticipantId;
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
