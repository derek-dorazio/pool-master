import type {
  SportEventCreate,
  SportEventRepository,
  SportEventRoundRepository,
  SportEventRoundSchedule,
  SportEventTierDefinition,
  SportEventTierRepository,
} from '@poolmaster/shared/db';
import type { SportEvent } from '@poolmaster/shared/domain';
import { expectDefined } from './expect-defined';

// One-row fixtures over the catalog repositories' batch writes (#1253), for tests that set up
// a single event, or one event's rounds or tiers.

/** One event, created through the repository's batch insert. */
export async function createSportEventRow(events: SportEventRepository, input: SportEventCreate): Promise<SportEvent> {
  const [event] = await events.createMany([input]);
  return expectDefined(event, 'created sport event');
}

/** One event's rounds. */
export function createRoundRows(rounds: SportEventRoundRepository, sportEventId: string, schedule: readonly SportEventRoundSchedule[]): Promise<void> {
  return rounds.createMany(schedule.map((round) => ({ sportEventId, ...round })));
}

/** One event's tiers. */
export function createTierRows(tiers: SportEventTierRepository, sportEventId: string, definitions: readonly SportEventTierDefinition[]): Promise<void> {
  return tiers.createMany(definitions.map((tier) => ({ sportEventId, ...tier })));
}
