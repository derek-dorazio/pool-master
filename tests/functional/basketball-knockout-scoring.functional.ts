import {
  acceptInvitation,
  addEventParticipants,
  applyEventParticipantUpload,
  autoAssignEventPrices,
  autoAssignEventTiers,
  clearEventMatchResult,
  createContest,
  createEvent,
  createParticipant,
  createSportLeague,
  enterContest,
  generateInviteLink,
  getContest,
  getContestEntry,
  getContestLeaderboard,
  getSelectionState,
  listContestEntries,
  listEventParticipants,
  listSports,
  loadEventBracket,
  openContest,
  recordEventMatchResult,
  releaseEvent,
  submitContestEntry,
  submitContestSelection,
  transitionEvent,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, ContestStatus, MatchSide, MatchStatus, SelectionType, Sport, findSportRow } from '@poolmaster/shared/domain';
import {
  ContestEntryDetailResponseSchema,
  ContestEntryListResponseSchema,
  ContestEntryResponseSchema,
  ContestLeaderboardResponseSchema,
  SelectionPickResponseSchema,
  SelectionStateResponseSchema,
  SportEventBracketResponseSchema,
} from '@poolmaster/shared/dto';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';
import { expectDefined } from '../support/expect-defined';
import { standardEventPricing } from '../support/budget-pricing';
import { expectMatchesSchema } from '../support/expect-matches-schema';

// Knockout scoring end to end over HTTP (#699): an admin releases a four-team, two-round bracket, a
// commissioner runs a contest scored by knockout round points (1 for a first-round win, 2 for the
// final) with the seed-difference upset bonus, an entry picks one team from each tier and counts
// its best two, and the admin enters each match's result. The board scores each pick its round
// points plus bonus, a decided final locks the earlier winners, and the settled contest keeps the
// total.

const RUN = `knockout-${Date.now()}`;
// Seeds, best first; the odds order the field into basketball's four tiers, one team to a tier.
const FIELD: readonly { name: string; seed: number }[] = [
  { name: 'Duke', seed: 1 },
  { name: 'Houston', seed: 2 },
  { name: 'Vermont', seed: 15 },
  { name: 'Texas', seed: 16 },
];
const SCORING = {
  participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS' as const,
  config: { roundValues: [1, 2], upsetBonus: { rule: 'SEED_DIFFERENCE' as const, multiplier: 1 } },
};

const created = {
  sportEventIds: new Set<string>(),
  participantIds: new Set<string>(),
  sportLeagueIds: new Set<string>(),
};

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
  if (created.participantIds.size) {
    await db.participant.deleteMany({ where: { id: { in: [...created.participantIds] } } });
  }
  if (created.sportLeagueIds.size) {
    await db.sportLeague.deleteMany({ where: { id: { in: [...created.sportLeagueIds] } } });
  }
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Basketball knockout scoring', () => {
  it('scores each pick its round points plus upset bonus from the admin\'s match results, locks a decided round and settles the contest on the totals', async () => {
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await getFunctionalPrisma().sport.upsert({
      where: { sport: Sport.BASKETBALL },
      create: { sport: Sport.BASKETBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
      update: {},
    });
    const admin = await buildRegisteredUser({ displayName: 'Bracket Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectDefined((await listSports({ client: a })).data).sports, Sport.BASKETBALL)).id;

    // --- A released two-round tournament ------------------------------------------------------
    const conference = await createSportLeague({ client: a, body: { sport: Sport.BASKETBALL, name: `Harbour Conference ${RUN}` } });
    const sportLeagueId = expectDefined(conference.data).sportLeague.id;
    created.sportLeagueIds.add(sportLeagueId);
    const tournament = await createEvent({
      client: a,
      body: { sportLeagueId, eventYear: 2099, name: `Harbour Classic ${RUN}`, startDate: '2099-03-19T16:00:00.000Z', rounds: 2, autoLifecycleEnabled: false },
    });
    const eventId = expectDefined(tournament.data).event.id;
    created.sportEventIds.add(eventId);

    const teamIds: string[] = [];
    for (const { name } of FIELD) {
      const participant = await createParticipant({ client: a, body: { sportId, participantType: 'TEAM', name: `${name} ${RUN}` } });
      const id = expectDefined(participant.data).participant.id;
      created.participantIds.add(id);
      teamIds.push(id);
    }
    expect((await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: teamIds } })).data?.added).toBe(4);
    await applyEventParticipantUpload({
      client: a,
      path: { eventId },
      body: { rows: FIELD.map((team, index) => ({ playerName: `${team.name} ${RUN}`, seedNumber: team.seed, oddsToWin: 2 + index * 5 })) },
    });
    expect((await autoAssignEventTiers({ client: a, path: { eventId }, body: { source: 'ODDS', tierSize: 1 } })).response?.status).toBe(200);
    expect((await autoAssignEventPrices({ client: a, path: { eventId }, body: standardEventPricing() })).response?.status).toBe(200);

    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    const rowOf = (name: string) => expectDefined(field.find((row) => row.participant.name === `${name} ${RUN}`)).id;
    const nameOf = (rowId: string) => expectDefined(field.find((row) => row.id === rowId)).participant.name.replace(` ${RUN}`, '');

    const loaded = await loadEventBracket({
      client: a,
      path: { eventId },
      body: {
        matches: [
          { matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: rowOf('Duke'), awaySportEventParticipantId: rowOf('Texas'), isNeutralSite: true, scheduledDate: null, advancesTo: { matchNumber: 3, side: MatchSide.HOME } },
          { matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: rowOf('Houston'), awaySportEventParticipantId: rowOf('Vermont'), isNeutralSite: true, scheduledDate: null, advancesTo: { matchNumber: 3, side: MatchSide.AWAY } },
          { matchNumber: 3, roundNumber: 2, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesTo: null },
        ],
      },
    });
    expect(loaded.response?.status).toBe(200);
    expect(expectMatchesSchema(SportEventBracketResponseSchema, loaded.data).matches).toHaveLength(3);
    // A draft takes no results: its pairings can still change.
    expectFunctionalError(
      await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 1 }, body: { winnerSide: MatchSide.HOME, homeScore: null, awayScore: null } }),
      { status: 409, code: 'SPORT_EVENT_NOT_RELEASED' },
    );
    const released = await releaseEvent({ client: a, path: { eventId } });
    expect([released.data?.event.status, released.error]).toEqual(['SCHEDULED', undefined]);

    // --- A contest scored by knockout round points with the upset bonus ------------------------
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Bracket Commissioner', leagueName: `Madness ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Bracket Member' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });

    const contestBody = (roundValues: number[]) => ({
      name: `Harbour Bracket Pool ${RUN}`,
      sportEventIds: [eventId],
      contestFormat: ContestFormat.ROSTER,
      selectionType: SelectionType.TIERED,
      configuration: {
        maxEntriesPerSquad: 1,
        selectionType: SelectionType.TIERED,
        picksPerTier: 1,
        countedScores: 2,
        scoring: { ...SCORING, config: { ...SCORING.config, roundValues } },
      },
    });
    expectFunctionalError(
      await createContest({ client: commissioner.client, path: { id: league.id }, body: contestBody([1, 2, 4]) }),
      { status: 422, code: 'CONTEST_SCORING_ROUNDS_MISMATCH' },
    );
    const contest = await createContest({ client: commissioner.client, path: { id: league.id }, body: contestBody([1, 2]) });
    expect(contest.response?.status).toBe(201);
    const contestId = expectDefined(contest.data).contest.id;
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

    const enterWith = async (client: typeof a, lineup: string[]) => {
      const entryId = expectMatchesSchema(ContestEntryResponseSchema, (await enterContest({ client, path: { contestId } })).data).entry.id;
      for (const team of lineup) {
        const pick = await submitContestSelection({ client, path: { contestId }, body: { entryId, participantId: rowOf(team) } });
        expect(pick.response?.status).toBe(200);
        expectMatchesSchema(SelectionPickResponseSchema, pick.data);
      }
      const submitted = await submitContestEntry({ client, path: { contestId, entryId, sportEventId: eventId } });
      expect(submitted.response?.status).toBe(200);
      expectMatchesSchema(SelectionStateResponseSchema, submitted.data);
      return entryId;
    };
    const entryId = await enterWith(member.client, ['Duke', 'Houston', 'Vermont', 'Texas']);

    // The entry reads back submitted for the tournament, in the contest's list and on its own.
    const entries = expectMatchesSchema(ContestEntryListResponseSchema, (await listContestEntries({ client: member.client, path: { contestId } })).data).entries;
    expect(entries.map((entry) => entry.id)).toEqual([entryId]);
    const detail = expectMatchesSchema(ContestEntryDetailResponseSchema, (await getContestEntry({ client: member.client, path: { contestId, entryId } })).data);
    expect(detail.entry.events.map((event) => [event.sportEventId, event.status])).toEqual([[eventId, 'SUBMITTED']]);

    // The selection room shows each team with its bracket seed.
    const room = expectDefined((await getSelectionState({ client: member.client, path: { contestId }, query: { entryId } })).data);
    const seeds = new Map((room.selectionGroups ?? []).flatMap((group) => group.participants).map((row) => [row.participantName, row.seedNumber]));
    expect(FIELD.map((team) => seeds.get(`${team.name} ${RUN}`))).toEqual(FIELD.map((team) => team.seed));

    // --- The tournament tips off and the results go in ------------------------------------------
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    expectFunctionalError(
      await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 3 }, body: { winnerSide: MatchSide.HOME, homeScore: null, awayScore: null } }),
      { status: 422, code: 'MATCH_SIDES_NOT_SET' },
    );
    expectFunctionalError(
      await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 1 }, body: { winnerSide: MatchSide.HOME, homeScore: 60, awayScore: 70 } }),
      { status: 422, code: 'MATCH_RESULT_INVALID' },
    );
    // Duke beats Texas; Vermont, a 15 seed, beats Houston, a 2.
    await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 1 }, body: { winnerSide: MatchSide.HOME, homeScore: 82, awayScore: 60 } });
    const afterFirstRound = await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 2 }, body: { winnerSide: MatchSide.AWAY, homeScore: 66, awayScore: 71 } });
    const final = expectDefined(expectMatchesSchema(SportEventBracketResponseSchema, afterFirstRound.data).matches.find((match) => match.matchNumber === 3));
    expect([nameOf(expectDefined(final.homeSportEventParticipantId)), nameOf(expectDefined(final.awaySportEventParticipantId))]).toEqual(['Duke', 'Vermont']);

    // While the final is unplayed a first-round result can be taken back: Vermont leaves the
    // final's away side, and the result goes in again.
    const cleared = await clearEventMatchResult({ client: a, path: { eventId, matchNumber: 2 } });
    const clearedFinal = expectDefined(expectMatchesSchema(SportEventBracketResponseSchema, cleared.data).matches.find((match) => match.matchNumber === 3));
    expect(clearedFinal.awaySportEventParticipantId).toBeNull();
    await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 2 }, body: { winnerSide: MatchSide.AWAY, homeScore: 66, awayScore: 71 } });

    // After the first round: Duke 1, Vermont 1 + (15 - 2) = 14, Houston and Texas 0; the best two count.
    const totalsOf = async () => Object.fromEntries(
      expectDefined((await getContestLeaderboard({ client: member.client, path: { contestId } })).data).entries
        .map((entry) => [entry.entryId, entry.totalScore]),
    );
    expect(await totalsOf()).toEqual({ [entryId]: 15 });

    // Vermont beats Duke in the final: 2 + (15 - 1) = 16 more.
    await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 3 }, body: { winnerSide: MatchSide.AWAY, homeScore: 70, awayScore: 72 } });
    const board = expectMatchesSchema(ContestLeaderboardResponseSchema, (await getContestLeaderboard({ client: member.client, path: { contestId } })).data);
    expect(board.scoringDefinitionId).toBe('KNOCKOUT_ROUND_POINTS');
    const picks = Object.fromEntries(board.entries.flatMap((entry) => entry.picks).map((pick) => [nameOf(pick.sportEventParticipantId), pick.knockout]));
    expect(picks).toEqual({
      Duke: { points: 1, wins: 1, upsetBonusPoints: 0, isAlive: false },
      Vermont: { points: 30, wins: 2, upsetBonusPoints: 27, isAlive: true },
      Houston: { points: 0, wins: 0, upsetBonusPoints: 0, isAlive: false },
      Texas: { points: 0, wins: 0, upsetBonusPoints: 0, isAlive: false },
    });
    const champion = expectDefined(board.participants.find((row) => row.id === rowOf('Vermont')));
    expect(champion.standing).toMatchObject({ position: 1, status: 'COMPLETE' });

    // The final is decided, so a first-round winner can no longer change; its score still can.
    expectFunctionalError(
      await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 2 }, body: { winnerSide: MatchSide.HOME, homeScore: 71, awayScore: 66 } }),
      { status: 409, code: 'SPORT_EVENT_MATCH_RESULT_LOCKED' },
    );
    expectFunctionalError(
      await clearEventMatchResult({ client: a, path: { eventId, matchNumber: 2 } }),
      { status: 409, code: 'SPORT_EVENT_MATCH_RESULT_LOCKED' },
    );
    const corrected = await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 2 }, body: { winnerSide: MatchSide.AWAY, homeScore: 66, awayScore: 73 } });
    expect(expectDefined(corrected.data).matches.find((match) => match.matchNumber === 2)).toMatchObject({ status: MatchStatus.COMPLETED, awayScore: 73 });

    // --- Settled ------------------------------------------------------------------------------
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    expect(await totalsOf()).toEqual({ [entryId]: 31 });
    const settled = await getFunctionalPrisma().contestEntryStanding.findUniqueOrThrow({ where: { contestEntryId: entryId } });
    expect([settled.totalScore, settled.displayPosition]).toEqual([31, '1']);
  });
});
