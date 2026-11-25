/**
 * The Prisma adapter for a sport league's Seasons (#2003) against real Postgres: what the events
 * sync reads of them, the daily current-Season recompute's reads and writes, and the League page's
 * Seasons read. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Sport } from '@poolmaster/shared/domain';
import { PrismaSportLeaguePageReader } from '../../../packages/core-api/src/adapters/prisma-sport-league-page-reader';
import { PrismaSportLeagueSeasonRepository } from '../../../packages/core-api/src/adapters/prisma-sport-league-season-repository';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { syncLeagueTo, syncSeasonsTo } from '../../support/league-sync';
import { mapEventToProvider } from '../../support/event-edition';
import { sportPlay } from '../../support/sport-play';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/** A made-up basketball league of this test's own, synced from BALLDONTLIE's NBA, with its 2025, 2026 and 2027 Seasons; 2025 current. */
async function seasonedLeague() {
  const prisma = getPrisma();
  const sport = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.BASKETBALL }, select: { id: true } });
  const league = await prisma.sportLeague.create({
    data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(Sport.BASKETBALL), sportId: sport.id, name: `Season League ${randomUUID().slice(0, 8)}` },
  });
  const mappingId = await syncLeagueTo(prisma, league.id, 'nba');
  const [s2025, s2026, s2027] = await syncSeasonsTo(prisma, league.id, mappingId, [2025, 2026, 2027]);
  return { league, mappingId, s2025, s2026, s2027 };
}

/** One event in `seasonId`, kept under the provider's id for it as the sync makes one when `synced`, else a test event with none. */
async function eventIn(sportLeagueId: string, seasonId: string, synced: boolean) {
  const prisma = getPrisma();
  const series = await prisma.eventSeries.create({ data: { sportLeagueId, name: `Series ${randomUUID().slice(0, 8)}` } });
  const event = await prisma.sportEvent.create({
    data: {
      eventSeriesId: series.id, sportLeagueSeasonId: seasonId, name: series.name,
      startDate: new Date('2026-03-01T00:00:00.000Z'),
    },
  });
  if (synced) await mapEventToProvider(prisma, event.id, { providerId: 'balldontlie', externalId: `season-${event.id}` }, 'nba');
}

describe('PrismaSportLeagueSeasonRepository', () => {
  it('finds a Season by id with its span and championship year, and null for an id no Season has', async () => {
    const { league, s2026 } = await seasonedLeague();
    const repository = new PrismaSportLeagueSeasonRepository(getPrisma());

    await expect(repository.findById(s2026)).resolves.toEqual({
      id: s2026, sportLeagueId: league.id, name: '2026', championshipYear: 2026,
      startsAt: new Date('2026-01-01T00:00:00.000Z'), endsAt: new Date('2026-12-31T23:59:59.999Z'),
    });
    await expect(repository.findById(randomUUID())).resolves.toBeNull();
  });

  it('gives the sync every Season of the league earliest first, each with the provider id of the mapping asked for, and none for another mapping', async () => {
    const { league, mappingId, s2025, s2026, s2027 } = await seasonedLeague();
    const repository = new PrismaSportLeagueSeasonRepository(getPrisma());

    const seasons = await repository.findForSync(league.id, mappingId);
    const otherMapping = await repository.findForSync(league.id, randomUUID());

    expect(seasons.map((season) => [season.id, season.providerSeasonId])).toEqual([[s2025, '2025'], [s2026, '2026'], [s2027, '2027']]);
    expect(otherMapping.map((season) => season.providerSeasonId)).toEqual([null, null, null]);
  });

  it('reads each league\'s current Season and its Seasons\' spans, marking only a Season the sync has made an event in', async () => {
    const { league, s2025, s2026, s2027 } = await seasonedLeague();
    await eventIn(league.id, s2026, true);
    await eventIn(league.id, s2027, false);
    const repository = new PrismaSportLeagueSeasonRepository(getPrisma());

    const facts = (await repository.findCurrentSeasonFacts()).find((row) => row.sportLeagueId === league.id);

    expect(facts?.currentSeasonId).toBe(s2025);
    expect(facts?.seasons.map((season) => [season.id, season.hasSyncedEvent])).toEqual(expect.arrayContaining([[s2025, false], [s2026, true], [s2027, false]]));
    expect(facts?.seasons).toHaveLength(3);
  });

  it('moves each league\'s current Season as told, clears one to null, and writes nothing for no changes', async () => {
    const first = await seasonedLeague();
    const second = await seasonedLeague();
    const repository = new PrismaSportLeagueSeasonRepository(getPrisma());
    const current = async (id: string) => (await getPrisma().sportLeague.findUniqueOrThrow({ where: { id }, select: { currentSeasonId: true } })).currentSeasonId;

    await repository.setCurrentSeasons([]);
    expect(await current(first.league.id)).toBe(first.s2025);

    await repository.setCurrentSeasons([
      { sportLeagueId: first.league.id, currentSeasonId: first.s2026 },
      { sportLeagueId: second.league.id, currentSeasonId: null },
    ]);

    expect([await current(first.league.id), await current(second.league.id)]).toEqual([first.s2026, null]);
  });
});

/** The NFL's reference row, seeded by the baseline migration with its Seasons. */
const NFL_ID = 'f91f2566-1978-4171-a706-ae417c4d601a';

describe('PrismaSportLeaguePageReader.readSeasons', () => {
  it('gives each of the NFL\'s Seasons its phases, a phase the migration gave no slots an empty list, and BALLDONTLIE\'s id for it by provider', async () => {
    const seasons = expectDefinedSeasons(await new PrismaSportLeaguePageReader(getPrisma()).readSeasons(NFL_ID));

    expect(seasons.filter((season) => season.isCurrent)).toHaveLength(1);
    const phases = seasons.flatMap((season) => season.phases);
    expect(phases.some((phase) => phase.slots.length === 0)).toBe(true);
    expect(phases.some((phase) => phase.slots.length > 0)).toBe(true);
    expect(seasons.flatMap((season) => season.providerMappings).every((mapping) => mapping.providerName.length > 0 && mapping.providerLeagueCode === 'nfl')).toBe(true);
  });

  it('gives a league with no Seasons none, and null for a league that does not exist', async () => {
    const { league } = await seasonedLeague();
    await getPrisma().sportLeague.update({ where: { id: league.id }, data: { currentSeasonId: null } });
    await getPrisma().sportLeagueSeason.deleteMany({ where: { sportLeagueId: league.id } });
    const reader = new PrismaSportLeaguePageReader(getPrisma());

    await expect(reader.readSeasons(league.id)).resolves.toEqual([]);
    await expect(reader.readSeasons(randomUUID())).resolves.toBeNull();
  });
});

function expectDefinedSeasons<T>(seasons: T[] | null): T[] {
  if (seasons === null) throw new Error('Expected the NFL to have Seasons');
  return seasons;
}
