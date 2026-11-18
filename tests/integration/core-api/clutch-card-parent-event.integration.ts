import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Sport } from '@poolmaster/shared/domain';
import { PrismaSportEventRepository, PrismaSportLeagueRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { expectDefined } from '../../support/expect-defined';

// #1820 against real Postgres: a Clutch Card event's link to its season event as the adapter
// writes and reads it, what the database itself refuses, the reference data that names each
// Clutch Card league's parent rounds, and the migration's backfill of the events already on a site.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271128000000_clutch_card_parent_event/migration.sql');

/** The migration's backfill statement, run again over rows a test wrote. */
function backfillStatement(): string {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('WITH candidates AS');
  if (start < 0) throw new Error('The migration has no backfill statement.');
  return sql.slice(start);
}

async function baseballLeague(name: string) {
  const sport = await getPrisma().sport.findUniqueOrThrow({ where: { sport: Sport.BASEBALL } });
  return getPrisma().sportLeague.findUniqueOrThrow({ where: { sportId_name: { sportId: sport.id, name } } });
}

/** An event row in a series of its own in the league, written as a test fixture. */
async function eventRow(sportLeagueId: string, input: { name: string; rounds: number; startDate: string; endDate: string | null; eventYear?: number }) {
  const series = await getPrisma().eventSeries.create({ data: { sportLeagueId, name: `${input.name} ${randomUUID()}` } });
  return getPrisma().sportEvent.create({
    data: {
      externalId: `clutch-${randomUUID()}`,
      providerId: 'integration-test',
      sport: Sport.BASEBALL,
      name: input.name,
      startDate: new Date(input.startDate),
      endDate: input.endDate === null ? null : new Date(input.endDate),
      rounds: input.rounds,
      eventSeriesId: series.id,
      eventYear: input.eventYear ?? 2025,
    },
  });
}

describe('Clutch Card parent event in Postgres (#1820)', () => {
  it('names every Clutch Card league\'s parent league and the rounds of it the league covers in reference data', async () => {
    const leagues = await getPrisma().sportLeague.findMany({ where: { scoringFamily: 'COMPOSITE' }, select: { name: true, parentSportLeagueId: true, parentRoundNumbers: true } });

    expect(leagues.length).toBeGreaterThanOrEqual(20);
    expect(leagues.filter((league) => league.parentSportLeagueId === null || league.parentRoundNumbers.length === 0)).toEqual([]);
    const worldSeries = await new PrismaSportLeagueRepository(getAppPrisma()).findById((await baseballLeague('World Series')).id);
    expect(worldSeries?.parentRoundNumbers).toEqual([4]);
  });

  it('writes a new event\'s parent and rounds, reads them back with the parent\'s name, and counts the parent\'s Clutch Card events', async () => {
    const events = new PrismaSportEventRepository(getAppPrisma());
    const mlb = await baseballLeague('MLB');
    const worldSeriesLeague = await baseballLeague('World Series');
    const postseason = await eventRow(mlb.id, { name: 'MLB Postseason', rounds: 4, startDate: '2025-09-30T17:00:00Z', endDate: '2025-11-02T04:00:00Z' });
    const series = await getPrisma().eventSeries.create({ data: { sportLeagueId: worldSeriesLeague.id, name: `World Series ${randomUUID()}` } });

    const [created] = await events.createMany([{
      externalId: `ws-${randomUUID()}`,
      providerId: 'integration-test',
      sport: Sport.BASEBALL,
      name: 'World Series',
      startDate: new Date('2025-10-24T23:00:00Z'),
      status: 'DRAFT',
      rounds: 7,
      eventSeriesId: series.id,
      eventYear: 2025,
      syncScope: 'NONE',
      autoLifecycleEnabled: true,
      parentEvent: { id: postseason.id, roundNumbers: [4] },
    }]);

    expect(created.parentEvent).toEqual({ id: postseason.id, name: 'MLB Postseason', roundNumbers: [4] });
    expect((await events.findById(created.id))?.parentEvent).toEqual({ id: postseason.id, name: 'MLB Postseason', roundNumbers: [4] });
    expect((await events.findById(postseason.id))?.parentEvent).toBeUndefined();
    expect(await events.countClutchCardEvents([postseason.id, created.id])).toEqual(new Map([[postseason.id, 1], [created.id, 0]]));
  });

  it('refuses a parent without rounds, rounds without a parent, and deleting a parent a Clutch Card event names', async () => {
    const mlb = await baseballLeague('MLB');
    const worldSeriesLeague = await baseballLeague('World Series');
    const postseason = await eventRow(mlb.id, { name: 'MLB Postseason', rounds: 4, startDate: '2025-09-30T17:00:00Z', endDate: '2025-11-02T04:00:00Z' });
    const worldSeries = await eventRow(worldSeriesLeague.id, { name: 'World Series', rounds: 7, startDate: '2025-10-24T23:00:00Z', endDate: '2025-11-02T04:00:00Z' });

    await expect(getPrisma().sportEvent.update({ where: { id: worldSeries.id }, data: { parentEventId: postseason.id } }))
      .rejects.toThrow(/sport_events_parent_with_rounds/);
    await expect(getPrisma().sportEvent.update({ where: { id: worldSeries.id }, data: { parentRoundNumbers: [4] } }))
      .rejects.toThrow(/sport_events_parent_with_rounds/);

    await getPrisma().sportEvent.update({ where: { id: worldSeries.id }, data: { parentEventId: postseason.id, parentRoundNumbers: [4] } });
    await expect(getPrisma().sportEvent.delete({ where: { id: postseason.id } })).rejects.toThrow();
    await expect(getPrisma().sportLeague.update({ where: { id: mlb.id }, data: { parentRoundNumbers: [1] } }))
      .rejects.toThrow(/sport_leagues_parent_rounds_need_parent_league/);
  });

  it('backfills each Clutch Card event with the one parent league event under way at its start, leaving one with none or several unlinked', async () => {
    const mlb = await baseballLeague('MLB');
    const worldSeriesLeague = await baseballLeague('World Series');
    const lcsLeague = await baseballLeague('League Championship Series');
    const postseason = await eventRow(mlb.id, { name: 'MLB Postseason', rounds: 4, startDate: '2025-09-30T17:00:00Z', endDate: '2025-11-02T04:00:00Z' });
    // A one-round event of the parent league the same days is no season event of the World Series,
    // and a test season event of another year under way the same days gives way to the real one.
    await eventRow(mlb.id, { name: 'Test- MLB Postseason', rounds: 4, startDate: '2025-10-01T12:00:00Z', endDate: '2025-11-03T12:00:00Z', eventYear: 2023 });
    await eventRow(mlb.id, { name: 'MLB Exhibition', rounds: 1, startDate: '2025-10-01T17:00:00Z', endDate: '2025-11-01T04:00:00Z' });
    const linked = await eventRow(worldSeriesLeague.id, { name: 'World Series', rounds: 7, startDate: '2025-10-24T23:00:00Z', endDate: '2025-11-02T04:00:00Z' });
    // Next season's World Series, whose season event was never loaded.
    const orphan = await eventRow(worldSeriesLeague.id, { name: 'World Series 2026', rounds: 7, startDate: '2026-10-23T23:00:00Z', endDate: null, eventYear: 2026 });
    // Two 2024 postseasons under way at once: the backfill cannot choose, so it links neither.
    await eventRow(mlb.id, { name: 'MLB Postseason 2024', rounds: 4, startDate: '2024-10-01T17:00:00Z', endDate: '2024-11-01T04:00:00Z', eventYear: 2024 });
    await eventRow(mlb.id, { name: 'Test- MLB Postseason 2024', rounds: 4, startDate: '2024-10-02T17:00:00Z', endDate: null, eventYear: 2024 });
    const ambiguous = await eventRow(lcsLeague.id, { name: 'League Championship Series 2024', rounds: 7, startDate: '2024-10-13T23:00:00Z', endDate: null, eventYear: 2024 });
    // An event of a league that is not a Clutch Card's is never given a parent.
    const season = await eventRow(mlb.id, { name: 'MLB Wild Card', rounds: 1, startDate: '2025-10-24T23:00:00Z', endDate: null });

    await getPrisma().$executeRawUnsafe(backfillStatement());

    const after = await getPrisma().sportEvent.findMany({
      where: { id: { in: [linked.id, orphan.id, ambiguous.id, season.id] } },
      select: { id: true, parentEventId: true, parentRoundNumbers: true },
    });
    const byId = new Map(after.map((row) => [row.id, row]));
    expect(expectDefined(byId.get(linked.id))).toMatchObject({ parentEventId: postseason.id, parentRoundNumbers: [4] });
    for (const id of [orphan.id, ambiguous.id, season.id]) {
      expect(expectDefined(byId.get(id))).toMatchObject({ parentEventId: null, parentRoundNumbers: [] });
    }
  });
});
