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
  listSportLeagues,
  openContest,
  recordEventMatchPeriodScore,
  recordEventMatchResult,
  loadEventBracket,
  updateEventBracketMatch,
  cancelEventMatch,
  setEventRoundMatchups,
  setEventPlayInWinner,
  applyEventGolfRoundScores,
  updateEventParticipantGolfRoundScore,
  applyEventRaceResults,
  autoAssignEventTiers,
  submitContestEntry,
  selectContestPick,
  transitionEvent,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, ContestStatus, SelectionType, Sport } from '@poolmaster/shared/domain';
import { LoadMode } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { parseSportDataFile } from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { buildLeagueWithCommissioner, buildRegisteredUser, inCurrentSeason, promoteToRootAdmin, seasonEvents } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { EVERY_GAME_PLAYED } from '../support/sport-test-seed';
import { sportRowKeys } from '../support/sport-rows';

// American football end to end over HTTP (#702): the NFL playoffs test seed loads into the seeded
// NFL sport league, played out, with its Divisional round placed by the reseed. A commissioner
// runs a contest from the NFL's default template (one team from each seed line's tier, round
// values doubling 1, 2, 4, 8), a member picks a lineup, and the settled contest scores each team
// for the games it won, a bye counting as a win.

const RUN = `nfl-${Date.now()}`;
const ANY_UUID = '00000000-0000-4000-8000-000000000000';
const SEED_FILE = join(__dirname, '../../packages/core-api/scripts/seed-golf/american-football-2026-nfl-playoffs-test.json');

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
    await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
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

describe('SDK Functional: American football', () => {
  it('scores and settles an entry on the played NFL playoffs from the NFL\'s default tiered template, a bye counting as a win', async () => {
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await getFunctionalPrisma().sport.upsert({
      where: { sport: Sport.FOOTBALL },
      create: { sport: Sport.FOOTBALL, ...sportRowKeys(Sport.FOOTBALL), tournamentFormat: 'MATCHES' },
      update: {},
    });
    const admin = await buildRegisteredUser({ displayName: 'Playoff Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;

    // --- The test seed, its teams and event tagged with this run --------------------------------
    const file = parseSportDataFile(JSON.parse(readFileSync(SEED_FILE, 'utf8')) as unknown);
    const tagged = (key: string | null) => (key === null ? null : `${RUN}-${key}`);
    const [playoffs] = file.sportLeagues[0].events;
    playoffs.name = `NFL Playoffs ${RUN}`;
    for (const player of file.sportLeagues[0].players) player.key = expectDefined(tagged(player.key));
    for (const entry of playoffs.field) entry.player = expectDefined(tagged(entry.player));
    for (const match of playoffs.matches ?? []) Object.assign(match, { home: tagged(match.home), away: tagged(match.away) });
    // The loader makes the event in the NFL's current Season; another suite may have moved it.
    await inCurrentSeason((await getFunctionalPrisma().sportLeague.findFirstOrThrow({ where: { name: 'NFL', displayOrder: { not: null } }, select: { id: true } })).id, 2026);
    // Release refuses an event that has started by the server's clock, so the seed is dated from today.
    await loadSportData(file, { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.APPLY, resultsThrough: EVERY_GAME_PLAYED });

    const nfl = expectDefined(expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.FOOTBALL } })).data).sportLeagues
      .find((league) => league.name === 'NFL'));
    const event = expectDefined((await seasonEvents(a, nfl.id, 2026))
      .find((row) => row.name === playoffs.name));
    created.sportEventIds.add(event.id);
    expect([event.status, event.rounds]).toEqual(['SCHEDULED', 4]);
    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId: event.id } })).data).participants;
    const rowOf = (team: string) => expectDefined(field.find((row) => row.participant.name === team), team).id;

    // --- The NFL's tiers are seed ranges (#2160): a per-event tier size has no meaning there -------
    // Tiers are edited only before release, so the event is a draft for this one call.
    await getFunctionalPrisma().sportEvent.update({ where: { id: event.id }, data: { status: 'DRAFT' } });
    const sized = await autoAssignEventTiers({ client: a, path: { eventId: event.id }, body: { tierSize: 4 } });
    expect([sized.response?.status, sized.error?.error.code]).toEqual([422, 'TIER_SIZE_NOT_FOR_RANGES']);
    await getFunctionalPrisma().sportEvent.update({ where: { id: event.id }, data: { status: 'SCHEDULED' } });

    // --- The Super Bowl's quarter scores (#772): Seattle, the away side, 3-0, 9-0 and 12-0 --------
    const superBowlOf = async () => expectDefined(expectDefined((await getEventBracket({ client: a, path: { eventId: event.id } })).data).matches
      .find((match) => match.matchNumber === 13));
    const superBowl = await superBowlOf();
    expect([superBowl.awaySportEventParticipantId, superBowl.awayScore, superBowl.homeScore]).toEqual([rowOf('Seattle Seahawks'), 29, 13]);
    const asLoaded = [
      { periodNumber: 1, homeScore: 0, awayScore: 3 },
      { periodNumber: 2, homeScore: 0, awayScore: 9 },
      { periodNumber: 3, homeScore: 0, awayScore: 12 },
    ];
    expect(superBowl.periodScores).toEqual(asLoaded);
    const superBowlQuarter = (periodNumber: number) => ({ eventId: event.id, matchNumber: 13, periodNumber });
    // A score below the half's, past the final score, or for the last quarter is refused; a member may not enter one.
    expect((await recordEventMatchPeriodScore({ client: a, path: superBowlQuarter(3), body: { homeScore: 0, awayScore: 6 } })).error?.error.code).toBe('MATCH_PERIOD_SCORE_INVALID');
    expect((await recordEventMatchPeriodScore({ client: a, path: superBowlQuarter(3), body: { homeScore: 14, awayScore: 12 } })).error?.error.code).toBe('MATCH_PERIOD_SCORE_INVALID');
    expect((await recordEventMatchPeriodScore({ client: a, path: superBowlQuarter(4), body: { homeScore: 0, awayScore: 12 } })).error?.error.code).toBe('MATCH_PERIOD_INVALID');
    const outsider = await buildRegisteredUser({ displayName: 'Scoreboard Stranger' });
    expect((await recordEventMatchPeriodScore({ client: outsider.client, path: superBowlQuarter(1), body: { homeScore: 0, awayScore: 3 } })).response?.status).toBe(403);
    // Entered again, the half's score reads as before.
    expect((await recordEventMatchPeriodScore({ client: a, path: superBowlQuarter(2), body: { homeScore: 0, awayScore: 9 } })).response?.status).toBe(200);
    expect((await superBowlOf()).periodScores).toEqual(asLoaded);

    // Results come only from the feed (#2074): the routes that cleared a result or a quarter's score,
    // postponed a game or replaced a withdrawn participant are gone, so even a root admin gets 404.
    const removedRoutes = await Promise.all([
      a.delete({ url: '/api/v1/events/{eventId}/bracket/matches/{matchNumber}/result', path: { eventId: event.id, matchNumber: 13 } }),
      a.delete({ url: '/api/v1/events/{eventId}/bracket/matches/{matchNumber}/periods/{periodNumber}', path: superBowlQuarter(2) }),
      a.post({ url: '/api/v1/events/{eventId}/bracket/matches/{matchNumber}/postpone', path: { eventId: event.id, matchNumber: 13 } }),
      a.put({
        url: '/api/v1/events/{eventId}/participants/{sportEventParticipantId}/replacement',
        path: { eventId: event.id, sportEventParticipantId: superBowl.homeSportEventParticipantId },
        body: {},
        headers: { 'Content-Type': 'application/json' },
      }),
    ]);
    expect(removedRoutes.map((removed) => removed.response?.status)).toEqual([404, 404, 404, 404]);
    expect((await superBowlOf()).periodScores).toEqual(asLoaded);

    // The kept admin result routes write only on a test event (#2074): the loader scored this one
    // because it covers a test slot. Cut loose from its test slot, every kept write is
    // 409 SPORT_EVENT_NOT_TEST_DATA and changes nothing; linked again, the write goes through.
    const db = getFunctionalPrisma();
    // The season already holds the synced slot beside each test one, so the event's slot links are
    // moved onto those synced slots instead: an event covering no test slot is one the feed scores.
    // Its rounds stay in the same event slots (#2006), so the links move rather than go.
    const links = await db.sportEventSlot.findMany({
      where: { sportEventId: event.id },
      select: { id: true, sportLeagueSeasonCompetitionSlotId: true, seasonSlot: { select: { sportLeagueSeasonId: true, sportLeagueCompetitionSlotId: true } } },
    });
    expect(links.length).toBeGreaterThan(0);
    const synced = await db.sportLeagueSeasonCompetitionSlot.findMany({
      where: { isTestData: false, OR: links.map(({ seasonSlot }) => seasonSlot) },
      select: { id: true, sportLeagueCompetitionSlotId: true },
    });
    const syncedOf = new Map(synced.map((slot) => [slot.sportLeagueCompetitionSlotId, slot.id]));
    const moveLinks = (to: (link: (typeof links)[number]) => string) => db.$transaction(
      links.map((link) => db.sportEventSlot.update({ where: { id: link.id }, data: { sportLeagueSeasonCompetitionSlotId: to(link) } })),
    );
    await moveLinks((link) => expectDefined(syncedOf.get(link.seasonSlot.sportLeagueCompetitionSlotId), 'the synced slot beside the test one'));
    const seahawks = rowOf('Seattle Seahawks');
    const matchPath = { eventId: event.id, matchNumber: 13 };
    const refused = await Promise.all([
      loadEventBracket({ client: a, path: { eventId: event.id }, body: { matches: [{ matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: false, scheduledDate: null, advancesTo: null }] } }),
      updateEventBracketMatch({ client: a, path: matchPath, body: { isNeutralSite: true } }),
      recordEventMatchResult({ client: a, path: matchPath, body: { winnerSide: 'AWAY', homeScore: 13, awayScore: 29 } }),
      recordEventMatchPeriodScore({ client: a, path: superBowlQuarter(2), body: { homeScore: 0, awayScore: 9 } }),
      cancelEventMatch({ client: a, path: matchPath }),
      setEventRoundMatchups({ client: a, path: { eventId: event.id, roundNumber: 2 }, body: { matches: [{ matchNumber: 7, homeSportEventParticipantId: seahawks, awaySportEventParticipantId: rowOf('Los Angeles Rams') }] } }),
      setEventPlayInWinner({ client: a, path: { eventId: event.id, sportEventParticipantId: seahawks }, body: { participantId: ANY_UUID } }),
      applyEventGolfRoundScores({ client: a, path: { eventId: event.id, roundNumber: 1 }, body: { rows: [{ participantId: ANY_UUID, strokes: 70, scoreToPar: -2, status: 'COMPLETED' }] } }),
      updateEventParticipantGolfRoundScore({ client: a, path: { eventId: event.id, roundNumber: 1, sportEventParticipantId: seahawks }, body: { strokes: 70 } }),
      applyEventRaceResults({ client: a, path: { eventId: event.id }, body: { isOfficial: true, rows: [{ participantId: ANY_UUID, resultStatus: 'FINISHED', finishPosition: 1, startPosition: null, riderName: null }] } }),
    ]);
    expect(refused.map((reply) => [reply.response?.status, reply.error?.error.code])).toEqual(refused.map(() => [409, 'SPORT_EVENT_NOT_TEST_DATA']));
    expect(await superBowlOf()).toMatchObject({ isNeutralSite: superBowl.isNeutralSite, status: superBowl.status, periodScores: asLoaded });
    await moveLinks((link) => link.sportLeagueSeasonCompetitionSlotId);
    expect((await recordEventMatchPeriodScore({ client: a, path: superBowlQuarter(2), body: { homeScore: 0, awayScore: 9 } })).response?.status).toBe(200);

    // --- A contest from the NFL's default template ----------------------------------------------
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Playoff Commissioner', leagueName: `Gridiron ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Playoff Member' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });

    const templates = expectDefined((await listContestConfigTemplates({
      client: commissioner.client,
      query: { sportLeagueId: nfl.id, active: true },
    })).data).templates
      .filter((template) => template.contestFormat === ContestFormat.ROSTER);
    expect(templates.map((template) => template.templateKey).sort()).toEqual([
      'nfl-budget-pick-3',
      'nfl-random-draw-doubling', 'nfl-random-draw-doubling-upset-bonus',
      'nfl-tiered-pick-3',
    ]);
    const tiered = expectDefined(templates.find((template) => template.isDefault), 'the NFL default');
    expect(tiered.templateKey).toBe('nfl-tiered-pick-3');

    const contest = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: { name: `Playoff Pool ${RUN}`, sportEventIds: [event.id], contestFormat: ContestFormat.ROSTER, selectionType: SelectionType.TIERED, templateId: tiered.id },
    });
    expect(contest.response?.status).toBe(201);
    const contestId = expectDefined(contest.data).contest.id;
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

    // One team from each of the NFL's seed tiers (#2160): a 1 seed, a 2 to 4 seed, and a 5 seed or below.
    const lineup = ['Seattle Seahawks', 'New England Patriots', 'Los Angeles Rams'];
    const entryId = expectDefined((await enterContest({ client: member.client, path: { contestId } })).data).entry.id;
    for (const team of lineup) {
      expect((await selectContestPick({ client: member.client, path: { contestId, entryId, sportEventParticipantId: rowOf(team) } })).response?.status).toBe(200);
    }
    expect((await submitContestEntry({ client: member.client, path: { contestId, entryId, sportEventId: event.id } })).response?.status).toBe(200);

    // --- Kickoff, then settled ----------------------------------------------------------------------
    expect((await transitionEvent({ client: a, path: { eventId: event.id }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    const board = expectDefined((await getContestLeaderboard({ client: member.client, path: { contestId } })).data);
    const points = Object.fromEntries(board.entries.flatMap((entry) => entry.picks)
      .map((pick) => [expectDefined(field.find((row) => row.id === pick.sportEventParticipantId)).participant.name, pick.knockout?.points]));
    // The Seahawks' bye counts as a win, 1, then 2 + 4 + 8; the Patriots 1 + 2 + 4; the Rams 1 + 2.
    expect(points).toEqual({
      'Seattle Seahawks': 15,
      'New England Patriots': 7,
      'Los Angeles Rams': 3,
    });

    expect((await transitionEvent({ client: a, path: { eventId: event.id }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    const settled = await getFunctionalPrisma().contestEntryStanding.findUniqueOrThrow({ where: { contestEntryId: entryId } });
    expect([settled.totalScore, settled.displayPosition]).toEqual([25, '1']);
  });
});
