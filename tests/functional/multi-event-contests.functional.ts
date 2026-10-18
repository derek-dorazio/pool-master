import {
  acceptInvitation,
  addEventParticipants,
  applyEventGolfRoundScores,
  applyEventParticipantUpload,
  autoAssignEventPrices,
  autoAssignEventTiers,
  createContest,
  createEvent,
  createParticipant,
  createSportLeague,
  enterContest,
  generateInviteLink,
  getContest,
  getContestLeaderboard,
  listContestConfigTemplates,
  listContestEntries,
  listEventParticipants,
  listSports,
  openContest,
  releaseEvent,
  setContestSportEvents,
  submitContestEntry,
  submitContestSelection,
  transitionEvent,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, ContestStatus, SelectionType, Sport, findSportRow } from '@poolmaster/shared/domain';
import {
  ContestEntryListResponseSchema,
  ContestEntryResponseSchema,
  ContestLeaderboardResponseSchema,
  ContestManagementResponseSchema,
  LeagueMembershipResponseSchema,
  SelectionStateResponseSchema,
} from '@poolmaster/shared/dto';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { standardEventPricing } from '../support/budget-pricing';
import { unlinkContestsFromSportEvents } from '../support/contest-event-links';
import { expectMatchesSchema } from '../support/expect-matches-schema';

// A golf contest over two tournaments end to end over HTTP (#713). An admin builds two one-round
// tournaments on a tour of their own, each with the same seven golfers, ranked so the default
// six tiers hold one golfer each and the last tier two. A commissioner creates the contest on
// the first tournament from golf's default tiered template (one golfer a tier, best four of six
// count), adds the second by replacing the contest's events, and two teams each pick a roster
// for each tournament and submit it, tournament by tournament.
//
// The first tournament plays and completes: it settles into frozen per-event standings and the
// contest stays ACTIVE, the board showing each entry's total so far and its result in that
// tournament. The second plays and completes: the contest completes, each entry's total the sum
// of its two tournaments, and it ranks by that sum.

const RUN = `multi-event-${Date.now()}`;
const GOLFERS = ['Ace', 'Birdie', 'Chip', 'Divot', 'Eagle', 'Fade', 'Gimme'];
// Every entry picks the first five (one tier each) and one of the two in the last tier.
const SHARED = ['Ace', 'Birdie', 'Chip', 'Divot', 'Eagle'];
// Score to par in each one-round tournament. Eagle's +5 is every entry's worst, so it never
// counts; the last-tier golfer decides each tournament.
const OPEN_SCORES: Record<string, number> = { Ace: 0, Birdie: 0, Chip: 0, Divot: 0, Eagle: 5, Fade: -3, Gimme: 2 };
const CLASSIC_SCORES: Record<string, number> = { Ace: 0, Birdie: 0, Chip: 0, Divot: 0, Eagle: 5, Fade: 4, Gimme: -6 };
const PAR = 72;

const created = {
  sportEventIds: new Set<string>(),
  sportLeagueIds: new Set<string>(),
  participantIds: new Set<string>(),
};

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  if (eventIds.length) {
    const field = { sportEventParticipant: { sportEventId: { in: eventIds } } };
    await unlinkContestsFromSportEvents(db, eventIds);
    await db.contestEntryPick.deleteMany({ where: field });
    await db.sportEventParticipantGolfRound.deleteMany({ where: { participantRound: field } });
    await db.sportEventParticipantRound.deleteMany({ where: field });
    await db.sportEventParticipantGolfStanding.deleteMany({ where: { standing: field } });
    await db.sportEventParticipantStanding.deleteMany({ where: field });
    await db.sportEventParticipantValuation.deleteMany({ where: field });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
  }
  const leagueIds = [...created.sportLeagueIds];
  if (leagueIds.length) {
    await db.eventSeries.deleteMany({ where: { sportLeagueId: { in: leagueIds } } });
    await db.participantLeagueAffiliation.deleteMany({ where: { sportLeagueId: { in: leagueIds } } });
    await db.sportLeague.deleteMany({ where: { id: { in: leagueIds } } });
  }
  if (created.participantIds.size) {
    await db.participant.deleteMany({ where: { id: { in: [...created.participantIds] } } });
  }
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

/**
 * Builds the two tournaments and the contest over both, with each team's roster submitted for each
 * tournament. `tag` keeps each test's tour, golfers and league apart.
 */
async function buildTwoTournamentContest(tag: string) {
  const admin = await buildRegisteredUser({ displayName: 'Tour Director' });
  await promoteToRootAdmin(admin);
  const a = admin.client;
  const sportId = expectDefined(findSportRow(expectDefined((await listSports({ client: a })).data).sports, Sport.GOLF)).id;

  // --- A tour, its two tournaments, and the same seven golfers in each -----------------------
  const tour = await createSportLeague({ client: a, body: { sport: 'GOLF', name: `Two Majors Tour ${RUN}${tag}` } });
  expect(tour.response.status).toBe(201);
  const sportLeagueId = expectDefined(tour.data).sportLeague.id;
  created.sportLeagueIds.add(sportLeagueId);

  const golferIds: string[] = [];
  for (const golfer of GOLFERS) {
    const participant = await createParticipant({ client: a, body: { sportId, participantType: 'INDIVIDUAL', name: `${golfer} ${RUN}${tag}` } });
    const id = expectDefined(participant.data).participant.id;
    created.participantIds.add(id);
    golferIds.push(id);
  }

  const buildTournament = async (name: string, startDate: string) => {
    const event = await createEvent({
      client: a,
      body: { sportLeagueId, eventYear: 2099, name: `${name} ${RUN}${tag}`, startDate, rounds: 1, autoLifecycleEnabled: false },
    });
    expect(event.response.status).toBe(201);
    const eventId = expectDefined(event.data).event.id;
    created.sportEventIds.add(eventId);
    expect((await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: golferIds } })).data?.added).toBe(7);
    const upload = await applyEventParticipantUpload({
      client: a,
      path: { eventId },
      body: { rows: GOLFERS.map((golfer, index) => ({ playerName: `${golfer} ${RUN}${tag}`, ranking: index + 1, seedNumber: index + 1 })) },
    });
    expect(upload.response.status).toBe(200);
    expect((await autoAssignEventTiers({ client: a, path: { eventId }, body: { source: 'RANKING', tierSize: 1 } })).response.status).toBe(200);
    expect((await autoAssignEventPrices({ client: a, path: { eventId }, body: standardEventPricing() })).response.status).toBe(200);
    expect((await releaseEvent({ client: a, path: { eventId } })).data?.event.status).toBe('SCHEDULED');
    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    const fieldRowOf = (golfer: string) => expectDefined(field.find((row) => row.participant.name === `${golfer} ${RUN}${tag}`)).id;
    return { eventId, fieldRowOf, fieldRowIds: new Set(field.map((row) => row.id)) };
  };
  const open = await buildTournament('Harbour Open', '2099-05-07T12:00:00.000Z');
  const classic = await buildTournament('Lakeside Classic', '2099-05-14T12:00:00.000Z');

  // --- The contest: created on the first tournament, the second added --------------------------
  const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Starter', leagueName: `Two Majors ${RUN}${tag}` });
  const member = await buildRegisteredUser({ displayName: 'Marshal' });
  const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
  const joined = await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
  expect(expectMatchesSchema(LeagueMembershipResponseSchema, joined.data).membership.leagueId).toBe(league.id);

  const templates = expectDefined((await listContestConfigTemplates({
    client: commissioner.client,
    query: { sport: Sport.GOLF, contestFormat: ContestFormat.ROSTER, active: true },
  })).data).templates;
  const tieredTemplate = expectDefined(templates.find((template) => template.isDefault), 'the golf default template');

  const contest = await createContest({
    client: commissioner.client,
    path: { id: league.id },
    body: {
      name: `Two Majors Picks ${RUN}${tag}`,
      sportEventIds: [open.eventId],
      contestFormat: ContestFormat.ROSTER,
      selectionType: SelectionType.TIERED,
      templateId: tieredTemplate.id,
    },
  });
  expect(contest.response.status).toBe(201);
  const contestId = expectDefined(contest.data).contest.id;

  // The request names the later tournament first; the contest keeps its events in start order.
  const replaced = await setContestSportEvents({
    client: commissioner.client,
    path: { id: league.id, contestId },
    body: { sportEventIds: [classic.eventId, open.eventId] },
  });
  expect(replaced.response.status).toBe(200);
  expect(expectMatchesSchema(ContestManagementResponseSchema, replaced.data).contest.sportEvents.map((event) => event.sportEventId)).toEqual([open.eventId, classic.eventId]);
  expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);
  const read = expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest;
  expect(read.sportEvents.map((event) => [event.sportEventId, event.sequence])).toEqual([[open.eventId, 1], [classic.eventId, 2]]);

  // --- Each team picks and submits a roster for each tournament ------------------------------
  const enterWith = async (client: typeof a, lastTierPick: { open: string; classic: string }) => {
    const entry = expectMatchesSchema(ContestEntryResponseSchema, (await enterContest({ client, path: { contestId } })).data).entry;
    expect(entry.events.map((event) => [event.sportEventId, event.status])).toEqual([[open.eventId, 'DRAFT'], [classic.eventId, 'DRAFT']]);
    for (const [tournament, lastTier] of [[open, lastTierPick.open], [classic, lastTierPick.classic]] as const) {
      for (const golfer of [...SHARED, lastTier]) {
        const pick = await submitContestSelection({ client, path: { contestId }, body: { entryId: entry.id, participantId: tournament.fieldRowOf(golfer) } });
        expect(pick.response.status).toBe(200);
      }
      const submitted = await submitContestEntry({ client, path: { contestId, entryId: entry.id, sportEventId: tournament.eventId } });
      expect(submitted.response.status).toBe(200);
      expectMatchesSchema(SelectionStateResponseSchema, submitted.data);
    }
    return entry.id;
  };
  // The commissioner backs Fade in both; the member backs Gimme in both.
  const commissionerEntryId = await enterWith(commissioner.client, { open: 'Fade', classic: 'Fade' });
  const memberEntryId = await enterWith(member.client, { open: 'Gimme', classic: 'Gimme' });

  // Each entry lists a status per tournament, both submitted.
  const listed = expectMatchesSchema(ContestEntryListResponseSchema, (await listContestEntries({ client: commissioner.client, path: { contestId } })).data);
  expect(Object.fromEntries(listed.entries.map((entry) => [entry.id, entry.events.map((event) => [event.sportEventId, event.status])]))).toEqual({
    [commissionerEntryId]: [[open.eventId, 'SUBMITTED'], [classic.eventId, 'SUBMITTED']],
    [memberEntryId]: [[open.eventId, 'SUBMITTED'], [classic.eventId, 'SUBMITTED']],
  });

  // Plays the tournament and posts every score, then completes it, or calls it off after the scores.
  const playTournament = async (eventId: string, scores: Record<string, number>, endStatus: 'COMPLETED' | 'CANCELLED' = 'COMPLETED') => {
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    const rows = GOLFERS.map((golfer) => ({
      playerName: `${golfer} ${RUN}${tag}`,
      strokes: PAR + scores[golfer],
      scoreToPar: scores[golfer],
      thru: 18,
      status: 'COMPLETED' as const,
    }));
    expect((await applyEventGolfRoundScores({ client: a, path: { eventId, roundNumber: 1 }, body: { rows } })).response.status).toBe(200);
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: endStatus } })).data?.event.status).toBe(endStatus);
  };
  type BoardEntry = {
    entryId: string;
    totalScore: number | null;
    displayPosition: string | null;
    events: Array<{ sportEventId: string; totalScore: number | null; displayPosition: string | null }>;
  };
  const standingsOf = (entries: BoardEntry[]) => Object.fromEntries(entries.map((entry) => [entry.entryId, {
    totalScore: entry.totalScore,
    displayPosition: entry.displayPosition,
    events: Object.fromEntries(entry.events.map((event) => [event.sportEventId, [event.totalScore, event.displayPosition]])),
  }]));
  return { open, classic, contestId, member, commissionerEntryId, memberEntryId, playTournament, standingsOf };
}

describe('SDK Functional: a golf contest over two tournaments (#713)', () => {
  it('settles the first tournament into its own standings with the contest still ACTIVE, then completes the contest on the second with each entry ranked by the sum of both', async () => {
    const { open, classic, contestId, member, commissionerEntryId, memberEntryId, playTournament, standingsOf } =
      await buildTwoTournamentContest('');

    // --- The first tournament: Fade's -3 beats Gimme's +2 -------------------------------------
    // Best four of six count: commissioner -3 + 0 + 0 + 0 = -3; member 0 + 0 + 0 + 0 = 0.
    await playTournament(open.eventId, OPEN_SCORES);

    const eventStandings = await getFunctionalPrisma().contestEntryEventStanding.findMany({ where: { contestId } });
    expect(Object.fromEntries(eventStandings.map((standing) => [standing.contestEntryId, [standing.sportEventId, standing.totalScore, standing.displayPosition]])))
      .toEqual({
        [commissionerEntryId]: [open.eventId, -3, '1'],
        [memberEntryId]: [open.eventId, 0, '2'],
      });
    expect(expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.ACTIVE);

    const midway = expectMatchesSchema(ContestLeaderboardResponseSchema, (await getContestLeaderboard({ client: member.client, path: { contestId }, query: { sportEventId: open.eventId } })).data);
    expect(midway.sportEventId).toBe(open.eventId);
    expect(standingsOf(midway.entries)).toEqual({
      [commissionerEntryId]: { totalScore: -3, displayPosition: '1', events: { [open.eventId]: [-3, '1'] } },
      [memberEntryId]: { totalScore: 0, displayPosition: '2', events: { [open.eventId]: [0, '2'] } },
    });
    // The board shows the first tournament's picks only, each pointing into its field.
    for (const entry of midway.entries) {
      expect(entry.picks).toHaveLength(6);
      expect(entry.picks.every((pick) => open.fieldRowIds.has(pick.sportEventParticipantId))).toBe(true);
    }

    // --- The second tournament: Gimme's -6 turns the contest ------------------------------------
    // Commissioner 0 (Fade's +4 drops out of the best four), member -6. Totals: member -6 + 0 = -6,
    // commissioner 0 + -3 = -3.
    await playTournament(classic.eventId, CLASSIC_SCORES);

    expect(expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    const settled = expectMatchesSchema(ContestLeaderboardResponseSchema, (await getContestLeaderboard({ client: member.client, path: { contestId }, query: { sportEventId: classic.eventId } })).data);
    expect(standingsOf(settled.entries)).toEqual({
      [memberEntryId]: { totalScore: -6, displayPosition: '1', events: { [open.eventId]: [0, '2'], [classic.eventId]: [-6, '1'] } },
      [commissionerEntryId]: { totalScore: -3, displayPosition: '2', events: { [open.eventId]: [-3, '1'], [classic.eventId]: [0, '2'] } },
    });
    expect(settled.entries.map((entry) => entry.entryId)).toEqual([memberEntryId, commissionerEntryId]);
    const totals = await getFunctionalPrisma().contestEntryStanding.findMany({ where: { contestId } });
    expect(Object.fromEntries(totals.map((standing) => [standing.contestEntryId, standing.totalScore])))
      .toEqual({ [memberEntryId]: -6, [commissionerEntryId]: -3 });
  }, 60_000);

  it('completes the contest on the first tournament alone when the second is called off after scores were posted, the second adding nothing to any total', async () => {
    const { open, classic, contestId, member, commissionerEntryId, memberEntryId, playTournament, standingsOf } =
      await buildTwoTournamentContest(' cancelled');

    await playTournament(open.eventId, OPEN_SCORES);
    // Gimme's -6 would turn the contest, but the tournament is called off.
    await playTournament(classic.eventId, CLASSIC_SCORES, 'CANCELLED');

    expect(expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    const eventStandings = await getFunctionalPrisma().contestEntryEventStanding.findMany({ where: { contestId } });
    expect(eventStandings.map((standing) => standing.sportEventId)).toEqual([open.eventId, open.eventId]);
    const totals = await getFunctionalPrisma().contestEntryStanding.findMany({ where: { contestId } });
    expect(Object.fromEntries(totals.map((standing) => [standing.contestEntryId, standing.totalScore])))
      .toEqual({ [commissionerEntryId]: -3, [memberEntryId]: 0 });

    const board = expectMatchesSchema(ContestLeaderboardResponseSchema, (await getContestLeaderboard({ client: member.client, path: { contestId }, query: { sportEventId: open.eventId } })).data);
    expect(standingsOf(board.entries)).toEqual({
      [commissionerEntryId]: { totalScore: -3, displayPosition: '1', events: { [open.eventId]: [-3, '1'] } },
      [memberEntryId]: { totalScore: 0, displayPosition: '2', events: { [open.eventId]: [0, '2'] } },
    });
  }, 60_000);
});
