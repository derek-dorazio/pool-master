import { randomUUID } from 'crypto';
import {
  cleanupTestData,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { MatchFormat, ParticipantType, ProviderCode, ScoringFamily, Sport, isLeaguePlayValid } from '@poolmaster/shared/domain';
import {
  PrismaParticipantProviderMappingRepository,
  PrismaParticipantRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
  PrismaSportLeagueRepository,
  PrismaSportRepository,
} from '../../../packages/core-api/src/adapters';
import { freshEventEdition, fixtureSeasonId, mapEventToProvider } from '../../support/event-edition';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { participantLeagueId } from '../../support/participant-league';
import { sportRowKeys } from '../../support/sport-rows';
import { sportPlay } from '../../support/sport-play';
import { insertTestSportLeague } from '../../support/test-sport-league';
import { oneEventSlotId } from '../../support/test-slots';

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
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF) },
    update: {},
  });
}

async function createEvent(tag: string, overrides: Record<string, unknown> = {}) {
  return getPrisma().sportEvent.create({
    data: {
      ...(await freshEventEdition(getPrisma())),
      name: `Catalog ${tag}`,
      startDate: new Date('2026-05-07T12:00:00.000Z'),
      ...overrides,
    },
  });
}

/** An event's sport league and that league's Season named for `championshipYear`. */
async function inSeason(sportLeagueId: string, championshipYear: number) {
  return { sportLeagueId, sportLeagueSeasonId: await fixtureSeasonId(getPrisma(), sportLeagueId, championshipYear) };
}

async function createParticipant(sportId: string, name: string, externalId?: string) {
  return createLeagueParticipant(await participantLeagueId(getPrisma(), sportId), name, externalId);
}

async function createLeagueParticipant(sportLeagueId: string, name: string, externalId?: string) {
  return getPrisma().participant.create({
    data: {
      sportLeagueId, name, participantType: 'INDIVIDUAL',
      // A feed id is a provider mapping's (#2040).
      ...(externalId && { providerMappings: { create: { sportLeagueId, providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'INDIVIDUAL', externalId } } }),
    },
  });
}

describe('Sport and SportLeague repositories', () => {
  it('reads a sport by id, null for an unknown id, and lists every sport most popular first', async () => {
    const golf = await golfSport();
    const sports = new PrismaSportRepository(getAppPrisma());

    await expect(sports.findById(golf.id)).resolves.toMatchObject({ id: golf.id, sport: Sport.GOLF });
    await expect(sports.findById(randomUUID())).resolves.toBeNull();
    // Every sport the migrations seed survives the cleanup, as reference data, listed by each row's
    // stored display order (most popular first), not the database enum's declaration order.
    const allSports = await sports.findAll();
    expect(allSports.map((row) => [row.sport, row.urlSegment, row.displayOrder])).toEqual([
      [Sport.FOOTBALL, 'football', 0],
      [Sport.BASKETBALL, 'basketball', 1],
      [Sport.BASEBALL, 'baseball', 2],
      [Sport.HOCKEY, 'hockey', 3],
      [Sport.SOCCER, 'soccer', 4],
      [Sport.GOLF, 'golf', 5],
      [Sport.AUTO_RACING, 'auto-racing', 6],
      [Sport.TENNIS, 'tennis', 7],
      [Sport.HORSE_RACING, 'horse-racing', 8],
      [Sport.CYCLING, 'cycling', 9],
      [Sport.RUNNING, 'running', 10],
    ]);
    expect(allSports.find((row) => row.sport === Sport.GOLF)?.id).toBe(golf.id);
  });

  // League model 3d (#2143): a league's address is a short code that names it on its own, never a
  // slug of its full name, so no two leagues share one, even in different sports.
  it('seeds every sport league with its short URL segment, none shared by two leagues of any sport', async () => {
    const leagues = await getPrisma().sportLeague.findMany({ select: { urlSegment: true, sport: { select: { sport: true } } } });
    const segments = leagues.map((league) => league.urlSegment);

    expect(leagues.map((league) => `${league.sport.sport}/${league.urlSegment}`).sort()).toEqual([
      'AUTO_RACING/f1', 'AUTO_RACING/indycar', 'AUTO_RACING/nascar',
      'BASEBALL/mlb',
      'BASKETBALL/nba', 'BASKETBALL/ncaamb', 'BASKETBALL/ncaawb', 'BASKETBALL/wnba',
      'CYCLING/uci-men', 'CYCLING/uci-women',
      'FOOTBALL/ncaamf', 'FOOTBALL/nfl',
      'GOLF/lpga', 'GOLF/pga',
      'HOCKEY/ncaamh', 'HOCKEY/ncaawh', 'HOCKEY/nhl', 'HOCKEY/pwhl',
      'HORSE_RACING/thoroughbred',
      'RUNNING/marathon-men', 'RUNNING/marathon-women',
      'SOCCER/copa-america', 'SOCCER/epl', 'SOCCER/euro', 'SOCCER/mls', 'SOCCER/ncaams', 'SOCCER/ncaaws', 'SOCCER/nwsl', 'SOCCER/ucl', 'SOCCER/womens-world-cup', 'SOCCER/world-cup',
      'TENNIS/atp', 'TENNIS/ncaamt', 'TENNIS/ncaawt', 'TENNIS/wta',
    ]);
    expect(new Set(segments).size).toBe(segments.length);
  });

  it('refuses a sport league whose segment another sport\'s league already has', async () => {
    const hockey = await getPrisma().sport.findUniqueOrThrow({ where: { sport: Sport.HOCKEY }, select: { id: true } });

    await expect(getPrisma().sportLeague.create({
      data: { ...(await sportLeagueRowDefaults(getPrisma())), ...sportPlay(Sport.HOCKEY), sportId: hockey.id, name: 'Segment clash', timeZone: 'UTC', urlSegment: 'nba' },
    })).rejects.toThrow(/Unique constraint failed on the fields: \(`url_segment`\)/);
  });

  // #2083: no API adds a sport league, so the migrations that seed them are checked against the
  // validity table instead of a create request.
  it('seeds every sport league with a scoring family and participant type that its slot definitions\' match formats admit', async () => {
    const definitions = await getPrisma().sportLeagueCompetitionSlot.findMany({
      select: { key: true, matchFormat: true, sportLeague: { select: { name: true, scoringFamily: true, participantType: true } } },
    });

    expect(definitions.length).toBeGreaterThan(0);
    expect(definitions.filter((definition) => !isLeaguePlayValid(
      definition.sportLeague.scoringFamily, definition.sportLeague.participantType, definition.matchFormat,
    )).map((definition) => `${definition.sportLeague.name} ${definition.key}`)).toEqual([]);
  });

  it('refuses a league play its scoring family does not admit: a race scored head to head, a stroke-play field of teams', () => {
    expect(isLeaguePlayValid(ScoringFamily.FINISH_POSITION, ParticipantType.INDIVIDUAL, MatchFormat.HEAD_TO_HEAD)).toBe(false);
    expect(isLeaguePlayValid(ScoringFamily.STROKE_PLAY, ParticipantType.TEAM, MatchFormat.FIELD)).toBe(false);
    expect(isLeaguePlayValid(ScoringFamily.HEAD_TO_HEAD, ParticipantType.INDIVIDUAL, MatchFormat.HEAD_TO_HEAD)).toBe(true);
  });

  // The provider tables migration maps each league BALLDONTLIE lists to its provider league (#1997),
  // replacing the match keyword a year import used to find the provider's events by.
  const mappedCodeOf = async (sport: Sport, name: string) => (await getPrisma().sportLeagueProviderMapping.findMany({
    where: { sportLeague: { name, sport: { sport } } },
    select: { providerLeague: { select: { code: true, provider: { select: { code: true } } } } },
  })).map((row) => `${row.providerLeague.provider.code}:${row.providerLeague.code}`);

  it.each([
    [Sport.GOLF, 'PGA TOUR', 'pga'],
    [Sport.FOOTBALL, 'NFL', 'nfl'],
    [Sport.FOOTBALL, 'NCAA Men\'s Football', 'ncaaf'],
    [Sport.BASKETBALL, 'NCAA Men\'s Basketball', 'ncaab'],
    [Sport.BASKETBALL, 'NCAA Women\'s Basketball', 'ncaaw'],
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
    await expect(mappedCodeOf(Sport.HOCKEY, 'NCAA Men\'s Hockey')).resolves.toEqual([]);
    await expect(mappedCodeOf(Sport.SOCCER, 'NCAA Women\'s Soccer')).resolves.toEqual([]);
    await expect(mappedCodeOf(Sport.FOOTBALL, 'CFP Semifinals')).resolves.toEqual([]);
    await expect(mappedCodeOf(Sport.BASKETBALL, 'NBA Finals')).resolves.toEqual([]);
  });

  it('seeds BALLDONTLIE\'s Provider row at its free-tier rate with webhooks switched on, and each of its leagues with its webhook timing and usual game length', async () => {
    const provider = await getPrisma().provider.findUniqueOrThrow({
      where: { code: 'BALLDONTLIE' },
      include: { leagues: { select: { code: true, typicalGameMinutes: true, quietAfterMinutes: true }, orderBy: { code: 'asc' } } },
    });

    expect(provider).toMatchObject({ name: 'BALLDONTLIE', baseUrl: 'https://api.balldontlie.io', requestsPerMinute: 5, webhooksEnabled: true, isEnabled: true });
    expect(provider).not.toHaveProperty('priority');
    expect(provider.leagues.map((league) => league.code)).toEqual(['epl', 'mlb', 'nba', 'ncaab', 'ncaaf', 'ncaaw', 'nfl', 'nhl', 'pga', 'wnba', 'worldcup']);
    expect(provider.leagues.find((league) => league.code === 'mlb')).toEqual({ code: 'mlb', typicalGameMinutes: 180, quietAfterMinutes: 210 });
  });

  it('refuses a provider rate outside the range the API holds it to', async () => {
    await expect(getPrisma().provider.updateMany({ where: { code: 'BALLDONTLIE' }, data: { requestsPerMinute: 0 } })).rejects.toThrow();
  });

  it('finds a sport by its sport value and lists sport leagues filtered by sport and activity, ordered by name', async () => {
    const sport = await golfSport();
    const sports = new PrismaSportRepository(getAppPrisma());
    const sportLeagues = new PrismaSportLeagueRepository(getAppPrisma());
    await insertTestSportLeague(getPrisma(), { sport: sport.sport, name: 'PGA Tour', championshipYear: 2026 });
    const liv = await insertTestSportLeague(getPrisma(), { sport: sport.sport, name: 'LIV Golf', championshipYear: 2026 });
    await sportLeagues.update(liv.id, { isActive: false });

    // Golf's reference leagues (the PGA TOUR its majors template names, #714) survive the cleanup,
    // so only this test's own two are read.
    const ours = (rows: Array<{ name: string }>) => rows.map((row) => row.name).filter((name) => name === 'LIV Golf' || name === 'PGA Tour');

    await expect(sports.findBySport(Sport.GOLF)).resolves.toMatchObject({ id: sport.id, sport: Sport.GOLF });
    expect(ours(await sportLeagues.findAll({ sportId: sport.id }))).toEqual(['LIV Golf', 'PGA Tour']);
    expect(ours(await sportLeagues.findAll({ sportId: sport.id, isActive: true }))).toEqual(['PGA Tour']);
  });

  it('reads the sport leagues with the ids asked for in one read, none for an unknown id or no ids (#1166)', async () => {
    const sport = await golfSport();
    const sportLeagues = new PrismaSportLeagueRepository(getAppPrisma());
    const pga = await insertTestSportLeague(getPrisma(), { sport: sport.sport, name: 'PGA Tour', championshipYear: 2026 });
    const liv = await insertTestSportLeague(getPrisma(), { sport: sport.sport, name: 'LIV Golf', championshipYear: 2026 });
    await insertTestSportLeague(getPrisma(), { sport: sport.sport, name: 'Korn Ferry Tour', championshipYear: 2026 });

    const rows = await sportLeagues.findByIds([pga.id, liv.id, randomUUID()]);

    expect(rows.map((row) => row.name).sort()).toEqual(['LIV Golf', 'PGA Tour']);
    await expect(sportLeagues.findByIds([])).resolves.toEqual([]);
  });

  it('reads the active event-synced sport leagues, leaving out an unsynced league and an inactive synced one', async () => {
    const sport = await golfSport();
    const prisma = getPrisma();
    const tag = randomUUID().slice(0, 8);
    const league = async (name: string, data: Record<string, unknown> = {}) => prisma.sportLeague.create({
      data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `${tag} ${name}`, ...data },
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
    const league = await insertTestSportLeague(prisma, { sport: sport.sport, name: `Mapped Tour ${randomUUID().slice(0, 8)}`, championshipYear: 2026 });

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
    const mapped = await insertTestSportLeague(getPrisma(), { sport: sport.sport, name: `Owner ${tag}`, championshipYear: 2026 });
    const other = await insertTestSportLeague(getPrisma(), { sport: sport.sport, name: `Other ${tag}`, championshipYear: 2026 });
    const mapping = (await sportLeagues.update(mapped.id, { syncProviderLeagueId: pgaTour.id })).selectedProviderMapping;

    await expect(prisma.sportLeague.update({ where: { id: other.id }, data: { selectedProviderMappingId: mapping?.id ?? null } })).rejects.toThrow();
  });
});

// #2003, #2010 — a SportEvent is one sport league's, played in one Season of that league.
describe('SportEventRepository — sport league and Season', () => {
  async function tour(name: string) {
    const sport = await golfSport();
    return insertTestSportLeague(getPrisma(), { sport: sport.sport, name, championshipYear: 2026 });
  }

  async function edition(sportLeagueId: string, championshipYear: number, tag: string) {
    return createEvent(tag, await inSeason(sportLeagueId, championshipYear));
  }

  it('narrows by sport league and by Season, reads the sport league and Season back, and counts per sport league with zeros', async () => {
    const [pga, lpga, empty] = [await tour('PGA Tour'), await tour('LPGA-style Tour'), await tour('Empty Tour')];
    const masters2025 = await edition(pga.id, 2025, 'masters-2025');
    const masters2026 = await edition(pga.id, 2026, 'masters-2026');
    await edition(lpga.id, 2026, 'us-open-2026');
    const events = new PrismaSportEventRepository(getAppPrisma());

    expect((await events.findAll({ sportLeagueId: pga.id })).map((row) => row.id).sort()).toEqual([masters2025.id, masters2026.id].sort());
    expect((await events.findAll({ sportLeagueSeasonId: masters2026.sportLeagueSeasonId })).map((row) => row.id)).toEqual([masters2026.id]);
    await expect(events.findById(masters2025.id)).resolves.toMatchObject({
      sportLeagueSeasonId: masters2025.sportLeagueSeasonId, championshipYear: 2025, sportLeagueId: pga.id, slotDefinitions: [],
    });
    expect(await events.countBySportLeagues([pga.id, lpga.id, empty.id])).toEqual(new Map([[pga.id, 2], [lpga.id, 1], [empty.id, 0]]));
  });

  it('leaves out the events of a switched-off sport league when asked for active sport leagues only, alone or with one sport league named', async () => {
    const [pga, switchedOff] = [await tour('PGA Tour'), await tour('Switched-off Tour')];
    await new PrismaSportLeagueRepository(getAppPrisma()).update(switchedOff.id, { isActive: false });
    const masters = await edition(pga.id, 2026, 'masters-active');
    const hidden = await edition(switchedOff.id, 2026, 'hidden-open');
    const events = new PrismaSportEventRepository(getAppPrisma());
    const ours = (rows: Array<{ id: string }>) => rows.map((row) => row.id).filter((id) => id === masters.id || id === hidden.id).sort();

    expect(ours(await events.findAll({ sport: Sport.GOLF }))).toEqual([masters.id, hidden.id].sort());
    expect(ours(await events.findAll({ sport: Sport.GOLF, activeSportLeaguesOnly: true }))).toEqual([masters.id]);
    expect(ours(await events.findAll({ sportLeagueId: switchedOff.id, activeSportLeaguesOnly: true }))).toEqual([]);
  });

  // #2010 — an event's Season is its own sport league's: the composite key refuses a Season of
  // another league, so no read has to check the two agree.
  it('refuses an event whose Season is another sport league\'s, and stores the event in its own league\'s Season', async () => {
    const [pga, lpga] = [await tour('PGA Tour'), await tour('LPGA-style Tour')];
    const lpgaSeasonId = await fixtureSeasonId(getPrisma(), lpga.id, 2026);

    await expect(createEvent('crossed', { sportLeagueId: pga.id, sportLeagueSeasonId: lpgaSeasonId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(edition(pga.id, 2026, 'own')).resolves.toMatchObject({ sportLeagueId: pga.id, sportLeagueSeasonId: await fixtureSeasonId(getPrisma(), pga.id, 2026) });
    await expect(getPrisma().sportEvent.count({ where: { sportLeagueId: { in: [pga.id, lpga.id] } } })).resolves.toBe(1);
  });
});

describe('ParticipantRepository — a sport league\'s roster (#1853)', () => {
  async function setup() {
    const sport = await golfSport();
    const suffix = randomUUID().slice(0, 8);
    const pga = await insertTestSportLeague(getPrisma(), { sport: sport.sport, name: `Roster Tour ${suffix}`, championshipYear: 2026 });
    const lpga = await insertTestSportLeague(getPrisma(), { sport: sport.sport, name: `Roster Women's Tour ${suffix}`, championshipYear: 2026 });
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
      isTestData: false,
      nationality: 'SWE',
      role: 'GOLFER',
      status: 'ACTIVE',
      injuryStatus: { status: 'HEALTHY' },
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
      sportLeagueId: await participantLeagueId(getPrisma(), sport.id), ranking: null, name: 'Old Name', participantType: 'INDIVIDUAL', status: 'ACTIVE', injuryStatus: { status: 'HEALTHY' }, isTestData: false,
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
    });

    expect(updated).toEqual(expect.objectContaining({
      name: 'New Name', firstName: 'New', lastName: 'Name', shortName: 'N. Name', nationality: 'USA', role: 'GOLFER',
      teamAffiliation: 'Team Blue', status: 'INACTIVE', photoUrl: 'https://example.test/photo.jpg', photoLastUpdated,
      injuryStatus: { status: 'OUT', detail: 'Wrist', expectedReturn, updatedAt: injuryUpdatedAt, source: 'feed' },
    }));
    await expect(participants.findById(created.id)).resolves.toEqual(updated);
  });

  it('deletes a participant on no field with its provider identities, keeps one on a field and says how many rows hold it, and answers null for no participant', async () => {
    const sport = await golfSport();
    const participants = new PrismaParticipantRepository(getAppPrisma());
    const free = await createParticipant(sport.id, 'Free Golfer');
    await new PrismaParticipantProviderMappingRepository(getAppPrisma())
      .bind({ providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'INDIVIDUAL', externalId: 'feed-free', participantId: free.id, sportLeagueId: free.sportLeagueId, mappedAt: new Date('2026-05-01T00:00:00.000Z') });
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
    const lcs = await insertTestSportLeague(getPrisma(), { sport: sport.sport, name: 'Other league', championshipYear: 2026 });
    const elsewhere = await createLeagueParticipant(lcs.id, 'First elsewhere');
    const identity = { providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'INDIVIDUAL' as const, externalId: 'feed-42' };

    await mappings.bind({ ...identity, participantId: first.id, sportLeagueId: first.sportLeagueId, mappedAt: new Date('2026-05-01T00:00:00.000Z') });
    const moved = await mappings.bind({ ...identity, participantId: second.id, sportLeagueId: second.sportLeagueId, mappedAt: new Date('2026-05-02T00:00:00.000Z') });
    await mappings.bind({ ...identity, participantId: elsewhere.id, sportLeagueId: lcs.id, mappedAt: new Date('2026-05-03T00:00:00.000Z') });

    expect(moved).toMatchObject({ participantId: second.id, externalId: 'feed-42', providerName: 'BALLDONTLIE', participantType: 'INDIVIDUAL' });
    await expect(mappings.findByParticipant(first.id)).resolves.toEqual([]);
    await expect(mappings.findByProviderExternalIds(ProviderCode.BALLDONTLIE, { sportLeagueId: second.sportLeagueId }, ['feed-42'])).resolves.toEqual([
      expect.objectContaining({ participantId: second.id, mappedAt: new Date('2026-05-02T00:00:00.000Z') }),
    ]);
    await expect(mappings.findByProviderExternalIds(ProviderCode.BALLDONTLIE, { sportLeagueId: lcs.id }, ['feed-42'])).resolves.toEqual([
      expect.objectContaining({ participantId: elsewhere.id }),
    ]);
    await expect(mappings.findByProviderAndSportLeague(BALLDONTLIE_TEST_PROVIDER_ID, lcs.id)).resolves.toEqual([expect.objectContaining({ participantId: elsewhere.id })]);
    await expect(mappings.findByParticipantIds([second.id, elsewhere.id])).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ participantId: second.id, externalId: 'feed-42' }),
      expect.objectContaining({ participantId: elsewhere.id, externalId: 'feed-42' }),
    ]));
  });

  it('keeps a team and a player of one league apart when the feed gives them the same raw id, since a mapping is unique per participant type', async () => {
    const sport = await golfSport();
    const mappings = new PrismaParticipantProviderMappingRepository(getAppPrisma());
    const [team, player] = [await createParticipant(sport.id, 'Raw Team'), await createParticipant(sport.id, 'Raw Player')];
    const raw = { providerId: BALLDONTLIE_TEST_PROVIDER_ID, externalId: '17', mappedAt: new Date('2026-05-01T00:00:00.000Z') };

    await mappings.bind({ ...raw, participantType: 'TEAM', participantId: team.id, sportLeagueId: team.sportLeagueId });
    await mappings.bind({ ...raw, participantType: 'INDIVIDUAL', participantId: player.id, sportLeagueId: player.sportLeagueId });

    await expect(mappings.findByParticipantIds([team.id, player.id])).resolves.toHaveLength(2);
  });

  it('binds nothing and answers null for a provider id that names no Provider row', async () => {
    const sport = await golfSport();
    const mappings = new PrismaParticipantProviderMappingRepository(getAppPrisma());
    const participant = await createParticipant(sport.id, 'Unknown Provider');

    await expect(mappings.bind({
      providerId: randomUUID(), participantType: 'INDIVIDUAL', externalId: 'feed-x', participantId: participant.id, sportLeagueId: participant.sportLeagueId, mappedAt: new Date(),
    })).resolves.toBeNull();
    await expect(mappings.findByParticipant(participant.id)).resolves.toEqual([]);
  });

  it('reads no provider identities when asked about no external ids, though the provider has some', async () => {
    const sport = await golfSport();
    const mappings = new PrismaParticipantProviderMappingRepository(getAppPrisma());
    const participant = await createParticipant(sport.id, 'Unasked');
    await mappings.bind({ providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'INDIVIDUAL', externalId: 'feed-7', participantId: participant.id, sportLeagueId: participant.sportLeagueId, mappedAt: new Date('2026-05-01T00:00:00.000Z') });

    await expect(mappings.findByProviderExternalIds(ProviderCode.BALLDONTLIE, { sportLeagueId: participant.sportLeagueId }, [])).resolves.toEqual([]);
  });
});

describe('SportEvent core repositories', () => {
  it('filters events by status and sport league, orders by start, and counts participants with zeros', async () => {
    const sport = await golfSport();
    const pga = await insertTestSportLeague(getPrisma(), { sport: sport.sport, name: 'PGA Tour', championshipYear: 2026 });
    const later = await createEvent('later', { startDate: new Date('2026-06-01T00:00:00.000Z'), ...(await inSeason(pga.id, 2026)) });
    const earlier = await createEvent('earlier', { startDate: new Date('2026-05-01T00:00:00.000Z'), status: 'IN_PROGRESS' });
    const golfer = await createParticipant(sport.id, 'Rory');
    await getPrisma().sportEventParticipant.create({ data: { sportEventId: later.id, participantId: golfer.id } });
    const events = new PrismaSportEventRepository(getAppPrisma());

    expect((await events.findAll({ sport: Sport.GOLF })).map((row) => row.id)).toEqual([earlier.id, later.id]);
    expect((await events.findAll({ statuses: ['IN_PROGRESS'] })).map((row) => row.id)).toEqual([earlier.id]);
    expect((await events.findAll({ statuses: ['SCHEDULED', 'IN_PROGRESS'] })).map((row) => row.id)).toEqual([earlier.id, later.id]);
    expect(await events.findAll({ statuses: ['COMPLETED'] })).toEqual([]);
    expect((await events.findAll({ sportLeagueId: pga.id })).map((row) => row.id)).toEqual([later.id]);
    await expect(events.findById(later.id)).resolves.toMatchObject({ sportLeagueId: pga.id, providerMappings: [], autoLifecycleEnabled: true });
    expect(await events.countParticipants([later.id, earlier.id])).toEqual(new Map([[later.id, 1], [earlier.id, 0]]));
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
    // Each event the provider has an id for is its event (#2004); one with none is no provider's.
    const mapped = async (tag: string, status: string) => {
      const event = await createEvent(tag, { status });
      await mapEventToProvider(getPrisma(), event.id, { providerId: 'balldontlie', externalId: `catalog-${tag}-${event.id}` });
      return event;
    };
    const live = await mapped('live', 'IN_PROGRESS');
    await mapped('scheduled', 'SCHEDULED');
    await mapped('done', 'COMPLETED');
    await createEvent('elsewhere', { status: 'SCHEDULED' });
    const touched = await getPrisma().sportEvent.update({ where: { id: live.id }, data: { name: 'Catalog live, renamed' } });

    const summary = await new PrismaSportEventRepository(getAppPrisma()).summarizeByProviders(['balldontlie', 'contract-provider']);

    expect(summary).toEqual(new Map([
      ['balldontlie', { activeEventCount: 2, lastChangedAt: touched.updatedAt }],
      ['contract-provider', { activeEventCount: 0, lastChangedAt: null }],
    ]));
  });

  it('reads rounds in order, and the event\'s field alone with each row\'s rounds by round number and its own standing', async () => {
    const sport = await golfSport();
    const event = await createEvent('standings');
    const otherEvent = await createEvent('other');
    const [round2, round1] = [
      await getPrisma().sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId: await oneEventSlotId(getPrisma(), event.id), roundNumber: 2, scheduledDate: new Date('2026-05-08') } }),
      await getPrisma().sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId: await oneEventSlotId(getPrisma(), event.id), roundNumber: 1, scheduledDate: new Date('2026-05-07') } }),
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
    const { sportLeagueId } = event;
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
    const [pga, lpga] = [
      await insertTestSportLeague(getPrisma(), { sport: sport.sport, name: 'Field PGA', championshipYear: 2026 }),
      await insertTestSportLeague(getPrisma(), { sport: sport.sport, name: 'Field LPGA', championshipYear: 2026 }),
    ];
    const pgaEvent = await createEvent('pga-field', await inSeason(pga.id, 2026));
    const lpgaEvent = await createEvent('lpga-field', await inSeason(lpga.id, 2026));
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
