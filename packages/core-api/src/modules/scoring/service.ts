/**
 * ScoringService — reads persisted contest scoring state and exposes
 * leaderboard, entry breakdown, participant history, and rollup operations.
 */

import type { PrismaClient } from '@prisma/client';
import type { RollupResult, StandingsRollup } from './rollup/standings-rollup';
import { assignRanks } from './rollup/standings-rollup';

export interface ScoreBreakdownView {
  participantId: string;
  participantName: string | null;
  contextLabel: string | null;
  statPoints: number;
  positionPoints: number;
  bonusPoints: number;
  penaltyPoints: number;
  multipliedTotal: number;
  dnfAdjustment: number;
  finalScore: number;
}

export interface LeaderboardEntry {
  entryId: string;
  rank: number;
  totalScore: number;
  isTied: boolean;
}

export interface EntryContestScoreView {
  contestId: string;
  entryId: string;
  eventTimestamp: string;
  pointsEarned: number;
  runningTotal: number;
  participantBreakdowns: ScoreBreakdownView[];
}

export interface EntryScoreDetail {
  entryId: string;
  contestId: string;
  totalScore: number;
  timeline: EntryContestScoreView[];
}

interface BreakdownContext {
  contextLabel: string | null;
}

export interface ParticipantEventScoreView {
  contestId: string;
  participantId: string;
  eventTimestamp: string;
  stats: Record<string, number>;
  points: number;
  breakdown: ScoreBreakdownView;
}

export interface ParticipantScoreHistory {
  participantId: string;
  contestId: string;
  scores: ParticipantEventScoreView[];
  totalPoints: number;
}

export interface HealthDetail {
  status: string;
  service: string;
  rollupRunning: boolean;
  activeContests: number;
  timestamp: string;
}

export interface ScoringServiceDeps {
  standingsRollup: StandingsRollup;
  prisma: PrismaClient;
}

export class ScoringService {
  private readonly standingsRollup: StandingsRollup;
  private readonly prisma: PrismaClient;

  constructor(deps: ScoringServiceDeps) {
    this.standingsRollup = deps.standingsRollup;
    this.prisma = deps.prisma;
  }

  async getLeaderboard(contestId: string): Promise<LeaderboardEntry[]> {
    const entries = await this.prisma.contestEntry.findMany({
      where: { contestId },
      orderBy: [{ totalScore: 'desc' }, { id: 'asc' }],
      select: { id: true, totalScore: true },
    });
    return assignRanks(entries.map((entry) => ({ entryId: entry.id, total: entry.totalScore })));
  }

  async getEntryScore(contestId: string, entryId: string): Promise<EntryScoreDetail> {
    const entry = await this.prisma.contestEntry.findUnique({
      where: { id: entryId },
      select: {
        id: true,
        contestId: true,
        totalScore: true,
      },
    });
    if (!entry || entry.contestId !== contestId) {
      return {
        entryId,
        contestId,
        totalScore: 0,
        timeline: [],
      };
    }

    const scoreEvents = await this.prisma.contestEntryParticipantScoreEvent.findMany({
      where: {
        participantScore: {
          entryId,
        },
      },
      include: {
        participantScore: {
          include: {
            rosterPick: {
              include: {
                sportEventParticipant: {
                  include: {
                    participant: {
                      select: { id: true, name: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const contextByParticipantId = await this.getBreakdownContext(contestId, entryId);

    let runningTotal = 0;
    return {
      entryId,
      contestId,
      totalScore: entry.totalScore,
      timeline: scoreEvents.map((event) => {
        const participant =
          event.participantScore.rosterPick.sportEventParticipant.participant;
        runningTotal += event.points;
        return {
          contestId,
          entryId,
          eventTimestamp: event.createdAt.toISOString(),
          pointsEarned: event.points,
          runningTotal,
          participantBreakdowns: [
            buildBreakdown(
              participant.id,
              participant.name,
              event.points,
              event.detailsJson as Record<string, unknown>,
              contextByParticipantId.get(participant.id)?.contextLabel ?? null,
            ),
          ],
        };
      }),
    };
  }

  private async getBreakdownContext(
    _contestId: string,
    _entryId: string,
  ): Promise<Map<string, BreakdownContext>> {
    return new Map();
  }

  async getParticipantScoreHistory(
    contestId: string,
    participantId: string,
  ): Promise<ParticipantScoreHistory> {
    const scoreEvents = await this.prisma.contestEntryParticipantScoreEvent.findMany({
      where: {
        participantScore: {
          entry: { contestId },
          rosterPick: {
            sportEventParticipant: { participantId },
          },
        },
      },
      include: {
        participantScore: {
          include: {
            rosterPick: {
              include: {
                sportEventParticipant: {
                  include: {
                    participant: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const participantName =
      scoreEvents[0]?.participantScore.rosterPick.sportEventParticipant.participant.name ?? null;
    const scores = scoreEvents.map((event) => ({
      contestId,
      participantId,
      eventTimestamp: event.createdAt.toISOString(),
      stats: extractNumericStats(event.detailsJson as Record<string, unknown>),
      points: event.points,
      breakdown: buildBreakdown(
        participantId,
        participantName,
        event.points,
        event.detailsJson as Record<string, unknown>,
        null,
      ),
    }));

    return {
      participantId,
      contestId,
      scores,
      totalPoints: scores.reduce((sum, score) => sum + score.points, 0),
    };
  }

  async triggerRollup(contestId: string): Promise<RollupResult> {
    return this.standingsRollup.rollupContest(contestId);
  }

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

function buildBreakdown(
  participantId: string,
  participantName: string | null,
  points: number,
  details: Record<string, unknown>,
  contextLabel: string | null,
): ScoreBreakdownView {
  const eventType = typeof details.eventType === 'string' ? details.eventType : null;
  const scoreToPar =
    typeof details.scoreToPar === 'number' ? details.scoreToPar : undefined;
  const penaltyApplied =
    typeof details.penaltyApplied === 'number' ? details.penaltyApplied : undefined;

  let statPoints = points;
  let bonusPoints = 0;
  let penaltyPoints = 0;

  if (scoreToPar !== undefined) {
    statPoints = scoreToPar;
  }

  if (penaltyApplied !== undefined) {
    penaltyPoints = penaltyApplied;
  }

  if (eventType === 'ROUND_MULTIPLIER' || eventType === 'SEED_DIFFERENTIAL_BONUS') {
    statPoints = 0;
    bonusPoints = points;
  }

  return {
    participantId,
    participantName,
    contextLabel,
    statPoints,
    positionPoints: 0,
    bonusPoints,
    penaltyPoints,
    multipliedTotal: points,
    dnfAdjustment: 0,
    finalScore: points,
  };
}

function extractNumericStats(details: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => typeof value === 'number'),
  ) as Record<string, number>;
}
