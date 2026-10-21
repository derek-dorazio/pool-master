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
  recordEventMatchResult,
  releaseEvent,
  replaceEventParticipant,
  replaceEventTiers,
} from '@poolmaster/shared/generated/hey-api';
import { MatchSide, ParticipantInactiveReason, Sport, findSportRow } from '@poolmaster/shared/domain';
import {
  SportEventBracketResponseSchema,
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

// A withdrawal after the draw end to end over HTTP (#704 slice 3): an admin releases a four-player
// tennis draw, then a player withdraws before the first round and a lucky loser takes the place.
// The replacement joins unseeded, last in the last tier at the lowest price; the withdrawn player
// stays on the field as WITHDRAWN. Once a match has started, its players can no longer be replaced.

const RUN = `tennis-withdrawal-${Date.now()}`;
// Seeds, best first; the odds order the field into its tiers, two players to a tier.
const FIELD: readonly { name: string; seed: number }[] = [
  { name: 'Alcaraz', seed: 1 },
  { name: 'Sinner', seed: 2 },
  { name: 'Zverev', seed: 3 },
  { name: 'Fritz', seed: 4 },
];
const LUCKY_LOSER = 'Lucky Loser';

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
    await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
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

describe('SDK Functional: Tennis withdrawal after the draw', () => {
  it('puts a lucky loser in a withdrawn player\'s place after release, at the bottom of the tiers and prices, and refuses once the match has started', async () => {
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await getFunctionalPrisma().sport.upsert({
      where: { sport: Sport.TENNIS },
      create: { sport: Sport.TENNIS, participantType: 'INDIVIDUAL', tournamentFormat: 'MATCHES' },
      update: {},
    });
    const admin = await buildRegisteredUser({ displayName: 'Tournament Referee' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectMatchesSchema(SportListResponseSchema, (await listSports({ client: a })).data).sports, Sport.TENNIS)).id;

    // --- A tour, a draw in it, its field, tiers and prices --------------------------------------
    const tour = await createSportLeague({ client: a, body: { sport: Sport.TENNIS, name: `Harbour Tour ${RUN}` } });
    expect(tour.response.status).toBe(201);
    const sportLeagueId = expectDefined(tour.data).sportLeague.id;
    created.sportLeagueIds.add(sportLeagueId);

    const draw = await createEvent({
      client: a,
      body: { sportLeagueId, eventYear: 2099, name: `Harbour Open ${RUN}`, startDate: '2099-08-30T15:00:00.000Z', rounds: 2, autoLifecycleEnabled: false },
    });
    expect(draw.response.status).toBe(201);
    const eventId = expectDefined(draw.data).event.id;
    created.sportEventIds.add(eventId);

    const playerIdOf = new Map<string, string>();
    for (const name of [...FIELD.map((player) => player.name), LUCKY_LOSER]) {
      const participant = await createParticipant({ client: a, body: { sportId, participantType: 'INDIVIDUAL', name: `${name} ${RUN}` } });
      const id = expectDefined(participant.data).participant.id;
      created.participantIds.add(id);
      playerIdOf.set(name, id);
    }
    await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: FIELD.map((player) => expectDefined(playerIdOf.get(player.name))) } });
    await applyEventParticipantUpload({
      client: a,
      path: { eventId },
      body: { rows: FIELD.map((player, index) => ({ playerName: `${player.name} ${RUN}`, seedNumber: player.seed, oddsToWin: 2 + index * 5 })) },
    });
    // A four-player draw is set to two tiers, over the sport's six.
    const twoTiers = await replaceEventTiers({
      client: a,
      path: { eventId },
      body: { tiers: [1, 2].map((n) => ({ tierKey: `tier-${n}`, label: `Tier ${n}`, tierNumber: n })) },
    });
    expect(twoTiers.response.status).toBe(200);
    expect((await autoAssignEventTiers({ client: a, path: { eventId }, body: { source: 'ODDS', tierSize: 2 } })).response.status).toBe(200);
    expect((await autoAssignEventPrices({ client: a, path: { eventId }, body: standardEventPricing() })).response.status).toBe(200);

    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    const rowOf = (name: string) => expectDefined(field.find((row) => row.participant.name === `${name} ${RUN}`));
    const lowestPrice = Math.min(...field.map((row) => expectDefined(row.valuation?.price)));
    const lastTierId = rowOf('Fritz').valuation?.sportEventTierId;

    // --- The draw: 1 v 4 and 2 v 3, the winners meeting in the final -------------------------------
    const loaded = await loadEventBracket({
      client: a,
      path: { eventId },
      body: {
        matches: [
          { matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: rowOf('Alcaraz').id, awaySportEventParticipantId: rowOf('Fritz').id, isNeutralSite: true, scheduledDate: null, advancesTo: { matchNumber: 3, side: MatchSide.HOME } },
          { matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: rowOf('Sinner').id, awaySportEventParticipantId: rowOf('Zverev').id, isNeutralSite: true, scheduledDate: null, advancesTo: { matchNumber: 3, side: MatchSide.AWAY } },
          { matchNumber: 3, roundNumber: 2, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesTo: null },
        ],
      },
    });
    expect(loaded.response.status).toBe(200);
    const released = await releaseEvent({ client: a, path: { eventId } });
    expect([released.data?.event.status, released.error]).toEqual(['SCHEDULED', undefined]);

    // --- Fritz withdraws before the first round, and the lucky loser takes his place ---------------
    const replaced = await replaceEventParticipant({
      client: a,
      path: { eventId, sportEventParticipantId: rowOf('Fritz').id },
      body: { participantId: expectDefined(playerIdOf.get(LUCKY_LOSER)) },
    });
    expect(replaced.error).toBeUndefined();
    const replacement = expectMatchesSchema(SportEventParticipantResponseSchema, replaced.data).participant;
    expect(replacement).toMatchObject({
      seedNumber: null,
      isActive: true,
      participant: { name: `${LUCKY_LOSER} ${RUN}` },
      valuation: { sportEventTierId: lastTierId, tierOrderIndex: 5, price: lowestPrice },
    });

    const bracket = expectMatchesSchema(SportEventBracketResponseSchema, (await getEventBracket({ client: a, path: { eventId } })).data).matches;
    expect(expectDefined(bracket.find((match) => match.matchNumber === 1)).awaySportEventParticipantId).toBe(replacement.id);
    const after = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    expect(after.find((row) => row.id === rowOf('Fritz').id)).toMatchObject({ isActive: false, inactiveReason: ParticipantInactiveReason.WITHDRAWN, seedNumber: 4 });

    // The place is taken, so the withdrawn row can't be replaced again.
    expectFunctionalError(
      await replaceEventParticipant({ client: a, path: { eventId, sportEventParticipantId: rowOf('Fritz').id }, body: { participantId: expectDefined(playerIdOf.get(LUCKY_LOSER)) } }),
      { status: 409, code: 'EVENT_PARTICIPANT_NOT_IN_BRACKET' },
    );

    // --- Once match 2 is played, a withdrawal there is a walkover, not a replacement --------------
    const result = await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 2 }, body: { winnerSide: MatchSide.HOME, homeScore: 3, awayScore: 1 } });
    expect(result.error).toBeUndefined();
    expectFunctionalError(
      await replaceEventParticipant({ client: a, path: { eventId, sportEventParticipantId: rowOf('Zverev').id }, body: { participantId: expectDefined(playerIdOf.get(LUCKY_LOSER)) } }),
      { status: 409, code: 'BRACKET_PARTICIPANT_ALREADY_PLAYED' },
    );
  });
});
