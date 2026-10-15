import { createEvent, listEventParticipants, listEvents, listParticipants, listSportLeagues, listSports } from '@poolmaster/shared/generated/hey-api';
import { findSportRow, Sport } from '@poolmaster/shared/domain';
import { LoadAction, LoadMode, LoadSubject, type LoadRow } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import {
  parseSportDataFile,
  SportDataContent,
  type SportDataFieldEntry,
  type SportDataFile,
} from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin, seedContestFixture, type RegisteredUserContext } from './builders';
import { disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';

// Loading a sport data file through the real admin API: a test seed a commissioner can build
// contests on, a real file filled in by comparison, and a second run that changes nothing.

const RUN = `load-${Date.now()}`;
const NOW = new Date('2026-10-08T19:00:00Z');

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
  return parseSportDataFile(JSON.parse(JSON.stringify(file)) as unknown, { allowTestData: true });
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
  await db.sportEventParticipantGolfRound.deleteMany({ where: { participantRound: { sportEventParticipantId: { in: fieldIds } } } });
  await db.sportEventParticipantRound.deleteMany({ where: { sportEventParticipantId: { in: fieldIds } } });
  await db.sportEventParticipantGolfStanding.deleteMany({ where: { standing: { sportEventParticipantId: { in: fieldIds } } } });
  await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipantId: { in: fieldIds } } });
  await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipantId: { in: fieldIds } } });
  await db.sportEventParticipant.deleteMany({ where: { id: { in: fieldIds } } });
  await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
  await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
  await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
  const participantIds = (await db.participant.findMany({ where: { externalId: { startsWith: RUN } }, select: { id: true } })).map((p) => p.id);
  await db.participantLeagueAffiliation.deleteMany({ where: { participantId: { in: participantIds } } });
  await db.participant.deleteMany({ where: { id: { in: participantIds } } });
  await db.eventSeries.deleteMany({ where: { sportLeagueId: { in: leagueIds } } });
  await db.sportLeague.deleteMany({ where: { id: { in: leagueIds } } });
}

let admin: RegisteredUserContext;

beforeAll(async () => {
  // The migrations' reference rows, restored in case an earlier suite cleared the sports table.
  const db = getFunctionalPrisma();
  await db.sport.upsert({ where: { sport: Sport.GOLF }, create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' }, update: {} });
  await db.sport.upsert({ where: { sport: Sport.HORSE_RACING }, create: { sport: Sport.HORSE_RACING, participantType: 'INDIVIDUAL', tournamentFormat: 'RACE' }, update: {} });
  admin = await buildRegisteredUser({ displayName: 'Load Admin' });
  await promoteToRootAdmin(admin);
});

afterAll(async () => {
  await cleanup();
  await disconnectFunctionalPrisma();
});

async function leagueNamed(name: string, sport: Sport = Sport.GOLF): Promise<{ id: string; matchKeyword: string | null } | undefined> {
  const { sportLeagues } = expectDefined((await listSportLeagues({ client: admin.client, query: { sport } })).data);
  return sportLeagues.find((league) => league.name === name);
}

async function eventsOf(sportLeagueId: string, eventYear: number) {
  return expectDefined((await listEvents({ client: admin.client, query: { sportLeagueId, eventYear } })).data).events;
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
    scope: { sport: Sport.GOLF, season: 2026, sportLeagues: [tour], contents: Object.values(SportDataContent) },
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

  it('reports every addition in a dry run without writing, then releases each tournament a week ahead with its field, tiers and stored final scores', async () => {
    const dryRun = await loadSportData(parsed(seed), { getClient, now: NOW, mode: LoadMode.DRY_RUN });
    expect(counts(dryRun)).toEqual({ 'SPORT_LEAGUE ADD': 1, 'PLAYER ADD': 12, 'EVENT ADD': 2, 'FIELD ADD': 2 });
    expect(await leagueNamed(tour)).toBeUndefined();

    const applied = await loadSportData(parsed(seed), { getClient, now: NOW, mode: LoadMode.APPLY });
    expect(counts(applied)).toEqual(counts(dryRun));

    const league = expectDefined(await leagueNamed(tour));
    expect(league.matchKeyword).toBe(tour);
    const events = await eventsOf(league.id, 2026);
    const opener = expectDefined(events.find((event) => event.name === `${prefix} Opener`));
    // Released for contests, a whole number of weeks on from 2026-01-15 and at least a week after NOW.
    expect(events.map((event) => event.status)).toEqual(['SCHEDULED', 'SCHEDULED']);
    expect(opener.startDate).toBe('2026-10-22T12:00:00.000Z');
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
    const golferOne = await db.participant.findFirstOrThrow({ where: { externalId: `${prefix}-p1` } });
    const affiliation = { participantId_sportLeagueId: { participantId: golferOne.id, sportLeagueId: league.id } };
    await db.participantLeagueAffiliation.update({ where: affiliation, data: { ranking: 99 } });

    const second = await loadSportData(parsed(seed), { getClient, now: NOW, mode: LoadMode.APPLY });

    expect(changes(second)).toEqual([]);
    expect(counts(second)).toEqual({ 'SPORT_LEAGUE SKIP': 1, 'PLAYER SKIP': 12, 'EVENT SKIP': 2, 'FIELD SKIP': 2 });
    const golfSportId = expectDefined(findSportRow(expectDefined((await listSports({ client: admin.client })).data).sports, Sport.GOLF)).id;
    expect(expectDefined((await listParticipants({ client: admin.client, query: { sportId: golfSportId, q: prefix } })).data).participants).toHaveLength(12);
    expect((await db.participantLeagueAffiliation.findUniqueOrThrow({ where: affiliation })).ranking).toBe(99);
  });

  it('finishes a tournament an earlier run left as an empty draft: field, tiers, prices, scores and release', async () => {
    const league = expectDefined(await leagueNamed(tour));
    const finale = { ...seed.sportLeagues[0].events[1], key: 'third', name: `${prefix} Finale`, startDate: '2026-01-29', endDate: '2026-02-01' };
    const withFinale: SportDataFile = { ...seed, sportLeagues: [{ ...seed.sportLeagues[0], events: [...seed.sportLeagues[0].events, finale] }] };
    // What a run that stopped straight after creating the event leaves behind.
    expectDefined((await createEvent({
      client: admin.client,
      body: { sportLeagueId: league.id, eventYear: 2026, name: finale.name, startDate: '2026-11-05T12:00:00.000Z', rounds: 4, autoLifecycleEnabled: false },
    })).data);

    const rows = await loadSportData(parsed(withFinale), { getClient, now: NOW, mode: LoadMode.APPLY });

    expect(changes(rows)).toEqual([
      expect.objectContaining({ subject: LoadSubject.EVENT, action: LoadAction.UPDATE, name: finale.name, detail: expect.stringContaining('finishes the draft') as unknown }),
      { sportLeague: tour, subject: LoadSubject.FIELD, action: LoadAction.UPDATE, name: finale.name, detail: expect.stringContaining('8 added') as unknown },
    ]);
    const stored = expectDefined((await eventsOf(league.id, 2026)).find((event) => event.name === finale.name));
    expect(stored).toMatchObject({ status: 'SCHEDULED', startDate: '2026-11-05T12:00:00.000Z', roundsPar: 70 });
    expect((await fieldOf(stored.id)).size).toBe(8);
  });
});

describe('Loading a real golf schedule and fields through the admin API', () => {
  const prefix = `${RUN}-real`;
  const tour = `Real Tour ${prefix}`;
  const name = (event: string) => `${prefix} ${event}`;
  const getClient = () => Promise.resolve(admin.client);
  const file = (edit: (events: SportDataFile['sportLeagues'][number]['events']) => void = () => {}): SportDataFile => {
    const events: SportDataFile['sportLeagues'][number]['events'] = [
      {
        key: 'heritage', name: name('Heritage'), startDate: '2027-04-15', endDate: '2027-04-18', venue: 'Harbour Town', location: 'Hilton Head, SC, US', rounds: 4, roundsPar: 71,
        field: [{ player: `${prefix}-p1`, ranking: 1 }, { player: `${prefix}-p2`, ranking: 2 }, { player: `${prefix}-p3`, ranking: 3 }],
      },
      {
        key: 'open', name: name('Open'), startDate: '2027-04-22', endDate: '2027-04-25', venue: 'Old Course', location: null, rounds: 4, roundsPar: 72,
        field: [{ player: `${prefix}-p1`, ranking: 1 }],
      },
    ];
    edit(events);
    return {
      schemaVersion: 1,
      scope: { sport: Sport.GOLF, season: 2027, sportLeagues: [tour], contents: [SportDataContent.SCHEDULE, SportDataContent.PLAYERS, SportDataContent.FIELDS] },
      testData: false,
      provenance: provenance(),
      sportLeagues: [{ name: tour, players: players(prefix, 4), events }],
    };
  };

  it('loads drafts with their fields, rankings and seeds, and no odds, tiers, prices or scores', async () => {
    const rows = await loadSportData(parsed(file()), { getClient, now: NOW, mode: LoadMode.APPLY });

    expect(counts(rows)).toEqual({ 'SPORT_LEAGUE ADD': 1, 'PLAYER ADD': 4, 'EVENT ADD': 2, 'FIELD ADD': 2 });
    const league = expectDefined(await leagueNamed(tour));
    const heritage = expectDefined((await eventsOf(league.id, 2027)).find((event) => event.name === name('Heritage')));
    expect(heritage).toMatchObject({ status: 'DRAFT', startDate: '2027-04-15T12:00:00.000Z', venue: 'Harbour Town', roundsPar: 71 });
    const field = await fieldOf(heritage.id);
    expect(field.get(`${prefix} Golfer 3`)).toMatchObject({ ranking: 3, seedNumber: 3, oddsToWin: null, isActive: true });
    expect([...field.values()].every((row) => !row.valuation?.sportEventTierId && row.rounds.length === 0)).toBe(true);
  });

  it('finds a renamed event by its dates, fills in what changed, withdraws a dropped player, and leaves an event that has finished alone', async () => {
    const league = expectDefined(await leagueNamed(tour));
    const open = expectDefined((await eventsOf(league.id, 2027)).find((event) => event.name === name('Open')));
    await getFunctionalPrisma().sportEvent.update({ where: { id: open.id }, data: { status: 'COMPLETED' } });
    const changed = file((events) => {
      events[0] = {
        ...events[0],
        name: name('Heritage presented by Sponsor'),
        venue: 'Harbour Town Golf Links',
        field: [{ player: `${prefix}-p1`, ranking: 5 }, { player: `${prefix}-p2`, ranking: 2 }, { player: `${prefix}-p4`, ranking: 4 }],
      };
      events[1] = { ...events[1], venue: 'St Andrews' };
    });

    const dryRun = await loadSportData(parsed(changed), { getClient, now: NOW, mode: LoadMode.DRY_RUN });
    const expected = [
      {
        sportLeague: tour, subject: LoadSubject.EVENT, action: LoadAction.UPDATE, name: name('Heritage presented by Sponsor'),
        detail: `name ${name('Heritage')} → ${name('Heritage presented by Sponsor')}; venue Harbour Town → Harbour Town Golf Links`,
      },
      {
        sportLeague: tour, subject: LoadSubject.FIELD, action: LoadAction.UPDATE, name: name('Heritage presented by Sponsor'),
        detail: `1 added (${prefix} Golfer 4); 1 re-ranked or re-seeded; 1 withdrawn (${prefix} Golfer 3)`,
      },
      {
        sportLeague: tour, subject: LoadSubject.EVENT, action: LoadAction.CONFLICT, name: name('Open'),
        detail: 'COMPLETED, so not changed: venue Old Course → St Andrews',
      },
    ];
    expect(changes(dryRun)).toEqual(expected);
    expect((await eventsOf(league.id, 2027)).map((event) => event.name).sort()).toEqual([name('Heritage'), name('Open')]);

    expect(changes(await loadSportData(parsed(changed), { getClient, now: NOW, mode: LoadMode.APPLY }))).toEqual(expected);
    const events = await eventsOf(league.id, 2027);
    const heritage = expectDefined(events.find((event) => event.name === name('Heritage presented by Sponsor')));
    expect(heritage.venue).toBe('Harbour Town Golf Links');
    expect(expectDefined(events.find((event) => event.id === open.id)).venue).toBe('Old Course');
    const field = await fieldOf(heritage.id);
    expect(field.get(`${prefix} Golfer 1`)).toMatchObject({ ranking: 5, seedNumber: 1, isActive: true });
    expect(field.get(`${prefix} Golfer 3`)).toMatchObject({ isActive: false, inactiveReason: 'WITHDRAWN' });
    expect(field.get(`${prefix} Golfer 4`)).toMatchObject({ ranking: 4, seedNumber: 3, isActive: true });

    // Run again: only the finished event's difference is still reported.
    expect(changes(await loadSportData(parsed(changed), { getClient, now: NOW, mode: LoadMode.APPLY }))).toEqual([expected[2]]);
  });

  it('never edits an event from a file whose contents leave out SCHEDULE', async () => {
    const fieldsOnly = file((events) => {
      events[0] = { ...events[0], name: name('Heritage presented by Sponsor'), venue: 'Somewhere Else', field: [{ player: `${prefix}-p1`, ranking: 5 }, { player: `${prefix}-p2`, ranking: 2 }, { player: `${prefix}-p4`, ranking: 4 }] };
      events.pop();
    });
    fieldsOnly.scope.contents = [SportDataContent.PLAYERS, SportDataContent.FIELDS];

    const rows = await loadSportData(parsed(fieldsOnly), { getClient, now: NOW, mode: LoadMode.APPLY });

    expect(changes(rows)).toEqual([]);
    const league = expectDefined(await leagueNamed(tour));
    expect(expectDefined((await eventsOf(league.id, 2027)).find((event) => event.name === name('Heritage presented by Sponsor'))).venue).toBe('Harbour Town Golf Links');
  });

  it('leaves a stored field alone when the file carries no field for that event yet', async () => {
    const noField = file((events) => {
      events[0] = { ...events[0], name: name('Heritage presented by Sponsor'), venue: 'Harbour Town Golf Links', field: [] };
      events[1] = { ...events[1], venue: 'St Andrews' };
    });

    const rows = await loadSportData(parsed(noField), { getClient, now: NOW, mode: LoadMode.APPLY });

    expect(changes(rows).filter((row) => row.subject === LoadSubject.FIELD)).toEqual([]);
    const league = expectDefined(await leagueNamed(tour));
    const heritage = expectDefined((await eventsOf(league.id, 2027)).find((event) => event.name === name('Heritage presented by Sponsor')));
    const field = await fieldOf(heritage.id);
    expect(field.get(`${prefix} Golfer 1`)).toMatchObject({ isActive: true });
    expect(field.get(`${prefix} Golfer 4`)).toMatchObject({ isActive: true });
  });

  it('reinstates a withdrawn player the file lists again, clearing the withdrawal reason, and the dry run reports it', async () => {
    const recommitted = file((events) => {
      events[0] = {
        ...events[0],
        name: name('Heritage presented by Sponsor'),
        venue: 'Harbour Town Golf Links',
        field: [{ player: `${prefix}-p1`, ranking: 5 }, { player: `${prefix}-p2`, ranking: 2 }, { player: `${prefix}-p4`, ranking: 4 }, { player: `${prefix}-p3`, ranking: 3 }],
      };
      events[1] = { ...events[1], venue: 'St Andrews' };
    });
    const fieldRow = {
      sportLeague: tour, subject: LoadSubject.FIELD, action: LoadAction.UPDATE, name: name('Heritage presented by Sponsor'),
      detail: `1 reinstated (${prefix} Golfer 3)`,
    };

    expect(changes(await loadSportData(parsed(recommitted), { getClient, now: NOW, mode: LoadMode.DRY_RUN }))).toContainEqual(fieldRow);
    expect(changes(await loadSportData(parsed(recommitted), { getClient, now: NOW, mode: LoadMode.APPLY }))).toContainEqual(fieldRow);

    const league = expectDefined(await leagueNamed(tour));
    const heritage = expectDefined((await eventsOf(league.id, 2027)).find((event) => event.name === name('Heritage presented by Sponsor')));
    expect((await fieldOf(heritage.id)).get(`${prefix} Golfer 3`)).toMatchObject({ isActive: true, inactiveReason: null, seedNumber: 4 });
    expect(changes(await loadSportData(parsed(recommitted), { getClient, now: NOW, mode: LoadMode.APPLY })).filter((row) => row.subject === LoadSubject.FIELD)).toEqual([]);
  });
});

describe('Loading a real horse racing schedule and field through the admin API', () => {
  const prefix = `${RUN}-race`;
  const circuit = `Circuit ${prefix}`;
  const race = `${prefix} Pegasus World Cup`;
  const getClient = () => Promise.resolve(admin.client);
  const file = (startsAt: string, field: SportDataFieldEntry[] = []): SportDataFile => ({
    schemaVersion: 1,
    scope: { sport: Sport.HORSE_RACING, season: 2027, sportLeagues: [circuit], contents: [SportDataContent.SCHEDULE, SportDataContent.PLAYERS, SportDataContent.FIELDS] },
    testData: false,
    provenance: provenance(),
    sportLeagues: [{
      name: circuit,
      players: [
        { key: `${prefix}-h1`, name: `${prefix} Horse 1`, countryCode: 'US', ranking: 1 },
        { key: `${prefix}-h2`, name: `${prefix} Horse 2`, countryCode: 'US', ranking: 2 },
      ],
      events: [{
        key: 'pegasus', name: race, startDate: '2027-01-30', endDate: '2027-01-30', startsAt, venue: 'Gulfstream Park', location: 'Hallandale Beach, Florida', rounds: 1, roundsPar: null, field,
      }],
    }],
  });

  it('creates the circuit and a draft race at its post time, with no par and the lifecycle run by hand so it never settles on no result', async () => {
    const rows = await loadSportData(parsed(file('2027-01-30T12:00:00-05:00')), { getClient, now: NOW, mode: LoadMode.APPLY });

    expect(counts(rows)).toMatchObject({ 'SPORT_LEAGUE ADD': 1, 'EVENT ADD': 1 });
    const league = expectDefined(await leagueNamed(circuit, Sport.HORSE_RACING));
    const [stored] = await eventsOf(league.id, 2027);
    expect(stored).toMatchObject({ name: race, status: 'DRAFT', startDate: '2027-01-30T17:00:00.000Z', venue: 'Gulfstream Park', rounds: 1, roundsPar: null, autoLifecycleEnabled: false });
  });

  it('moves the post time on the same day, and adds the field once it is drawn, in post-position order', async () => {
    const rows = await loadSportData(parsed(file('2027-01-30T17:40:00-05:00', [{ player: `${prefix}-h2` }, { player: `${prefix}-h1` }])), { getClient, now: NOW, mode: LoadMode.APPLY });

    expect(changes(rows).map((row) => `${row.subject} ${row.action}`)).toEqual(expect.arrayContaining(['EVENT UPDATE']));
    const league = expectDefined(await leagueNamed(circuit, Sport.HORSE_RACING));
    const [stored] = await eventsOf(league.id, 2027);
    expect(stored.startDate).toBe('2027-01-30T22:40:00.000Z');
    const field = await fieldOf(stored.id);
    expect(field.get(`${prefix} Horse 2`)).toMatchObject({ seedNumber: 1, isActive: true });
    expect(field.get(`${prefix} Horse 1`)).toMatchObject({ seedNumber: 2, isActive: true });
  });

  it('keeps a race ending no earlier than its start when an evening post time past 23:00 UTC moves later on the same day', async () => {
    const race2 = (startsAt: string): SportDataFile => {
      const loaded = file(startsAt);
      loaded.sportLeagues[0].events[0] = { ...loaded.sportLeagues[0].events[0], key: 'classic', name: `${prefix} Classic`, startDate: '2027-11-06', endDate: '2027-11-06' };
      return loaded;
    };
    await loadSportData(parsed(race2('2027-11-06T23:20:00Z')), { getClient, now: NOW, mode: LoadMode.APPLY });
    await loadSportData(parsed(race2('2027-11-06T23:50:00Z')), { getClient, now: NOW, mode: LoadMode.APPLY });

    const league = expectDefined(await leagueNamed(circuit, Sport.HORSE_RACING));
    const classic = expectDefined((await eventsOf(league.id, 2027)).find((event) => event.name === `${prefix} Classic`));
    expect(classic.startDate).toBe('2027-11-06T23:50:00.000Z');
    expect(Date.parse(expectDefined(classic.endDate))).toBeGreaterThanOrEqual(Date.parse(classic.startDate));
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
    scope: { sport: Sport.GOLF, season: 2026, sportLeagues: [tour], contents: [SportDataContent.PLAYERS, SportDataContent.FIELDS] },
    testData: true,
    provenance: provenance(),
    sportLeagues: [{ name: tour, players: keys.map((key) => roster[key - 1]), events: [] }],
  });
  const fieldRow = (detail: string): LoadRow => ({ sportLeague: tour, subject: LoadSubject.FIELD, action: LoadAction.UPDATE, name: eventName, detail });
  let eventId = '';

  beforeAll(async () => {
    // A real schedule file puts the event on the site with a field of golfers 1 to 3.
    const schedule: SportDataFile = {
      schemaVersion: 1,
      scope: { sport: Sport.GOLF, season: 2027, sportLeagues: [tour], contents: [SportDataContent.SCHEDULE, SportDataContent.PLAYERS, SportDataContent.FIELDS] },
      testData: false,
      provenance: provenance(),
      sportLeagues: [{
        name: tour,
        players: roster.slice(0, 3),
        events: [{
          key: 'invitational', name: eventName, startDate: '2027-05-06', endDate: '2027-05-09', venue: null, location: null, rounds: 4, roundsPar: 72,
          field: [1, 2, 3].map((index) => ({ player: `${prefix}-p${index}`, ranking: index })),
        }],
      }],
    };
    await loadSportData(parsed(schedule), { getClient, now: NOW, mode: LoadMode.APPLY });
    const league = expectDefined(await leagueNamed(tour));
    eventId = expectDefined((await eventsOf(league.id, 2027)).find((event) => event.name === eventName)).id;
  });

  it('refuses a slate run without an event, a file with its own events given one, and an event the sport league does not have', async () => {
    await expect(loadSportData(parsed(slate([1])), { getClient, now: NOW, mode: LoadMode.DRY_RUN })).rejects.toThrow('A test slate fills one event: name it (--event).');
    await expect(loadSportData(parsed(slate([1])), { getClient, now: NOW, mode: LoadMode.DRY_RUN, event: `${prefix} Nowhere` })).rejects.toThrow(`No ${tour} event named ${prefix} Nowhere.`);
    const seedFile = parsed(slate([1]));
    seedFile.testData = false;
    await expect(loadSportData(seedFile, { getClient, now: NOW, mode: LoadMode.DRY_RUN, event: eventName })).rejects.toThrow('--event and --replace-field go with a test slate');
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
    const entry = await db.contestEntry.create({ data: { contestId, squadId: squad.id, entryNumber: 1, name: `Slate Entry ${prefix}`, status: 'SUBMITTED' } });
    const picked = expectDefined((await fieldOf(eventId)).get(`${prefix} Golfer 2`));
    await db.contestEntryPick.create({ data: { entryId: entry.id, sportEventParticipantId: picked.id, contestFormat: 'ROSTER', slot: 1 } });

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
