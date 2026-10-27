import {
  addEventParticipants,
  applyEventParticipantUpload,
  autoAssignEventPrices,
  autoAssignEventTiers,
  createEvent,
  createParticipant,
  createSportLeague,
  getEventBracket,
  listEventParticipants,
  listSports,
  loadEventBracket,
  releaseEvent,
  removeEventParticipant,
  setEventPlayInWinner,
  updateEventBracketMatch,
  updateEventParticipants,
} from '@poolmaster/shared/generated/hey-api';
import { MatchSide, MatchStatus, Sport, findSportRow } from '@poolmaster/shared/domain';
import {
  AddSportEventParticipantsResponseSchema,
  SportEventBracketResponseSchema,
  SportEventMatchResponseSchema,
  SportEventParticipantResponseSchema,
  SportListResponseSchema,
} from '@poolmaster/shared/dto';
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

// A basketball bracket end to end over HTTP (#698): an admin builds a four-team tournament in the
// run's own league, with one place standing for a First Four pairing, loads its
// bracket, and releases it only once the bracket holds the whole field. After release the
// pairings and seeds are locked while a match's time can still move, and the First Four winner
// takes over the pairing's place.

const RUN = `basketball-${Date.now()}`;
const PAIRING = 'Texas / Xavier';
// Seeds, best first; the odds only order the field into its four tiers, one team to a tier.
const FIELD: readonly { name: string; seed: number }[] = [
  { name: 'Duke', seed: 1 },
  { name: 'Houston', seed: 2 },
  { name: 'Vermont', seed: 15 },
  { name: PAIRING, seed: 16 },
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
    const seriesIds = (await db.sportEvent.findMany({ where: { id: { in: eventIds } }, select: { eventSeriesId: true } }))
      .map((event) => event.eventSeriesId);
    await db.sportEventMatch.deleteMany({ where: { sportEventId: { in: eventIds } } });
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

describe('SDK Functional: Basketball bracket', () => {
  it('releases a tournament only once its bracket holds the field, then locks pairings and seeds and lets the First Four winner take its place', async () => {
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await getFunctionalPrisma().sport.upsert({
      where: { sport: Sport.BASKETBALL },
      create: { sport: Sport.BASKETBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
      update: {},
    });
    const admin = await buildRegisteredUser({ displayName: 'Bracket Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectMatchesSchema(SportListResponseSchema, (await listSports({ client: a })).data).sports, Sport.BASKETBALL)).id;

    // --- A league, a tournament in it, and its field --------------------------------------------
    const conference = await createSportLeague({ client: a, body: { sport: Sport.BASKETBALL, name: `Harbour Conference ${RUN}` } });
    expect(conference.response?.status).toBe(201);
    const sportLeagueId = expectDefined(conference.data).sportLeague.id;
    created.sportLeagueIds.add(sportLeagueId);

    const tournament = await createEvent({
      client: a,
      body: { sportLeagueId, eventYear: 2099, name: `Harbour Classic ${RUN}`, startDate: '2099-03-19T16:00:00.000Z', rounds: 2, autoLifecycleEnabled: false },
    });
    expect(tournament.response?.status).toBe(201);
    const eventId = expectDefined(tournament.data).event.id;
    created.sportEventIds.add(eventId);

    const teamIdOf = new Map<string, string>();
    for (const name of [...FIELD.map((team) => team.name), 'Texas']) {
      const participant = await createParticipant({ client: a, body: { sportId, participantType: 'TEAM', name: `${name} ${RUN}` } });
      const id = expectDefined(participant.data).participant.id;
      created.participantIds.add(id);
      teamIdOf.set(name, id);
    }
    const fieldTeamIds = FIELD.map((team) => expectDefined(teamIdOf.get(team.name)));
    const added = await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: fieldTeamIds } });
    expect(expectMatchesSchema(AddSportEventParticipantsResponseSchema, added.data).added).toBe(4);

    const upload = await applyEventParticipantUpload({
      client: a,
      path: { eventId },
      body: { rows: FIELD.map((team, index) => ({ playerName: `${team.name} ${RUN}`, seedNumber: team.seed, oddsToWin: 2 + index * 5 })) },
    });
    expect(upload.response?.status).toBe(200);
    expect((await autoAssignEventTiers({ client: a, path: { eventId }, body: { source: 'ODDS', tierSize: 1 } })).response?.status).toBe(200);
    expect((await autoAssignEventPrices({ client: a, path: { eventId }, body: standardEventPricing() })).response?.status).toBe(200);

    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    const rowOf = (name: string) => expectDefined(field.find((row) => row.participant.name === `${name} ${RUN}`)).id;

    // --- The pairing's row is marked a play-in place; only such a row can take a play-in winner --
    const marked = await updateEventParticipants({
      client: a,
      path: { eventId },
      body: { participants: [{ sportEventParticipantId: rowOf(PAIRING), isPlayInPlace: true }] },
    });
    expect(marked.error).toBeUndefined();
    expect(expectDefined(marked.data).participants.find((row) => row.id === rowOf(PAIRING))?.isPlayInPlace).toBe(true);

    // --- No release without a bracket, and no bracket with two finals ---------------------------
    const early = await releaseEvent({ client: a, path: { eventId } });
    expectFunctionalError(early, { status: 422, code: 'SPORT_EVENT_NOT_READY' });
    expect(JSON.stringify(early.error)).toContain('its bracket is not loaded');
    expect(expectMatchesSchema(SportEventBracketResponseSchema, (await getEventBracket({ client: a, path: { eventId } })).data).matches).toEqual([]);

    const firstRound = [
      { matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: rowOf('Duke'), awaySportEventParticipantId: rowOf(PAIRING), isNeutralSite: true, scheduledDate: '2099-03-19T16:00:00.000Z', advancesTo: { matchNumber: 3, side: MatchSide.HOME } },
      { matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: rowOf('Houston'), awaySportEventParticipantId: rowOf('Vermont'), isNeutralSite: true, scheduledDate: '2099-03-19T19:00:00.000Z', advancesTo: { matchNumber: 3, side: MatchSide.AWAY } },
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
            { matchNumber: 3, roundNumber: 2, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesTo: null },
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
          { matchNumber: 3, roundNumber: 2, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesTo: null },
        ],
      },
    });
    expect(loaded.response?.status).toBe(200);
    const bracket = expectMatchesSchema(SportEventBracketResponseSchema, (await getEventBracket({ client: a, path: { eventId } })).data).matches;
    expect(bracket.map((match) => [match.matchNumber, match.roundNumber, match.status])).toEqual([
      [1, 1, MatchStatus.SCHEDULED], [2, 1, MatchStatus.SCHEDULED], [3, 2, MatchStatus.SCHEDULED],
    ]);
    const final = expectDefined(bracket.find((match) => match.matchNumber === 3));
    expect(bracket.filter((match) => match.advancesToMatchId === final.id).map((match) => match.advancesToSide).sort((left, right) => String(left).localeCompare(String(right))))
      .toEqual([MatchSide.AWAY, MatchSide.HOME]);

    const release = await releaseEvent({ client: a, path: { eventId } });
    expect(release.error).toBeUndefined();
    expect(release.data?.event.status).toBe('SCHEDULED');

    // --- Released: pairings, seeds and the bracket's teams are locked, a time is not ------------
    expectFunctionalError(
      await loadEventBracket({ client: a, path: { eventId }, body: { matches: firstRound } }),
      { status: 409, code: 'SPORT_EVENT_BRACKET_LOCKED' },
    );
    expectFunctionalError(
      await updateEventBracketMatch({ client: a, path: { eventId, matchNumber: 1 }, body: { awaySportEventParticipantId: rowOf('Vermont') } }),
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
      path: { eventId, matchNumber: 3 },
      body: { scheduledDate: '2099-03-21T18:30:00.000Z' },
    });
    expect(expectMatchesSchema(SportEventMatchResponseSchema, moved.data).match.scheduledDate).toBe('2099-03-21T18:30:00.000Z');

    // A row that is not a play-in place cannot take a play-in winner, so a real team stays put.
    expectFunctionalError(
      await setEventPlayInWinner({
        client: a,
        path: { eventId, sportEventParticipantId: rowOf('Vermont') },
        body: { participantId: expectDefined(teamIdOf.get('Texas')) },
      }),
      { status: 409, code: 'EVENT_PARTICIPANT_NOT_PLAY_IN_PLACE' },
    );

    // --- The First Four winner takes the pairing's place, keeping its seed and its match --------
    const filled = await setEventPlayInWinner({
      client: a,
      path: { eventId, sportEventParticipantId: rowOf(PAIRING) },
      body: { participantId: expectDefined(teamIdOf.get('Texas')) },
    });
    expect(filled.response?.status).toBe(200);
    expect(expectMatchesSchema(SportEventParticipantResponseSchema, filled.data).participant).toMatchObject({ id: rowOf(PAIRING), seedNumber: 16, participant: { name: `Texas ${RUN}` } });
    const afterFill = expectDefined((await getEventBracket({ client: a, path: { eventId } })).data).matches;
    expect(expectDefined(afterFill.find((match) => match.matchNumber === 1)).awaySportEventParticipantId).toBe(rowOf(PAIRING));
    const pairing = await getFunctionalPrisma().participant.findUniqueOrThrow({ where: { id: expectDefined(teamIdOf.get(PAIRING)) } });
    expect(pairing.status).toBe('INACTIVE');

    // The place is filled, so it is a play-in place no more and a second winner is refused.
    expectFunctionalError(
      await setEventPlayInWinner({
        client: a,
        path: { eventId, sportEventParticipantId: rowOf(PAIRING) },
        body: { participantId: expectDefined(teamIdOf.get('Texas')) },
      }),
      { status: 409, code: 'EVENT_PARTICIPANT_NOT_PLAY_IN_PLACE' },
    );
  });
});
