import type {
  EventSeriesRepository,
  SportEventCreate,
  SportEventRepository,
  SportEventRoundRepository,
  SportEventRoundSchedule,
  SportEventTierDefinition,
  SportEventTierRepository,
} from '@poolmaster/shared/db';
import type { EventSeries, SportEvent } from '@poolmaster/shared/domain';
import { expectDefined } from './expect-defined';

// One-row fixtures over the catalog repositories' batch writes (#1253), for tests that set up
// a single event, series, or one event's rounds or tiers.

/** One event, created through the repository's batch insert. */
export async function createSportEventRow(events: SportEventRepository, input: SportEventCreate): Promise<SportEvent> {
  const [event] = await events.createMany([input]);
  return expectDefined(event, 'created sport event');
}

/** The sport league's series of this name, created on first use. */
export async function seriesNamed(series: EventSeriesRepository, sportLeagueId: string, name: string): Promise<EventSeries> {
  const [row] = await series.findOrCreateMany(sportLeagueId, [name]);
  return expectDefined(row, `event series ${name}`);
}

/** One event's rounds. */
export function createRoundRows(rounds: SportEventRoundRepository, sportEventId: string, schedule: readonly SportEventRoundSchedule[]): Promise<void> {
  return rounds.createMany(schedule.map((round) => ({ sportEventId, ...round })));
}

/** One event's tiers. */
export function createTierRows(tiers: SportEventTierRepository, sportEventId: string, definitions: readonly SportEventTierDefinition[]): Promise<void> {
  return tiers.createMany(definitions.map((tier) => ({ sportEventId, ...tier })));
}
