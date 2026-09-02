/**
 * GolfRoundScheduleService — a tournament's `SportEventRound` schedule rows
 * (plans/124 §4.10). Genuinely different from `SportEventParticipantGolfRound`
 * (a golfer's *result* for a round): this table holds the round's own
 * schedule — date/end — independent of any participant.
 *
 * `ensureSportEventRounds` is a default, not a requirement: it seeds
 * sequential daily dates starting at the tournament's `startDate`, and every
 * date is individually editable afterward via `updateSportEventRounds`. It
 * is idempotent — a round number that already has a row is left untouched,
 * never overwritten by a repeat call.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class GolfRoundScheduleError extends Error {
  constructor(
    message: string,
    readonly code: string = 'ROUND_NOT_FOUND',
    readonly statusCode: number = 404,
  ) {
    super(message);
    this.name = 'GolfRoundScheduleError';
  }
}

export interface SportEventRoundRow {
  id: string;
  sportEventId: string;
  roundNumber: number;
  scheduledDate: Date;
  scheduledEndAt: Date | null;
}

export class GolfRoundScheduleService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * Creates one `SportEventRound` per `rounds` for `sportEventId`,
   * defaulting to sequential daily dates starting at `startDate`, for any
   * round number that doesn't already have a row. Idempotent: a no-op for
   * round numbers that already exist.
   */
  async ensureSportEventRounds(input: {
    sportEventId: string;
    rounds: number;
    startDate: Date;
  }): Promise<SportEventRoundRow[]> {
    const existing = await this.prisma.sportEventRound.findMany({
      where: { sportEventId: input.sportEventId },
    });
    const existingRoundNumbers = new Set(existing.map((round) => round.roundNumber));

    const missingRoundNumbers = Array.from(
      { length: input.rounds },
      (_, index) => index + 1,
    ).filter((roundNumber) => !existingRoundNumbers.has(roundNumber));

    if (missingRoundNumbers.length > 0) {
      await this.prisma.$transaction(
        missingRoundNumbers.map((roundNumber) =>
          this.prisma.sportEventRound.create({
            data: {
              sportEventId: input.sportEventId,
              roundNumber,
              scheduledDate: new Date(input.startDate.getTime() + (roundNumber - 1) * MS_PER_DAY),
            },
          }),
        ),
      );
      this.logger?.info({
        sportEventId: input.sportEventId,
        createdRoundNumbers: missingRoundNumbers,
      }, 'Created default golf round schedule rows');
    }

    return this.listSportEventRounds(input.sportEventId);
  }

  async listSportEventRounds(sportEventId: string): Promise<SportEventRoundRow[]> {
    return this.prisma.sportEventRound.findMany({
      where: { sportEventId },
      orderBy: { roundNumber: 'asc' },
    });
  }

  /**
   * Bulk row patch — how a rain delay or an irregular (non-daily) schedule
   * gets recorded (plans/124 §5.2). Throws `GolfRoundScheduleError` for any
   * `roundNumber` that doesn't already have a row for this event; this never
   * creates rounds, only reschedules existing ones.
   */
  async updateSportEventRounds(
    sportEventId: string,
    updates: Array<{ roundNumber: number; scheduledDate: Date; scheduledEndAt?: Date | null }>,
  ): Promise<SportEventRoundRow[]> {
    const existing = await this.prisma.sportEventRound.findMany({
      where: { sportEventId },
    });
    const existingByRoundNumber = new Map(existing.map((round) => [round.roundNumber, round]));

    for (const update of updates) {
      if (!existingByRoundNumber.has(update.roundNumber)) {
        throw new GolfRoundScheduleError(
          `Sport event ${sportEventId} has no SportEventRound for round ${update.roundNumber}`,
        );
      }
    }

    await this.prisma.$transaction(
      updates.map((update) =>
        this.prisma.sportEventRound.update({
          where: {
            sportEventId_roundNumber: { sportEventId, roundNumber: update.roundNumber },
          },
          data: {
            scheduledDate: update.scheduledDate,
            ...(update.scheduledEndAt !== undefined ? { scheduledEndAt: update.scheduledEndAt } : {}),
          },
        }),
      ),
    );

    this.logger?.info({
      sportEventId,
      updatedRoundNumbers: updates.map((update) => update.roundNumber),
    }, 'Updated golf round schedule rows');

    return this.listSportEventRounds(sportEventId);
  }
}
