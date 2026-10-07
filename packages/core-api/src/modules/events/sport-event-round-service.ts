/**
 * SportEventRoundService — an event's round schedule (plans/124 §4.10): when each round
 * is played, independent of any participant's result in it.
 *
 * `ensureRounds` is a default, not a requirement: sequential daily dates from the event's
 * start, each editable afterwards, and idempotent — a round that already exists is never
 * overwritten. `reschedule` and `shiftSchedule` only move existing rounds; neither creates one.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { SportEventRoundRepository, SportEventRoundSchedule } from '@poolmaster/shared/db';
import type { SportEventRound } from '@poolmaster/shared/domain';
import { SportEventError } from './errors';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SportEventRoundServiceDeps {
  rounds: SportEventRoundRepository;
  logger?: FastifyBaseLogger;
}

export class SportEventRoundService {
  constructor(private readonly deps: SportEventRoundServiceDeps) {}

  listRounds(sportEventId: string): Promise<SportEventRound[]> {
    return this.deps.rounds.findBySportEvent(sportEventId);
  }

  /** Creates rounds 1..`rounds` a day apart from `startDate`, skipping any that exist. */
  async ensureRounds(input: { sportEventId: string; rounds: number; startDate: Date }): Promise<SportEventRound[]> {
    const existing = new Set((await this.deps.rounds.findBySportEvent(input.sportEventId)).map((round) => round.roundNumber));
    const missing = Array.from({ length: input.rounds }, (_, index) => index + 1)
      .filter((roundNumber) => !existing.has(roundNumber))
      .map((roundNumber) => ({
        roundNumber,
        scheduledDate: new Date(input.startDate.getTime() + (roundNumber - 1) * MS_PER_DAY),
      }));
    if (missing.length > 0) {
      await this.deps.rounds.createMany(input.sportEventId, missing);
      this.deps.logger?.info(
        { sportEventId: input.sportEventId, createdRoundNumbers: missing.map((round) => round.roundNumber) },
        'Created default round schedule',
      );
    }
    return this.deps.rounds.findBySportEvent(input.sportEventId);
  }

  /** Creates rounds from an already-derived schedule, where the dates come from somewhere other than start + N days. */
  async createFromSchedule(sportEventId: string, schedule: readonly SportEventRoundSchedule[]): Promise<SportEventRound[]> {
    await this.deps.rounds.createMany(sportEventId, schedule);
    this.deps.logger?.info(
      { sportEventId, createdRoundNumbers: schedule.map((round) => round.roundNumber) },
      'Created round schedule from a derived schedule',
    );
    return this.deps.rounds.findBySportEvent(sportEventId);
  }

  /** Moves every round, start and end, by `shiftMs`: the event's start date moved and its schedule moves with it. */
  async shiftSchedule(sportEventId: string, shiftMs: number): Promise<SportEventRound[]> {
    const existing = await this.deps.rounds.findBySportEvent(sportEventId);
    if (existing.length === 0) {
      return existing;
    }
    return this.reschedule(sportEventId, existing.map((round) => ({
      roundNumber: round.roundNumber,
      scheduledDate: new Date(round.scheduledDate.getTime() + shiftMs),
      scheduledEndAt: round.scheduledEndAt ? new Date(round.scheduledEndAt.getTime() + shiftMs) : null,
    })));
  }

  /** How a rain delay or an irregular schedule is recorded. 404 ROUND_NOT_FOUND for a round the event lacks. */
  async reschedule(sportEventId: string, schedule: readonly SportEventRoundSchedule[]): Promise<SportEventRound[]> {
    const existing = new Set((await this.deps.rounds.findBySportEvent(sportEventId)).map((round) => round.roundNumber));
    const unknown = schedule.find((round) => !existing.has(round.roundNumber));
    if (unknown) {
      throw new SportEventError(
        `Sport event ${sportEventId} has no round ${unknown.roundNumber}.`,
        'ROUND_NOT_FOUND',
        404,
      );
    }
    await this.deps.rounds.reschedule(sportEventId, schedule);
    this.deps.logger?.info(
      { sportEventId, updatedRoundNumbers: schedule.map((round) => round.roundNumber) },
      'Rescheduled rounds',
    );
    return this.deps.rounds.findBySportEvent(sportEventId);
  }
}
