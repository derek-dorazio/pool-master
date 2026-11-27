import { deleteTestSportLeagues, TEST_DEFINITION_KEY } from '../support/test-slots';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listEventParticipants, listEvents, listSportLeagues } from '@poolmaster/shared/generated/hey-api';
import { GameSideStatus, Sport } from '@poolmaster/shared/domain';
import { LoadAction, LoadMode } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { parseSportDataFile, type SportDataFile } from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { addRunSportLeague, buildRegisteredUser, promoteToRootAdmin } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { oneEventOf } from '../support/sport-test-seed';

// A racing test seed end to end over HTTP (#705): the 2026 Triple Crown as run loads into its own
// sport league, each race released and its real finishing order entered as the official result,
// the horses that did not start among it.

const RUN = `racing-seed-${Date.now()}`;
const SEED_DIR = join(__dirname, '../../packages/core-api/scripts/seed-golf');

const created = { sportLeagueIds: new Set<string>() };

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const leagueIds = [...created.sportLeagueIds];
  if (leagueIds.length) {
    const series = { sportLeagueId: { in: leagueIds } };
    const where = { sportEvent: series };
    await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipant: where } });
    await db.sportEventSlotParticipantValuation.deleteMany({ where: { sportEventParticipant: where } });
    // A race is a FIELD match in its event (#2008); its sides hold the field rows.
    await db.sportEventRoundMatch.deleteMany({ where });
    await db.sportEventParticipant.deleteMany({ where });
    await db.sportEventRound.deleteMany({ where });
    await db.sportEventSlotTier.deleteMany({ where: { slot: where } });
    await db.sportEvent.deleteMany({ where: series });
  }
  // The run's players: every participant of the run's own leagues (the loader finds a player by name, #2040).
  if (leagueIds.length) await db.participant.deleteMany({ where: { sportLeagueId: { in: leagueIds } } });
  if (leagueIds.length) await deleteTestSportLeagues(db, leagueIds);
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

/** The seed with its sport league and horses tagged with this run, so they never meet another suite's. */
function taggedSeed(): SportDataFile {
  const file = parseSportDataFile(JSON.parse(readFileSync(join(SEED_DIR, 'horse-racing-2026-test.json'), 'utf8')) as unknown);
  const leagueName = `US Thoroughbred ${RUN}`;
  file.scope.sportLeagues = [leagueName];
  const [league] = file.sportLeagues;
  league.name = leagueName;
  for (const player of league.players) player.key = `${RUN}-${player.key}`;
  for (const event of league.events) for (const entry of event.field) entry.player = `${RUN}-${entry.player}`;
  // A league a test adds plays one test definition (TEST_EVENT), not the file's slot keys.
  for (const event of league.events) event.slotKey = TEST_DEFINITION_KEY;
  return file;
}

describe('SDK Functional: racing test seed', () => {
  it('loads the 2026 Triple Crown as run, each race released with its official finishing order, and a second run changes nothing', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Racing Secretary' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const file = taggedSeed();

    created.sportLeagueIds.add(await addRunSportLeague(Sport.HORSE_RACING, file.sportLeagues[0].name));
    // Dated from today: release refuses a race that has started.
    await loadSportData(file, { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.APPLY });

    const sportLeague = expectDefined(expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.HORSE_RACING } })).data).sportLeagues
      .find((league) => league.name === file.sportLeagues[0].name));
    created.sportLeagueIds.add(sportLeague.id);
    const events = expectDefined((await listEvents({ client: a, query: { sportLeagueId: sportLeague.id } })).data).events;
    expect(events.map((event) => [event.name, event.status]).sort((left, right) => left[0].localeCompare(right[0]))).toEqual([
      ['Belmont Stakes', 'SCHEDULED'], ['Kentucky Derby', 'SCHEDULED'], ['Preakness Stakes', 'SCHEDULED'],
    ]);

    const derby = expectDefined(events.find((event) => event.name === 'Kentucky Derby'));
    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId: derby.id } })).data).participants;
    expect(field).toHaveLength(24);
    expect(field.every((row) => row.race?.isOfficial === true)).toBe(true);
    expect(field.filter((row) => row.race?.resultStatus === GameSideStatus.DID_NOT_START)).toHaveLength(6);
    const winner = expectDefined(field.find((row) => row.race?.finishPosition === 1));
    expect([winner.participant.name, winner.race?.startPosition]).toEqual(['Golden Tempo', 19]);

    const again = await loadSportData(file, { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.DRY_RUN });
    expect(again.filter((row) => row.action !== LoadAction.SKIP)).toEqual([]);
  });

  it('loads last season\'s Australian Grand Prix as run onto a Formula 1 test slot, the race released with its official finishing order, its retirements and its non-starters', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Race Steward' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const file = oneEventOf('auto-racing-2026-test.json', 'Formula 1', 'Australian Grand Prix')(RUN, 2026);
    const [league] = file.sportLeagues;
    league.name = `Formula 1 ${RUN}`;
    file.scope.sportLeagues = [league.name];
    // A league a test adds plays one test definition (TEST_EVENT), not the file's Grand Prix keys.
    for (const event of league.events) event.slotKey = TEST_DEFINITION_KEY;
    created.sportLeagueIds.add(await addRunSportLeague(Sport.AUTO_RACING, league.name));

    await loadSportData(file, { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.APPLY });

    const sportLeague = expectDefined(expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.AUTO_RACING } })).data).sportLeagues
      .find((row) => row.name === league.name));
    const [race] = expectDefined((await listEvents({ client: a, query: { sportLeagueId: sportLeague.id } })).data).events;
    expect([race.name, race.status]).toEqual([`Australian Grand Prix ${RUN}`, 'SCHEDULED']);
    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId: race.id } })).data).participants;
    expect(field).toHaveLength(22);
    expect(field.every((row) => row.race?.isOfficial === true)).toBe(true);
    const podium = [1, 2, 3].map((place) => expectDefined(field.find((row) => row.race?.finishPosition === place)).participant.name);
    expect(podium).toEqual(['George Russell', 'Kimi Antonelli', 'Charles Leclerc']);
    expect(field.filter((row) => row.race?.resultStatus === GameSideStatus.DID_NOT_FINISH)).toHaveLength(4);
    expect(field.filter((row) => row.race?.resultStatus === GameSideStatus.DID_NOT_START)).toHaveLength(2);
  });
});
