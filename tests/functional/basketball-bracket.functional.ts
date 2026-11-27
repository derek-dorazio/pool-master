import { deleteTestSportLeagues } from '../support/test-slots';
import {
  addEventParticipants,
  autoAssignEventSlotPrices,
  autoAssignEventSlotTiers,
  createParticipant,
  getEventBracket,
  listEventParticipants,
  loadEventBracket,
  releaseEvent,
  removeEventParticipant,
  updateEventBracketMatch,
  updateEventParticipants,
} from '@poolmaster/shared/generated/hey-api';
import { HomeAway, isAtPlace, MatchSideOutcome, MatchStatus, Sport } from '@poolmaster/shared/domain';
import {
  AddSportEventParticipantsResponseSchema,
  SportEventBracketResponseSchema,
  SportEventRoundMatchResponseSchema,
} from '@poolmaster/shared/dto';
import { buildRegisteredUser, promoteToRootAdmin, createTestEvent } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';
import { expectDefined } from '../support/expect-defined';
import { standardPricingFor } from './standard-pricing';
import { expectMatchesSchema } from '../support/expect-matches-schema';
import { sportRowKeys } from '../support/sport-rows';
import { insertTestSportLeague } from '../support/test-sport-league';
import { setFieldRows } from './field-rows';
import { tierSetSlotPath } from './tier-set-slot';

// A basketball bracket end to end over HTTP (#698): an admin builds a four-team tournament in the
// run's own league, loads its bracket, and releases it only once the bracket holds the whole
// field. After release the pairings and seeds are locked while a match's time can still move.

const RUN = `basketball-${Date.now()}`;
// Seeds, best first; the seeds also order the field into its four tiers, one team to a tier.
const FIELD: readonly { name: string; seed: number }[] = [
  { name: 'Duke', seed: 1 },
  { name: 'Houston', seed: 2 },
  { name: 'Vermont', seed: 15 },
  { name: 'Texas', seed: 16 },
];

const created = {
  sportEventIds: new Set<string>(),
  participantIds: new Set<string>(),
  sportLeagueIds: new Set<string>(),
};

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  if (eventIds.length) {
    await db.sportEventRoundMatch.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventSlotParticipantValuation.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventSlotTier.deleteMany({ where: { slot: { sportEventId: { in: eventIds } } } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
  }
  if (created.participantIds.size) {
    await db.participant.deleteMany({ where: { id: { in: [...created.participantIds] } } });
  }
  if (created.sportLeagueIds.size) {
    await deleteTestSportLeagues(db, [...created.sportLeagueIds]);
  }
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Basketball bracket', () => {
  it('releases a tournament only once its bracket holds the field, then locks pairings and seeds while a match\'s time can still move', async () => {
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await getFunctionalPrisma().sport.upsert({
      where: { sport: Sport.BASKETBALL },
      create: { sport: Sport.BASKETBALL, ...sportRowKeys(Sport.BASKETBALL) },
      update: {},
    });
    const admin = await buildRegisteredUser({ displayName: 'Bracket Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;

    // --- A league, a tournament in it, and its field --------------------------------------------
    const conference = await insertTestSportLeague(getFunctionalPrisma(), { sport: Sport.BASKETBALL, name: `Harbour Conference ${RUN}` });
    const sportLeagueId = conference.id;
    created.sportLeagueIds.add(sportLeagueId);

    const tournament = await createTestEvent({
      client: a,
      body: { sportLeagueId: sportLeagueId, championshipYear: 2099, name: `Harbour Classic ${RUN}`, startDate: '2099-03-19T16:00:00.000Z', rounds: 2, autoLifecycleEnabled: false },
    });
    expect(tournament.response?.status).toBe(201);
    const eventId = expectDefined(tournament.data).event.id;
    created.sportEventIds.add(eventId);

    const teamIdOf = new Map<string, string>();
    for (const name of FIELD.map((team) => team.name)) {
      const participant = await createParticipant({ client: a, body: { sportLeagueId, participantType: 'TEAM', name: `${name} ${RUN}` } });
      const id = expectDefined(participant.data).participant.id;
      created.participantIds.add(id);
      teamIdOf.set(name, id);
    }
    const fieldTeamIds = FIELD.map((team) => expectDefined(teamIdOf.get(team.name)));
    const added = await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: fieldTeamIds } });
    expect(expectMatchesSchema(AddSportEventParticipantsResponseSchema, added.data).added).toBe(4);

    const upload = await setFieldRows({
      client: a,
      path: { eventId },
      body: { rows: FIELD.map((team) => ({ playerName: `${team.name} ${RUN}`, seedNumber: team.seed })) },
    });
    expect(upload.response?.status).toBe(200);
    expect((await autoAssignEventSlotTiers({ client: a, path: await tierSetSlotPath(a, eventId), body: { tierSize: 1 } })).response?.status).toBe(200);
    expect((await autoAssignEventSlotPrices({ client: a, path: await tierSetSlotPath(a, eventId), body: await standardPricingFor(a) })).response?.status).toBe(200);

    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    const rowOf = (name: string) => expectDefined(field.find((row) => row.participant.name === `${name} ${RUN}`)).id;

    // --- No release without a bracket, and no bracket with two finals ---------------------------
    const early = await releaseEvent({ client: a, path: { eventId } });
    expectFunctionalError(early, { status: 422, code: 'SPORT_EVENT_NOT_READY' });
    expect(JSON.stringify(early.error)).toContain('its bracket is not loaded');
    expect(expectMatchesSchema(SportEventBracketResponseSchema, (await getEventBracket({ client: a, path: { eventId } })).data).matches).toEqual([]);

    /** Both sides of a match at a neutral site, side 1 first (#2184). */
    const neutralSides = (sideOne: string | null, sideTwo: string | null) => [
      { sideNumber: 1, sportEventParticipantId: sideOne, homeAway: HomeAway.NONE },
      { sideNumber: 2, sportEventParticipantId: sideTwo, homeAway: HomeAway.NONE },
    ];
    const firstRound = [
      { matchNumber: 1, roundNumber: 1, sides: neutralSides(rowOf('Texas'), rowOf('Duke')), isNeutralSite: true, scheduledDate: '2099-03-19T16:00:00.000Z', advancesTo: { roundNumber: 2, matchNumber: 1, sideNumber: 2 } },
      { matchNumber: 2, roundNumber: 1, sides: neutralSides(rowOf('Vermont'), rowOf('Houston')), isNeutralSite: true, scheduledDate: '2099-03-19T19:00:00.000Z', advancesTo: { roundNumber: 2, matchNumber: 1, sideNumber: 1 } },
    ];
    expectFunctionalError(
      await loadEventBracket({
        client: a,
        path: { eventId },
        // Game 1 links nowhere while game 2 feeds a final, so two games end the bracket. (Games
        // none of which link are a week's games, which load: #715.)
        body: {
          matches: [
            { ...expectDefined(firstRound[0]), advancesTo: null },
            expectDefined(firstRound[1]),
            { matchNumber: 1, roundNumber: 2, sides: neutralSides(null, null), isNeutralSite: true, scheduledDate: null, advancesTo: null },
          ],
        },
      }),
      { status: 422, code: 'BRACKET_INVALID' },
    );

    // --- The bracket loads whole and reads back round by round ----------------------------------
    const loaded = await loadEventBracket({
      client: a,
      path: { eventId },
      body: {
        matches: [
          ...firstRound,
          { matchNumber: 1, roundNumber: 2, sides: neutralSides(null, null), isNeutralSite: true, scheduledDate: null, advancesTo: null },
        ],
      },
    });
    expect(loaded.response?.status).toBe(200);
    const bracket = expectMatchesSchema(SportEventBracketResponseSchema, (await getEventBracket({ client: a, path: { eventId } })).data).matches;
    expect(bracket.map((match) => [match.matchNumber, match.roundNumber, match.status])).toEqual([
      [1, 1, MatchStatus.SCHEDULED], [2, 1, MatchStatus.SCHEDULED], [1, 2, MatchStatus.SCHEDULED],
    ]);
    const final = expectDefined(bracket.find((match) => isAtPlace(match, { roundNumber: 2, matchNumber: 1 })));
    // Each game's winner fills a side of the final, by side number; the final's sides wait empty.
    expect(bracket.filter((match) => match.advancesTo?.matchId === final.id).map((match) => match.advancesTo?.sideNumber ?? 0).sort((left, right) => left - right))
      .toEqual([1, 2]);
    expect(final.sides.map((side) => [side.sideNumber, side.sportEventParticipantId, side.outcome])).toEqual([[1, null, MatchSideOutcome.PENDING], [2, null, MatchSideOutcome.PENDING]]);
    expect(final.games.map((game) => [game.gameNumber, game.isFinal, game.sideResults.map((result) => result.homeAway)])).toEqual([[1, false, [HomeAway.NONE, HomeAway.NONE]]]);

    const release = await releaseEvent({ client: a, path: { eventId } });
    expect(release.error).toBeUndefined();
    expect(release.data?.event.status).toBe('SCHEDULED');

    // --- Released: pairings, seeds and the bracket's teams are locked, a time is not ------------
    expectFunctionalError(
      await loadEventBracket({ client: a, path: { eventId }, body: { matches: firstRound } }),
      { status: 409, code: 'SPORT_EVENT_BRACKET_LOCKED' },
    );
    expectFunctionalError(
      await updateEventBracketMatch({ client: a, path: { eventId, roundNumber: 1, matchNumber: 1 }, body: { sides: [{ sideNumber: 1, sportEventParticipantId: rowOf('Vermont') }, { sideNumber: 2, sportEventParticipantId: rowOf('Duke') }] } }),
      { status: 409, code: 'SPORT_EVENT_BRACKET_LOCKED' },
    );
    expectFunctionalError(
      await updateEventParticipants({ client: a, path: { eventId }, body: { participants: [{ sportEventParticipantId: rowOf('Duke'), seedNumber: 3 }] } }),
      { status: 409, code: 'SPORT_EVENT_SEEDS_LOCKED' },
    );
    expectFunctionalError(
      await removeEventParticipant({ client: a, path: { eventId, sportEventParticipantId: rowOf('Vermont') } }),
      { status: 409, code: 'EVENT_PARTICIPANT_IN_BRACKET' },
    );

    const moved = await updateEventBracketMatch({
      client: a,
      path: { eventId, roundNumber: 2, matchNumber: 1 },
      body: { scheduledDate: '2099-03-21T18:30:00.000Z' },
    });
    expect(expectMatchesSchema(SportEventRoundMatchResponseSchema, moved.data).match.scheduledDate).toBe('2099-03-21T18:30:00.000Z');
  });
});
