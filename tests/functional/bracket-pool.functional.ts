import { deleteTestSportLeagues } from '../support/test-slots';
import {
  acceptInvitation,
  addEventParticipants,
  autoAssignEventPrices,
  autoAssignEventTiers,
  clearGamePick,
  createContest,
  createParticipant,
  enterContest,
  generateInviteLink,
  getBracketLeaderboard,
  getContest,
  getContestLeaderboard,
  getEventBracket,
  getGamePicks,
  listEventParticipants,
  loadEventBracket,
  openContest,
  proposeEventRoundMatchups,
  recordEventMatchResult,
  releaseEvent,
  saveGamePicks,
  setEventRoundMatchups,
  submitGamePicks,
  transitionEvent,
  updateContestEntry,
} from '@poolmaster/shared/generated/hey-api';
import {
  ContestEntryStatus,
  ContestFormat,
  ContestStatus,
  MatchSideOutcome,
  MatchSide,
  PickOutcome,
  PredictedResult,
  SelectionType,
  Sport,
  isAtPlace,
  matchPlaceOf,
  describeMatchPlace,
  type MatchPlace,
} from '@poolmaster/shared/domain';
import {
  BracketLeaderboardResponseSchema,
  GamePicksResponseSchema,
  SportEventBracketResponseSchema,
  SportEventRoundMatchupsResponseSchema,
} from '@poolmaster/shared/dto';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin, createTestEvent } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';
import { expectDefined } from '../support/expect-defined';
import { unlinkContestsFromSportEvents } from '../support/contest-event-links';
import { standardPricingRequest } from './standard-pricing';
import { expectMatchesSchema } from '../support/expect-matches-schema';
import { sportRowKeys } from '../support/sport-rows';
import { insertTestSportLeague } from '../support/test-sport-league';
import type { TestRoundSlot } from '../support/event-edition';
import { bracketMatch, readHomeAway, resultBody } from '../support/match-requests';
import { HOME_SIDE, pickSideOf, predictedHomeAndAway, type PickSides } from '../support/match-sides';
import { setFieldRows } from './field-rows';

// Bracket pools end to end over HTTP (#721). An admin releases a knockout; a commissioner runs a
// BRACKET contest on it scored by knockout round points; each team fills in the winner of every
// game before tip-off, the later games offering the teams its own picks sent there, and gives a
// tiebreaker, the final's total points. The admin then enters the results round by round, the
// bracket leaderboard shrinks each entry's most possible points as its picks bust, and the
// settled contest keeps the places the tiebreaker decided.
//
// Every date is fixed in 2099, so the server's real clock never reaches the event: the admin
// starts and completes it by status, which is what locks, reveals and settles the picks.

const at = (roundNumber: number, matchNumber: number): MatchPlace => ({ roundNumber, matchNumber });

const RUN = `bracket-pool-${Date.now()}`;

const created = {
  sportEventIds: new Set<string>(),
  participantIds: new Set<string>(),
  sportLeagueIds: new Set<string>(),
};

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  if (eventIds.length) {
    await db.contestEntryMatchPrediction.deleteMany({ where: { sportEventRoundMatch: { sportEventId: { in: eventIds } } } });
    await unlinkContestsFromSportEvents(db, eventIds);
    await db.sportEventRoundMatch.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
  }
  if (created.participantIds.size) {
    await db.participant.deleteMany({ where: { id: { in: [...created.participantIds] } } });
  }
  if (created.sportLeagueIds.size) {
    // A league with setups cannot be deleted: the play-in test's own setup goes first.
    await db.contestConfigTemplate.deleteMany({ where: { sportLeagueId: { in: [...created.sportLeagueIds] } } });
    await deleteTestSportLeagues(db, [...created.sportLeagueIds]);
  }
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

type Client = Awaited<ReturnType<typeof buildRegisteredUser>>['client'];

interface BracketMatchInput {
  matchNumber: number;
  roundNumber: number;
  home: number | null;
  away: number | null;
  advancesTo: (MatchPlace & { side: MatchSide }) | null;
  regionLabel?: string;
  /** When the game tips off; with none it is timed at the event's start. */
  scheduledDate?: string;
}

/**
 * A released knockout of teams named `Seed <n>`, seeded n, on a new sport league of its own: the
 * admin's client, the event and its field rows by seed, and its games by round and number.
 */
async function releasedKnockout(options: {
  label: string;
  seeds: readonly number[];
  rounds: number;
  tierSize: number;
  /** One test slot per round, when the rounds are told apart by their slots (a reseeded round). */
  roundSlots?: readonly TestRoundSlot[];
  matches: readonly BracketMatchInput[];
}) {
  // The migration's reference row, restored in case an earlier suite cleared the sports table.
  await getFunctionalPrisma().sport.upsert({
    where: { sport: Sport.BASKETBALL },
    create: { sport: Sport.BASKETBALL, ...sportRowKeys(Sport.BASKETBALL) },
    update: {},
  });
  const admin = await buildRegisteredUser({ displayName: `${options.label} Director` });
  await promoteToRootAdmin(admin);
  const a = admin.client;

  const { id: sportLeagueId } = await insertTestSportLeague(getFunctionalPrisma(), { sport: Sport.BASKETBALL, name: `${options.label} League ${RUN}` });
  created.sportLeagueIds.add(sportLeagueId);
  const event = await createTestEvent({
    client: a,
    body: { sportLeagueId: sportLeagueId, championshipYear: 2099, name: `${options.label} ${RUN}`, startDate: '2099-03-19T16:00:00.000Z', rounds: options.rounds, ...(options.roundSlots !== undefined && { roundSlots: options.roundSlots }), autoLifecycleEnabled: false },
  });
  const eventId = expectDefined(event.data, JSON.stringify(event.error)).event.id;
  created.sportEventIds.add(eventId);

  const teamIds: string[] = [];
  for (const seed of options.seeds) {
    const participant = await createParticipant({ client: a, body: { sportLeagueId, participantType: 'TEAM', name: `Seed ${seed} ${options.label} ${RUN}` } });
    const id = expectDefined(participant.data).participant.id;
    created.participantIds.add(id);
    teamIds.push(id);
  }
  expect((await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: teamIds } })).data?.added).toBe(options.seeds.length);
  expect((await setFieldRows({
    client: a,
    path: { eventId },
    body: { rows: options.seeds.map((seed) => ({ playerName: `Seed ${seed} ${options.label} ${RUN}`, seedNumber: seed })) },
  })).response?.status).toBe(200);
  expect((await autoAssignEventTiers({ client: a, path: { eventId }, body: { tierSize: options.tierSize } })).response?.status).toBe(200);
  expect((await autoAssignEventPrices({ client: a, path: { eventId }, body: await standardPricingRequest(a) })).response?.status).toBe(200);

  const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
  const row = (seed: number) => expectDefined(field.find((each) => each.participant.name === `Seed ${seed} ${options.label} ${RUN}`), `seed ${seed}`).id;
  const seedOf = (rowId: string | null | undefined) => (rowId ? expectDefined(field.find((each) => each.id === rowId)).seedNumber ?? null : null);

  const loaded = await loadEventBracket({
    client: a,
    path: { eventId },
    body: {
      matches: options.matches.map((match) => bracketMatch({
        matchNumber: match.matchNumber,
        roundNumber: match.roundNumber,
        homeSportEventParticipantId: match.home === null ? null : row(match.home),
        awaySportEventParticipantId: match.away === null ? null : row(match.away),
        isNeutralSite: true,
        scheduledDate: match.scheduledDate ?? null,
        advancesTo: match.advancesTo,
        ...(match.regionLabel !== undefined && { regionLabel: match.regionLabel }),
      })),
    },
  });
  expect([loaded.error, loaded.response?.status]).toEqual([undefined, 200]);
  const released = await releaseEvent({ client: a, path: { eventId } });
  expect([released.error, released.data?.event.status]).toEqual([undefined, 'SCHEDULED']);

  const bracket = expectMatchesSchema(SportEventBracketResponseSchema, (await getEventBracket({ client: a, path: { eventId } })).data).matches;
  const gameId = (place: MatchPlace) => expectDefined(bracket.find((match) => isAtPlace(match, place)), describeMatchPlace(place)).id;
  return { admin: a, eventId, sportLeagueId, row, seedOf, gameId };
}

/** A league of three teams: the commissioner's and two members'. */
async function leagueOfThree(label: string) {
  const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: `${label} Commissioner`, leagueName: `${label} Pool ${RUN}` });
  const join = async (displayName: string) => {
    const member = await buildRegisteredUser({ displayName });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
    return member;
  };
  return { commissioner, league, bob: await join(`${label} Bob`), cara: await join(`${label} Cara`) };
}

describe('SDK Functional: a bracket pool (#721)', () => {
  it('fills in a 16-team bracket with its tiebreaker before tip-off and before any game has a start time, scores it round by round as max possible points shrink, and settles it with the tiebreaker deciding a tie on points', async () => {
    // --- A released 16-team, four-round knockout -----------------------------------------------
    // Round 1 pairs 1-16, 8-9, 5-12, 4-13, 6-11, 3-14, 7-10 and 2-15; each pair of games feeds one
    // game of the next round, down to the final, round 4's game 1. Each round numbers its games from 1 (#2161).
    const firstRound: Array<[number, number]> = [[1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15]];
    const later = (roundNumber: number, matchNumber: number, last = false): BracketMatchInput => ({
      matchNumber, roundNumber, home: null, away: null,
      advancesTo: last ? null : { roundNumber: roundNumber + 1, matchNumber: Math.ceil(matchNumber / 2), side: matchNumber % 2 === 1 ? MatchSide.HOME : MatchSide.AWAY },
    });
    const { admin: a, eventId, row, gameId } = await releasedKnockout({
      label: 'Sixteen',
      seeds: Array.from({ length: 16 }, (_, index) => index + 1),
      rounds: 4,
      tierSize: 4,
      matches: [
        ...firstRound.map(([home, away], index): BracketMatchInput => ({
          matchNumber: index + 1, roundNumber: 1, home, away,
          advancesTo: { roundNumber: 2, matchNumber: 1 + Math.floor(index / 2), side: index % 2 === 0 ? MatchSide.HOME : MatchSide.AWAY },
        })),
        later(2, 1), later(2, 2), later(2, 3), later(2, 4),
        later(3, 1), later(3, 2),
        // No game has a start yet: the rule still names the final the slot's tiebreaker game (#2048).
        later(4, 1, true),
      ],
    });

    // --- A bracket contest, opened and entered by three teams ----------------------------------
    const { commissioner, league, bob, cara } = await leagueOfThree('Sixteen');
    const alice = commissioner;
    const contestBody = (overrides: Record<string, unknown> = {}) => ({
      name: `Bracket Pool ${RUN}`,
      sportEventIds: [eventId],
      contestFormat: ContestFormat.PREDICTION,
      selectionType: SelectionType.BRACKET,
      configuration: {
        selectionType: SelectionType.BRACKET,
        maxEntriesPerSquad: 1,
        scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS' as const, config: { roundValues: [1, 2, 4, 8], upsetBonus: { rule: 'NONE' as const } } },
      },
      ...overrides,
    });
    expectFunctionalError(
      await createContest({ client: alice.client, path: { id: league.id }, body: { ...contestBody(), contestFormat: ContestFormat.ROSTER } }),
      { status: 422, code: 'CONTEST_FORMAT_NOT_ALLOWED' },
    );
    // A client still sending the retired starting round (#2172) has it dropped: the bracket is the full one.
    const retiredStartRound = { ...contestBody().configuration, startsAtRound: 3 };
    const contest = await createContest({ client: alice.client, path: { id: league.id }, body: contestBody({ configuration: retiredStartRound }) });
    expect([contest.error, contest.response?.status]).toEqual([undefined, 201]);
    const contestId = expectDefined(contest.data).contest.id;
    const stored = await getFunctionalPrisma().contestConfiguration.findUniqueOrThrow({ where: { contestId } });
    expect(stored.configJson).toEqual({ selectionType: SelectionType.BRACKET });
    expect(expectDefined(contest.data).contest).toMatchObject({ contestFormat: ContestFormat.PREDICTION, selectionType: SelectionType.BRACKET });
    expect((await openContest({ client: alice.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

    const entryOf = async (client: Client) => expectDefined((await enterContest({ client, path: { contestId } })).data).entry.id;
    const entries = { alice: await entryOf(alice.client), bob: await entryOf(bob.client), cara: await entryOf(cara.client) };
    const path = (entryId: string) => ({ contestId, entryId, sportEventId: eventId });
    const pick = (place: MatchPlace, seed: number) => ({ sportEventRoundMatchId: gameId(place), predictedResult: PredictedResult.TEAM, sportEventParticipantId: row(seed), confidence: null });
    // The bracket's 15 games in bracket order: round 1's eight, round 2's four, the semi-finals and the final.
    const BRACKET_ORDER = [1, 2, 3, 4, 5, 6, 7, 8].map((matchNumber) => at(1, matchNumber))
      .concat([1, 2, 3, 4].map((matchNumber) => at(2, matchNumber)), [at(3, 1), at(3, 2), at(4, 1)]);
    const picksOf = (winners: readonly number[]) => winners.map((seed, index) => pick(expectDefined(BRACKET_ORDER[index]), seed));
    const predictedSeeds = (view: { games: Array<MatchPlace & PickSides> }, place: MatchPlace) => {
      const game = expectDefined(view.games.find((each) => isAtPlace(each, place)));
      return predictedHomeAndAway(game);
    };

    // The winners of the 15 games, in bracket order. Chalk: the better seed wins every game.
    const CHALK = [1, 8, 5, 4, 6, 3, 7, 2, 1, 4, 3, 2, 1, 2, 1];
    // Cara: 9, 12, 11 and 10 win in round 1, 12 reaches the semi-final, and 2 wins it all.
    const CARA = [1, 9, 12, 4, 11, 3, 10, 2, 1, 12, 3, 2, 12, 2, 2];

    const fresh = expectMatchesSchema(GamePicksResponseSchema, (await getGamePicks({ client: alice.client, path: path(entries.alice) })).data);
    expect(fresh).toMatchObject({ selectionType: SelectionType.BRACKET, mode: null, gameCount: 15, pickedCount: 0, tiebreakerValue: null, canSubmit: false });
    expect(predictedSeeds(fresh, at(1, 1))).toEqual([row(1), row(16)]);
    // Each team carries its seed, which the bracket shows beside its name.
    expect(pickSideOf(expectDefined(fresh.games.find((game) => isAtPlace(game, at(1, 1)))), HOME_SIDE).predictedTeam?.seedNumber).toBe(1);
    expect(predictedSeeds(fresh, at(2, 1))).toEqual([null, null]);

    // --- Alice fills in the whole bracket in one request, with her tiebreaker ------------------
    const aliceSaved = expectMatchesSchema(GamePicksResponseSchema, (await saveGamePicks({
      client: alice.client, path: path(entries.alice), body: { picks: picksOf(CHALK), tiebreakerValue: 140 },
    })).data);
    expect(aliceSaved).toMatchObject({ pickedCount: 15, tiebreakerValue: 140, canSubmit: true });
    expect(predictedSeeds(aliceSaved, at(4, 1))).toEqual([row(1), row(2)]);
    expect(expectMatchesSchema(GamePicksResponseSchema, (await submitGamePicks({ client: alice.client, path: path(entries.alice) })).data).status)
      .toBe(ContestEntryStatus.SUBMITTED);

    // --- Bob changes an early pick and sees the picks that followed from it cleared -------------
    expect((await saveGamePicks({ client: bob.client, path: path(entries.bob), body: { picks: picksOf(CHALK) } })).data?.pickedCount).toBe(15);
    // A later pick must name a team the entry picked to get there.
    expectFunctionalError(
      await saveGamePicks({ client: bob.client, path: path(entries.bob), body: { picks: [pick(at(2, 1), 16)] } }),
      { status: 400, code: 'PREDICTION_TEAM_NOT_IN_GAME' },
    );
    // Picking 16 over 1 in game 1 strands his 1 seed in game 9, the semi-final and the final.
    const upset = expectMatchesSchema(GamePicksResponseSchema, (await saveGamePicks({ client: bob.client, path: path(entries.bob), body: { picks: [pick(at(1, 1), 16)] } })).data);
    expect(upset.pickedCount).toBe(12);
    expect(upset.games.filter((game) => game.pick === null).map(matchPlaceOf)).toEqual([at(2, 1), at(3, 1), at(4, 1)]);
    expect(predictedSeeds(upset, at(2, 1))).toEqual([row(16), row(8)]);
    expect(predictedSeeds(upset, at(4, 1))).toEqual([null, row(2)]);
    // Clearing game 4 clears his 4 seed in game 10 too.
    const clearedView = expectMatchesSchema(GamePicksResponseSchema, (await clearGamePick({ client: bob.client, path: { ...path(entries.bob), sportEventRoundMatchId: gameId(at(1, 4)) } })).data);
    expect(clearedView.games.filter((game) => game.pick === null).map(matchPlaceOf)).toEqual([at(1, 4), at(2, 1), at(2, 2), at(3, 1), at(4, 1)]);
    // He goes back to chalk, but submits without a tiebreaker first.
    await saveGamePicks({ client: bob.client, path: path(entries.bob), body: { picks: [pick(at(1, 1), 1), pick(at(1, 4), 4), pick(at(2, 1), 1), pick(at(2, 2), 4), pick(at(3, 1), 1), pick(at(4, 1), 1)] } });
    expectFunctionalError(await submitGamePicks({ client: bob.client, path: path(entries.bob) }), { status: 409, code: 'PREDICTION_TIEBREAKER_MISSING' });
    // A prediction contest's tiebreaker rides with its picks, not the entry update.
    expectFunctionalError(
      await updateContestEntry({ client: bob.client, path: { contestId, entryId: entries.bob }, body: { tiebreakerValue: 120 } }),
      { status: 400, code: 'CONTEST_FORMAT_MISMATCH' },
    );
    await saveGamePicks({ client: bob.client, path: path(entries.bob), body: { picks: [], tiebreakerValue: 120 } });
    expect((await submitGamePicks({ client: bob.client, path: path(entries.bob) })).data?.status).toBe(ContestEntryStatus.SUBMITTED);

    // --- Cara picks upsets and submits; an incomplete bracket cannot be submitted ---------------
    await saveGamePicks({ client: cara.client, path: path(entries.cara), body: { picks: picksOf(CARA).slice(0, 14), tiebreakerValue: 150 } });
    expectFunctionalError(await submitGamePicks({ client: cara.client, path: path(entries.cara) }), { status: 409, code: 'PREDICTION_WEEK_INCOMPLETE' });
    await saveGamePicks({ client: cara.client, path: path(entries.cara), body: { picks: [pick(at(4, 1), 2)] } });
    expect((await submitGamePicks({ client: cara.client, path: path(entries.cara) })).data?.status).toBe(ContestEntryStatus.SUBMITTED);

    // Before tip-off nobody sees another team's picks, and there is no leaderboard yet.
    const hidden = expectMatchesSchema(GamePicksResponseSchema, (await getGamePicks({ client: bob.client, path: path(entries.alice) })).data);
    expect(hidden).toMatchObject({ ownEntry: false, pickedCount: 0, tiebreakerValue: null, points: null });
    expect(predictedSeeds(hidden, at(2, 1))).toEqual([null, null]);
    expectFunctionalError(await getBracketLeaderboard({ client: bob.client, path: { contestId } }), { status: 400, code: 'CONTEST_LEADERBOARD_PICKS_HIDDEN' });
    expectFunctionalError(await getContestLeaderboard({ client: bob.client, path: { contestId } }), { status: 400, code: 'CONTEST_LEADERBOARD_PICKS_HIDDEN' });

    // --- Tip-off: every pick and the tiebreaker lock, and the brackets are revealed ------------
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    expect(expectDefined((await getContest({ client: bob.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.ACTIVE);
    expectFunctionalError(
      await saveGamePicks({ client: alice.client, path: path(entries.alice), body: { picks: [pick(at(4, 1), 2)] } }),
      { status: 409, code: 'PREDICTION_GAME_STARTED' },
    );
    expectFunctionalError(
      await saveGamePicks({ client: alice.client, path: path(entries.alice), body: { picks: [], tiebreakerValue: 136 } }),
      { status: 409, code: 'CONTEST_ENTRY_LOCKED' },
    );
    const revealed = expectMatchesSchema(GamePicksResponseSchema, (await getGamePicks({ client: bob.client, path: path(entries.alice) })).data);
    expect(revealed).toMatchObject({ pickedCount: 15, tiebreakerValue: 140, points: 0, maxPossiblePoints: 8 * 1 + 4 * 2 + 2 * 4 + 8 });
    expect(predictedSeeds(revealed, at(4, 1))).toEqual([row(1), row(2)]);
    // A bracket has its own leaderboard: the roster one refuses it.
    expectFunctionalError(await getContestLeaderboard({ client: bob.client, path: { contestId } }), { status: 400, code: 'CONTEST_FORMAT_MISMATCH' });

    const standings = async () => expectMatchesSchema(BracketLeaderboardResponseSchema, (await getBracketLeaderboard({ client: cara.client, path: { contestId } })).data);
    // Each entry's place, points and most possible points; entries sharing a place have no order between them.
    const board = async () => Object.fromEntries((await standings()).entries
      .map((entry) => [entry.entryId, [entry.displayPosition, entry.points, entry.maxPossiblePoints]]));
    expect(await board()).toEqual({
      [entries.alice]: ['T1', 0, 32],
      [entries.bob]: ['T1', 0, 32],
      [entries.cara]: ['T1', 0, 32],
    });

    // --- The results go in, round by round ------------------------------------------------------
    /** The admin enters a game's result: the team seeded `seed` wins it, by `winnerScore` to `loserScore`. */
    const win = async (place: MatchPlace, seed: number, winnerScore = 70, loserScore = 60) => {
      const bracket = expectDefined((await getEventBracket({ client: a, path: { eventId } })).data).matches;
      const game = expectDefined(bracket.find((match) => isAtPlace(match, place)));
      const { homeSportEventParticipantId, awaySportEventParticipantId } = readHomeAway(game);
      const winnerSide = homeSportEventParticipantId === row(seed) ? MatchSide.HOME : MatchSide.AWAY;
      expect([homeSportEventParticipantId, awaySportEventParticipantId]).toContain(row(seed));
      const [homeScore, awayScore] = winnerSide === MatchSide.HOME ? [winnerScore, loserScore] : [loserScore, winnerScore];
      const result = await recordEventMatchResult({ client: a, path: { eventId, ...place }, body: resultBody({ winnerSide, homeScore, awayScore }) });
      expect([result.error, result.response?.status]).toEqual([undefined, 200]);
      // The winner's side is WON on the match the API answers with, on sides (#2184).
      const decided = expectDefined(result.data?.matches.find((match) => isAtPlace(match, place)));
      expect([decided.isFinal, decided.sides.find((side) => side.sportEventParticipantId === row(seed))?.outcome]).toEqual([true, MatchSideOutcome.WON]);
    };
    // Round 1: chalk, except 9 beats 8 in game 2.
    for (const [place, seed] of [[at(1, 1), 1], [at(1, 2), 9], [at(1, 3), 5], [at(1, 4), 4], [at(1, 5), 6], [at(1, 6), 3], [at(1, 7), 7], [at(1, 8), 2]] as const) await win(place, seed);
    // Alice and Bob: 7 of 8, only the 8 seed lost. Cara: 5 of 8, and her 12 seed is out of games 10 and 13.
    expect(await board()).toEqual({
      [entries.alice]: ['T1', 7, 31],
      [entries.bob]: ['T1', 7, 31],
      [entries.cara]: ['3', 5, 23],
    });
    const caraView = expectMatchesSchema(GamePicksResponseSchema, (await getGamePicks({ client: cara.client, path: path(entries.cara) })).data);
    const outcomeOf = (place: MatchPlace) => expectDefined(caraView.games.find((game) => isAtPlace(game, place))).pick;
    expect(outcomeOf(at(1, 2))).toMatchObject({ outcome: PickOutcome.CORRECT, points: 1 });
    expect(outcomeOf(at(1, 3))).toMatchObject({ outcome: PickOutcome.BUSTED, points: 0 });
    expect(outcomeOf(at(3, 1))).toMatchObject({ outcome: PickOutcome.BUSTED, points: 0 });
    expect(outcomeOf(at(4, 1))).toMatchObject({ outcome: PickOutcome.PENDING, points: null });

    // Round 2 and the semi-finals: chalk.
    for (const [place, seed] of [[at(2, 1), 1], [at(2, 2), 4], [at(2, 3), 3], [at(2, 4), 2]] as const) await win(place, seed);
    expect(await board()).toEqual({
      [entries.alice]: ['T1', 15, 31],
      [entries.bob]: ['T1', 15, 31],
      [entries.cara]: ['3', 11, 23],
    });
    for (const [place, seed] of [[at(3, 1), 1], [at(3, 2), 2]] as const) await win(place, seed);
    expect(await board()).toEqual({
      [entries.alice]: ['T1', 23, 31],
      [entries.bob]: ['T1', 23, 31],
      [entries.cara]: ['3', 15, 23],
    });
    expect((await standings()).finalTotalPoints).toBeNull();

    // The final: 1 beats 2, 70 to 66, a total of 136. Alice guessed 140, Bob 120.
    await win(at(4, 1), 1, 70, 66);
    const decided = await standings();
    expect(decided.finalTotalPoints).toBe(136);
    expect(decided.entries.map((entry) => [entry.entryId, entry.displayPosition, entry.points, entry.maxPossiblePoints, entry.correctPickCount, entry.tiebreakerValue])).toEqual([
      [entries.alice, '1', 31, 31, 14, 140],
      [entries.bob, '2', 31, 31, 14, 120],
      [entries.cara, '3', 15, 15, 9, 150],
    ]);
    // Each entry's champion pick, with its seed: right for Alice and Bob, Cara's 2 seed out.
    expect(decided.entries.map((entry) => [entry.entryId, entry.champion?.sportEventParticipantId, entry.champion?.seedNumber, entry.champion?.outcome])).toEqual([
      [entries.alice, row(1), 1, PickOutcome.CORRECT],
      [entries.bob, row(1), 1, PickOutcome.CORRECT],
      [entries.cara, row(2), 2, PickOutcome.BUSTED],
    ]);

    // --- Settled ---------------------------------------------------------------------------------
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(expectDefined((await getContest({ client: bob.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    const frozen = await getFunctionalPrisma().contestEntryStanding.findMany({ where: { contestId }, orderBy: { position: 'asc' } });
    expect(frozen.map((standing) => [standing.contestEntryId, standing.totalScore, standing.displayPosition])).toEqual([
      [entries.alice, 31, '1'],
      [entries.bob, 31, '2'],
      [entries.cara, 15, '3'],
    ]);
    // A score correction after settlement moves the final's total to 130, which would level Alice
    // and Bob (both 10 away); the settled places stand.
    await win(at(4, 1), 1, 70, 60);
    const settled = await standings();
    expect(settled.finalTotalPoints).toBe(130);
    expect(settled.entries.map((entry) => [entry.entryId, entry.displayPosition, entry.points])).toEqual([
      [entries.alice, '1', 31],
      [entries.bob, '2', 31],
      [entries.cara, '3', 15],
    ]);
  });

  it('pairs a reseeded round from each entry\'s own picks, as the NFL\'s Divisional round is, and settles the contest on the real reseeded results', async () => {
    // One NFL-shaped conference: the 1 seed on a bye, Wild Card games linking nowhere, a Divisional
    // round placed by seed and a conference final fed by links.
    const wildCard = (matchNumber: number, home: number, away: number): BracketMatchInput => ({ matchNumber, roundNumber: 1, home, away, advancesTo: null, regionLabel: 'AFC' });
    const { admin: a, eventId, row, seedOf, gameId } = await releasedKnockout({
      label: 'Reseed',
      seeds: [1, 2, 3, 4, 5, 6, 7],
      rounds: 3,
      tierSize: 2,
      // Wild Card, a Divisional round the pairing reseeds, and the conference final.
      roundSlots: [{ slotKind: 'QUARTERFINAL' }, { slotKind: 'SEMIFINAL', pairing: 'RESEEDED' }, { slotKind: 'FINAL' }],
      matches: [
        wildCard(1, 2, 7), wildCard(2, 3, 6), wildCard(3, 4, 5),
        { matchNumber: 1, roundNumber: 2, home: 1, away: null, advancesTo: { ...at(3, 1), side: MatchSide.HOME }, regionLabel: 'AFC' },
        { matchNumber: 2, roundNumber: 2, home: null, away: null, advancesTo: { ...at(3, 1), side: MatchSide.AWAY }, regionLabel: 'AFC' },
        { matchNumber: 1, roundNumber: 3, home: null, away: null, advancesTo: null, regionLabel: 'AFC' },
      ],
    });
    const { commissioner, league, bob } = await leagueOfThree('Reseed');
    const contest = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: `Playoff Bracket ${RUN}`,
        sportEventIds: [eventId],
        contestFormat: ContestFormat.PREDICTION,
        selectionType: SelectionType.BRACKET,
        configuration: {
          selectionType: SelectionType.BRACKET,
          maxEntriesPerSquad: 1,
          scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues: [1, 2, 4], upsetBonus: { rule: 'NONE' } } },
        },
      },
    });
    expect([contest.error, contest.response?.status]).toEqual([undefined, 201]);
    const contestId = expectDefined(contest.data).contest.id;
    await openContest({ client: commissioner.client, path: { id: league.id, contestId } });
    const aliceEntry = expectDefined((await enterContest({ client: commissioner.client, path: { contestId } })).data).entry.id;
    const bobEntry = expectDefined((await enterContest({ client: bob.client, path: { contestId } })).data).entry.id;
    const path = (entryId: string) => ({ contestId, entryId, sportEventId: eventId });
    const pick = (place: MatchPlace, seed: number) => ({ sportEventRoundMatchId: gameId(place), predictedResult: PredictedResult.TEAM, sportEventParticipantId: row(seed), confidence: null });
    const divisional = (view: { games: Array<MatchPlace & PickSides> }) =>
      [at(2, 1), at(2, 2)].map((place) => {
        const game = expectDefined(view.games.find((each) => isAtPlace(each, place)));
        return predictedHomeAndAway(game).map((id) => seedOf(id));
      });

    // Alice has the 7 upsetting the 2, so her Divisional round is 1-7 and 3-5; she takes the 5 to the final.
    const aliceView = expectMatchesSchema(GamePicksResponseSchema, (await saveGamePicks({
      client: commissioner.client, path: path(aliceEntry), body: { picks: [pick(at(1, 1), 7), pick(at(1, 2), 3), pick(at(1, 3), 5), pick(at(2, 1), 1), pick(at(2, 2), 5), pick(at(3, 1), 5)], tiebreakerValue: 41 },
    })).data);
    expect(divisional(aliceView)).toEqual([[1, 7], [3, 5]]);
    // With the 2 through instead, the 5 is reseeded to visit the 1, so her picks of the 5 in the Divisional round's game 2 and the final go.
    const repaired = expectMatchesSchema(GamePicksResponseSchema, (await saveGamePicks({ client: commissioner.client, path: path(aliceEntry), body: { picks: [pick(at(1, 1), 2)] } })).data);
    expect(divisional(repaired)).toEqual([[1, 5], [2, 3]]);
    expect(repaired.games.filter((game) => game.pick === null).map(matchPlaceOf)).toEqual([at(2, 2), at(3, 1)]);
    await saveGamePicks({ client: commissioner.client, path: path(aliceEntry), body: { picks: [pick(at(1, 1), 7), pick(at(2, 2), 5), pick(at(3, 1), 5)] } });
    expect((await submitGamePicks({ client: commissioner.client, path: path(aliceEntry) })).data?.status).toBe(ContestEntryStatus.SUBMITTED);

    // Bob picks every home team: 2, 3 and 4 through, the 1 and the 2 in the final, the 1 champion.
    await saveGamePicks({
      client: bob.client, path: path(bobEntry), body: { picks: [pick(at(1, 1), 2), pick(at(1, 2), 3), pick(at(1, 3), 4), pick(at(2, 1), 1), pick(at(2, 2), 2), pick(at(3, 1), 1)], tiebreakerValue: 40 },
    });
    expect((await submitGamePicks({ client: bob.client, path: path(bobEntry) })).data?.status).toBe(ContestEntryStatus.SUBMITTED);

    // --- The playoff: Wild Card weekend, the admin's reseed, then the rest -----------------------
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    await recordEventMatchResult({ client: a, path: { eventId, ...at(1, 1) }, body: resultBody({ winnerSide: MatchSide.AWAY, homeScore: 17, awayScore: 24 }) });
    await recordEventMatchResult({ client: a, path: { eventId, ...at(1, 2) }, body: resultBody({ winnerSide: MatchSide.HOME, homeScore: 31, awayScore: 10 }) });
    await recordEventMatchResult({ client: a, path: { eventId, ...at(1, 3) }, body: resultBody({ winnerSide: MatchSide.AWAY, homeScore: 20, awayScore: 23 }) });
    const proposal = expectMatchesSchema(SportEventRoundMatchupsResponseSchema, (await proposeEventRoundMatchups({ client: a, path: { eventId, roundNumber: 2 } })).data).matches;
    expect((await setEventRoundMatchups({ client: a, path: { eventId, roundNumber: 2 }, body: { matches: proposal } })).response?.status).toBe(200);
    // The 1 beats the 7; the 5 beats the 3; the 5 wins the final 23 to 20.
    await recordEventMatchResult({ client: a, path: { eventId, ...at(2, 1) }, body: resultBody({ winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 14 }) });
    await recordEventMatchResult({ client: a, path: { eventId, ...at(2, 2) }, body: resultBody({ winnerSide: MatchSide.AWAY, homeScore: 16, awayScore: 19 }) });
    await recordEventMatchResult({ client: a, path: { eventId, ...at(3, 1) }, body: resultBody({ winnerSide: MatchSide.AWAY, homeScore: 20, awayScore: 23 }) });

    // Alice: all three Wild Card games (3), the 1 and the 5 in the Divisional round (4), the 5 champion (4).
    // Bob: only the 3 (1) and the 1 in the Divisional round (2); his 2 and his champion 1 are busted.
    const leaderboard = expectMatchesSchema(BracketLeaderboardResponseSchema, (await getBracketLeaderboard({ client: bob.client, path: { contestId } })).data);
    expect(leaderboard.finalTotalPoints).toBe(43);
    expect(leaderboard.entries.map((entry) => [entry.entryId, entry.displayPosition, entry.points, entry.maxPossiblePoints])).toEqual([
      [aliceEntry, '1', 11, 11],
      [bobEntry, '2', 3, 3],
    ]);

    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(expectDefined((await getContest({ client: bob.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    const frozen = await getFunctionalPrisma().contestEntryStanding.findMany({ where: { contestId }, orderBy: { position: 'asc' } });
    expect(frozen.map((standing) => [standing.contestEntryId, standing.totalScore, standing.displayPosition])).toEqual([[aliceEntry, 11, '1'], [bobEntry, 3, '2']]);
  });

  it('leaves an event\'s play-in out of a bracket whose template covers the rounds after it, scoring its first covered round at the first round value', async () => {
    // A play-in is the event's round 1 (#2184): seeds 4 and 5 play for the place against the 1
    // seed in round 2. The contest's setup lists the semi-final and final slots only.
    const { admin: a, eventId, sportLeagueId, row, gameId } = await releasedKnockout({
      label: 'PlayIn',
      seeds: [1, 2, 3, 4, 5],
      rounds: 3,
      tierSize: 1,
      roundSlots: [{ slotKind: 'PLAY_IN' }, { slotKind: 'SEMIFINAL' }, { slotKind: 'FINAL' }],
      matches: [
        { matchNumber: 1, roundNumber: 1, home: 4, away: 5, advancesTo: { ...at(2, 1), side: MatchSide.AWAY } },
        { matchNumber: 1, roundNumber: 2, home: 1, away: null, advancesTo: { ...at(3, 1), side: MatchSide.HOME } },
        { matchNumber: 2, roundNumber: 2, home: 2, away: 3, advancesTo: { ...at(3, 1), side: MatchSide.AWAY } },
        { matchNumber: 1, roundNumber: 3, home: null, away: null, advancesTo: null },
      ],
    });
    const db = getFunctionalPrisma();
    const eventSlots = await db.sportEventSlot.findMany({
      where: { sportEventId: eventId },
      select: { seasonSlot: { select: { sportLeagueCompetitionSlotId: true, definition: { select: { slotKind: true } } } } },
    });
    const definitionOf = (slotKind: string) => expectDefined(eventSlots.find((slot) => slot.seasonSlot.definition.slotKind === slotKind), slotKind).seasonSlot.sportLeagueCompetitionSlotId;
    const template = await db.contestConfigTemplate.create({
      data: {
        sportLeagueId,
        contestFormat: ContestFormat.PREDICTION,
        selectionType: SelectionType.BRACKET,
        templateKey: `play-in-bracket-${RUN}`,
        name: 'Bracket',
        description: 'Pick every game from the semi-finals on.',
        sortOrder: 1,
        coverageMode: 'ALL_LISTED',
        configJson: {
          selectionType: SelectionType.BRACKET,
          maxEntriesPerSquad: 1,
          scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues: [1, 4], upsetBonus: { rule: 'NONE' } } },
        },
      },
    });
    await db.contestConfigTemplateSlot.createMany({
      data: ['SEMIFINAL', 'FINAL'].map((slotKind) => ({ sportLeagueId, templateId: template.id, sportLeagueCompetitionSlotId: definitionOf(slotKind) })),
    });
    const win = async (place: MatchPlace, winnerSide: MatchSide) => {
      const result = await recordEventMatchResult({ client: a, path: { eventId, ...place }, body: resultBody({ winnerSide, homeScore: 70, awayScore: 60 }) });
      expect([result.error, result.response?.status]).toEqual([undefined, 200]);
    };

    const { commissioner, league } = await leagueOfThree('PlayIn');
    const created = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: { name: `Play-in Bracket ${RUN}`, sportEventIds: [eventId], contestFormat: ContestFormat.PREDICTION, selectionType: SelectionType.BRACKET, templateId: template.id },
    });
    const contestId = expectDefined(created.data, JSON.stringify(created.error)).contest.id;
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);
    const entryId = expectDefined((await enterContest({ client: commissioner.client, path: { contestId } })).data).entry.id;
    const path = { contestId, entryId, sportEventId: eventId };
    const pick = (place: MatchPlace, seed: number) => ({ sportEventRoundMatchId: gameId(place), predictedResult: PredictedResult.TEAM, sportEventParticipantId: row(seed), confidence: null });

    // The bracket asks the three games from the semi-finals on, and no pick of the play-in.
    const fresh = expectMatchesSchema(GamePicksResponseSchema, (await getGamePicks({ client: commissioner.client, path })).data);
    expect([fresh.gameCount, fresh.games.map(matchPlaceOf)]).toEqual([3, [at(2, 1), at(2, 2), at(3, 1)]]);
    expectFunctionalError(
      await saveGamePicks({ client: commissioner.client, path, body: { picks: [pick(at(1, 1), 4)] } }),
      { status: 404, code: 'PREDICTION_GAME_NOT_FOUND' },
    );

    // The play-in's winner takes its semi-final place as a real team, and the entry picks every game.
    await win(at(1, 1), MatchSide.HOME);
    const saved = expectMatchesSchema(GamePicksResponseSchema, (await saveGamePicks({
      client: commissioner.client, path, body: { picks: [pick(at(2, 1), 1), pick(at(2, 2), 2), pick(at(3, 1), 1)], tiebreakerValue: 130 },
    })).data);
    expect(saved).toMatchObject({ pickedCount: 3, gameCount: 3, canSubmit: true });
    expect((await submitGamePicks({ client: commissioner.client, path })).data?.status).toBe(ContestEntryStatus.SUBMITTED);

    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    await win(at(2, 1), MatchSide.HOME);
    await win(at(2, 2), MatchSide.HOME);
    await win(at(3, 1), MatchSide.HOME);

    // Two semi-final wins at the first value, 1 each, and the final at the second, 4.
    const board = expectMatchesSchema(BracketLeaderboardResponseSchema, (await getBracketLeaderboard({ client: commissioner.client, path: { contestId } })).data);
    expect(board.entries.map((entry) => [entry.entryId, entry.points, entry.maxPossiblePoints])).toEqual([[entryId, 6, 6]]);
  });
});
