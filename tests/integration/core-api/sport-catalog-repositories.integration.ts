import { randomUUID } from 'crypto';
import {
  cleanupTestData,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { seriesNamed } from '../../support/sport-event-rows';
import { BracketAdvancement, Sport, SPORTS_BY_POPULARITY, TournamentFormat, getSportDefinition } from '@poolmaster/shared/domain';
import {
  PrismaEventSeriesRepository,
  PrismaParticipantProviderMappingRepository,
  PrismaParticipantRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
  PrismaSportLeagueRepository,
  PrismaSportRepository,
} from '../../../packages/core-api/src/adapters';
import { freshEventEdition } from '../../support/event-edition';
import { leagueProfiles } from '../../support/league-profiles';
import { participantLeagueId } from '../../support/participant-league';

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
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
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
      ...overrides,
    },
  });
}

async function createParticipant(sportId: string, name: string, externalId?: string) {
  return createLeagueParticipant(await participantLeagueId(getPrisma(), sportId), name, externalId);
}

async function createLeagueParticipant(sportLeagueId: string, name: string, externalId?: string) {
  return getPrisma().participant.create({
    data: { sportLeagueId, name, participantType: 'INDIVIDUAL', ...(externalId ? { externalId } : {}) },
  });
}

describe('Sport and SportLeague repositories', () => {
  it('reads a sport by id, null for an unknown id, and lists every sport most popular first', async () => {
    const golf = await golfSport();
    const sports = new PrismaSportRepository(getAppPrisma());

    await expect(sports.findById(golf.id)).resolves.toMatchObject({ id: golf.id, sport: Sport.GOLF, participantType: 'INDIVIDUAL' });
    await expect(sports.findById(randomUUID())).resolves.toBeNull();
    // Every sport the migrations seed survives the cleanup, as reference data, listed in Sport's own
    // order (most popular first), not the database enum's declaration order.
    const allSports = await sports.findAll();
    expect(allSports.map((row) => row.sport)).toEqual(SPORTS_BY_POPULARITY);
    expect(allSports.find((row) => row.sport === Sport.GOLF)?.id).toBe(golf.id);
  });

  // #715 renamed KNOCKOUT_BRACKET to MATCHES in place, so the sports rows seeded with it carry the new value.
  it('stores each seeded sport\'s tournament format as its sport definition gives it, basketball, American football, hockey, baseball, soccer and tennis as MATCHES', async () => {
    const sports = await new PrismaSportRepository(getAppPrisma()).findAll();

    expect(sports.map((row) => [row.sport, row.tournamentFormat]))
      .toEqual(sports.map((row) => [row.sport, getSportDefinition(row.sport).tournamentFormat]));
    expect(sports.filter((row) => row.tournamentFormat === TournamentFormat.MATCHES).map((row) => row.sport).sort())
      .toEqual([Sport.AMERICAN_FOOTBALL, Sport.BASEBALL, Sport.BASKETBALL, Sport.HOCKEY, Sport.SOCCER, Sport.TENNIS]);
  });

  // The provider tables migration maps each league BALLDONTLIE lists to its provider league (#1997),
  // replacing the match keyword a year import used to find the provider's events by.
  const mappedCodeOf = async (sport: Sport, name: string) => (await getPrisma().sportLeagueProviderMapping.findMany({
    where: { sportLeague: { name, sport: { sport } } },
    select: { providerLeague: { select: { code: true, provider: { select: { code: true } } } } },
  })).map((row) => `${row.providerLeague.provider.code}:${row.providerLeague.code}`);

  it.each([
    [Sport.GOLF, 'PGA TOUR', 'pga'],
    [Sport.AMERICAN_FOOTBALL, 'NFL', 'nfl'],
    [Sport.AMERICAN_FOOTBALL, 'College Football Playoff', 'ncaaf'],
    [Sport.BASKETBALL, 'NCAA Division I Men', 'ncaab'],
    [Sport.BASKETBALL, 'NCAA Division I Women', 'ncaaw'],
    [Sport.BASKETBALL, 'NBA', 'nba'],
    [Sport.BASKETBALL, 'WNBA', 'wnba'],
    [Sport.HOCKEY, 'NHL', 'nhl'],
    [Sport.BASEBALL, 'MLB', 'mlb'],
    [Sport.SOCCER, 'Premier League', 'epl'],
    [Sport.SOCCER, 'FIFA World Cup', 'worldcup'],
  ])('maps the seeded %s league %s to BALLDONTLIE\'s %s league, and to no other', async (sport, name, code) => {
    await expect(mappedCodeOf(sport, name)).resolves.toEqual([`BALLDONTLIE:${code}`]);
  });

  it('maps no league of another sport that shares a mapped league\'s name, nor a Clutch Card league', async () => {
    await expect(mappedCodeOf(Sport.HOCKEY, 'NCAA Division I Men')).resolves.toEqual([]);
    await expect(mappedCodeOf(Sport.SOCCER, 'NCAA Division I Women')).resolves.toEqual([]);
    await expect(mappedCodeOf(Sport.AMERICAN_FOOTBALL, 'CFP Semifinals')).resolves.toEqual([]);
    await expect(mappedCodeOf(Sport.BASKETBALL, 'NBA Finals')).resolves.toEqual([]);
  });

  it('seeds BALLDONTLIE\'s Provider row at its free-tier rate with webhooks switched on, and each of its leagues with its webhook timing and usual game length', async () => {
    const provider = await getPrisma().provider.findUniqueOrThrow({
      where: { code: 'BALLDONTLIE' },
      include: { leagues: { select: { code: true, typicalGameMinutes: true, quietAfterMinutes: true }, orderBy: { code: 'asc' } } },
    });

    expect(provider).toMatchObject({ name: 'BALLDONTLIE', baseUrl: 'https://api.balldontlie.io', requestsPerMinute: 5, webhooksEnabled: true, isEnabled: true, priority: 1 });
    expect(provider.leagues.map((league) => league.code)).toEqual(['epl', 'mlb', 'nba', 'ncaab', 'ncaaf', 'ncaaw', 'nfl', 'nhl', 'pga', 'wnba', 'worldcup']);
    expect(provider.leagues.find((league) => league.code === 'mlb')).toEqual({ code: 'mlb', typicalGameMinutes: 180, quietAfterMinutes: 210 });
  });

  it('refuses a provider rate outside the range the API holds it to', async () => {
    await expect(getPrisma().provider.updateMany({ where: { code: 'BALLDONTLIE' }, data: { requestsPerMinute: 0 } })).rejects.toThrow();
  });

  it('seeds each series league\'s best-of lengths by round, first to final, and refuses an even length (#1545)', async () => {
    const lengthsOf = async (name: string) =>
      (await getPrisma().sportLeague.findFirstOrThrow({ where: { name }, select: { roundSeriesLengths: true } })).roundSeriesLengths;

    await expect(lengthsOf('NBA')).resolves.toEqual([7, 7, 7, 7]);
    await expect(lengthsOf('NHL')).resolves.toEqual([7, 7, 7, 7]);
    await expect(lengthsOf('WNBA')).resolves.toEqual([3, 5, 7]);
    await expect(lengthsOf('MLB')).resolves.toEqual([3, 5, 7, 7]);
    await expect(lengthsOf('MLS')).resolves.toEqual([1, 3, 1, 1, 1]);
    await expect(lengthsOf('NFL')).resolves.toEqual([]);
    await expect(getPrisma().sportLeague.updateMany({ where: { name: 'NBA' }, data: { roundSeriesLengths: [6] } })).rejects.toThrow();
  });

  it('finds a sport by its sport value and lists sport leagues filtered by sport and activity, ordered by name', async () => {
    const sport = await golfSport();
    const sports = new PrismaSportRepository(getAppPrisma());
    const sportLeagues = new PrismaSportLeagueRepository(getAppPrisma());
    await sportLeagues.create({ ...(await leagueProfiles(getPrisma())), sportId: sport.id, name: 'PGA Tour', bracketAdvancement: BracketAdvancement.FIXED });
    const liv = await sportLeagues.create({ ...(await leagueProfiles(getPrisma())), sportId: sport.id, name: 'LIV Golf', bracketAdvancement: BracketAdvancement.FIXED });
    await sportLeagues.update(liv.id, { isActive: false });

    // Golf's reference leagues (the PGA TOUR its majors template names, #714) survive the cleanup,
    // so only this test's own two are read.
    const ours = (rows: Array<{ name: string }>) => rows.map((row) => row.name).filter((name) => name === 'LIV Golf' || name === 'PGA Tour');

    await expect(sports.findBySport(Sport.GOLF)).resolves.toMatchObject({ id: sport.id, sport: Sport.GOLF });
    expect(ours(await sportLeagues.findAll({ sportId: sport.id }))).toEqual(['LIV Golf', 'PGA Tour']);
    expect(ours(await sportLeagues.findAll({ sportId: sport.id, isActive: true }))).toEqual(['PGA Tour']);
    await expect(sportLeagues.findBySportAndName(sport.id, 'PGA Tour')).resolves.toMatchObject({ name: 'PGA Tour', selectedProviderMapping: null });
  });

  it('reads the sport leagues with the ids asked for in one read, none for an unknown id or no ids (#1166)', async () => {
    const sport = await golfSport();
    const sportLeagues = new PrismaSportLeagueRepository(getAppPrisma());
    const pga = await sportLeagues.create({ ...(await leagueProfiles(getPrisma())), sportId: sport.id, name: 'PGA Tour', bracketAdvancement: BracketAdvancement.FIXED });
    const liv = await sportLeagues.create({ ...(await leagueProfiles(getPrisma())), sportId: sport.id, name: 'LIV Golf', bracketAdvancement: BracketAdvancement.FIXED });
    await sportLeagues.create({ ...(await leagueProfiles(getPrisma())), sportId: sport.id, name: 'Korn Ferry Tour', bracketAdvancement: BracketAdvancement.FIXED });

    const rows = await sportLeagues.findByIds([pga.id, liv.id, randomUUID()]);

    expect(rows.map((row) => row.name).sort()).toEqual(['LIV Golf', 'PGA Tour']);
    await expect(sportLeagues.findByIds([])).resolves.toEqual([]);
  });

  it('reads the active event-synced sport leagues, leaving out an unsynced league and an inactive synced one', async () => {
    const sport = await golfSport();
    const prisma = getPrisma();
    const tag = randomUUID().slice(0, 8);
    const league = async (name: string, data: Record<string, unknown> = {}) => prisma.sportLeague.create({
      data: { ...(await leagueProfiles(prisma)), sportId: sport.id, name: `${tag} ${name}`, ...data },
    });
    const pgaTour = await prisma.providerLeague.findFirstOrThrow({ where: { code: 'pga' }, select: { id: true } });
    const repository = new PrismaSportLeagueRepository(getAppPrisma());
    const synced = await league('Synced');
    await repository.update(synced.id, { syncProviderLeagueId: pgaTour.id });
    await league('Unsynced');
    const inactive = await league('Inactive Synced');
    await repository.update(inactive.id, { syncProviderLeagueId: pgaTour.id });
    await prisma.sportLeague.update({ where: { id: inactive.id }, data: { isActive: false } });

    const rows = await new PrismaSportLeagueRepository(getAppPrisma()).findEventSynced();

    expect(rows.filter((row) => row.name.startsWith(tag)).map((row) => row.name)).toEqual([`${tag} Synced`]);
  });

  it('maps a league to the provider league it is set to sync from and selects it, then keeps the mapping when sync is turned off (#1997)', async () => {
    const sport = await golfSport();
    const prisma = getPrisma();
    const sportLeagues = new PrismaSportLeagueRepository(getAppPrisma());
    const pgaTour = await prisma.providerLeague.findFirstOrThrow({ where: { code: 'pga' }, select: { id: true } });
    const league = await sportLeagues.create({ ...(await leagueProfiles(prisma)), sportId: sport.id, name: `Mapped Tour ${randomUUID().slice(0, 8)}`, bracketAdvancement: BracketAdvancement.FIXED });

    const synced = await sportLeagues.update(league.id, { syncProviderLeagueId: pgaTour.id });
    const again = await sportLeagues.update(league.id, { syncProviderLeagueId: pgaTour.id });
    const off = await sportLeagues.update(league.id, { syncProviderLeagueId: null });

    expect(synced.selectedProviderMapping).toMatchObject({
      providerLeagueId: pgaTour.id, providerLeagueCode: 'pga', providerLeagueName: 'PGA TOUR', providerCode: 'BALLDONTLIE', providerName: 'BALLDONTLIE', providerId: 'balldontlie',
    });
    expect(again.selectedProviderMapping?.id).toBe(synced.selectedProviderMapping?.id);
    expect(off.selectedProviderMapping).toBeNull();
    await expect(prisma.sportLeagueProviderMapping.count({ where: { sportLeagueId: league.id } })).resolves.toBe(1);
  });

  it('refuses selecting a mapping that belongs to another league, by the composite key to its own mappings', async () => {
    const sport = await golfSport();
    const prisma = getPrisma();
    const sportLeagues = new PrismaSportLeagueRepository(getAppPrisma());
    const pgaTour = await prisma.providerLeague.findFirstOrThrow({ where: { code: 'pga' }, select: { id: true } });
    const tag = randomUUID().slice(0, 8);
    const mapped = await sportLeagues.create({ ...(await leagueProfiles(prisma)), sportId: sport.id, name: `Owner ${tag}`, bracketAdvancement: BracketAdvancement.FIXED });
    const other = await sportLeagues.create({ ...(await leagueProfiles(prisma)), sportId: sport.id, name: `Other ${tag}`, bracketAdvancement: BracketAdvancement.FIXED });
    const mapping = (await sportLeagues.update(mapped.id, { syncProviderLeagueId: pgaTour.id })).selectedProviderMapping;

    await expect(prisma.sportLeague.update({ where: { id: other.id }, data: { selectedProviderMappingId: mapping?.id ?? null } })).rejects.toThrow();
  });

  it('records the sport league\'s current event year through update (plans/147 decision 6)', async () => {
    const sport = await golfSport();
    const sportLeagues = new PrismaSportLeagueRepository(getAppPrisma());
    const pga = await sportLeagues.create({ ...(await leagueProfiles(getPrisma())), sportId: sport.id, name: 'PGA Tour', bracketAdvancement: BracketAdvancement.FIXED });

    await sportLeagues.update(pga.id, { currentEventYear: 2026 });

    await expect(sportLeagues.findById(pga.id)).resolves.toMatchObject({ currentEventYear: 2026 });
  });
});

// plans/147 — SportEvent's only parent is its EventSeries, and the year lives on the edition.
describe('SportEventRepository — series and event year', () => {
  async function tour(name: string) {
    const sport = await golfSport();
    return new PrismaSportLeagueRepository(getAppPrisma()).create({ ...(await leagueProfiles(getPrisma())), sportId: sport.id, name, bracketAdvancement: BracketAdvancement.FIXED });
  }

  async function edition(eventSeriesId: string, eventYear: number, tag: string) {
    return createEvent(tag, { eventSeriesId, eventYear });
  }

  it('narrows by sport league through the series and by event year, reads the sport league back, and counts per sport league with zeros', async () => {
    const [pga, lpga, empty] = [await tour('PGA Tour'), await tour('LPGA-style Tour'), await tour('Empty Tour')];
    const series = new PrismaEventSeriesRepository(getAppPrisma());
    const masters = await seriesNamed(series, pga.id, 'The Masters');
    const usOpen = await seriesNamed(series, lpga.id, 'U.S. Open');
    const masters2025 = await edition(masters.id, 2025, 'masters-2025');
    const masters2026 = await edition(masters.id, 2026, 'masters-2026');
    await edition(usOpen.id, 2026, 'us-open-2026');
    const events = new PrismaSportEventRepository(getAppPrisma());

    expect((await events.findAll({ sportLeagueId: pga.id })).map((row) => row.id).sort()).toEqual([masters2025.id, masters2026.id].sort());
    expect((await events.findAll({ sportLeagueId: pga.id, eventYear: 2026 })).map((row) => row.id)).toEqual([masters2026.id]);
    await expect(events.findById(masters2025.id)).resolves.toMatchObject({ eventSeriesId: masters.id, eventYear: 2025, sportLeagueId: pga.id });
    expect(await events.countBySportLeagues([pga.id, lpga.id, empty.id])).toEqual(new Map([[pga.id, 2], [lpga.id, 1], [empty.id, 0]]));
    expect(await events.countBySportLeagues([pga.id, empty.id], { eventYear: 2025 })).toEqual(new Map([[pga.id, 1], [empty.id, 0]]));
  });

  it('leaves out the events of a switched-off sport league when asked for active sport leagues only, alone or with one sport league named', async () => {
    const [pga, switchedOff] = [await tour('PGA Tour'), await tour('Switched-off Tour')];
    await new PrismaSportLeagueRepository(getAppPrisma()).update(switchedOff.id, { isActive: false });
    const series = new PrismaEventSeriesRepository(getAppPrisma());
    const masters = await edition((await seriesNamed(series, pga.id, 'The Masters')).id, 2026, 'masters-active');
    const hidden = await edition((await seriesNamed(series, switchedOff.id, 'Hidden Open')).id, 2026, 'hidden-open');
    const events = new PrismaSportEventRepository(getAppPrisma());
    const ours = (rows: Array<{ id: string }>) => rows.map((row) => row.id).filter((id) => id === masters.id || id === hidden.id).sort();

    expect(ours(await events.findAll({ eventYear: 2026 }))).toEqual([masters.id, hidden.id].sort());
    expect(ours(await events.findAll({ eventYear: 2026, activeSportLeaguesOnly: true }))).toEqual([masters.id]);
    expect(ours(await events.findAll({ sportLeagueId: switchedOff.id, activeSportLeaguesOnly: true }))).toEqual([]);
  });

  it('says a sport league has a loaded bracket when any edition of any of its series, in any year, has a match, and not when none has', async () => {
    const [nfl, cfp, empty] = [await tour('NFL'), await tour('College Football Playoff'), await tour('Empty League')];
    const series = new PrismaEventSeriesRepository(getAppPrisma());
    const playoffs = await seriesNamed(series, nfl.id, 'NFL Playoffs');
    await edition(playoffs.id, 2026, 'nfl-2026');
    const played = await edition(playoffs.id, 2025, 'nfl-2025');
    await edition((await seriesNamed(series, cfp.id, 'College Football Playoff')).id, 2026, 'cfp-2026');
    const round = await getPrisma().sportEventRound.create({ data: { sportEventId: played.id, roundNumber: 1, scheduledDate: new Date('2026-01-10T18:00:00.000Z') } });
    await getPrisma().sportEventRoundMatch.create({ data: { sportEventId: played.id, sportEventRoundId: round.id, matchNumber: 1, isNeutralSite: false } });
    const events = new PrismaSportEventRepository(getAppPrisma());

    await expect(events.sportLeagueHasLoadedBracket(nfl.id)).resolves.toBe(true);
    await expect(events.sportLeagueHasLoadedBracket(cfp.id)).resolves.toBe(false);
    await expect(events.sportLeagueHasLoadedBracket(empty.id)).resolves.toBe(false);
  });

  // plans/147 decision 5 — @@unique([eventSeriesId, eventYear]) is what makes "there is one
  // 2026 Masters" an invariant. Proved against Postgres, below the service's 409 mapping.
  it('rejects a second edition of one series in one year, and allows the same series in another year', async () => {
    const pga = await tour('PGA Tour');
    const masters = await seriesNamed(new PrismaEventSeriesRepository(getAppPrisma()), pga.id, 'The Masters');
    await edition(masters.id, 2026, 'first');

    await expect(edition(masters.id, 2026, 'second')).rejects.toMatchObject({
      code: 'P2002',
      meta: { target: ['event_series_id', 'event_year'] },
    });
    await expect(edition(masters.id, 2027, 'next-year')).resolves.toMatchObject({ eventYear: 2027 });
    await expect(getPrisma().sportEvent.count({ where: { eventSeriesId: masters.id } })).resolves.toBe(2);
  });
});

describe('ParticipantRepository — a sport league\'s roster (#1853)', () => {
  async function setup() {
    const sport = await golfSport();
    const leagues = new PrismaSportLeagueRepository(getAppPrisma());
    const suffix = randomUUID().slice(0, 8);
    const pga = await leagues.create({ ...(await leagueProfiles(getPrisma())), sportId: sport.id, name: `Roster Tour ${suffix}`, bracketAdvancement: BracketAdvancement.FIXED });
    const lpga = await leagues.create({ ...(await leagueProfiles(getPrisma())), sportId: sport.id, name: `Roster Women's Tour ${suffix}`, bracketAdvancement: BracketAdvancement.FIXED });
    const [ben, al, cy] = [
      await createLeagueParticipant(pga.id, 'Ben'),
      await createLeagueParticipant(pga.id, 'Al'),
      await createLeagueParticipant(pga.id, 'Cy'),
    ];
    const nelly = await createLeagueParticipant(lpga.id, 'Nelly');
    return { pga, lpga, ben, al, cy, nelly, participants: new PrismaParticipantRepository(getAppPrisma()) };
  }

  it('lists only the league\'s own participants, best rank first, unranked last, then by name, and counts each league\'s', async () => {
    const { pga, lpga, cy, participants } = await setup();
    await participants.updateRankings(pga.id, [{ participantId: cy.id, ranking: 1 }]);

    const rows = await participants.findBySportLeague(pga.id);

    expect(rows.map((row) => [row.name, row.ranking])).toEqual([['Cy', 1], ['Al', null], ['Ben', null]]);
    const none = randomUUID();
    expect(await participants.countBySportLeagues([pga.id, lpga.id, none])).toEqual(new Map([[pga.id, 3], [lpga.id, 1], [none, 0]]));
  });

  it('re-ranks all or nothing: a participant of another league leaves every ranking as it was', async () => {
    const { pga, ben, nelly, participants } = await setup();

    await expect(participants.updateRankings(pga.id, [
      { participantId: ben.id, ranking: 7 },
      { participantId: nelly.id, ranking: 8 },
    ])).rejects.toThrow();

    await expect(participants.findById(ben.id)).resolves.toMatchObject({ ranking: null });
    await expect(participants.findById(nelly.id)).resolves.toMatchObject({ ranking: null });
  });

  it('re-ranks several participants at once, the later of two rankings for one participant winning', async () => {
    const { pga, ben, al, participants } = await setup();

    await participants.updateRankings(pga.id, [
      { participantId: ben.id, ranking: 2 },
      { participantId: al.id, ranking: 1 },
      { participantId: ben.id, ranking: 3 },
    ]);

    expect((await participants.findBySportLeague(pga.id)).map((row) => [row.name, row.ranking])).toEqual([['Al', 1], ['Ben', 3], ['Cy', null]]);
  });
});

describe('ParticipantRepository — search and matching', () => {
  it('returns every match unpaged, and matches upload identifiers exactly within one sport league', async () => {
    const sport = await golfSport();
    const league = await participantLeagueId(getPrisma(), sport.id);
    const participants = new PrismaParticipantRepository(getAppPrisma());
    for (let index = 0; index < 60; index += 1) {
      await createParticipant(sport.id, `Search Golfer ${String(index).padStart(2, '0')}`);
    }
    const rory = await createParticipant(sport.id, 'Rory McIlroy', 'owgr-rory');

    expect(await participants.search('Search Golfer', { sportLeagueId: league })).toHaveLength(60);
    await expect(participants.findMatchingAny(league, [{ name: 'rory mcilroy' }])).resolves.toEqual([expect.objectContaining({ id: rory.id })]);
    await expect(participants.findMatchingAny(league, [{ externalId: 'owgr-rory' }])).resolves.toHaveLength(1);
    await expect(participants.findMatchingAny(league, [{ name: 'Rory' }])).resolves.toEqual([]);
    await expect(participants.findMatchingAny(randomUUID(), [{ id: rory.id }])).resolves.toEqual([]);
    await expect(participants.findMatchingAny(league, [])).resolves.toEqual([]);
  });

  it('reads the candidates for a whole upload at once: every participant of the sport league any row\'s identifier matches, and no other', async () => {
    const sport = await golfSport();
    const league = await participantLeagueId(getPrisma(), sport.id);
    const participants = new PrismaParticipantRepository(getAppPrisma());
    const rory = await createParticipant(sport.id, 'Rory McIlroy', 'owgr-rory');
    const jon = await createParticipant(sport.id, 'Jon Rahm', 'owgr-jon');
    const scottie = await createParticipant(sport.id, 'Scottie Scheffler', 'owgr-scottie');
    await createParticipant(sport.id, 'Ludvig Aberg', 'owgr-ludvig');

    const found = await participants.findMatchingAny(league, [{ id: rory.id }, { externalId: 'owgr-jon' }, { name: 'SCOTTIE scheffler' }, { name: 'Nobody' }]);

    expect(found.map((candidate) => candidate.id).sort()).toEqual([rory.id, jon.id, scottie.id].sort());
  });

  it('creates a participant, reads it by id, and updates only the fields given', async () => {
    const sport = await golfSport();
    const participants = new PrismaParticipantRepository(getAppPrisma());

    const created = await participants.create({
      sportLeagueId: await participantLeagueId(getPrisma(), sport.id),
      ranking: 12,
      name: 'Ludvig Aberg',
      participantType: 'INDIVIDUAL',
      nationality: 'SWE',
      role: 'GOLFER',
      status: 'ACTIVE',
      injuryStatus: { status: 'HEALTHY' },
      externalIds: { owgr: '12' },
    });
    const updated = await participants.update(created.id, { name: 'Ludvig Åberg', status: 'INACTIVE' });

    expect(updated).toEqual(expect.objectContaining({
      id: created.id,
      name: 'Ludvig Åberg',
      status: 'INACTIVE',
      ranking: 12,
      nationality: 'SWE',
      role: 'GOLFER',
      injuryStatus: { status: 'HEALTHY' },
      externalIds: { owgr: '12' },
    }));
    await expect(participants.findById(created.id)).resolves.toEqual(updated);
    await expect(participants.findById(randomUUID())).resolves.toBeNull();
  });

  it('searches by status within a sport league, and an empty search lists every participant of the league by name', async () => {
    const sport = await golfSport();
    const league = await participantLeagueId(getPrisma(), sport.id);
    const participants = new PrismaParticipantRepository(getAppPrisma());
    const active = await createParticipant(sport.id, 'Active Golfer');
    const retired = await getPrisma().participant.create({ data: { sportLeagueId: league, name: 'Retired Golfer', participantType: 'INDIVIDUAL', status: 'INACTIVE' } });

    await expect(participants.search('Golfer', { sportLeagueId: league, status: 'INACTIVE' })).resolves.toEqual([expect.objectContaining({ id: retired.id })]);
    expect((await participants.search('  ', { sportLeagueId: league })).map((participant) => participant.id)).toEqual([active.id, retired.id]);
  });

  it('updates every field it is given, reading the injury dates back as dates', async () => {
    const sport = await golfSport();
    const participants = new PrismaParticipantRepository(getAppPrisma());
    const created = await participants.create({
      sportLeagueId: await participantLeagueId(getPrisma(), sport.id), ranking: null, name: 'Old Name', participantType: 'INDIVIDUAL', status: 'ACTIVE', injuryStatus: { status: 'HEALTHY' }, externalIds: {},
    });
    const expectedReturn = new Date('2026-06-01T00:00:00.000Z');
    const injuryUpdatedAt = new Date('2026-05-20T00:00:00.000Z');
    const photoLastUpdated = new Date('2026-05-21T00:00:00.000Z');

    const updated = await participants.update(created.id, {
      name: 'New Name',
      firstName: 'New',
      lastName: 'Name',
      shortName: 'N. Name',
      nationality: 'USA',
      role: 'GOLFER',
      teamAffiliation: 'Team Blue',
      status: 'INACTIVE',
      injuryStatus: { status: 'OUT', detail: 'Wrist', expectedReturn, updatedAt: injuryUpdatedAt, source: 'feed' },
      photoUrl: 'https://example.test/photo.jpg',
      photoLastUpdated,
      externalIds: { owgr: '99' },
      externalId: 'owgr-new',
    });

    expect(updated).toEqual(expect.objectContaining({
      name: 'New Name', firstName: 'New', lastName: 'Name', shortName: 'N. Name', nationality: 'USA', role: 'GOLFER',
      teamAffiliation: 'Team Blue', status: 'INACTIVE', photoUrl: 'https://example.test/photo.jpg', photoLastUpdated,
      externalIds: { owgr: '99' }, externalId: 'owgr-new',
      injuryStatus: { status: 'OUT', detail: 'Wrist', expectedReturn, updatedAt: injuryUpdatedAt, source: 'feed' },
    }));
    await expect(participants.findById(created.id)).resolves.toEqual(updated);
  });

  it('deletes a participant on no field with its provider identities, keeps one on a field and says how many rows hold it, and answers null for no participant', async () => {
    const sport = await golfSport();
    const participants = new PrismaParticipantRepository(getAppPrisma());
    const free = await createParticipant(sport.id, 'Free Golfer');
    await new PrismaParticipantProviderMappingRepository(getAppPrisma())
      .bind({ providerId: 'integration-test', externalId: 'feed-free', confidence: 'MANUAL', participantId: free.id, sportLeagueId: free.sportLeagueId, mappedAt: new Date('2026-05-01T00:00:00.000Z') });
    const fielded = await createParticipant(sport.id, 'Fielded Golfer');
    const event = await createEvent('delete-participant');
    await getPrisma().sportEventParticipant.create({ data: { sportEventId: event.id, participantId: fielded.id } });

    await expect(participants.deleteUnlessOnAField(free.id)).resolves.toBe(0);
    await expect(participants.deleteUnlessOnAField(fielded.id)).resolves.toBe(1);
    await expect(participants.deleteUnlessOnAField(randomUUID())).resolves.toBeNull();

    await expect(participants.findById(free.id)).resolves.toBeNull();
    await expect(getPrisma().participantProviderMapping.count({ where: { participantId: free.id } })).resolves.toBe(0);
    await expect(participants.findById(fielded.id)).resolves.toEqual(expect.objectContaining({ id: fielded.id }));
  });

  it('binds a provider identity once per sport league: binding it again in the league moves it, binding it in another league adds a second', async () => {
    const sport = await golfSport();
    const mappings = new PrismaParticipantProviderMappingRepository(getAppPrisma());
    const [first, second] = [await createParticipant(sport.id, 'First'), await createParticipant(sport.id, 'Second')];
    const lcs = await new PrismaSportLeagueRepository(getAppPrisma()).create({ ...(await leagueProfiles(getPrisma())), sportId: sport.id, name: 'Other league', bracketAdvancement: BracketAdvancement.FIXED });
    const elsewhere = await createLeagueParticipant(lcs.id, 'First elsewhere');
    const identity = { providerId: 'integration-test', externalId: 'feed-42', confidence: 'MANUAL' as const };

    await mappings.bind({ ...identity, participantId: first.id, sportLeagueId: first.sportLeagueId, mappedAt: new Date('2026-05-01T00:00:00.000Z') });
    const moved = await mappings.bind({ ...identity, participantId: second.id, sportLeagueId: second.sportLeagueId, mappedAt: new Date('2026-05-02T00:00:00.000Z') });
    await mappings.bind({ ...identity, participantId: elsewhere.id, sportLeagueId: lcs.id, mappedAt: new Date('2026-05-03T00:00:00.000Z') });

    expect(moved).toMatchObject({ participantId: second.id, externalId: 'feed-42' });
    await expect(mappings.findByParticipant(first.id)).resolves.toEqual([]);
    await expect(mappings.findByProviderExternalIds('integration-test', { sportLeagueId: second.sportLeagueId }, ['feed-42'])).resolves.toEqual([
      expect.objectContaining({ participantId: second.id, mappedAt: new Date('2026-05-02T00:00:00.000Z') }),
    ]);
    await expect(mappings.findByProviderExternalIds('integration-test', { sportLeagueId: lcs.id }, ['feed-42'])).resolves.toEqual([
      expect.objectContaining({ participantId: elsewhere.id }),
    ]);
    await expect(mappings.findByProviderAndSportLeague('integration-test', lcs.id)).resolves.toEqual([expect.objectContaining({ participantId: elsewhere.id })]);
  });

  it('reads no provider identities when asked about no external ids, though the provider has some', async () => {
    const sport = await golfSport();
    const mappings = new PrismaParticipantProviderMappingRepository(getAppPrisma());
    const participant = await createParticipant(sport.id, 'Unasked');
    await mappings.bind({ providerId: 'integration-test', externalId: 'feed-7', confidence: 'MANUAL', participantId: participant.id, sportLeagueId: participant.sportLeagueId, mappedAt: new Date('2026-05-01T00:00:00.000Z') });

    await expect(mappings.findByProviderExternalIds('integration-test', { sportLeagueId: participant.sportLeagueId }, [])).resolves.toEqual([]);
  });
});

describe('SportEvent core repositories', () => {
  it('filters events by status and sport league, orders by start, and counts participants with zeros', async () => {
    const sport = await golfSport();
    const pga = await new PrismaSportLeagueRepository(getAppPrisma()).create({ ...(await leagueProfiles(getPrisma())), sportId: sport.id, name: 'PGA Tour', bracketAdvancement: BracketAdvancement.FIXED });
    const series = await seriesNamed(new PrismaEventSeriesRepository(getAppPrisma()), pga.id, 'The Memorial');
    const later = await createEvent('later', { startDate: new Date('2026-06-01T00:00:00.000Z'), eventSeriesId: series.id, eventYear: 2026 });
    const earlier = await createEvent('earlier', { startDate: new Date('2026-05-01T00:00:00.000Z'), status: 'IN_PROGRESS' });
    const golfer = await createParticipant(sport.id, 'Rory');
    await getPrisma().sportEventParticipant.create({ data: { sportEventId: later.id, participantId: golfer.id } });
    const events = new PrismaSportEventRepository(getAppPrisma());

    expect((await events.findAll({ sport: Sport.GOLF })).map((row) => row.id)).toEqual([earlier.id, later.id]);
    expect((await events.findAll({ statuses: ['IN_PROGRESS'] })).map((row) => row.id)).toEqual([earlier.id]);
    expect((await events.findAll({ statuses: ['SCHEDULED', 'IN_PROGRESS'] })).map((row) => row.id)).toEqual([earlier.id, later.id]);
    expect(await events.findAll({ statuses: ['COMPLETED'] })).toEqual([]);
    expect((await events.findAll({ sportLeagueId: pga.id })).map((row) => row.id)).toEqual([later.id]);
    await expect(events.findById(later.id)).resolves.toMatchObject({ sportLeagueId: pga.id, syncScope: 'NONE', autoLifecycleEnabled: true });
    expect(await events.countParticipants([later.id, earlier.id])).toEqual(new Map([[later.id, 1], [earlier.id, 0]]));
  });

  it('lists a sport league\'s event years once each, earliest first, leaving out a draft-only year for a non-admin read', async () => {
    const sport = await golfSport();
    const leagues = new PrismaSportLeagueRepository(getAppPrisma());
    const tour = await leagues.create({ ...(await leagueProfiles(getPrisma())), sportId: sport.id, name: 'Years Tour', bracketAdvancement: BracketAdvancement.FIXED });
    const other = await leagues.create({ ...(await leagueProfiles(getPrisma())), sportId: sport.id, name: 'Other Tour', bracketAdvancement: BracketAdvancement.FIXED });
    const seriesRepo = new PrismaEventSeriesRepository(getAppPrisma());
    const masters = await seriesNamed(seriesRepo, tour.id, 'Years Masters');
    const open = await seriesNamed(seriesRepo, tour.id, 'Years Open');
    await createEvent('masters-2026', { eventSeriesId: masters.id, eventYear: 2026 });
    await createEvent('open-2026', { eventSeriesId: open.id, eventYear: 2026 });
    await createEvent('masters-2025', { eventSeriesId: masters.id, eventYear: 2025 });
    await createEvent('masters-2027', { eventSeriesId: masters.id, eventYear: 2027, status: 'DRAFT' });
    await createEvent('other-2030', { eventSeriesId: (await seriesNamed(seriesRepo, other.id, 'Elsewhere')).id, eventYear: 2030 });
    const events = new PrismaSportEventRepository(getAppPrisma());

    expect(await events.findEventYears(tour.id, { releasedOnly: false })).toEqual([2025, 2026, 2027]);
    expect(await events.findEventYears(tour.id, { releasedOnly: true })).toEqual([2025, 2026]);
  });

  it('reads several events by id in one query, leaving out an unknown id, and reads none for no ids', async () => {
    const first = await createEvent('first');
    const second = await createEvent('second');
    await createEvent('unasked');
    const events = new PrismaSportEventRepository(getAppPrisma());

    expect((await events.findByIds([first.id, second.id, randomUUID()])).map((row) => row.name).sort()).toEqual(['Catalog first', 'Catalog second']);
    await expect(events.findByIds([])).resolves.toEqual([]);
  });

  it('summarizes each provider\'s scheduled and in-progress events and its latest change, with zeros for a provider with none', async () => {
    const live = await createEvent('live', { status: 'IN_PROGRESS' });
    await createEvent('scheduled', { status: 'SCHEDULED' });
    await createEvent('done', { status: 'COMPLETED' });
    await createEvent('elsewhere', { providerId: 'TEST_PROVIDER', status: 'SCHEDULED' });
    const touched = await getPrisma().sportEvent.update({ where: { id: live.id }, data: { name: 'Catalog live, renamed' } });

    const summary = await new PrismaSportEventRepository(getAppPrisma()).summarizeByProviders(['integration-test', 'contract-provider']);

    expect(summary).toEqual(new Map([
      ['integration-test', { activeEventCount: 2, lastChangedAt: touched.updatedAt }],
      ['contract-provider', { activeEventCount: 0, lastChangedAt: null }],
    ]));
  });

  it('reads rounds in order, and the event\'s field alone with each row\'s rounds by round number and its own standing', async () => {
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

    expect((await new PrismaSportEventRoundRepository(getAppPrisma()).findBySportEvent(event.id)).map((row) => row.roundNumber)).toEqual([1, 2]);
    const { sportLeagueId } = await getPrisma().eventSeries.findUniqueOrThrow({ where: { id: event.eventSeriesId } });
    const field = await new PrismaSportEventParticipantRepository(getAppPrisma()).findFieldForEvent(event.id, sportLeagueId);
    expect(field.map((row) => [
      row.participant.name,
      row.standing?.standing.position,
      row.rounds.map(({ round }) => [round.sportEventParticipantId, round.roundNumber]),
    ])).toEqual([
      ['Leader', 1, [[leader.id, 1], [leader.id, 2]]],
      ['Second', 2, []],
      ['Unranked', null, []],
    ]);
  });

  it("reads several events' fields in one read, in the order asked, each row's tour membership checked against its own event's tour (#1315)", async () => {
    const sport = await golfSport();
    const tours = new PrismaSportLeagueRepository(getPrisma());
    const series = new PrismaEventSeriesRepository(getPrisma());
    const [pga, lpga] = [
      await tours.create({ ...(await leagueProfiles(getPrisma())), sportId: sport.id, name: 'Field PGA', bracketAdvancement: BracketAdvancement.FIXED }),
      await tours.create({ ...(await leagueProfiles(getPrisma())), sportId: sport.id, name: 'Field LPGA', bracketAdvancement: BracketAdvancement.FIXED }),
    ];
    const pgaEvent = await createEvent('pga-field', { eventSeriesId: (await seriesNamed(series, pga.id, 'Field Open')).id, eventYear: 2026 });
    const lpgaEvent = await createEvent('lpga-field', { eventSeriesId: (await seriesNamed(series, lpga.id, 'Field Classic')).id, eventYear: 2026 });
    const unasked = await createEvent('unasked-field');
    const member = await createLeagueParticipant(pga.id, 'PGA Member');
    const guest = await createParticipant(sport.id, 'Guest');
    for (const event of [pgaEvent, lpgaEvent, unasked]) {
      await getPrisma().sportEventParticipant.createMany({ data: [member, guest].map((golfer) => ({ sportEventId: event.id, participantId: golfer.id })) });
    }

    const fields = await new PrismaSportEventParticipantRepository(getPrisma()).findFieldsForEvents([
      { sportEventId: lpgaEvent.id, sportLeagueId: lpga.id },
      { sportEventId: pgaEvent.id, sportLeagueId: pga.id },
    ]);

    expect(fields.map((row) => [row.entry.sportEventId, row.participant.name, row.affiliatedWithSportLeague])).toEqual([
      [lpgaEvent.id, 'Guest', false],
      [lpgaEvent.id, 'PGA Member', false],
      [pgaEvent.id, 'Guest', false],
      [pgaEvent.id, 'PGA Member', true],
    ]);
    await expect(new PrismaSportEventParticipantRepository(getPrisma()).findFieldsForEvents([])).resolves.toEqual([]);
  });
});
