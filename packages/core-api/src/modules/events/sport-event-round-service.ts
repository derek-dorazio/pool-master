/**
 * SportEventRoundService — an event's round schedule (plans/124 §4.10): when each round
 * is played, independent of any participant's result in it.
 *
 * A new event's rounds are created with it (`createSchedules`), from a derived schedule or the
 * default, `dailyRoundSchedule`: sequential daily dates from the event's start, each editable
 * afterwards. `extendTo` adds rounds after the last one. `reschedule` and `shiftSchedule` only
 * move existing rounds; neither creates one.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { SportEventRoundCreate, SportEventRoundRepository, SportEventRoundSchedule } from '@poolmaster/shared/db';
import { NO_ROUND_RESULTS, roundProgressOf, type RoundProgress, type SportEventRound } from '@poolmaster/shared/domain';
import { SportEventError } from './errors';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** How many rounds `providerEventRoundSchedule` makes. Deleted with it in slice 10b. */
const PROVIDER_EVENT_DEFAULT_ROUNDS = 4;

/** A round with where it stands (#1889): what the rounds read answers with. */
export type SportEventRoundView = SportEventRound & { progress: RoundProgress };

export interface SportEventRoundServiceDeps {
  rounds: SportEventRoundRepository;
  logger?: FastifyBaseLogger;
}

export class SportEventRoundService {
  constructor(private readonly deps: SportEventRoundServiceDeps) {}

  listRounds(sportEventId: string): Promise<SportEventRound[]> {
    return this.deps.rounds.findBySportEvent(sportEventId);
  }

  /** The event's rounds, each with its status, result count and completion time read off its results. */
  async listRoundViews(sportEventId: string): Promise<SportEventRoundView[]> {
    const [rounds, facts] = await Promise.all([this.deps.rounds.findBySportEvent(sportEventId), this.deps.rounds.findResultFacts(sportEventId)]);
    return rounds.map((round) => ({ ...round, progress: roundProgressOf(facts.get(round.id) ?? NO_ROUND_RESULTS) }));
  }

  /**
   * Creates new events' round schedules, every event's in one insert (#1253). The events have no
   * rounds yet: an event is created with its schedule.
   */
  async createSchedules(schedules: ReadonlyArray<{ sportEventId: string; rounds: ReadonlyArray<Omit<SportEventRoundCreate, 'sportEventId'>> }>): Promise<void> {
    await this.deps.rounds.createMany(schedules.flatMap(({ sportEventId, rounds }) => rounds.map((round) => ({ sportEventId, ...round }))));
    this.deps.logger?.info(
      { sportEventIds: schedules.map(({ sportEventId }) => sportEventId), roundCount: schedules.reduce((total, { rounds }) => total + rounds.length, 0) },
      'Created round schedules for new events',
    );
  }

  /**
   * Adds rounds up to `rounds` when an admin raises an event's round count: each added round a
   * day after the round before it, so it follows an irregular schedule rather than landing on
   * one of its days. Rounds that exist are left alone.
   */
  async extendTo(input: { sportEventId: string; rounds: number; startDate: Date }): Promise<SportEventRound[]> {
    const existing = await this.deps.rounds.findBySportEvent(input.sportEventId);
    // Only an event played in one slot takes more rounds: a round per slot is the others' count (#2006).
    const seasonSlotIds = new Set(existing.map((round) => round.slot.seasonSlotId));
    const [seasonSlotId] = [...seasonSlotIds];
    if (seasonSlotIds.size !== 1) {
      throw new SportEventError(
        `Sport event ${input.sportEventId} plays a round in each of its slots, so its round count comes from them.`,
        'EVENT_ROUNDS_FROM_SLOTS',
        422,
      );
    }
    const dateByRound = new Map(existing.map((round) => [round.roundNumber, round.scheduledDate]));
    const added: SportEventRoundSchedule[] = [];
    for (let roundNumber = 1; roundNumber <= input.rounds; roundNumber += 1) {
      if (dateByRound.has(roundNumber)) continue;
      const previous = dateByRound.get(roundNumber - 1);
      const scheduledDate = previous
        ? new Date(previous.getTime() + MS_PER_DAY)
        : new Date(input.startDate.getTime() + (roundNumber - 1) * MS_PER_DAY);
      dateByRound.set(roundNumber, scheduledDate);
      added.push({ roundNumber, scheduledDate });
    }
    if (added.length > 0) {
      await this.deps.rounds.createMany(added.map((round) => ({ sportEventId: input.sportEventId, seasonSlotId, ...round })));
      this.deps.logger?.info(
        { sportEventId: input.sportEventId, createdRoundNumbers: added.map((round) => round.roundNumber) },
        'Added rounds to the schedule',
      );
    }
    return this.deps.rounds.findBySportEvent(input.sportEventId);
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

/**
 * A provider event's schedule when no round count is given: four rounds a day apart from
 * `startDate`, the fourth on `endDate` when the provider sends one. A stopgap until slice 10b
 * of the league model redesign takes the round count from the event's Round rows and deletes it.
 */
export function providerEventRoundSchedule(startDate: Date, endDate: Date | null): SportEventRoundSchedule[] {
  const schedule = dailyRoundSchedule(PROVIDER_EVENT_DEFAULT_ROUNDS, startDate);
  if (endDate === null) return schedule;
  return schedule.map((round) => round.roundNumber === PROVIDER_EVENT_DEFAULT_ROUNDS
    ? { ...round, scheduledDate: endDate }
    : round);
}

/** The default schedule: rounds 1..`rounds` a day apart from `startDate`. */
export function dailyRoundSchedule(rounds: number, startDate: Date): SportEventRoundSchedule[] {
  return Array.from({ length: rounds }, (_, index) => ({
    roundNumber: index + 1,
    scheduledDate: new Date(startDate.getTime() + index * MS_PER_DAY),
  }));
}

/**
 * An event's rounds in its slots (#2006), its slots in play order: an event played in one slot
 * plays every round of `schedule` there (a golf tournament's four, a week's one); an event with
 * several plays a round in each, numbered in that order and dated by the slot, else by the
 * schedule's start.
 */
export function roundsInSlots(
  schedule: readonly SportEventRoundSchedule[],
  slots: ReadonlyArray<{ id: string; startsAt: Date | null; endsAt: Date | null }>,
): Array<Omit<SportEventRoundCreate, 'sportEventId'>> {
  if (slots.length === 0) throw new Error('An event is created on at least one Season slot.');
  // poolmaster-allow-position: an event of one slot plays every round in it
  if (slots.length === 1) return schedule.map((round) => ({ ...round, seasonSlotId: slots[0].id }));
  const start = schedule.length === 0 ? null : new Date(Math.min(...schedule.map((round) => round.scheduledDate.getTime())));
  return slots.map((slot, index) => ({
    roundNumber: index + 1,
    scheduledDate: requiredDate(slot.startsAt ?? start, slot.id),
    scheduledEndAt: slot.endsAt,
    seasonSlotId: slot.id,
  }));
}

function requiredDate(date: Date | null, seasonSlotId: string): Date {
  if (date === null) throw new Error(`Season slot ${seasonSlotId} has no start, and the event no schedule to date its round by.`);
  return date;
}
