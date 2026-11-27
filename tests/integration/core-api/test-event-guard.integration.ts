/**
 * The test-event guard's one read (#2074, #2253): the admin result routes write only on an event
 * that covers a test slot, and `isTestEvent` answers that from the event read itself. Its slots
 * are read by the event's id, not counted with a relation `_count`, which groups the whole slot
 * table and joins the groups back.
 */
import { randomUUID } from 'node:crypto';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { recordStatements, statementCounts, statementParams, statementsOn, StatementVerb } from '../statement-log';
import { fixtureSeasonId, fixtureTourId } from '../../support/event-edition';
import { createSportEventRow } from '../../support/sport-event-rows';
import { linkTestSlot } from '../../support/test-slots';

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

/** The guard's statements: the event and what every event read carries, each read once. */
const PINNED_COUNTS: Array<[string, number]> = [
  ['SELECT sport_event_provider_mappings', 1],
  ['SELECT sport_event_rounds', 1],
  ['SELECT sport_event_slots', 1],
  ['SELECT sport_events', 1],
  ['SELECT sport_league_competition_slots', 1],
  ['SELECT sport_league_competitions', 1],
  ['SELECT sport_league_phases', 1],
  ['SELECT sport_league_season_competition_slots', 1],
  ['SELECT sport_league_seasons', 1],
  ['SELECT sport_leagues', 1],
  ['SELECT sports', 1],
];

async function eventOnSlot(isTestData: boolean) {
  const prisma = getPrisma();
  const sportLeagueId = await fixtureTourId(prisma);
  const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    sportLeagueId,
    sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeagueId, 2026),
    name: `Guard ${randomUUID().slice(0, 8)}`,
    startDate: new Date('2026-06-01T12:00:00.000Z'),
    status: 'SCHEDULED',
    autoLifecycleEnabled: true,
  });
  await linkTestSlot(prisma, event, isTestData);
  return event;
}

describe('isTestEvent', () => {
  it('says an event on a test slot is a test event, reading its slots by the event id with no grouped count, in the pinned statements', async () => {
    const event = await eventOnSlot(true);

    const { result, statements } = await recordStatements(() => new PrismaSportEventRepository(getAppPrisma()).isTestEvent(event.id));

    expect(result).toBe(true);
    const slotReads = statementsOn(statements, StatementVerb.SELECT, 'sport_event_slots');
    expect(slotReads.map((statement) => statementParams(statement))).toEqual([expect.arrayContaining([event.id])]);
    expect(statements.filter((statement) => /GROUP BY/i.test(statement.sql))).toEqual([]);
    expect(statementCounts(statements)).toEqual(PINNED_COUNTS);
  });

  it('says an event on a slot the sync keeps is no test event, and an unknown event is not found', async () => {
    const event = await eventOnSlot(false);
    const events = new PrismaSportEventRepository(getAppPrisma());

    await expect(events.isTestEvent(event.id)).resolves.toBe(false);
    await expect(events.isTestEvent(randomUUID())).resolves.toBeNull();
  });
});
