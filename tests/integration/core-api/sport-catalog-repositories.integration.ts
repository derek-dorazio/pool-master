import { randomUUID } from 'crypto';
import {
  cleanupTestData,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { Sport } from '@poolmaster/shared/domain';
import {
  PrismaEventSeriesRepository,
  PrismaParticipantLeagueAffiliationRepository,
  PrismaParticipantRepository,
  PrismaSportEventParticipantRoundRepository,
  PrismaSportEventParticipantStandingRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
  PrismaSportLeagueRepository,
  PrismaSportRepository,
} from '../../../packages/core-api/src/adapters';
import { freshEventEdition } from '../../support/event-edition';

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
      ...(await freshEventEdition(getPrisma())),
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

  it('records the sport league\'s current event year through update (plans/147 decision 6)', async () => {
    const sport = await golfSport();
    const sportLeagues = new PrismaSportLeagueRepository(getPrisma());
    const pga = await sportLeagues.create({ sportId: sport.id, name: 'PGA Tour', matchKeyword: null });

    await sportLeagues.update(pga.id, { currentEventYear: 2026 });

    await expect(sportLeagues.findById(pga.id)).resolves.toMatchObject({ currentEventYear: 2026 });
  });
});

// plans/147 — SportEvent's only parent is its EventSeries, and the year lives on the edition.
describe('SportEventRepository — series and event year', () => {
  async function tour(name: string) {
    const sport = await golfSport();
    return new PrismaSportLeagueRepository(getPrisma()).create({ sportId: sport.id, name, matchKeyword: null });
  }

  async function edition(eventSeriesId: string, eventYear: number, tag: string) {
    return createEvent(tag, { eventSeriesId, eventYear });
  }

  it('narrows by sport league through the series and by event year, reads the sport league back, and counts per sport league with zeros', async () => {
    const [pga, lpga, empty] = [await tour('PGA Tour'), await tour('LPGA Tour'), await tour('Empty Tour')];
    const series = new PrismaEventSeriesRepository(getPrisma());
    const masters = await series.findOrCreate(pga.id, 'The Masters');
    const usOpen = await series.findOrCreate(lpga.id, 'U.S. Open');
    const masters2025 = await edition(masters.id, 2025, 'masters-2025');
    const masters2026 = await edition(masters.id, 2026, 'masters-2026');
    await edition(usOpen.id, 2026, 'us-open-2026');
    const events = new PrismaSportEventRepository(getPrisma());

    expect((await events.findAll({ sportLeagueId: pga.id })).map((row) => row.id).sort()).toEqual([masters2025.id, masters2026.id].sort());
    expect((await events.findAll({ sportLeagueId: pga.id, eventYear: 2026 })).map((row) => row.id)).toEqual([masters2026.id]);
    await expect(events.findById(masters2025.id)).resolves.toMatchObject({ eventSeriesId: masters.id, eventYear: 2025, sportLeagueId: pga.id });
    expect(await events.countBySportLeagues([pga.id, lpga.id, empty.id])).toEqual(new Map([[pga.id, 2], [lpga.id, 1], [empty.id, 0]]));
    expect(await events.countBySportLeagues([pga.id, empty.id], { eventYear: 2025 })).toEqual(new Map([[pga.id, 1], [empty.id, 0]]));
  });

  // plans/147 decision 5 — @@unique([eventSeriesId, eventYear]) is what makes "there is one
  // 2026 Masters" an invariant. Proved against Postgres, below the service's 409 mapping.
  it('rejects a second edition of one series in one year, and allows the same series in another year', async () => {
    const pga = await tour('PGA Tour');
    const masters = await new PrismaEventSeriesRepository(getPrisma()).findOrCreate(pga.id, 'The Masters');
    await edition(masters.id, 2026, 'first');

    await expect(edition(masters.id, 2026, 'second')).rejects.toMatchObject({
      code: 'P2002',
      meta: { target: ['event_series_id', 'event_year'] },
    });
    await expect(edition(masters.id, 2027, 'next-year')).resolves.toMatchObject({ eventYear: 2027 });
    await expect(getPrisma().sportEvent.count({ where: { eventSeriesId: masters.id } })).resolves.toBe(2);
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
  it('filters events by status and sport league, orders by start, and counts participants with zeros', async () => {
    const sport = await golfSport();
    const pga = await new PrismaSportLeagueRepository(getPrisma()).create({ sportId: sport.id, name: 'PGA Tour', matchKeyword: null });
    const series = await new PrismaEventSeriesRepository(getPrisma()).findOrCreate(pga.id, 'The Memorial');
    const later = await createEvent('later', { startDate: new Date('2026-06-01T00:00:00.000Z'), eventSeriesId: series.id, eventYear: 2026 });
    const earlier = await createEvent('earlier', { startDate: new Date('2026-05-01T00:00:00.000Z'), status: 'IN_PROGRESS' });
    const golfer = await createParticipant(sport.id, 'Rory');
    await getPrisma().sportEventParticipant.create({ data: { sportEventId: later.id, participantId: golfer.id } });
    const events = new PrismaSportEventRepository(getPrisma());

    expect((await events.findAll({ sport: Sport.GOLF })).map((row) => row.id)).toEqual([earlier.id, later.id]);
    expect((await events.findAll({ status: 'IN_PROGRESS' })).map((row) => row.id)).toEqual([earlier.id]);
    expect((await events.findAll({ sportLeagueId: pga.id })).map((row) => row.id)).toEqual([later.id]);
    await expect(events.findById(later.id)).resolves.toMatchObject({ sportLeagueId: pga.id, syncScope: 'NONE', autoLifecycleEnabled: true });
    expect(await events.countParticipants([later.id, earlier.id])).toEqual(new Map([[later.id, 1], [earlier.id, 0]]));
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
