import type { PrismaClient } from '@prisma/client';
import { GameSideStatus, MatchStatus } from '../../packages/shared/domain';
import { PrismaFieldGameRepository } from '../../packages/core-api/src/adapters';

/** One golfer's score in a round, as the stroke-play writer stores it. */
export interface GolfRoundScore {
  sportEventParticipantId: string;
  strokes: number;
  scoreToPar: number;
  /** Holes thru; 18 once the golfer has finished. */
  thru?: number | null;
  /** The golfer's side status in the round: null while on the course. Finished by default. */
  status?: GameSideStatus | null;
}

/**
 * Writes golfers' rounds as the stroke-play writer does (#2008): each round's FIELD Game, created
 * with its first score, and each golfer's side result there. The event must have the rounds. A
 * Game is COMPLETED once every side written has a status, at `completedAt`.
 */
export async function writeGolfRounds(
  prisma: PrismaClient,
  sportEventId: string,
  rounds: ReadonlyArray<{ roundNumber: number; scores: readonly GolfRoundScore[]; completedAt?: Date | null }>,
): Promise<void> {
  await new PrismaFieldGameRepository(prisma).applyResults(sportEventId, {
    games: rounds.map(({ roundNumber, scores, completedAt }) => {
      const sides = scores.map((score) => {
        const status = score.status === undefined ? GameSideStatus.FINISHED : score.status;
        return {
          sportEventParticipantId: score.sportEventParticipantId,
          score: score.strokes,
          scoreToPar: score.scoreToPar,
          periodsCompleted: score.thru === undefined ? (status === null ? null : 18) : score.thru,
          position: null,
          startPosition: null,
          status,
        };
      });
      const finished = sides.every((side) => side.status !== null);
      return {
        roundNumber,
        status: finished ? MatchStatus.COMPLETED : MatchStatus.IN_PROGRESS,
        completedAt: finished ? completedAt ?? null : null,
        sides,
      };
    }),
    standings: [],
  });
}
