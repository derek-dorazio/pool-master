import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listEventParticipants, listEvents, listSportLeagues } from '@poolmaster/shared/generated/hey-api';
import { RaceResultStatus, Sport } from '@poolmaster/shared/domain';
import { LoadAction, LoadMode } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { parseSportDataFile, type SportDataFile } from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { buildRegisteredUser, promoteToRootAdmin } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';

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
    const series = { eventSeries: { sportLeagueId: { in: leagueIds } } };
    const where = { sportEvent: series };
    await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipant: where } });
    await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipant: where } });
    await db.sportEventParticipant.deleteMany({ where });
    await db.sportEventRound.deleteMany({ where });
    await db.sportEventTier.deleteMany({ where });
    await db.sportEvent.deleteMany({ where: series });
    await db.eventSeries.deleteMany({ where: { sportLeagueId: { in: leagueIds } } });
  }
  const participantIds = (await db.participant.findMany({ where: { externalId: { startsWith: RUN } }, select: { id: true } })).map((row) => row.id);
  await db.participantLeagueAffiliation.deleteMany({ where: { participantId: { in: participantIds } } });
  await db.participant.deleteMany({ where: { id: { in: participantIds } } });
  if (leagueIds.length) await db.sportLeague.deleteMany({ where: { id: { in: leagueIds } } });
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

/** The seed with its sport league and horses tagged with this run, so they never meet another suite's. */
function taggedSeed(): SportDataFile {
  const file = parseSportDataFile(JSON.parse(readFileSync(join(SEED_DIR, 'horse-racing-2026-test.json'), 'utf8')) as unknown, { allowTestData: true });
  const leagueName = `US Thoroughbred ${RUN}`;
  file.scope.sportLeagues = [leagueName];
  const [league] = file.sportLeagues;
  league.name = leagueName;
  for (const player of league.players) player.key = `${RUN}-${player.key}`;
  for (const event of league.events) for (const entry of event.field) entry.player = `${RUN}-${entry.player}`;
  return file;
}

describe('SDK Functional: racing test seed', () => {
  it('loads the 2026 Triple Crown as run, each race released with its official finishing order, and a second run changes nothing', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Racing Secretary' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const file = taggedSeed();

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
    expect(field.filter((row) => row.race?.resultStatus === RaceResultStatus.DID_NOT_START)).toHaveLength(6);
    const winner = expectDefined(field.find((row) => row.race?.finishPosition === 1));
    expect([winner.participant.name, winner.race?.startPosition, winner.race?.riderName]).toEqual(['Golden Tempo', 19, 'José Ortiz']);

    const again = await loadSportData(file, { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.DRY_RUN });
    expect(again.filter((row) => row.action !== LoadAction.SKIP)).toEqual([]);
  });
});
