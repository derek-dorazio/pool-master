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
  listEventRounds,
  listEvents,
  listSportLeagues,
  openContest,
  submitContestEntry,
  selectContestPick,
  transitionEvent,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, ContestStatus, SelectionType, Sport } from '@poolmaster/shared/domain';
import { LoadAction, LoadMode } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { parseSportDataFile, type SportDataFile } from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin, type RegisteredUserContext } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { EVERY_GAME_PLAYED } from '../support/sport-test-seed';
import { sportRowKeys } from '../support/sport-rows';
import { withHomeAwayRead } from '../support/match-requests';

// The College Football Playoff end to end over HTTP (#707): the 2025-26 test seed loads into the
// seeded sport league, its event starting with the league's six tiers, and is played out game by
// game, the top four seeds coming in on byes. A commissioner runs a contest from the league's
// default template (one team from each of six tiers, round values doubling 1, 2, 4, 8), a member
// picks a lineup that includes a seed on a bye, and the settled contest scores each team for the
// games it won, a bye counting as a win.

const RUN = `cfp-${Date.now()}`;
const SEED_DIR = join(__dirname, '../../packages/core-api/scripts/seed-golf');

const created = { sportEventIds: new Set<string>() };

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  // The run's players, read before its fields go (the loader finds a player by name, #2040).
  const runParticipantIds = (await db.sportEventParticipant.findMany({ where: { sportEventId: { in: eventIds } }, select: { participantId: true } }))
    .map((row) => row.participantId);
  if (eventIds.length) {
    await db.contestEntryPick.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventRoundMatch.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventSlotParticipantValuation.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventSlotTier.deleteMany({ where: { slot: { sportEventId: { in: eventIds } } } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
  }
  // Only those no other event's field still holds.
  await db.participant.deleteMany({ where: { id: { in: runParticipantIds }, sportEventParticipants: { none: {} } } });
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

/** The test seed, its teams and event tagged with this run so they never meet another suite's. */
function taggedSeed(fileName: string, eventName: string): SportDataFile {
  const file = parseSportDataFile(JSON.parse(readFileSync(join(SEED_DIR, fileName), 'utf8')) as unknown);
  const tagged = (key: string | null) => (key === null ? null : `${RUN}-${key}`);
  const [league] = file.sportLeagues;
  const [playoffs] = league.events;
  playoffs.name = eventName;
  for (const player of league.players) player.key = expectDefined(tagged(player.key));
  for (const entry of playoffs.field) entry.player = expectDefined(tagged(entry.player));
  for (const match of playoffs.matches ?? []) match.sides = match.sides.map((side) => ({ ...side, player: tagged(side.player) }));
  return file;
}

/** Loads a seed dated from today (release refuses an event that has started), and finds its event. */
async function loadPlayoffs(admin: RegisteredUserContext, file: SportDataFile) {
  await loadSportData(file, { getClient: () => Promise.resolve(admin.client), now: new Date(), mode: LoadMode.APPLY, resultsThrough: EVERY_GAME_PLAYED });
  const leagueName = file.sportLeagues[0].name;
  const sportLeague = expectDefined(expectDefined((await listSportLeagues({ client: admin.client, query: { sport: Sport.FOOTBALL } })).data).sportLeagues
    .find((league) => league.name === leagueName), leagueName);
  const eventName = file.sportLeagues[0].events[0].name;
  const event = expectDefined(expectDefined((await listEvents({ client: admin.client, query: { sportLeagueId: sportLeague.id } })).data).events
    .find((row) => row.name === eventName), eventName);
  created.sportEventIds.add(event.id);
  return { sportLeague, event };
}

describe('SDK Functional: College Football Playoff', () => {
  beforeAll(async () => {
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await getFunctionalPrisma().sport.upsert({
      where: { sport: Sport.FOOTBALL },
      create: { sport: Sport.FOOTBALL, ...sportRowKeys(Sport.FOOTBALL) },
      update: {},
    });
  });

  it('loads the played 2025-26 playoff on three tiers by seed, 1-4, 5-8 and 9-12, whatever the odds say, with the top four seeds on byes, then scores and settles an entry from the default pick-3 tiered template by games won', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Playoff Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;

    const file = taggedSeed('american-football-2025-cfp-test.json', `College Football Playoff ${RUN}`);
    const { sportLeague: cfp, event } = await loadPlayoffs(admin, file);
    // Each round is played in its CFP slot, the National Championship the FINAL.
    expect(expectDefined((await listEventRounds({ client: a, path: { eventId: event.id } })).data).rounds.map((round) => round.slot.slotKind)).toEqual(['ROUND_OF_16', 'QUARTERFINAL', 'SEMIFINAL', 'FINAL']);
    expect([event.status, event.rounds]).toEqual(['SCHEDULED', 4]);

    // The league's seed-range tiers (#2164): four seeds in each, by seed and not by odds.
    const tiers = await getFunctionalPrisma().sportEventSlotTier.findMany({
      where: { slot: { sportEventId: event.id } },
      orderBy: { tierNumber: 'asc' },
      select: { tierNumber: true, _count: { select: { valuations: true } } },
    });
    expect(tiers.map((tier) => [tier.tierNumber, tier._count.valuations])).toEqual([[1, 4], [2, 4], [3, 4]]);

    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId: event.id } })).data).participants;
    const rowOf = (team: string) => expectDefined(field.find((row) => row.participant.name === team), team).id;
    const bracket = expectDefined((await getEventBracket({ client: a, path: { eventId: event.id } })).data).matches.map(withHomeAwayRead);
    // Each top-four seed waits in a quarterfinal for a first-round winner.
    expect(bracket.filter((match) => match.roundNumber === 2).map((match) => match.homeSportEventParticipantId)).toEqual(
      ['Indiana Hoosiers', 'Texas Tech Red Raiders', 'Georgia Bulldogs', 'Ohio State Buckeyes'].map(rowOf),
    );
    const final = expectDefined(bracket.find((match) => match.roundNumber === 4));
    expect([final.homeSportEventParticipantId, final.awaySportEventParticipantId, final.winnerSide, final.homeScore, final.awayScore])
      .toEqual([rowOf('Indiana Hoosiers'), rowOf('Miami Hurricanes'), 'HOME', 27, 21]);

    // Loading the same file again changes nothing.
    const again = await loadSportData(file, { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.DRY_RUN });
    expect(again.filter((row) => row.action !== LoadAction.SKIP)).toEqual([]);

    // --- A contest from the league's default template ---------------------------------------------
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Playoff Commissioner', leagueName: `Gridiron ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Playoff Member' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });

    const templates = expectDefined((await listContestConfigTemplates({
      client: commissioner.client,
      query: { sportLeagueId: cfp.id, active: true },
    })).data).templates
      .filter((template) => template.contestFormat === ContestFormat.ROSTER);
    const tiered = expectDefined(templates.find((template) => template.isDefault && template.selectionType === SelectionType.TIERED), 'the College Football Playoff tiered default');
    expect(tiered.templateKey).toBe('cfp-tiered-pick-3');

    const contest = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: { name: `Playoff Pool ${RUN}`, sportEventIds: [event.id], contestFormat: ContestFormat.ROSTER, selectionType: SelectionType.TIERED, templateId: tiered.id },
    });
    expect(contest.response?.status).toBe(201);
    const contestId = expectDefined(contest.data).contest.id;
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

    // One team from each tier. Texas Tech, the 4 seed, is in the first tier though Oregon, the 5
    // seed in the second, has the better odds.
    const lineup = ['Texas Tech Red Raiders', 'Oregon Ducks', 'Miami Hurricanes'];
    const entryId = expectDefined((await enterContest({ client: member.client, path: { contestId } })).data).entry.id;
    for (const team of lineup) {
      expect((await selectContestPick({ client: member.client, path: { contestId, entryId, sportEventParticipantId: rowOf(team) } })).response?.status).toBe(200);
    }
    expect((await submitContestEntry({ client: member.client, path: { contestId, entryId, sportEventId: event.id } })).response?.status).toBe(200);

    // --- Kickoff, then settled -----------------------------------------------------------------------
    expect((await transitionEvent({ client: a, path: { eventId: event.id }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    const board = expectDefined((await getContestLeaderboard({ client: member.client, path: { contestId } })).data);
    const points = Object.fromEntries(board.entries.flatMap((entry) => entry.picks)
      .map((pick) => [expectDefined(field.find((row) => row.id === pick.sportEventParticipantId)).participant.name, pick.knockout?.points]));
    // Texas Tech's bye counts as a win, 1, and it loses its quarterfinal; Oregon wins two before
    // losing its semifinal, 1 + 2; Miami loses the final, 1 + 2 + 4.
    expect(points).toEqual({
      'Texas Tech Red Raiders': 1,
      'Oregon Ducks': 3,
      'Miami Hurricanes': 7,
    });

    expect((await transitionEvent({ client: a, path: { eventId: event.id }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    const settled = await getFunctionalPrisma().contestEntryStanding.findUniqueOrThrow({ where: { contestEntryId: entryId } });
    expect([settled.totalScore, settled.displayPosition]).toEqual([11, '1']);
  });
});
