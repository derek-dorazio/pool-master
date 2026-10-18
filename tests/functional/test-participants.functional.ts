import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLeagueByCode, getVersion, listContestEntries, listContests, listLeagueMembers, listSportLeagues, loginUser } from '@poolmaster/shared/generated/hey-api';
import { ContestEntryStatus, ContestStatus, Sport } from '@poolmaster/shared/domain';
import { LoadAction, LoadMode, LoadSubject } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { parseSportDataFile, type SportDataFile } from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { CONTESTS_PER_SPORT_LEAGUE, loadTestParticipants, type TestPlayer } from '../../packages/core-api/scripts/seed-golf/test-participants';
import { refuseUnlessTestTarget, testLeagueCode } from '../../packages/core-api/scripts/seed-golf/test-participants-data';
import { buildRegisteredUser, promoteToRootAdmin } from './builders';
import { cleanupFunctionalData, createAuthenticatedClient, createFunctionalEmail, disconnectFunctionalPrisma, getFunctionalPrisma, getSdkClient } from './setup';
import { expectDefined } from '../support/expect-defined';

// The pool side of a test seed over HTTP: test players join a test league for the seed's sport
// league, each upcoming race gets an open contest, and every player's squad submits an entry;
// a second run finds it all in place.

const RUN = `test-participants-${Date.now()}`;
const SEED_DIR = join(__dirname, '../../packages/core-api/scripts/seed-golf');
const PASSWORD = 'FuncTest123!';

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
  await db.participantLeagueAffiliation.deleteMany({ where: { OR: [{ participantId: { in: participantIds } }, { sportLeagueId: { in: leagueIds } }] } });
  await db.participant.deleteMany({ where: { id: { in: participantIds } } });
  if (leagueIds.length) await db.sportLeague.deleteMany({ where: { id: { in: leagueIds } } });
}

afterAll(async () => {
  // The test players and the admin carry functional addresses, so their league and its contests go first.
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

/** The racing seed with its sport league and horses tagged with this run, so they never meet another suite's. */
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

function testPlayers(): TestPlayer[] {
  return ['Avery', 'Blake'].map((firstName) => ({
    username: `${RUN}-${firstName.toLowerCase()}`,
    email: createFunctionalEmail(`test-player-${firstName.toLowerCase()}`),
    firstName,
    lastName: 'Tester',
  }));
}

async function signIn(identifier: string, password: string) {
  const login = expectDefined((await loginUser({ client: getSdkClient(), body: { identifier, password } })).data);
  return createAuthenticatedClient(login.tokens.accessToken);
}

describe('SDK Functional: test participants', () => {
  it('only a QA or local site takes test participants; staging and prod are refused', async () => {
    const environment = expectDefined((await getVersion({ client: getSdkClient() })).data).environment;
    expect(() => refuseUnlessTestTarget(environment, 'Loading test participants')).not.toThrow();
    expect(() => refuseUnlessTestTarget('prod', 'Loading test participants')).toThrow('Loading test participants is for QA only, and this site is prod.');
  });

  it('puts every test player in a test league with a submitted entry in each upcoming race, and a second run changes nothing', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Pool Steward' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const file = taggedSeed();
    const players = testPlayers();
    const getClient = () => Promise.resolve(a);
    await loadSportData(file, { getClient, now: new Date(), mode: LoadMode.APPLY });
    const sportLeague = expectDefined(expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.HORSE_RACING } })).data).sportLeagues
      .find((league) => league.name === file.sportLeagues[0].name));
    created.sportLeagueIds.add(sportLeague.id);

    const options = { getClient, signIn, players, password: PASSWORD };
    const dryRun = await loadTestParticipants(file, { ...options, mode: LoadMode.DRY_RUN });
    expect(dryRun.filter((row) => row.subject === LoadSubject.TEST_PLAYER).map((row) => row.action)).toEqual([LoadAction.ADD, LoadAction.ADD]);
    expect(dryRun.filter((row) => row.subject === LoadSubject.ENTRY)).toHaveLength(3 * players.length);
    expect(dryRun.every((row) => row.action === LoadAction.ADD)).toBe(true);

    await loadTestParticipants(file, { ...options, mode: LoadMode.APPLY });

    const league = expectDefined((await getLeagueByCode({ client: a, path: { leagueCode: testLeagueCode(sportLeague.name) } })).data).league;
    expect(league.name).toBe(`${sportLeague.name} test pool`);
    const members = expectDefined((await listLeagueMembers({ client: a, path: { id: league.id } })).data).members;
    expect(members.map((member) => member.user.username).sort()).toEqual([admin.username, ...players.map((player) => player.username)].sort());

    // The seed's three races are all upcoming, so each gets a contest, up to the cap.
    const contests = expectDefined((await listContests({ client: a, path: { id: league.id } })).data).contests;
    expect(contests).toHaveLength(Math.min(3, CONTESTS_PER_SPORT_LEAGUE));
    expect(contests.every((contest) => contest.status === ContestStatus.OPEN)).toBe(true);
    for (const contest of contests) {
      const { entries } = expectDefined((await listContestEntries({ client: a, path: { contestId: contest.id } })).data);
      expect(entries).toHaveLength(players.length);
      expect(entries.every((entry) => entry.events.every((entryEvent) => entryEvent.status === ContestEntryStatus.SUBMITTED) && entry.picksCount > 0)).toBe(true);
    }

    const again = await loadTestParticipants(file, { ...options, mode: LoadMode.APPLY });
    expect(again.filter((row) => row.action !== LoadAction.SKIP)).toEqual([]);
  });
});
