import {
  addEventParticipants,
  applyEventParticipantUpload,
  autoAssignEventPrices,
  autoAssignEventTiers,
  clearEventMatchResult,
  createEvent,
  createParticipant,
  createSportLeague,
  getEventBracket,
  listEventParticipants,
  listSports,
  loadEventBracket,
  proposeEventRoundMatchups,
  recordEventMatchResult,
  releaseEvent,
  setEventRoundMatchups,
  transitionEvent,
  updateSportLeague,
} from '@poolmaster/shared/generated/hey-api';
import { BracketAdvancement, MatchSide, MatchStatus, ParticipantStandingStatus, Sport, findSportRow } from '@poolmaster/shared/domain';
import { SportEventBracketResponseSchema, SportEventRoundMatchupsResponseSchema } from '@poolmaster/shared/dto';
import { buildRegisteredUser, promoteToRootAdmin } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';
import { expectDefined } from '../support/expect-defined';
import { standardEventPricing } from '../support/budget-pricing';
import { expectMatchesSchema } from '../support/expect-matches-schema';

// A reseeded bracket end to end over HTTP (#722), shaped like one NFL conference: seven seeds, the
// 1 seed on a bye, Wild Card games that link nowhere, a Divisional round the admin places by seed,
// and a conference final fed by links. The server proposes the reseed, the admin sets it, and the
// results then run to a champion. A Wild Card correction moves the team it placed until that
// team's next game is played.

const RUN = `reseed-${Date.now()}`;
const SEEDS = [1, 2, 3, 4, 5, 6, 7] as const;

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

describe('SDK Functional: Reseeded bracket', () => {
  it('places the Divisional round by seed after Wild Card weekend, moves a placed team when its result is corrected, and crowns the conference champion', async () => {
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await getFunctionalPrisma().sport.upsert({
      where: { sport: Sport.BASKETBALL },
      create: { sport: Sport.BASKETBALL, participantType: 'TEAM', tournamentFormat: 'KNOCKOUT_BRACKET' },
      update: {},
    });
    const admin = await buildRegisteredUser({ displayName: 'Playoff Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectDefined((await listSports({ client: a })).data).sports, Sport.BASKETBALL)).id;

    // --- A league that reseeds, and its playoff -------------------------------------------------
    const league = await createSportLeague({ client: a, body: { sport: Sport.BASKETBALL, name: `Gridiron Conference ${RUN}`, bracketAdvancement: BracketAdvancement.RESEED_BY_SEED } });
    expect(league.data?.sportLeague.bracketAdvancement).toBe(BracketAdvancement.RESEED_BY_SEED);
    const sportLeagueId = expectDefined(league.data).sportLeague.id;
    created.sportLeagueIds.add(sportLeagueId);
    const playoff = await createEvent({
      client: a,
      body: { sportLeagueId, eventYear: 2099, name: `Conference Playoff ${RUN}`, startDate: '2099-01-09T18:00:00.000Z', rounds: 3, autoLifecycleEnabled: false },
    });
    const eventId = expectDefined(playoff.data).event.id;
    created.sportEventIds.add(eventId);

    const teamIds: string[] = [];
    for (const seed of SEEDS) {
      const participant = await createParticipant({ client: a, body: { sportId, participantType: 'TEAM', name: `Seed ${seed} ${RUN}` } });
      const id = expectDefined(participant.data).participant.id;
      created.participantIds.add(id);
      teamIds.push(id);
    }
    await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: teamIds } });
    await applyEventParticipantUpload({
      client: a,
      path: { eventId },
      body: { rows: SEEDS.map((seed) => ({ playerName: `Seed ${seed} ${RUN}`, seedNumber: seed, oddsToWin: seed * 3 })) },
    });
    expect((await autoAssignEventTiers({ client: a, path: { eventId }, body: { source: 'ODDS', tierSize: 2 } })).response.status).toBe(200);
    expect((await autoAssignEventPrices({ client: a, path: { eventId }, body: standardEventPricing() })).response.status).toBe(200);

    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    const seedRow = (seed: number) => expectDefined(field.find((row) => row.participant.name === `Seed ${seed} ${RUN}`)).id;
    const seedOf = (rowId: string | null) => (rowId === null ? null : expectDefined(field.find((row) => row.id === rowId)).seedNumber);
    const sidesOf = (matches: readonly { matchNumber: number; homeSportEventParticipantId: string | null; awaySportEventParticipantId: string | null }[], matchNumber: number) => {
      const match = expectDefined(matches.find((candidate) => candidate.matchNumber === matchNumber));
      return [seedOf(match.homeSportEventParticipantId), seedOf(match.awaySportEventParticipantId)];
    };

    const wildCard = (matchNumber: number, home: number, away: number) => ({
      matchNumber, roundNumber: 1, homeSportEventParticipantId: seedRow(home), awaySportEventParticipantId: seedRow(away),
      isNeutralSite: false, scheduledDate: null, advancesTo: null, regionLabel: 'AFC',
    });
    const loaded = await loadEventBracket({
      client: a,
      path: { eventId },
      body: {
        matches: [
          wildCard(1, 2, 7),
          wildCard(2, 3, 6),
          wildCard(3, 4, 5),
          { matchNumber: 4, roundNumber: 2, homeSportEventParticipantId: seedRow(1), awaySportEventParticipantId: null, isNeutralSite: false, scheduledDate: null, advancesTo: { matchNumber: 6, side: MatchSide.HOME }, regionLabel: 'AFC' },
          { matchNumber: 5, roundNumber: 2, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: false, scheduledDate: null, advancesTo: { matchNumber: 6, side: MatchSide.AWAY }, regionLabel: 'AFC' },
          { matchNumber: 6, roundNumber: 3, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: false, scheduledDate: null, advancesTo: null, regionLabel: 'AFC' },
        ],
      },
    });
    expect([loaded.error, loaded.data?.matches.map((match) => match.regionLabel)]).toEqual([undefined, ['AFC', 'AFC', 'AFC', 'AFC', 'AFC', 'AFC']]);

    // A draft is placed through the bracket itself, not by reseeding.
    expectFunctionalError(await proposeEventRoundMatchups({ client: a, path: { eventId, roundNumber: 2 } }), { status: 409, code: 'SPORT_EVENT_NOT_RELEASED' });
    // The Divisional round waits on its teams, and release lets it.
    const released = await releaseEvent({ client: a, path: { eventId } });
    expect([released.error, released.data?.event.status]).toEqual([undefined, 'SCHEDULED']);
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');

    // --- What reseeding refuses -----------------------------------------------------------------
    expectFunctionalError(await proposeEventRoundMatchups({ client: a, path: { eventId, roundNumber: 2 } }), { status: 409, code: 'BRACKET_ROUND_NOT_FINISHED' });
    expectFunctionalError(await proposeEventRoundMatchups({ client: a, path: { eventId, roundNumber: 3 } }), { status: 422, code: 'BRACKET_NOT_RESEEDED' });
    await updateSportLeague({ client: a, path: { sportLeagueId }, body: { bracketAdvancement: BracketAdvancement.FIXED } });
    expectFunctionalError(await proposeEventRoundMatchups({ client: a, path: { eventId, roundNumber: 2 } }), { status: 422, code: 'BRACKET_NOT_RESEEDED' });
    await updateSportLeague({ client: a, path: { sportLeagueId }, body: { bracketAdvancement: BracketAdvancement.RESEED_BY_SEED } });

    // --- Wild Card weekend: the 7 upsets the 2, the 3 and the 5 win -------------------------------
    await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 1 }, body: { winnerSide: MatchSide.AWAY, homeScore: 17, awayScore: 24 } });
    await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 2 }, body: { winnerSide: MatchSide.HOME, homeScore: 31, awayScore: 10 } });
    const weekend = await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 3 }, body: { winnerSide: MatchSide.AWAY, homeScore: 20, awayScore: 23 } });
    // No winner moves on by itself: each still waits to be placed.
    expect([sidesOf(expectDefined(weekend.data).matches, 4), sidesOf(expectDefined(weekend.data).matches, 5)]).toEqual([[1, null], [null, null]]);

    // --- The reseed: the 1 hosts the 7, the 3 hosts the 5 ----------------------------------------
    const proposal = expectMatchesSchema(SportEventRoundMatchupsResponseSchema, (await proposeEventRoundMatchups({ client: a, path: { eventId, roundNumber: 2 } })).data).matches;
    expect(proposal.map((matchup) => [matchup.matchNumber, seedOf(matchup.homeSportEventParticipantId), seedOf(matchup.awaySportEventParticipantId)])).toEqual([
      [4, 1, 7],
      [5, 3, 5],
    ]);
    expectFunctionalError(
      await setEventRoundMatchups({
        client: a,
        path: { eventId, roundNumber: 2 },
        body: { matches: [
          { matchNumber: 4, homeSportEventParticipantId: seedRow(3), awaySportEventParticipantId: seedRow(7) },
          { matchNumber: 5, homeSportEventParticipantId: seedRow(1), awaySportEventParticipantId: seedRow(5) },
        ] },
      }),
      { status: 422, code: 'BRACKET_INVALID' },
    );
    const placed = await setEventRoundMatchups({ client: a, path: { eventId, roundNumber: 2 }, body: { matches: proposal } });
    const placedMatches = expectMatchesSchema(SportEventBracketResponseSchema, placed.data).matches;
    expect([sidesOf(placedMatches, 4), sidesOf(placedMatches, 5)]).toEqual([[1, 7], [3, 5]]);

    // The 6 had won after all: it takes the 3's place.
    const corrected = await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 2 }, body: { winnerSide: MatchSide.AWAY, homeScore: 10, awayScore: 13 } });
    expect(sidesOf(expectDefined(corrected.data).matches, 5)).toEqual([6, 5]);

    // --- The Divisional round is played, which locks Wild Card weekend and the reseed -------------
    await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 4 }, body: { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 14 } });
    await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 5 }, body: { winnerSide: MatchSide.AWAY, homeScore: 16, awayScore: 19 } });
    expectFunctionalError(
      await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 2 }, body: { winnerSide: MatchSide.HOME, homeScore: 31, awayScore: 10 } }),
      { status: 409, code: 'SPORT_EVENT_MATCH_RESULT_LOCKED' },
    );
    expectFunctionalError(await clearEventMatchResult({ client: a, path: { eventId, matchNumber: 2 } }), { status: 409, code: 'SPORT_EVENT_MATCH_RESULT_LOCKED' });
    expectFunctionalError(
      await setEventRoundMatchups({ client: a, path: { eventId, roundNumber: 2 }, body: { matches: proposal } }),
      { status: 409, code: 'BRACKET_ROUND_ALREADY_PLAYED' },
    );

    // --- The conference final, fed by links ------------------------------------------------------
    const bracket = expectDefined((await getEventBracket({ client: a, path: { eventId } })).data).matches;
    expect(sidesOf(bracket, 6)).toEqual([1, 5]);
    const final = await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 6 }, body: { winnerSide: MatchSide.AWAY, homeScore: 20, awayScore: 23 } });
    expect(expectDefined(final.data).matches.find((match) => match.matchNumber === 6)?.status).toBe(MatchStatus.COMPLETED);

    const standings = await getFunctionalPrisma().sportEventParticipantStanding.findMany({ where: { sportEventParticipant: { sportEventId: eventId } } });
    const standingOf = (seed: number) => expectDefined(standings.find((row) => row.sportEventParticipantId === seedRow(seed)));
    expect([standingOf(5).position, standingOf(5).status]).toEqual([1, ParticipantStandingStatus.COMPLETE]);
    expect([standingOf(1).position, standingOf(1).status]).toEqual([2, ParticipantStandingStatus.ELIMINATED]);
    expect(standingOf(7).currentRound).toBe(2);
  });
});
