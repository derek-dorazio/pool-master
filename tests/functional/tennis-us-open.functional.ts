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

// The 2026 US Open men's and women's singles end to end over HTTP (#704): the test seed loads each
// 128-player draw into the ATP and the WTA, its qualifier places taking their qualifiers after
// release, and plays every match out, the two men's retirements included. A commissioner runs a
// contest from the ATP's default template (one player from each of six tiers, round values
// doubling from 1 to 64), and the settled contest scores each player for the matches they won,
// a retirement a full win for the player who went through.

const RUN = `tennis-${Date.now()}`;
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

/** The test seed, its players and events tagged with this run so they never meet another suite's. */
function taggedSeed(fileName: string, eventName: (leagueName: string) => string): SportDataFile {
  const file = parseSportDataFile(JSON.parse(readFileSync(join(SEED_DIR, fileName), 'utf8')) as unknown, { allowTestData: true });
  const tagged = (key: string | null) => (key === null ? null : `${RUN}-${key}`);
  for (const league of file.sportLeagues) {
    const [draw] = league.events;
    draw.name = eventName(league.name);
    for (const player of league.players) player.key = expectDefined(tagged(player.key));
    for (const entry of draw.field) {
      entry.player = expectDefined(tagged(entry.player));
      if (entry.playInWinner !== undefined) entry.playInWinner = expectDefined(tagged(entry.playInWinner));
    }
    for (const match of draw.matches ?? []) Object.assign(match, { home: tagged(match.home), away: tagged(match.away) });
  }
  return file;
}

/** Loads a seed dated from today (release refuses an event that has started). */
async function loadSeed(admin: RegisteredUserContext, file: SportDataFile): Promise<void> {
  await loadSportData(file, { getClient: () => Promise.resolve(admin.client), now: new Date(), mode: LoadMode.APPLY });
}

/** One of a loaded seed's sport leagues and its event. */
async function findDraw(admin: RegisteredUserContext, file: SportDataFile, leagueIndex = 0) {
  const leagueName = file.sportLeagues[leagueIndex].name;
  const sportLeague = expectDefined(expectDefined((await listSportLeagues({ client: admin.client, query: { sport: Sport.TENNIS } })).data).sportLeagues
    .find((league) => league.name === leagueName), leagueName);
  const eventName = file.sportLeagues[leagueIndex].events[0].name;
  const event = expectDefined(expectDefined((await listEvents({ client: admin.client, query: { sportLeagueId: sportLeague.id } })).data).events
    .find((row) => row.name === eventName), eventName);
  created.sportEventIds.add(event.id);
  return { sportLeague, event };
}

describe('SDK Functional: the 2026 US Open singles draws', () => {
  beforeAll(async () => {
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await getFunctionalPrisma().sport.upsert({
      where: { sport: Sport.TENNIS },
      create: { sport: Sport.TENNIS, participantType: 'INDIVIDUAL', tournamentFormat: 'MATCHES' },
      update: {},
    });
  });

  it('loads both draws as seven rounds, the 32 seeds seeded and everyone else unseeded, each qualifier place filled, every match played, Zverev and Rybakina the champions', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Tennis Director' });
    await promoteToRootAdmin(admin);
    const file = taggedSeed('tennis-2026-us-open-test.json', (leagueName) => `US Open ${leagueName} ${RUN}`);
    await loadSeed(admin, file);

    // The men's draw has 31 seeds: Ruud, the 19th, withdrew and a lucky loser took his place.
    for (const [leagueIndex, champion, runnerUp, finalScore, seeded] of [
      [0, 'Alexander Zverev', 'Ben Shelton', [3, 1], 31],
      [1, 'Elena Rybakina', 'Aryna Sabalenka', [2, 1], 32],
    ] as const) {
      const { event } = await findDraw(admin, file, leagueIndex);
      expect([event.status, event.rounds]).toEqual(['SCHEDULED', 7]);
      const field = expectDefined((await listEventParticipants({ client: admin.client, path: { eventId: event.id } })).data).participants;
      expect(field).toHaveLength(128);
      expect(field.some((row) => row.isPlayInPlace)).toBe(false);
      expect(field.filter((row) => row.seedNumber !== null)).toHaveLength(seeded);
      expect(field.filter((row) => row.seedNumber === null)).toHaveLength(128 - seeded);

      const bracket = expectDefined((await getEventBracket({ client: admin.client, path: { eventId: event.id } })).data).matches;
      expect(bracket).toHaveLength(127);
      expect(bracket.every((match) => match.status === 'COMPLETED')).toBe(true);
      // Each quarter of the draw is a region through the quarterfinals; the semifinals and final carry none.
      expect([...new Set(bracket.filter((match) => match.roundNumber <= 5).map((match) => match.regionLabel))])
        .toEqual(['Top quarter', 'Second quarter', 'Third quarter', 'Bottom quarter']);
      expect(bracket.filter((match) => match.roundNumber > 5).map((match) => match.regionLabel)).toEqual([null, null, null]);
      const final = expectDefined(bracket.find((match) => match.roundNumber === 7));
      const nameOf = (rowId: string | null) => expectDefined(field.find((row) => row.id === rowId)).participant.name;
      const [winnerRow, loserRow, winnerSets, loserSets] = final.winnerSide === 'HOME'
        ? [final.homeSportEventParticipantId, final.awaySportEventParticipantId, final.homeScore, final.awayScore]
        : [final.awaySportEventParticipantId, final.homeSportEventParticipantId, final.awayScore, final.homeScore];
      expect([nameOf(winnerRow), nameOf(loserRow), winnerSets, loserSets]).toEqual([champion, runnerUp, ...finalScore]);
    }

    // The men's two retirements keep the sets finished and how the match ended.
    const { event: atp } = await findDraw(admin, file, 0);
    const atpBracket = expectDefined((await getEventBracket({ client: admin.client, path: { eventId: atp.id } })).data).matches;
    expect(atpBracket.filter((match) => match.ending !== 'PLAYED').map((match) => [match.roundNumber, match.ending, match.homeScore, match.awayScore]))
      .toEqual([[1, 'RETIREMENT', 2, 0], [5, 'RETIREMENT', 2, 0]]);

    const again = await loadSportData(file, { getClient: () => Promise.resolve(admin.client), now: new Date(), mode: LoadMode.DRY_RUN });
    expect(again.filter((row) => row.action !== LoadAction.SKIP)).toEqual([]);
  });

  it('scores and settles an entry from the ATP\'s default tiered template by matches won, a retirement a full win for the player who went through', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Tennis Settler' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const file = taggedSeed('tennis-2026-us-open-test.json', (leagueName) => `US Open ${leagueName} settled ${RUN}`);
    file.sportLeagues.splice(1, 1);
    await loadSeed(admin, file);
    const { sportLeague: atp, event } = await findDraw(admin, file);
    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId: event.id } })).data).participants;
    const rowOf = (player: string) => expectDefined(field.find((row) => row.participant.name === player), player).id;

    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Tennis Commissioner', leagueName: `Baseline ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Tennis Member' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });

    const templates = expectDefined((await listContestConfigTemplates({
      client: commissioner.client,
      query: { sport: Sport.TENNIS, sportLeagueId: atp.id, active: true },
    })).data).templates
      .filter((template) => template.contestFormat === ContestFormat.ROSTER);
    const tiered = expectDefined(templates.find((template) => template.isDefault), 'the ATP default');
    expect(tiered.templateKey).toBe('atp-tiered-doubling');

    const contest = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: { name: `Slam Pool ${RUN}`, sportEventIds: [event.id], contestFormat: ContestFormat.ROSTER, selectionType: SelectionType.TIERED, templateId: tiered.id },
    });
    expect(contest.response.status).toBe(201);
    const contestId = expectDefined(contest.data).contest.id;
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

    // One player from each tier of eight, by odds: seeds 1-8, 9-16, 17-25 (Ruud's 19 missing),
    // 26-32 with the best-ranked unseeded player, then the unseeded players by ranking.
    const lineup = ['Alexander Zverev', 'Frances Tiafoe', 'Luciano Darderi', 'Alexander Blockx', 'Botic van de Zandschulp', 'Dane Sweeny'];
    const entryId = expectDefined((await enterContest({ client: member.client, path: { contestId } })).data).entry.id;
    for (const player of lineup) {
      expect((await submitContestSelection({ client: member.client, path: { contestId }, body: { entryId, participantId: rowOf(player) } })).response.status).toBe(200);
    }
    expect((await submitContestEntry({ client: member.client, path: { contestId, entryId, sportEventId: event.id } })).response.status).toBe(200);

    expect((await transitionEvent({ client: a, path: { eventId: event.id }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    const board = expectDefined((await getContestLeaderboard({ client: member.client, path: { contestId } })).data);
    const points = Object.fromEntries(board.entries.flatMap((entry) => entry.picks)
      .map((pick) => [expectDefined(field.find((row) => row.id === pick.sportEventParticipantId)).participant.name, pick.knockout?.points]));
    // Zverev wins all seven rounds, 1 + 2 + ... + 64; Tiafoe loses the semifinal; Blockx retires
    // in the quarterfinal, so his four wins count and the retirement is a loss; Sweeny's first-round
    // win over Moutet, who retired, counts in full.
    expect(points).toEqual({
      'Alexander Zverev': 127,
      'Frances Tiafoe': 31,
      'Luciano Darderi': 7,
      'Alexander Blockx': 15,
      'Botic van de Zandschulp': 15,
      'Dane Sweeny': 3,
    });

    expect((await transitionEvent({ client: a, path: { eventId: event.id }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    const settled = await getFunctionalPrisma().contestEntryStanding.findUniqueOrThrow({ where: { contestEntryId: entryId } });
    expect([settled.totalScore, settled.displayPosition]).toEqual([198, '1']);
  });
});
