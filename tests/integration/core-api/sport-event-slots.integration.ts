import { Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createSportEventRow } from '../../support/sport-event-rows';
import { freshEventEdition } from '../../support/event-edition';

// The SportEventSlot keys (#2004) against real Postgres: a slot belongs to at most one event, and
// only to an event of the slot's own Season. A fake cannot hold either: both are database keys.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/** A slot of a Season the migrations seeded, with its league, sport and championship year. */
async function seededSeasonSlot() {
  return getPrisma().sportLeagueSeasonPhaseSlot.findFirstOrThrow({
    where: { isTestData: false },
    select: {
      id: true,
      sportLeagueSeasonId: true,
      season: { select: { championshipYear: true, sportLeagueId: true, sportLeague: { select: { sport: { select: { sport: true } } } } } },
    },
    orderBy: { id: 'asc' },
  });
}

/** An event in `championshipYear`'s Season of the league; with no league, in the fixture tour's. */
async function eventIn(sportLeagueId: string | undefined, championshipYear: number, sport: Sport, name: string) {
  return createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    ...(await freshEventEdition(getPrisma(), { ...(sportLeagueId !== undefined && { sportLeagueId }), championshipYear, sport })),
    sport,
    name,
    startDate: new Date(Date.UTC(championshipYear, 5, 1)),
    status: SportEventStatus.SCHEDULED,
    autoLifecycleEnabled: false,
  });
}

describe('SportEventSlot keys', () => {
  it('gives a Season slot to one event and refuses it to a second event of the same Season', async () => {
    const slot = await seededSeasonSlot();
    const { sportLeagueId, championshipYear } = slot.season;
    const sport = slot.season.sportLeague.sport.sport;
    const first = await eventIn(sportLeagueId, championshipYear, sport, 'First on the slot');
    const second = await eventIn(sportLeagueId, championshipYear, sport, 'Second on the slot');
    const row = (sportEventId: string) => ({ sportEventId, sportLeagueSeasonId: slot.sportLeagueSeasonId, sportLeagueSeasonPhaseSlotId: slot.id });

    await getPrisma().sportEventSlot.create({ data: row(first.id) });

    await expect(getPrisma().sportEventSlot.create({ data: row(second.id) })).rejects.toMatchObject({ code: 'P2002' });
    await expect(getPrisma().sportEventSlot.findMany({ where: { sportLeagueSeasonPhaseSlotId: slot.id }, select: { sportEventId: true } }))
      .resolves.toEqual([{ sportEventId: first.id }]);
  });

  it('refuses a slot to an event of another Season', async () => {
    const slot = await seededSeasonSlot();
    const otherSeasonEvent = await eventIn(undefined, slot.season.championshipYear, Sport.GOLF, 'Another Season');

    await expect(getPrisma().sportEventSlot.create({
      data: { sportEventId: otherSeasonEvent.id, sportLeagueSeasonId: slot.sportLeagueSeasonId, sportLeagueSeasonPhaseSlotId: slot.id },
    })).rejects.toMatchObject({ code: 'P2003' });
  });
});
