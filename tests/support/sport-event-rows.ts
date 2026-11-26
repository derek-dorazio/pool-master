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
import { linkTestSlot } from './test-slots';

// One-row fixtures over the catalog repositories' batch writes (#1253), for tests that set up
// a single event, or one event's rounds or tiers.

/** One event, created through the repository's batch insert. */
export async function createSportEventRow(events: SportEventRepository, input: SportEventCreate): Promise<SportEvent> {
  const [event] = await events.createMany([input]);
  return expectDefined(event, 'created sport event');
}

/**
 * One event's rounds, all played in its one slot (#2006): the event's own, else a test slot linked
 * to it now (an event a test made below the API has none).
 */
export async function createRoundRows(
  prisma: Parameters<typeof linkTestSlot>[0],
  rounds: SportEventRoundRepository,
  event: { id: string; sportLeagueSeasonId: string; startDate: Date },
  schedule: readonly SportEventRoundSchedule[],
): Promise<void> {
  const slots = await prisma.sportEventSlot.findMany({ where: { sportEventId: event.id }, select: { sportLeagueSeasonCompetitionSlotId: true } });
  if (slots.length > 1) throw new Error(`Sport event ${event.id} has ${String(slots.length)} slots; createRoundRows places rounds in one.`);
  // poolmaster-allow-position: the event's one slot
  const seasonSlotId = slots.length === 1 ? slots[0].sportLeagueSeasonCompetitionSlotId : await linkTestSlot(prisma, event);
  await rounds.createMany(schedule.map((round) => ({ sportEventId: event.id, seasonSlotId, ...round })));
}

/** One event's tiers. */
export function createTierRows(tiers: SportEventTierRepository, sportEventId: string, definitions: readonly SportEventTierDefinition[]): Promise<void> {
  return tiers.createMany(definitions.map((tier) => ({ sportEventId, ...tier })));
}
