import { deleteTestSportLeagues } from '../support/test-slots';
import {
  getEventBracket,
  listEventParticipants,
  listParticipants,
  listSportLeagues,
} from '@poolmaster/shared/generated/hey-api';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BracketAdvancement, MatchSide, MatchStatus, ProviderCode, Sport } from '@poolmaster/shared/domain';
import { LoadAction, LoadMode, LoadSubject, type LoadRow } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { seedDateOffsetDays, shiftedEventDates } from '../../packages/core-api/scripts/seed-golf/seed-golf-data';
import {
  parseSportDataFile,
  SportDataContent,
  TEST_SEED_CONTENTS,
  type SportDataFieldEntry,
  type SportDataFile,
} from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { addRunSportLeague, buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin, seedContestFixture, type RegisteredUserContext, inCurrentSeason, seasonEvents, createTestEvent } from './builders';
import { disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { sportLeagueRowDefaults } from '../support/league-profiles';
import { EVERY_GAME_PLAYED } from '../support/sport-test-seed';
import { sportRowKeys } from '../support/sport-rows';
import { sportPlay } from '../support/sport-play';

// Loading a test data file through the real admin API: a test seed a commissioner can build
// contests on, its players bound to their feed ids, a test slate, and a second run that changes nothing.

const RUN = `load-${Date.now()}`;
// The real clock: release refuses an event that has started by the server's own clock.
const NOW = new Date();

function provenance(): SportDataFile['provenance'] {
  return { gatheredAt: '2026-10-13', gatheredBy: 'functional test', sources: [{ name: 'Test source', url: 'https://example.com/schedule' }] };
}

function players(prefix: string, count: number): SportDataFile['sportLeagues'][number]['players'] {
  return Array.from({ length: count }, (_, index) => ({
    key: `${prefix}-p${index + 1}`,
    name: `${prefix} Golfer ${index + 1}`,
    countryCode: 'US',
    ranking: index + 1,
  }));
}

function parsed(file: SportDataFile): SportDataFile {
  return parseSportDataFile(JSON.parse(JSON.stringify(file)) as unknown);
}

function changes(rows: readonly LoadRow[]): LoadRow[] {
  return rows.filter((row) => row.action !== LoadAction.SKIP);
}

function counts(rows: readonly LoadRow[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    const key = `${row.subject} ${row.action}`;
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const leagueIds = (await db.sportLeague.findMany({ where: { name: { contains: RUN } }, select: { id: true } })).map((league) => league.id);
  const eventIds = (await db.sportEvent.findMany({ where: { name: { contains: RUN } }, select: { id: true } })).map((event) => event.id);
  const fieldIds = (await db.sportEventParticipant.findMany({ where: { sportEventId: { in: eventIds } }, select: { id: true } })).map((row) => row.id);
  await db.sportEventRoundMatch.deleteMany({ where: { sportEventId: { in: eventIds } } });
  await db.sportEventParticipantGolfRound.deleteMany({ where: { participantRound: { sportEventParticipantId: { in: fieldIds } } } });
  await db.sportEventParticipantRound.deleteMany({ where: { sportEventParticipantId: { in: fieldIds } } });
  await db.sportEventParticipantGolfStanding.deleteMany({ where: { standing: { sportEventParticipantId: { in: fieldIds } } } });
  await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipantId: { in: fieldIds } } });
  await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipantId: { in: fieldIds } } });
  await db.sportEventParticipant.deleteMany({ where: { id: { in: fieldIds } } });
  await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
  await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
  await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
  // The run's players, and every participant of the run's leagues (#1853: each belongs to one).
  const participantWhere = { OR: [{ name: { startsWith: RUN } }, { sportLeagueId: { in: leagueIds } }] };
  await db.participantProviderMapping.deleteMany({ where: { participant: participantWhere } });
  await db.participant.deleteMany({ where: participantWhere });
  await db.eventSeries.deleteMany({ where: { sportLeagueId: { in: leagueIds } } });
  await deleteTestSportLeagues(db, leagueIds);
}

let admin: RegisteredUserContext;

beforeAll(async () => {
  // The migrations' reference rows, restored in case an earlier suite cleared the sports table.
  const db = getFunctionalPrisma();
  await db.sport.upsert({ where: { sport: Sport.GOLF }, create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF), tournamentFormat: 'STROKE_PLAY_TOURNAMENT' }, update: {} });
  await db.sport.upsert({ where: { sport: Sport.HORSE_RACING }, create: { sport: Sport.HORSE_RACING, ...sportRowKeys(Sport.HORSE_RACING), tournamentFormat: 'RACE' }, update: {} });
  await db.sport.upsert({ where: { sport: Sport.BASKETBALL }, create: { sport: Sport.BASKETBALL, ...sportRowKeys(Sport.BASKETBALL), tournamentFormat: 'MATCHES' }, update: {} });
  await db.sport.upsert({ where: { sport: Sport.AMERICAN_FOOTBALL }, create: { sport: Sport.AMERICAN_FOOTBALL, ...sportRowKeys(Sport.AMERICAN_FOOTBALL), tournamentFormat: 'MATCHES' }, update: {} });
  admin = await buildRegisteredUser({ displayName: 'Load Admin' });
  await promoteToRootAdmin(admin);
});

afterAll(async () => {
  await cleanup();
  await disconnectFunctionalPrisma();
});

async function leagueNamed(name: string, sport: Sport = Sport.GOLF): Promise<{ id: string; bracketAdvancement: BracketAdvancement } | undefined> {
  const { sportLeagues } = expectDefined((await listSportLeagues({ client: admin.client, query: { sport } })).data);
  return sportLeagues.find((league) => league.name === name);
}

async function addSportLeague(name: string, sport: Sport = Sport.GOLF): Promise<void> {
  await addRunSportLeague(admin.client, sport, name);
}

async function eventsOf(sportLeagueId: string, championshipYear: number) {
  return seasonEvents(admin.client, sportLeagueId, championshipYear);
}

async function fieldOf(eventId: string) {
  const { participants } = expectDefined((await listEventParticipants({ client: admin.client, path: { eventId } })).data);
  return new Map(participants.map((row) => [row.participant.name, row]));
}

describe('Loading a golf test seed through the admin API', () => {
  const prefix = `${RUN}-test`;
  const tour = `Seed Tour ${prefix}`;
  const golfer = (index: number, rounds: number[], extra: Partial<SportDataFieldEntry> = {}): SportDataFieldEntry => ({
    player: `${prefix}-p${index}`, ranking: index, oddsToWin: 5 + index, rounds, ...extra,
  });
  const seed: SportDataFile = {
    schemaVersion: 1,
    scope: { sport: Sport.GOLF, season: 2026, sportLeagues: [tour], ...sportPlay(Sport.GOLF), contents: [...TEST_SEED_CONTENTS] },
    testData: true,
    provenance: provenance(),
    sportLeagues: [{
      name: tour,
      players: players(prefix, 12),
      events: [
        {
          key: 'first',
          name: `${prefix} Opener`,
          startDate: '2026-01-15',
          endDate: '2026-01-18',
          venue: 'Seed Links',
          location: 'Testville, US',
          rounds: 4,
          roundsPar: 72,
          winner: 'public',
          field: [
            golfer(1, [66, 67, 68, 69]),
            ...Array.from({ length: 9 }, (_, index) => golfer(index + 2, [70, 71, 72, 70 + index])),
            golfer(11, [78, 79], { finish: 'MC' }),
            golfer(12, [71, 40], { finish: 'WD', withdrawnThru: 9 }),
          ],
        },
        {
          key: 'second',
          name: `${prefix} Classic`,
          startDate: '2026-01-22',
          endDate: '2026-01-25',
          venue: null,
          location: null,
          rounds: 4,
          roundsPar: 70,
          winner: 'generated',
          field: Array.from({ length: 8 }, (_, index) => golfer(index + 1, [69, 70, 71, 68 + index])),
        },
      ],
    }],
  };
  const getClient = () => Promise.resolve(admin.client);

  beforeAll(() => addSportLeague(tour));

  it('refuses a file naming a sport league the site does not have, in a dry run too, since only a migration adds a league', async () => {
    const missing = `Missing Tour ${prefix}`;
    const file: SportDataFile = { ...seed, scope: { ...seed.scope, sportLeagues: [missing] }, sportLeagues: [{ ...seed.sportLeagues[0], name: missing }] };

    await expect(loadSportData(parsed(file), { getClient, now: NOW, mode: LoadMode.DRY_RUN })).rejects.toThrow(`No GOLF sport league named ${missing}`);
    expect(await leagueNamed(missing)).toBeUndefined();
  });

  it('reports every addition in a dry run without writing, then releases each tournament at least a week after today with its field, tiers and stored final scores', async () => {
    const dryRun = await loadSportData(parsed(seed), { getClient, now: NOW, mode: LoadMode.DRY_RUN });
    expect(counts(dryRun)).toEqual({ 'SPORT_LEAGUE SKIP': 1, 'PLAYER ADD': 12, 'EVENT ADD': 2, 'FIELD ADD': 2 });
    expect(await eventsOf(expectDefined(await leagueNamed(tour)).id, 2026)).toEqual([]);

    const applied = await loadSportData(parsed(seed), { getClient, now: NOW, mode: LoadMode.APPLY });
    expect(counts(applied)).toEqual(counts(dryRun));

    const league = expectDefined(await leagueNamed(tour));
    const events = await eventsOf(league.id, 2026);
    const opener = expectDefined(events.find((event) => event.name === `${prefix} Opener`));
    // Released for contests, a whole number of weeks on from 2026-01-15 and at least a week after today.
    expect(events.map((event) => event.status)).toEqual(['SCHEDULED', 'SCHEDULED']);
    expect(opener.startDate).toBe(shiftedEventDates(seed.sportLeagues[0].events[0], seedDateOffsetDays(seed, NOW)).startDate);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const openerStart = Date.parse(opener.startDate);
    expect(openerStart).toBeGreaterThanOrEqual(NOW.getTime() + weekMs);
    expect((openerStart - Date.parse('2026-01-15T12:00:00Z')) % weekMs).toBe(0);
    expect(opener.autoLifecycleEnabled).toBe(false);

    const field = await fieldOf(opener.id);
    expect(field.size).toBe(12);
    expect([...field.values()].every((row) => row.valuation?.sportEventTierId && row.valuation.price !== null)).toBe(true);
    expect(field.get(`${prefix} Golfer 1`)).toMatchObject({ ranking: 1, oddsToWin: 6, seedNumber: 1 });
    expect(expectDefined(field.get(`${prefix} Golfer 1`)).standing).toMatchObject({ position: 1, status: 'COMPLETE' });
    expect(expectDefined(field.get(`${prefix} Golfer 11`)).standing).toMatchObject({ position: null, status: 'ELIMINATED' });
    expect(expectDefined(field.get(`${prefix} Golfer 12`)).standing).toMatchObject({ position: null, status: 'WITHDRAWN' });
    expect(expectDefined(field.get(`${prefix} Golfer 12`)).rounds.find((round) => round.roundNumber === 2)?.status).toBe('DNF');
  });

  it('skips everything on a second run, keeping a tour ranking an admin changed by hand', async () => {
    const league = expectDefined(await leagueNamed(tour));
    const db = getFunctionalPrisma();
    const golferOne = await db.participant.findFirstOrThrow({ where: { name: `${prefix} Golfer 1` } });
    await db.participant.update({ where: { id: golferOne.id }, data: { ranking: 99 } });

    const second = await loadSportData(parsed(seed), { getClient, now: NOW, mode: LoadMode.APPLY });

    expect(changes(second)).toEqual([]);
    expect(counts(second)).toEqual({ 'SPORT_LEAGUE SKIP': 1, 'PLAYER SKIP': 12, 'EVENT SKIP': 2, 'FIELD SKIP': 2 });
    expect(expectDefined((await listParticipants({ client: admin.client, query: { sportLeagueId: league.id } })).data).participants).toHaveLength(12);
    expect((await db.participant.findUniqueOrThrow({ where: { id: golferOne.id } })).ranking).toBe(99);
  });

  it('finishes a tournament an earlier run left as an empty draft: field, tiers, prices, scores and release', async () => {
    const league = expectDefined(await leagueNamed(tour));
    const finale = { ...seed.sportLeagues[0].events[1], key: 'third', name: `${prefix} Finale`, startDate: '2026-01-29', endDate: '2026-02-01' };
    const withFinale: SportDataFile = { ...seed, sportLeagues: [{ ...seed.sportLeagues[0], events: [...seed.sportLeagues[0].events, finale] }] };
    const finaleStart = shiftedEventDates(finale, seedDateOffsetDays(withFinale, NOW)).startDate;
    // What a run that stopped straight after creating the event leaves behind.
    expectDefined((await createTestEvent({
      client: admin.client,
      body: { sportLeagueId: league.id, championshipYear: 2026, name: finale.name, startDate: finaleStart, rounds: 4, autoLifecycleEnabled: false },
    })).data);

    const rows = await loadSportData(parsed(withFinale), { getClient, now: NOW, mode: LoadMode.APPLY });

    expect(changes(rows)).toEqual([
      expect.objectContaining({ subject: LoadSubject.EVENT, action: LoadAction.UPDATE, name: finale.name, detail: expect.stringContaining('finishes the draft') as unknown }),
      { sportLeague: tour, subject: LoadSubject.FIELD, action: LoadAction.UPDATE, name: finale.name, detail: expect.stringContaining('8 added') as unknown },
    ]);
    const stored = expectDefined((await eventsOf(league.id, 2026)).find((event) => event.name === finale.name));
    expect(stored).toMatchObject({ status: 'SCHEDULED', startDate: finaleStart, roundsPar: 70 });
    expect((await fieldOf(stored.id)).size).toBe(8);
  });

  it('sets up a tournament the run holds back as a draft with its field, tiers, prices and scores, and releases it on a later run', async () => {
    const league = expectDefined(await leagueNamed(tour));
    const heldBack = { ...seed.sportLeagues[0].events[1], key: 'held', name: `${prefix} Invitational`, startDate: '2026-02-05', endDate: '2026-02-08' };
    const file: SportDataFile = { ...seed, sportLeagues: [{ ...seed.sportLeagues[0], events: [heldBack] }] };

    // The whole seed's offset, so it lands three weeks after the Opener rather than on its dates.
    const offsetDays = seedDateOffsetDays(seed, NOW);

    const held = await loadSportData(parsed(file), { getClient, now: NOW, mode: LoadMode.APPLY, offsetDays, release: false });

    expect(held).toContainEqual(expect.objectContaining({ subject: LoadSubject.EVENT, action: LoadAction.ADD, name: heldBack.name, detail: 'a draft with odds, tiers, prices and scores' }));
    const draft = expectDefined((await eventsOf(league.id, 2026)).find((event) => event.name === heldBack.name));
    expect(draft.status).toBe('DRAFT');
    const field = await fieldOf(draft.id);
    expect([...field.values()].every((row) => row.valuation?.sportEventTierId && row.valuation.price !== null)).toBe(true);
    expect(expectDefined(field.get(`${prefix} Golfer 1`)).standing).toMatchObject({ status: 'COMPLETE' });

    const released = await loadSportData(parsed(file), { getClient, now: NOW, mode: LoadMode.APPLY, offsetDays });

    expect(released).toContainEqual(expect.objectContaining({ subject: LoadSubject.EVENT, action: LoadAction.UPDATE, name: heldBack.name, detail: expect.stringContaining('release') as unknown }));
    expect(expectDefined((await eventsOf(league.id, 2026)).find((event) => event.name === heldBack.name)).status).toBe('SCHEDULED');
  });
});

describe('Binding a test player\'s feed ids as the test seed loads', () => {
  const prefix = `${RUN}-feed`;
  const tour = `Feed Tour ${prefix}`;
  // A test data file names a feed id by its provider's code; the mapping keys it to that Provider row (#2040).
  const provider = ProviderCode.BALLDONTLIE;
  const providerRowId = async () => (await getFunctionalPrisma().provider.findUniqueOrThrow({ where: { code: provider } })).id;
  const feedId = (id: string) => `${prefix}-${id}`;
  const getClient = () => Promise.resolve(admin.client);
  // Two golfers are too few to release; the drafts are enough to see who is fielded.
  /** A tour of two golfers, the feed ids given each; `key` keeps each test's tour and golfers its own. */
  const seed = (key: string, feedIds: Array<Record<string, string> | undefined>): SportDataFile => ({
    schemaVersion: 1,
    scope: { sport: Sport.GOLF, season: 2026, sportLeagues: [`${tour} ${key}`], ...sportPlay(Sport.GOLF), contents: [...TEST_SEED_CONTENTS] },
    testData: true,
    provenance: provenance(),
    sportLeagues: [{
      name: `${tour} ${key}`,
      players: players(`${prefix}-${key}`, 2).map((player, index) => ({ ...player, ...(feedIds[index] && { feedIds: feedIds[index] }) })),
      events: [{
        key: 'feed', name: `${prefix} ${key} Open`, startDate: '2026-03-05', endDate: '2026-03-08', venue: null, location: null, rounds: 4, roundsPar: 72, winner: 'public',
        field: [1, 2].map((index) => ({ player: `${prefix}-${key}-p${index}`, ranking: index, oddsToWin: 5 + index, rounds: [68 + index, 70, 70, 70] })),
      }],
    }],
  });
  const mappingOf = (id: string) => getFunctionalPrisma().participantProviderMapping.findFirst({ where: { provider: { code: provider }, externalId: feedId(id) } });

  afterAll(async () => {
    await getFunctionalPrisma().participantProviderMapping.deleteMany({ where: { provider: { code: provider }, externalId: { startsWith: prefix } } });
  });

  it('reports a feed id to bind in a dry run without binding it, then binds it to the player it creates, and skips it on a second run', async () => {
    await addSportLeague(`${tour} new`);
    const file = seed('new', [{ [provider]: feedId('golfer-1') }, undefined]);

    const dryRun = await loadSportData(parsed(file), { getClient, now: NOW, mode: LoadMode.DRY_RUN, release: false });
    expect(changes(dryRun)).toContainEqual({ sportLeague: `${tour} new`, subject: LoadSubject.PLAYER, action: LoadAction.UPDATE, name: `${prefix}-new Golfer 1`, detail: `${provider} feed id ${feedId('golfer-1')} bound` });
    await expect(mappingOf('golfer-1')).resolves.toBeNull();

    await loadSportData(parsed(file), { getClient, now: NOW, mode: LoadMode.APPLY, release: false });
    const golferOne = await getFunctionalPrisma().participant.findFirstOrThrow({ where: { name: `${prefix}-new Golfer 1` } });
    await expect(mappingOf('golfer-1')).resolves.toMatchObject({ participantId: golferOne.id, providerId: await providerRowId(), participantType: 'INDIVIDUAL' });

    const second = await loadSportData(parsed(file), { getClient, now: NOW, mode: LoadMode.APPLY, release: false });
    expect(changes(second).filter((row) => row.subject === LoadSubject.PLAYER)).toEqual([]);
  });

  it('takes the league\'s participant a feed id is already mapped to, whatever the file calls the player, and fields it rather than creating a second', async () => {
    const db = getFunctionalPrisma();
    const golfSportId = (await db.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } })).id;
    const league = `${tour} known`;
    // As the sync leaves a golfer it fielded first in the league: its own spelling and no test data key.
    const sportLeague = await db.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(db)), ...sportPlay(Sport.GOLF), sportId: golfSportId, name: league } });
    // A migration adds a league with its Seasons; the file's 2026 one stands in, made current.
    await inCurrentSeason(sportLeague.id, 2026);
    const synced = await db.participant.create({ data: { sportLeagueId: sportLeague.id, name: `${prefix} Synced Spelling`, participantType: 'INDIVIDUAL' } });
    await db.participantProviderMapping.create({ data: { participantId: synced.id, sportLeagueId: sportLeague.id, providerId: await providerRowId(), participantType: 'INDIVIDUAL', externalId: feedId('golfer-2') } });


    const rows = await loadSportData(parsed(seed('known', [undefined, { [provider]: feedId('golfer-2') }])), { getClient, now: NOW, mode: LoadMode.APPLY, release: false });

    expect(changes(rows).filter((row) => row.subject === LoadSubject.PLAYER)).toEqual([
      { sportLeague: league, subject: LoadSubject.PLAYER, action: LoadAction.ADD, name: `${prefix}-known Golfer 1`, detail: 'ranked 1' },
    ]);
    await expect(db.participant.count({ where: { name: `${prefix}-known Golfer 2` } })).resolves.toBe(0);
    const event = expectDefined((await eventsOf(expectDefined(await leagueNamed(league)).id, 2026))[0]);
    expect((await fieldOf(event.id)).has(`${prefix} Synced Spelling`)).toBe(true);
  });
});

describe('Loading the NFL playoffs test seed through the admin API', () => {
  // The checked-in file, its names and keys tagged with this run so the suite cleans up after it.
  const prefix = `${RUN}-nfl`;
  const league = `NFL ${prefix}`;
  const playoffs = `${prefix} NFL Playoffs`;
  const getClient = () => Promise.resolve(admin.client);
  // Release refuses an event that has started by the server's clock, so the seed is dated from today.
  const now = new Date();
  const tagged = (key: string | null) => (key === null ? null : `${prefix}-${key}`);
  function nflSeed(): SportDataFile {
    const file = parsed(JSON.parse(readFileSync(join(__dirname, '../../packages/core-api/scripts/seed-golf/american-football-2026-nfl-playoffs-test.json'), 'utf8')) as SportDataFile);
    file.scope.sportLeagues = [league];
    const [nfl] = file.sportLeagues;
    nfl.name = league;
    for (const player of nfl.players) player.key = expectDefined(tagged(player.key));
    for (const event of nfl.events) {
      event.name = playoffs;
      for (const entry of event.field) entry.player = expectDefined(tagged(entry.player));
      for (const match of event.matches ?? []) Object.assign(match, { home: tagged(match.home), away: tagged(match.away) });
    }
    return file;
  }

  it('releases the playoffs with reseeded Divisional and conference rounds and every result entered, the Seahawks winning the Super Bowl, then skips on a second run', async () => {
    await addSportLeague(league, Sport.AMERICAN_FOOTBALL);
    const applied = await loadSportData(nflSeed(), { getClient, now, mode: LoadMode.APPLY, resultsThrough: EVERY_GAME_PLAYED });
    // The league starts on the default bracket rule, and the file's reseeding is set on it.
    expect(counts(applied)).toEqual({ 'SPORT_LEAGUE UPDATE': 1, 'PLAYER ADD': 14, 'EVENT ADD': 1, 'FIELD ADD': 1, 'BRACKET ADD': 1 });

    const stored = expectDefined(await leagueNamed(league, Sport.AMERICAN_FOOTBALL));
    expect(stored.bracketAdvancement).toBe(BracketAdvancement.RESEED_BY_SEED);
    const event = expectDefined((await eventsOf(stored.id, 2026)).find((row) => row.name === playoffs));
    const nameOf = new Map([...(await fieldOf(event.id)).entries()].map(([name, row]) => [row.id, name]));
    const { matches } = expectDefined((await getEventBracket({ client: admin.client, path: { eventId: event.id } })).data);
    const byNumber = new Map(matches.map((match) => [match.matchNumber, match]));
    const sides = (matchNumber: number) => {
      const match = expectDefined(byNumber.get(matchNumber));
      return [match.homeSportEventParticipantId, match.awaySportEventParticipantId].map((id) => (id === null ? null : nameOf.get(id)));
    };

    expect(matches.every((match) => match.status === MatchStatus.COMPLETED)).toBe(true);
    // Each conference's 1 seed meets its lowest seed left, as the 2025 season's Divisional round did.
    expect([7, 8, 9, 10].map(sides)).toEqual([
      ['Denver Broncos', 'Buffalo Bills'],
      ['New England Patriots', 'Houston Texans'],
      ['Seattle Seahawks', 'San Francisco 49ers'],
      ['Chicago Bears', 'Los Angeles Rams'],
    ]);
    // A second reseed places the conference championships: the better seed left hosts.
    expect([11, 12].map(sides)).toEqual([['Denver Broncos', 'New England Patriots'], ['Seattle Seahawks', 'Los Angeles Rams']]);
    expect(sides(13)).toEqual(['New England Patriots', 'Seattle Seahawks']);
    expect(byNumber.get(13)).toMatchObject({ winnerSide: MatchSide.AWAY, homeScore: 13, awayScore: 29, isNeutralSite: true });

    expect(changes(await loadSportData(nflSeed(), { getClient, now, mode: LoadMode.APPLY, resultsThrough: EVERY_GAME_PLAYED }))).toEqual([]);
  });
});

describe('Filling an event from a test slate through the admin API', () => {
  const prefix = `${RUN}-slate`;
  const tour = `Slate Tour ${prefix}`;
  const eventName = `${prefix} Invitational`;
  const getClient = () => Promise.resolve(admin.client);
  const roster = players(prefix, 6);
  const slate = (keys: readonly number[]): SportDataFile => ({
    schemaVersion: 1,
    scope: { sport: Sport.GOLF, season: 2026, sportLeagues: [tour], ...sportPlay(Sport.GOLF), contents: [SportDataContent.PLAYERS, SportDataContent.FIELDS] },
    testData: true,
    provenance: provenance(),
    sportLeagues: [{ name: tour, players: keys.map((key) => roster[key - 1]), events: [] }],
  });
  const fieldRow = (detail: string): LoadRow => ({ sportLeague: tour, subject: LoadSubject.FIELD, action: LoadAction.UPDATE, name: eventName, detail });
  let eventId = '';

  beforeAll(async () => {
    // The loader writes into the league's current Season, so the schedule's 2027 one is made current.
    await inCurrentSeason(await addRunSportLeague(admin.client, Sport.GOLF, tour), 2027);
    // A test seed held back as a draft puts the event on the site with a field of golfers 1 to 3.
    const schedule: SportDataFile = {
      schemaVersion: 1,
      scope: { sport: Sport.GOLF, season: 2027, sportLeagues: [tour], ...sportPlay(Sport.GOLF), contents: [...TEST_SEED_CONTENTS] },
      testData: true,
      provenance: provenance(),
      sportLeagues: [{
        name: tour,
        players: roster.slice(0, 3),
        events: [{
          key: 'invitational', name: eventName, startDate: '2027-05-06', endDate: '2027-05-09', venue: null, location: null, rounds: 4, roundsPar: 72, winner: 'public',
          field: [1, 2, 3].map((index) => ({ player: `${prefix}-p${index}`, ranking: index, oddsToWin: 5 + index, rounds: [68 + index, 70, 70, 70] })),
        }],
      }],
    };
    await loadSportData(parsed(schedule), { getClient, now: NOW, mode: LoadMode.APPLY, release: false });
    const league = expectDefined(await leagueNamed(tour));
    eventId = expectDefined((await eventsOf(league.id, 2027)).find((event) => event.name === eventName)).id;
  });

  it('refuses a slate run without an event, a file with its own events given one, and an event the sport league does not have', async () => {
    await expect(loadSportData(parsed(slate([1])), { getClient, now: NOW, mode: LoadMode.DRY_RUN })).rejects.toThrow('A test slate fills one event: name it (--event).');
    await expect(loadSportData(parsed(slate([1])), { getClient, now: NOW, mode: LoadMode.DRY_RUN, event: `${prefix} Nowhere` })).rejects.toThrow(`No ${tour} event named ${prefix} Nowhere.`);
    const seedFile = parsed(slate([1]));
    await expect(loadSportData({ ...seedFile, scope: { ...seedFile.scope, contents: [...TEST_SEED_CONTENTS] } }, { getClient, now: NOW, mode: LoadMode.DRY_RUN, event: eventName })).rejects.toThrow('--event and --replace-field go with a test slate');
  });

  it('fills the named event with the slate in seed order, withdrawing a player it leaves out, after a dry run that writes nothing, then skips on a second run', async () => {
    const file = parsed(slate([4, 2, 5]));
    const expected = fieldRow(`2 added (${prefix} Golfer 4, ${prefix} Golfer 5); 2 withdrawn (${prefix} Golfer 1, ${prefix} Golfer 3)`);

    const dryRun = await loadSportData(file, { getClient, now: NOW, mode: LoadMode.DRY_RUN, event: eventName });
    expect(changes(dryRun)).toEqual([
      { sportLeague: tour, subject: LoadSubject.PLAYER, action: LoadAction.ADD, name: `${prefix} Golfer 4`, detail: 'ranked 4' },
      { sportLeague: tour, subject: LoadSubject.PLAYER, action: LoadAction.ADD, name: `${prefix} Golfer 5`, detail: 'ranked 5' },
      expected,
    ]);
    expect((await fieldOf(eventId)).size).toBe(3);

    expect(changes(await loadSportData(file, { getClient, now: NOW, mode: LoadMode.APPLY, event: eventName }))).toContainEqual(expected);
    const field = await fieldOf(eventId);
    expect(field.get(`${prefix} Golfer 4`)).toMatchObject({ seedNumber: 1, ranking: 4, isActive: true });
    expect(field.get(`${prefix} Golfer 2`)).toMatchObject({ seedNumber: 2, isActive: true });
    expect(field.get(`${prefix} Golfer 5`)).toMatchObject({ seedNumber: 3, isActive: true });
    expect(field.get(`${prefix} Golfer 1`)).toMatchObject({ isActive: false, inactiveReason: 'WITHDRAWN' });

    expect(changes(await loadSportData(file, { getClient, now: NOW, mode: LoadMode.APPLY, event: eventName }))).toEqual([]);
  });

  it('replaces the field when asked: removes every row the slate leaves out, but withdraws one a contest entry has picked', async () => {
    const db = getFunctionalPrisma();
    const { league, commissioner } = await buildLeagueWithCommissioner({ displayName: 'Slate Commissioner', leagueName: `Slate League ${prefix}` });
    const { contestId } = await seedContestFixture(league.id, { name: `Slate Contest ${prefix}`, selectionType: 'TIERED' });
    const squad = await db.squad.create({ data: { leagueId: league.id, createdBy: commissioner.userId, name: `Slate Squad ${prefix}` } });
    const entry = await db.contestEntry.create({ data: { contestId, squadId: squad.id, entryNumber: 1, name: `Slate Entry ${prefix}` } });
    const picked = expectDefined((await fieldOf(eventId)).get(`${prefix} Golfer 2`));
    await db.contestEntryPick.create({ data: { entryId: entry.id, sportEventParticipantId: picked.id } });

    try {
      const file = parsed(slate([6, 4]));
      const dryRun = await loadSportData(file, { getClient, now: NOW, mode: LoadMode.DRY_RUN, event: eventName, replaceField: true });
      expect(changes(dryRun)).toContainEqual(fieldRow(
        `1 added (${prefix} Golfer 6); 1 re-ranked or re-seeded; 4 removed (${prefix} Golfer 1, ${prefix} Golfer 2, ${prefix} Golfer 3, ${prefix} Golfer 5); any a contest entry has picked are withdrawn instead`,
      ));

      const applied = await loadSportData(file, { getClient, now: NOW, mode: LoadMode.APPLY, event: eventName, replaceField: true });
      expect(changes(applied)).toContainEqual(fieldRow(`1 withdrawn, not removed, because a contest entry picked them (${prefix} Golfer 2)`));
      const field = await fieldOf(eventId);
      expect([...field.keys()].sort()).toEqual([`${prefix} Golfer 2`, `${prefix} Golfer 4`, `${prefix} Golfer 6`]);
      expect(field.get(`${prefix} Golfer 6`)).toMatchObject({ seedNumber: 1, isActive: true });
      expect(field.get(`${prefix} Golfer 4`)).toMatchObject({ seedNumber: 2, isActive: true });
      expect(field.get(`${prefix} Golfer 2`)).toMatchObject({ isActive: false, inactiveReason: 'WITHDRAWN' });
    } finally {
      await db.contestEntryPick.deleteMany({ where: { entryId: entry.id } });
      await db.contestEntry.delete({ where: { id: entry.id } });
      await db.contestConfiguration.deleteMany({ where: { contestId } });
      await db.contest.delete({ where: { id: contestId } });
      await db.squad.delete({ where: { id: squad.id } });
    }
  });
});
