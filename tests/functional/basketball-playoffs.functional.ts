import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acceptInvitation,
  createContest,
  enterContest,
  generateInviteLink,
  getContest,
  getContestLeaderboard,
  getEventBracket,
  listContestConfigTemplates,
  listEventParticipants,
  listEvents,
  listSportLeagues,
  openContest,
  submitContestEntry,
  submitContestSelection,
  transitionEvent,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, ContestStatus, SelectionType, Sport } from '@poolmaster/shared/domain';
import { LoadAction, LoadMode } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { parseSportDataFile, type SportDataFile } from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin, type RegisteredUserContext } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';

// The NBA and WNBA playoffs end to end over HTTP (#706): each test seed loads into its seeded sport
// league, played out series by series. The NBA's play-in places take their winners after release,
// before any result. A commissioner runs a contest from the NBA's default template (one team from
// each of four tiers, round values doubling 1, 2, 4, 8), a member picks a lineup that includes a
// filled play-in place, and the settled contest scores each team for the series it won.

const RUN = `nba-${Date.now()}`;
const SEED_DIR = join(__dirname, '../../packages/core-api/scripts/seed-golf');

const created = { sportEventIds: new Set<string>() };

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  if (eventIds.length) {
    const seriesIds = (await db.sportEvent.findMany({ where: { id: { in: eventIds } }, select: { eventSeriesId: true } }))
      .map((event) => event.eventSeriesId);
    await db.contestEntryPick.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventMatch.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
    await db.eventSeries.deleteMany({ where: { id: { in: seriesIds } } });
  }
  const participantIds = (await db.participant.findMany({ where: { externalId: { startsWith: RUN } }, select: { id: true } })).map((row) => row.id);
  await db.participantLeagueAffiliation.deleteMany({ where: { participantId: { in: participantIds } } });
  await db.participant.deleteMany({ where: { id: { in: participantIds } } });
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

/** The test seed, its teams and events tagged with this run so they never meet another suite's. */
function taggedSeed(fileName: string, eventName: (leagueName: string) => string): SportDataFile {
  const file = parseSportDataFile(JSON.parse(readFileSync(join(SEED_DIR, fileName), 'utf8')) as unknown, { allowTestData: true });
  const tagged = (key: string | null) => (key === null ? null : `${RUN}-${key}`);
  for (const league of file.sportLeagues) {
    const [playoffs] = league.events;
    playoffs.name = eventName(league.name);
    for (const player of league.players) player.key = expectDefined(tagged(player.key));
    for (const entry of playoffs.field) {
      entry.player = expectDefined(tagged(entry.player));
      if (entry.playInWinner !== undefined) entry.playInWinner = expectDefined(tagged(entry.playInWinner));
    }
    for (const match of playoffs.matches ?? []) Object.assign(match, { home: tagged(match.home), away: tagged(match.away) });
  }
  return file;
}

/** Loads a seed dated from today (release refuses an event that has started). */
async function loadSeed(admin: RegisteredUserContext, file: SportDataFile): Promise<void> {
  await loadSportData(file, { getClient: () => Promise.resolve(admin.client), now: new Date(), mode: LoadMode.APPLY });
}

/** One of a loaded seed's sport leagues and its event. */
async function findPlayoffs(admin: RegisteredUserContext, file: SportDataFile, leagueIndex = 0) {
  const leagueName = file.sportLeagues[leagueIndex].name;
  const sportLeague = expectDefined(expectDefined((await listSportLeagues({ client: admin.client, query: { sport: Sport.BASKETBALL } })).data).sportLeagues
    .find((league) => league.name === leagueName), leagueName);
  const eventName = file.sportLeagues[leagueIndex].events[0].name;
  const event = expectDefined(expectDefined((await listEvents({ client: admin.client, query: { sportLeagueId: sportLeague.id } })).data).events
    .find((row) => row.name === eventName), eventName);
  created.sportEventIds.add(event.id);
  return { sportLeague, event };
}

async function loadPlayoffs(admin: RegisteredUserContext, file: SportDataFile) {
  await loadSeed(admin, file);
  return findPlayoffs(admin, file);
}

describe('SDK Functional: NBA and WNBA playoffs', () => {
  beforeAll(async () => {
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await getFunctionalPrisma().sport.upsert({
      where: { sport: Sport.BASKETBALL },
      create: { sport: Sport.BASKETBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
      update: {},
    });
  });

  it('loads the played NBA playoffs with each play-in place naming its winner, then scores and settles an entry from the NBA\'s default tiered template by series won', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Playoff Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;

    const file = taggedSeed('basketball-2025-nba-playoffs-test.json', () => `NBA Playoffs ${RUN}`);
    const { sportLeague: nba, event } = await loadPlayoffs(admin, file);
    expect(nba.roundNames).toEqual(['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals']);
    expect([event.status, event.rounds]).toEqual(['SCHEDULED', 4]);

    // Each play-in place now names the team that won it, keeping its seed, and is no longer a place.
    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId: event.id } })).data).participants;
    expect(field.some((row) => row.isPlayInPlace)).toBe(false);
    expect(field.filter((row) => (row.seedNumber ?? 0) >= 7).map((row) => [row.participant.name, row.seedNumber]).sort((left, right) => String(left[0]).localeCompare(String(right[0])))).toEqual([
      ['Golden State Warriors', 7], ['Memphis Grizzlies', 8], ['Miami Heat', 8], ['Orlando Magic', 7],
    ]);
    const rowOf = (team: string) => expectDefined(field.find((row) => row.participant.name === team), team).id;
    const bracket = expectDefined((await getEventBracket({ client: a, path: { eventId: event.id } })).data).matches;
    const final = expectDefined(bracket.find((match) => match.roundNumber === 4));
    expect([final.homeSportEventParticipantId, final.winnerSide, final.homeScore, final.awayScore]).toEqual([rowOf('Oklahoma City Thunder'), 'HOME', 4, 3]);

    // Loading the same file again changes nothing, the filled play-in places included.
    const again = await loadSportData(file, { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.DRY_RUN });
    expect(again.filter((row) => row.action !== LoadAction.SKIP)).toEqual([]);

    // --- A contest from the NBA's default template ----------------------------------------------
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Playoff Commissioner', leagueName: `Hardwood ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Playoff Member' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });

    const templates = expectDefined((await listContestConfigTemplates({
      client: commissioner.client,
      query: { sport: Sport.BASKETBALL, sportLeagueId: nba.id, contestFormat: ContestFormat.ROSTER, active: true },
    })).data).templates;
    const tiered = expectDefined(templates.find((template) => template.isDefault), 'the NBA default');
    expect(tiered.templateKey).toBe('nba-tiered-doubling');

    const contest = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: { name: `Playoff Pool ${RUN}`, sportEventIds: [event.id], contestFormat: ContestFormat.ROSTER, selectionType: SelectionType.TIERED, templateId: tiered.id },
    });
    expect(contest.response.status).toBe(201);
    const contestId = expectDefined(contest.data).contest.id;
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

    // One team from each tier of four, by odds; the last tier is the four play-in places.
    const lineup = ['Oklahoma City Thunder', 'Indiana Pacers', 'Minnesota Timberwolves', 'Golden State Warriors'];
    const entryId = expectDefined((await enterContest({ client: member.client, path: { contestId } })).data).entry.id;
    for (const team of lineup) {
      expect((await submitContestSelection({ client: member.client, path: { contestId }, body: { entryId, participantId: rowOf(team) } })).response.status).toBe(200);
    }
    expect((await submitContestEntry({ client: member.client, path: { contestId, entryId, sportEventId: event.id } })).response.status).toBe(200);

    // --- Tip-off, then settled ----------------------------------------------------------------------
    expect((await transitionEvent({ client: a, path: { eventId: event.id }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    const board = expectDefined((await getContestLeaderboard({ client: member.client, path: { contestId } })).data);
    const points = Object.fromEntries(board.entries.flatMap((entry) => entry.picks)
      .map((pick) => [expectDefined(field.find((row) => row.id === pick.sportEventParticipantId)).participant.name, pick.knockout?.points]));
    // The Thunder win every series, 1 + 2 + 4 + 8; the Pacers lose the Finals, 1 + 2 + 4; the
    // Timberwolves lose the Conference Finals, 1 + 2; the Warriors, a play-in 7 seed, win one series.
    expect(points).toEqual({
      'Oklahoma City Thunder': 15,
      'Indiana Pacers': 7,
      'Minnesota Timberwolves': 3,
      'Golden State Warriors': 1,
    });

    expect((await transitionEvent({ client: a, path: { eventId: event.id }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    const settled = await getFunctionalPrisma().contestEntryStanding.findUniqueOrThrow({ where: { contestEntryId: entryId } });
    expect([settled.totalScore, settled.displayPosition]).toEqual([26, '1']);
  });

  it('loads the played WNBA playoffs as three rounds named by the WNBA, Las Vegas sweeping Phoenix in the Finals', async () => {
    const admin = await buildRegisteredUser({ displayName: 'WNBA Director' });
    await promoteToRootAdmin(admin);

    const { sportLeague: wnba, event } = await loadPlayoffs(admin, taggedSeed('basketball-2025-wnba-playoffs-test.json', () => `WNBA Playoffs ${RUN}`));

    expect(wnba.roundNames).toEqual(['First Round', 'Semifinals', 'WNBA Finals']);
    expect([event.status, event.rounds]).toEqual(['SCHEDULED', 3]);
    const field = expectDefined((await listEventParticipants({ client: admin.client, path: { eventId: event.id } })).data).participants;
    const bracket = expectDefined((await getEventBracket({ client: admin.client, path: { eventId: event.id } })).data).matches;
    const final = expectDefined(bracket.find((match) => match.roundNumber === 3));
    const winnerRowId = final.winnerSide === 'HOME' ? final.homeSportEventParticipantId : final.awaySportEventParticipantId;
    const winner = expectDefined(field.find((row) => row.id === winnerRowId));
    expect([winner.participant.name, final.homeScore, final.awayScore]).toEqual(['Las Vegas Aces', 4, 0]);
    expect(bracket.every((match) => match.status === 'COMPLETED')).toBe(true);
  });

  it('loads the played 2026 men\'s and women\'s March Madness, each First Four place taking its winner, with Michigan and UCLA the champions', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Tournament Director' });
    await promoteToRootAdmin(admin);
    const file = taggedSeed('basketball-2026-ncaa-tournaments-test.json', (leagueName) => `${leagueName} Tournament ${RUN}`);
    await loadSeed(admin, file);

    for (const [leagueIndex, champion, runnerUp, firstFourWinners] of [
      [0, 'Michigan Wolverines', 'UConn Huskies', ['Howard Bison', 'Miami (OH) RedHawks', 'Prairie View A&M Panthers', 'Texas Longhorns']],
      [1, 'UCLA Bruins', 'South Carolina Gamecocks', ['Missouri State Lady Bears', 'Nebraska Cornhuskers', 'Southern Jaguars', 'Virginia Cavaliers']],
    ] as const) {
      const { event } = await findPlayoffs(admin, file, leagueIndex);
      expect([event.status, event.rounds]).toEqual(['SCHEDULED', 6]);
      const field = expectDefined((await listEventParticipants({ client: admin.client, path: { eventId: event.id } })).data).participants;
      expect(field).toHaveLength(64);
      expect(field.some((row) => row.isPlayInPlace)).toBe(false);
      const names = new Set(field.map((row) => row.participant.name));
      expect(firstFourWinners.filter((team) => names.has(team))).toEqual(firstFourWinners);

      const bracket = expectDefined((await getEventBracket({ client: admin.client, path: { eventId: event.id } })).data).matches;
      expect(bracket).toHaveLength(63);
      expect(bracket.every((match) => match.status === 'COMPLETED')).toBe(true);
      const final = expectDefined(bracket.find((match) => match.roundNumber === 6));
      const nameOf = (rowId: string | null) => expectDefined(field.find((row) => row.id === rowId)).participant.name;
      const [winnerRow, loserRow] = final.winnerSide === 'HOME'
        ? [final.homeSportEventParticipantId, final.awaySportEventParticipantId]
        : [final.awaySportEventParticipantId, final.homeSportEventParticipantId];
      expect([nameOf(winnerRow), nameOf(loserRow)]).toEqual([champion, runnerUp]);
    }

    const again = await loadSportData(file, { getClient: () => Promise.resolve(admin.client), now: new Date(), mode: LoadMode.DRY_RUN });
    expect(again.filter((row) => row.action !== LoadAction.SKIP)).toEqual([]);
  });
});
