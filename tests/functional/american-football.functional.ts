import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acceptInvitation,
  createContest,
  enterContest,
  generateInviteLink,
  getContest,
  getContestLeaderboard,
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
import { LoadMode } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { parseSportDataFile } from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';

// American football end to end over HTTP (#702): the NFL playoffs test seed loads into the seeded
// NFL sport league, played out, with its Divisional round placed by the reseed. A commissioner
// runs a contest from the NFL's default template (one team from each seed line's tier, round
// values doubling 1, 2, 4, 8), a member picks a lineup, and the settled contest scores each team
// for the games it won; a bye scores nothing.

const RUN = `nfl-${Date.now()}`;
const SEED_FILE = join(__dirname, '../../packages/core-api/scripts/seed-golf/american-football-2026-nfl-playoffs-test.json');

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

describe('SDK Functional: American football', () => {
  it('scores and settles an entry on the played NFL playoffs from the NFL\'s default tiered template, a bye scoring nothing', async () => {
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await getFunctionalPrisma().sport.upsert({
      where: { sport: Sport.AMERICAN_FOOTBALL },
      create: { sport: Sport.AMERICAN_FOOTBALL, participantType: 'TEAM', tournamentFormat: 'KNOCKOUT_BRACKET' },
      update: {},
    });
    const admin = await buildRegisteredUser({ displayName: 'Playoff Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;

    // --- The test seed, its teams and event tagged with this run --------------------------------
    const file = parseSportDataFile(JSON.parse(readFileSync(SEED_FILE, 'utf8')) as unknown, { allowTestData: true });
    const tagged = (key: string | null) => (key === null ? null : `${RUN}-${key}`);
    const [playoffs] = file.sportLeagues[0].events;
    playoffs.name = `NFL Playoffs ${RUN}`;
    for (const player of file.sportLeagues[0].players) player.key = expectDefined(tagged(player.key));
    for (const entry of playoffs.field) entry.player = expectDefined(tagged(entry.player));
    for (const match of playoffs.matches ?? []) Object.assign(match, { home: tagged(match.home), away: tagged(match.away) });
    // Release refuses an event that has started by the server's clock, so the seed is dated from today.
    await loadSportData(file, { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.APPLY });

    const nfl = expectDefined(expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.AMERICAN_FOOTBALL } })).data).sportLeagues
      .find((league) => league.name === 'NFL'));
    const event = expectDefined(expectDefined((await listEvents({ client: a, query: { sportLeagueId: nfl.id, eventYear: 2026 } })).data).events
      .find((row) => row.name === playoffs.name));
    created.sportEventIds.add(event.id);
    expect([event.status, event.rounds]).toEqual(['SCHEDULED', 4]);
    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId: event.id } })).data).participants;
    const rowOf = (team: string) => expectDefined(field.find((row) => row.participant.name === team), team).id;

    // --- A contest from the NFL's default template ----------------------------------------------
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Playoff Commissioner', leagueName: `Gridiron ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Playoff Member' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });

    const templates = expectDefined((await listContestConfigTemplates({
      client: commissioner.client,
      query: { sport: Sport.AMERICAN_FOOTBALL, sportLeagueId: nfl.id, contestFormat: ContestFormat.ROSTER, active: true },
    })).data).templates;
    expect(templates.map((template) => template.templateKey).sort()).toEqual([
      'nfl-budget-doubling', 'nfl-budget-doubling-upset-bonus',
      'nfl-random-draw-doubling', 'nfl-random-draw-doubling-upset-bonus',
      'nfl-tiered-doubling', 'nfl-tiered-doubling-upset-bonus',
    ]);
    const tiered = expectDefined(templates.find((template) => template.isDefault), 'the NFL default');
    expect(tiered.templateKey).toBe('nfl-tiered-doubling');

    const contest = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: { name: `Playoff Pool ${RUN}`, sportEventIds: [event.id], contestFormat: ContestFormat.ROSTER, selectionType: SelectionType.TIERED, templateId: tiered.id },
    });
    expect(contest.response.status).toBe(201);
    const contestId = expectDefined(contest.data).contest.id;
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

    // One team from each seed line: the tiers follow the seeds, best first.
    const lineup = ['Seattle Seahawks', 'New England Patriots', 'Jacksonville Jaguars', 'Pittsburgh Steelers', 'Los Angeles Rams', 'Buffalo Bills', 'Los Angeles Chargers'];
    const entryId = expectDefined((await enterContest({ client: member.client, path: { contestId } })).data).entry.id;
    for (const team of lineup) {
      expect((await submitContestSelection({ client: member.client, path: { contestId }, body: { entryId, participantId: rowOf(team) } })).response.status).toBe(200);
    }
    expect((await submitContestEntry({ client: member.client, path: { contestId, entryId, sportEventId: event.id } })).response.status).toBe(200);

    // --- Kickoff, then settled ----------------------------------------------------------------------
    expect((await transitionEvent({ client: a, path: { eventId: event.id }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    const board = expectDefined((await getContestLeaderboard({ client: member.client, path: { contestId } })).data);
    const points = Object.fromEntries(board.entries.flatMap((entry) => entry.picks)
      .map((pick) => [expectDefined(field.find((row) => row.id === pick.sportEventParticipantId)).participant.name, pick.knockout?.points]));
    // The Seahawks' bye scores nothing, then 2 + 4 + 8; the Patriots 1 + 2 + 4; the Rams 1 + 2; the
    // Bills 1; the three Wild Card losers 0.
    expect(points).toEqual({
      'Seattle Seahawks': 14,
      'New England Patriots': 7,
      'Jacksonville Jaguars': 0,
      'Pittsburgh Steelers': 0,
      'Los Angeles Rams': 3,
      'Buffalo Bills': 1,
      'Los Angeles Chargers': 0,
    });

    expect((await transitionEvent({ client: a, path: { eventId: event.id }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    const settled = await getFunctionalPrisma().contestEntryStanding.findUniqueOrThrow({ where: { contestEntryId: entryId } });
    expect([settled.totalScore, settled.displayPosition]).toEqual([25, '1']);
  });
});
