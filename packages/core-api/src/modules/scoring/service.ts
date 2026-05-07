/**
 * ScoringService — reads persisted contest scoring state and exposes
 * leaderboard, entry breakdown, participant history, and rollup operations.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { ContestEntryNotFoundError } from '../contests/service';
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
  status: 'ok';
  service: string;
  /**
   * Indicates the live-score-driven scoring path is the canonical
   * single write path (plans/117 §11.3). Always true in this build —
   * pool-master-rop.78.8 retired the periodic rollup interval so there
   * is no longer a separate "rollup running" lifecycle to surface. The
   * field is kept on the response so existing health consumers can
   * continue to call the endpoint without a contract change.
   */
  eventDriven: true;
  timestamp: string;
}

export interface ScoringServiceDeps {
  standingsRollup: StandingsRollup;
  prisma: PrismaClient;
  logger?: FastifyBaseLogger;
}

export class ScoringService {
  private readonly standingsRollup: StandingsRollup;
  private readonly prisma: PrismaClient;

  constructor(deps: ScoringServiceDeps) {
    this.standingsRollup = deps.standingsRollup;
    this.prisma = deps.prisma;
    this.logger = deps.logger;
  }

  private readonly logger?: FastifyBaseLogger;

  async getLeaderboard(contestId: string): Promise<LeaderboardEntry[]> {
    this.logger?.debug({ contestId }, 'Reading scoring leaderboard');
    const entries = await this.prisma.contestEntry.findMany({
      where: { contestId },
      orderBy: [{ totalScore: 'desc' }, { id: 'asc' }],
      select: { id: true, totalScore: true },
    });
    const leaderboard = assignRanks(entries.map((entry) => ({ entryId: entry.id, total: entry.totalScore })));
    this.logger?.info({ contestId, entryCount: leaderboard.length }, 'Read scoring leaderboard');
    return leaderboard;
  }

  async getEntryScore(contestId: string, entryId: string): Promise<EntryScoreDetail> {
    this.logger?.debug({ contestId, entryId }, 'Reading scoring entry breakdown');
    const entry = await this.prisma.contestEntry.findUnique({
      where: { id: entryId },
      select: {
        id: true,
        contestId: true,
        totalScore: true,
      },
    });
    if (!entry || entry.contestId !== contestId) {
      this.logger?.warn({ contestId, entryId }, 'Scoring entry breakdown requested for missing or mismatched entry');
      throw new ContestEntryNotFoundError(contestId, entryId);
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
            pick: {
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
    const detail = {
      entryId,
      contestId,
      totalScore: entry.totalScore,
      timeline: scoreEvents.map((event) => {
        const participant =
          event.participantScore.pick.sportEventParticipant.participant;
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
    this.logger?.info({
      contestId,
      entryId,
      scoreEventCount: detail.timeline.length,
    }, 'Read scoring entry breakdown');
    return detail;
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
    this.logger?.debug({ contestId, participantId }, 'Reading participant score history');
    const scoreEvents = await this.prisma.contestEntryParticipantScoreEvent.findMany({
      where: {
        participantScore: {
          entry: { contestId },
          pick: {
            sportEventParticipant: { participantId },
          },
        },
      },
      include: {
        participantScore: {
          include: {
            pick: {
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
      scoreEvents[0]?.participantScore.pick.sportEventParticipant.participant.name ?? null;
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

    const history = {
      participantId,
      contestId,
      scores,
      totalPoints: scores.reduce((sum, score) => sum + score.points, 0),
    };
    if (history.scores.length === 0) {
      this.logger?.warn({ contestId, participantId }, 'Participant score history requested with no persisted scoring events');
    } else {
      this.logger?.info({
        contestId,
        participantId,
        scoreEventCount: history.scores.length,
      }, 'Read participant score history');
    }
    return history;
  }

  async triggerRollup(contestId: string): Promise<RollupResult> {
    this.logger?.debug({ contestId }, 'Triggering scoring standings rollup');
    const result = await this.standingsRollup.rollupContest(contestId);
    this.logger?.info({
      contestId,
      entriesUpdated: result.entriesUpdated,
    }, 'Completed scoring standings rollup');
    return result;
  }

  getHealth(): HealthDetail {
    const detail: HealthDetail = {
      status: 'ok',
      service: 'scoring-service',
      eventDriven: true,
      timestamp: new Date().toISOString(),
    };
    this.logger?.debug({ eventDriven: detail.eventDriven }, 'Read scoring service health');
    return detail;
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
