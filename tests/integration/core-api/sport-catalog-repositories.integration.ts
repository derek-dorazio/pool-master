import { randomUUID } from 'crypto';
import {
  cleanupTestData,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { Sport } from '@poolmaster/shared/domain';
import {
  PrismaParticipantLeagueAffiliationRepository,
  PrismaParticipantRepository,
  PrismaSeasonRepository,
  PrismaSportEventParticipantRoundRepository,
  PrismaSportEventParticipantStandingRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
  PrismaSportLeagueRepository,
  PrismaSportRepository,
} from '../../../packages/core-api/src/adapters';

// The catalog and event-core ports against real Postgres: each query returns the right
// rows, scoping actually scopes, ordering is what the port promises, and the bulk writes
// are all-or-nothing. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

async function golfSport() {
  return getPrisma().sport.upsert({
    where: { name: Sport.GOLF },
    create: { name: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
}

async function createEvent(tag: string, overrides: Record<string, unknown> = {}) {
  return getPrisma().sportEvent.create({
    data: {
      externalId: `catalog-${tag}-${randomUUID()}`,
      providerId: 'integration-test',
      sport: 'GOLF',
      name: `Catalog ${tag}`,
      startDate: new Date('2026-05-07T12:00:00.000Z'),
      releaseAt: new Date('2026-05-01T12:00:00.000Z'),
      fieldLocksAt: new Date('2026-05-06T16:00:00.000Z'),
      ...overrides,
    },
  });
}

async function createParticipant(sportId: string, name: string, externalId?: string) {
  return getPrisma().participant.create({
    data: { sportId, name, participantType: 'INDIVIDUAL', ...(externalId ? { externalId } : {}) },
  });
}

describe('Sport and SportLeague repositories', () => {
  it('finds a sport by name and lists sport leagues filtered by sport and activity, ordered by name', async () => {
    const sport = await golfSport();
    const sports = new PrismaSportRepository(getPrisma());
    const sportLeagues = new PrismaSportLeagueRepository(getPrisma());
    await sportLeagues.create({ sportId: sport.id, name: 'PGA Tour', matchKeyword: 'PGA' });
    const liv = await sportLeagues.create({ sportId: sport.id, name: 'LIV Golf', matchKeyword: null });
    await sportLeagues.update(liv.id, { isActive: false });

    await expect(sports.findByName(Sport.GOLF)).resolves.toMatchObject({ id: sport.id, name: Sport.GOLF });
    expect((await sportLeagues.findAll({ sportId: sport.id })).map((row) => row.name)).toEqual(['LIV Golf', 'PGA Tour']);
    expect((await sportLeagues.findAll({ sportId: sport.id, isActive: true })).map((row) => row.name)).toEqual(['PGA Tour']);
    await expect(sportLeagues.findBySportAndName(sport.id, 'PGA Tour')).resolves.toMatchObject({ matchKeyword: 'PGA' });
  });

  it('points a sport league at its current season through update', async () => {
    const sport = await golfSport();
    const sportLeagues = new PrismaSportLeagueRepository(getPrisma());
    const seasons = new PrismaSeasonRepository(getPrisma());
    const pga = await sportLeagues.create({ sportId: sport.id, name: 'PGA Tour', matchKeyword: null });
    const season = await seasons.create({
      sportLeagueId: pga.id, name: 'PGA Tour 2026', year: 2026,
      startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'),
    });

    await sportLeagues.update(pga.id, { currentSeasonId: season.id });

    await expect(sportLeagues.findById(pga.id)).resolves.toMatchObject({ currentSeasonId: season.id });
  });
});

describe('SeasonRepository', () => {
  it('scopes seasons by sport through the sport league, orders newest year first, and counts per sport league with zeros', async () => {
    const sport = await golfSport();
    const other = await getPrisma().sport.upsert({
      where: { name: Sport.NBA }, create: { name: Sport.NBA, participantType: 'TEAM', tournamentFormat: 'SERIES_PLAYOFF', category: 'BASKETBALL' }, update: {},
    });
    const sportLeagues = new PrismaSportLeagueRepository(getPrisma());
    const seasons = new PrismaSeasonRepository(getPrisma());
    const pga = await sportLeagues.create({ sportId: sport.id, name: 'PGA Tour', matchKeyword: null });
    const empty = await sportLeagues.create({ sportId: sport.id, name: 'Empty Tour', matchKeyword: null });
    const nba = await sportLeagues.create({ sportId: other.id, name: 'NBA', matchKeyword: null });
    for (const [sportLeagueId, year] of [[pga.id, 2025], [pga.id, 2026], [nba.id, 2026]] as const) {
      await seasons.create({ sportLeagueId, name: `S ${year}`, year, startDate: new Date(`${year}-01-01`), endDate: new Date(`${year}-12-31`) });
    }

    const golfSeasons = await seasons.findAll({ sportId: sport.id });

    expect(golfSeasons.map((row) => row.year)).toEqual([2026, 2025]);
    await expect(seasons.findBySportLeagueAndYear(pga.id, 2025)).resolves.toMatchObject({ year: 2025 });
    expect(await seasons.countBySportLeagues([pga.id, empty.id])).toEqual(new Map([[pga.id, 2], [empty.id, 0]]));
  });
});

describe('ParticipantLeagueAffiliationRepository', () => {
  async function setup() {
    const sport = await golfSport();
    const pga = await new PrismaSportLeagueRepository(getPrisma()).create({ sportId: sport.id, name: 'PGA Tour', matchKeyword: null });
    const [ben, al, cy] = [
      await createParticipant(sport.id, 'Ben'),
      await createParticipant(sport.id, 'Al'),
      await createParticipant(sport.id, 'Cy'),
    ];
    return { pga, ben, al, cy, affiliations: new PrismaParticipantLeagueAffiliationRepository(getPrisma()) };
  }

  it('lists best rank first, unranked last, then by name, carrying the canonical participant', async () => {
    const { pga, ben, al, cy, affiliations } = await setup();
    for (const person of [ben, al, cy]) await affiliations.create(pga.id, person.id);
    await affiliations.updateRankings(pga.id, [{ participantId: cy.id, ranking: 1 }]);

    const rows = await affiliations.findBySportLeague(pga.id);

    expect(rows.map((row) => [row.participant.name, row.ranking])).toEqual([['Cy', 1], ['Al', null], ['Ben', null]]);
    expect(await affiliations.countBySportLeagues([pga.id])).toEqual(new Map([[pga.id, 3]]));
  });

  it('re-ranks all or nothing: one unknown participant leaves every ranking as it was', async () => {
    const { pga, ben, al, affiliations } = await setup();
    await affiliations.create(pga.id, ben.id);

    await expect(affiliations.updateRankings(pga.id, [
      { participantId: ben.id, ranking: 7 },
      { participantId: al.id, ranking: 8 },
    ])).rejects.toThrow();

    await expect(affiliations.find(pga.id, ben.id)).resolves.toMatchObject({ ranking: null });
  });

  it('upserts rankings, creating missing affiliations and re-ranking existing ones, then deletes one', async () => {
    const { pga, ben, al, affiliations } = await setup();
    await affiliations.create(pga.id, ben.id);

    await affiliations.upsertRankings(pga.id, [
      { participantId: ben.id, ranking: 2 },
      { participantId: al.id, ranking: 1 },
    ]);
    await affiliations.delete(pga.id, ben.id);

    expect((await affiliations.findBySportLeague(pga.id)).map((row) => [row.participant.name, row.ranking])).toEqual([['Al', 1]]);
  });
});

describe('ParticipantRepository — search and matching', () => {
  it('returns every match unpaged, and matches upload identifiers exactly within one sport', async () => {
    const sport = await golfSport();
    const participants = new PrismaParticipantRepository(getPrisma());
    for (let index = 0; index < 60; index += 1) {
      await createParticipant(sport.id, `Search Golfer ${String(index).padStart(2, '0')}`);
    }
    const rory = await createParticipant(sport.id, 'Rory McIlroy', 'owgr-rory');

    expect(await participants.search('Search Golfer', { sportId: sport.id })).toHaveLength(60);
    await expect(participants.findMatching(sport.id, { name: 'rory mcilroy' })).resolves.toEqual([expect.objectContaining({ id: rory.id })]);
    await expect(participants.findMatching(sport.id, { externalId: 'owgr-rory' })).resolves.toHaveLength(1);
    await expect(participants.findMatching(sport.id, { name: 'Rory' })).resolves.toEqual([]);
    await expect(participants.findMatching(randomUUID(), { id: rory.id })).resolves.toEqual([]);
  });
});

describe('SportEvent core repositories', () => {
  it('filters events by status and season, orders by start, and counts participants and events per season with zeros', async () => {
    const sport = await golfSport();
    const pga = await new PrismaSportLeagueRepository(getPrisma()).create({ sportId: sport.id, name: 'PGA Tour', matchKeyword: null });
    const season = await new PrismaSeasonRepository(getPrisma()).create({
      sportLeagueId: pga.id, name: '2026', year: 2026, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'),
    });
    const later = await createEvent('later', { startDate: new Date('2026-06-01T00:00:00.000Z'), seasonId: season.id });
    const earlier = await createEvent('earlier', { startDate: new Date('2026-05-01T00:00:00.000Z'), status: 'IN_PROGRESS' });
    const golfer = await createParticipant(sport.id, 'Rory');
    await getPrisma().sportEventParticipant.create({ data: { sportEventId: later.id, participantId: golfer.id } });
    const events = new PrismaSportEventRepository(getPrisma());

    expect((await events.findAll({ sport: Sport.GOLF })).map((row) => row.id)).toEqual([earlier.id, later.id]);
    expect((await events.findAll({ status: 'IN_PROGRESS' })).map((row) => row.id)).toEqual([earlier.id]);
    expect((await events.findAll({ seasonId: season.id })).map((row) => row.id)).toEqual([later.id]);
    await expect(events.findById(later.id)).resolves.toMatchObject({ seasonId: season.id, syncScope: 'FULL', autoLifecycleEnabled: true });
    expect(await events.countParticipants([later.id, earlier.id])).toEqual(new Map([[later.id, 1], [earlier.id, 0]]));
    expect(await events.countBySeasons([season.id])).toEqual(new Map([[season.id, 1]]));
  });

  it('reads rounds in order, participant rounds with their round number, and standings best position first scoped to the event', async () => {
    const sport = await golfSport();
    const event = await createEvent('standings');
    const otherEvent = await createEvent('other');
    const [round2, round1] = [
      await getPrisma().sportEventRound.create({ data: { sportEventId: event.id, roundNumber: 2, scheduledDate: new Date('2026-05-08') } }),
      await getPrisma().sportEventRound.create({ data: { sportEventId: event.id, roundNumber: 1, scheduledDate: new Date('2026-05-07') } }),
    ];
    const seps = [];
    for (const name of ['Leader', 'Unranked', 'Second']) {
      const person = await createParticipant(sport.id, name);
      seps.push(await getPrisma().sportEventParticipant.create({ data: { sportEventId: event.id, participantId: person.id } }));
    }
    const [leader, unranked, second] = seps;
    const outsider = await getPrisma().sportEventParticipant.create({
      data: { sportEventId: otherEvent.id, participantId: (await createParticipant(sport.id, 'Elsewhere')).id },
    });
    for (const [sep, position] of [[leader, 1], [unranked, null], [second, 2], [outsider, 1]] as const) {
      await getPrisma().sportEventParticipantStanding.create({ data: { sportEventParticipantId: sep.id, position, status: 'ACTIVE' } });
    }
    for (const round of [round2, round1]) {
      await getPrisma().sportEventParticipantRound.create({ data: { sportEventParticipantId: leader.id, sportEventRoundId: round.id, status: 'COMPLETED' } });
    }

    expect((await new PrismaSportEventRoundRepository(getPrisma()).findBySportEvent(event.id)).map((row) => row.roundNumber)).toEqual([1, 2]);
    expect((await new PrismaSportEventParticipantRoundRepository(getPrisma()).findBySportEventParticipant(leader.id))
      .map((row) => row.roundNumber)).toEqual([1, 2]);
    const standings = new PrismaSportEventParticipantStandingRepository(getPrisma());
    expect((await standings.findBySportEvent(event.id)).map((row) => [row.sportEventParticipantId, row.position]))
      .toEqual([[leader.id, 1], [second.id, 2], [unranked.id, null]]);
    await expect(standings.findBySportEventParticipant(outsider.id)).resolves.toMatchObject({ position: 1 });
  });
});
