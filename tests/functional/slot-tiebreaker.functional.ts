import { randomUUID } from 'node:crypto';
import {
  addEventParticipants,
  chooseEventSlotTiebreakerGame,
  createParticipant,
  listEventParticipants,
  listEventSlotTiebreakers,
  loadEventBracket,
} from '@poolmaster/shared/generated/hey-api';
import { Sport } from '@poolmaster/shared/domain';
import { SportEventSlotTiebreakerResponseSchema, SportEventSlotTiebreakersResponseSchema } from '@poolmaster/shared/dto';
import { buildRegisteredUser, createTestEvent, promoteToRootAdmin } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, expectFunctionalError, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { expectMatchesSchema } from '../support/expect-matches-schema';
import { sportRowKeys } from '../support/sport-rows';
import { insertTestSportLeague } from '../support/test-sport-league';
import { deleteTestSportLeagues } from '../support/test-slots';
import { unlinkContestsFromSportEvents } from '../support/contest-event-links';
import { bracketMatch } from '../support/match-requests';

// A root admin chooses a slot's tiebreaker game over HTTP (#2048): the choice is kept with who
// made it and when, a game that has started is refused, and the Slots tab's read names every Game
// of the slot with whether it can be chosen.

const RUN = `slot-tiebreaker-${Date.now()}`;
const TEAMS = ['Owls', 'Hawks', 'Crows', 'Doves'];
const created = { sportEventIds: new Set<string>(), participantIds: new Set<string>(), sportLeagueIds: new Set<string>() };

afterAll(async () => {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  await cleanupFunctionalData();
  if (eventIds.length) {
    await unlinkContestsFromSportEvents(db, eventIds);
    await db.sportEventRoundMatch.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventSlotTier.deleteMany({ where: { slot: { sportEventId: { in: eventIds } } } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
  }
  if (created.participantIds.size) await db.participant.deleteMany({ where: { id: { in: [...created.participantIds] } } });
  if (created.sportLeagueIds.size) await deleteTestSportLeagues(db, [...created.sportLeagueIds]);
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: a slot\'s tiebreaker game', () => {
  it('lets a root admin choose a game before it starts, keeps who chose it and when, and refuses a started game, a game of no slot of the event and a slot the event does not cover', async () => {
    const db = getFunctionalPrisma();
    await db.sport.upsert({ where: { sport: Sport.FOOTBALL }, create: { sport: Sport.FOOTBALL, ...sportRowKeys(Sport.FOOTBALL) }, update: {} });
    const admin = await buildRegisteredUser({ displayName: 'Tiebreaker Admin' });
    await promoteToRootAdmin(admin);
    const a = admin.client;

    const { id: sportLeagueId } = await insertTestSportLeague(db, { sport: Sport.FOOTBALL, name: `Tiebreaker League ${RUN}` });
    created.sportLeagueIds.add(sportLeagueId);
    const teamIds: string[] = [];
    for (const team of TEAMS) {
      const id = expectDefined((await createParticipant({ client: a, body: { sportLeagueId, participantType: 'TEAM', name: `${team} ${RUN}` } })).data).participant.id;
      created.participantIds.add(id);
      teamIds.push(id);
    }
    const event = await createTestEvent({
      client: a,
      body: { sportLeagueId, championshipYear: 2099, name: `Week 1 ${RUN}`, startDate: '2099-09-10T17:00:00.000Z', rounds: 1, autoLifecycleEnabled: false },
    });
    const eventId = expectDefined(event.data, JSON.stringify(event.error)).event.id;
    const seasonSlotId = expectDefined(expectDefined(event.data).event.slots[0], 'the event\'s slot').id;
    created.sportEventIds.add(eventId);
    await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: teamIds } });
    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    const rowOf = (team: string) => expectDefined(field.find((row) => row.participant.name === `${team} ${RUN}`), team).id;
    // One game long past, so it has started, and one far ahead.
    const kickoffs = ['2020-09-13T17:00:00.000Z', '2099-09-14T00:20:00.000Z'];
    const loaded = await loadEventBracket({
      client: a,
      path: { eventId },
      body: {
        matches: [0, 1].map((index) => (bracketMatch({
          matchNumber: index + 1,
          roundNumber: 1,
          homeSportEventParticipantId: rowOf(expectDefined(TEAMS[index * 2])),
          awaySportEventParticipantId: rowOf(expectDefined(TEAMS[index * 2 + 1])),
          isNeutralSite: false,
          scheduledDate: expectDefined(kickoffs[index]),
          advancesTo: null,
        }))),
      },
    });
    const matches = expectDefined(loaded.data, JSON.stringify(loaded.error)).matches;
    const pastMatchId = expectDefined(matches.find((match) => match.matchNumber === 1)).id;
    const futureMatchId = expectDefined(matches.find((match) => match.matchNumber === 2)).id;

    const listed = await listEventSlotTiebreakers({ client: a, path: { eventId } });
    expectMatchesSchema(SportEventSlotTiebreakersResponseSchema, listed.data);
    const slot = expectDefined(expectDefined(listed.data).slots.find((each) => each.seasonSlotId === seasonSlotId), 'listed slot');
    const pastGame = expectDefined(slot.games.find((game) => game.sportEventRoundMatchId === pastMatchId));
    const futureGame = expectDefined(slot.games.find((game) => game.sportEventRoundMatchId === futureMatchId));
    expect([pastGame.choosable, futureGame.choosable]).toEqual([false, true]);

    const chosen = await chooseEventSlotTiebreakerGame({ client: a, path: { eventId, seasonSlotId }, body: { gameId: futureGame.id } });
    expectMatchesSchema(SportEventSlotTiebreakerResponseSchema, chosen.data);
    expect(expectDefined(chosen.data).slot).toMatchObject({ tiebreakerGameId: futureGame.id, chosenByUserId: admin.userId, editable: true });
    const stored = await db.sportEventSlot.findFirstOrThrow({ where: { sportEventId: eventId }, select: { tiebreakerGameId: true, tiebreakerGameChosenAt: true, tiebreakerGameChosenByUserId: true } });
    expect(stored.tiebreakerGameId).toBe(futureGame.id);
    expect(stored.tiebreakerGameChosenByUserId).toBe(admin.userId);
    expect(stored.tiebreakerGameChosenAt).toBeInstanceOf(Date);

    expectFunctionalError(await chooseEventSlotTiebreakerGame({ client: a, path: { eventId, seasonSlotId }, body: { gameId: pastGame.id } }), { status: 409, code: 'TIEBREAKER_GAME_STARTED' });
    expectFunctionalError(await chooseEventSlotTiebreakerGame({ client: a, path: { eventId, seasonSlotId }, body: { gameId: randomUUID() } }), { status: 422, code: 'TIEBREAKER_GAME_NOT_IN_SLOT' });
    expectFunctionalError(await chooseEventSlotTiebreakerGame({ client: a, path: { eventId, seasonSlotId: randomUUID() }, body: { gameId: futureGame.id } }), { status: 404, code: 'SEASON_SLOT_NOT_FOUND' });
  });

  it('refuses a change once the slot\'s tiebreaker game has started', async () => {
    const db = getFunctionalPrisma();
    const admin = await buildRegisteredUser({ displayName: 'Late Tiebreaker Admin' });
    await promoteToRootAdmin(admin);
    const eventId = expectDefined([...created.sportEventIds][0], 'the first test\'s event');
    const slotRow = await db.sportEventSlot.findFirstOrThrow({ where: { sportEventId: eventId }, select: { id: true, sportLeagueSeasonCompetitionSlotId: true } });
    const games = await db.sportEventRoundMatchGame.findMany({ where: { sportEventId: eventId }, select: { id: true, match: { select: { matchNumber: true } } } });
    const startedGame = expectDefined(games.find((game) => game.match.matchNumber === 1), 'the game played in 2020');
    const laterGame = expectDefined(games.find((game) => game.match.matchNumber === 2), 'the game ahead');
    // The slot's game is the one already played, as the rule leaves it once it has started.
    await db.sportEventSlot.update({ where: { id: slotRow.id }, data: { tiebreakerGameId: startedGame.id, tiebreakerGameChosenAt: null, tiebreakerGameChosenByUserId: null } });

    const refused = await chooseEventSlotTiebreakerGame({
      client: admin.client,
      path: { eventId, seasonSlotId: slotRow.sportLeagueSeasonCompetitionSlotId },
      body: { gameId: laterGame.id },
    });

    expectFunctionalError(refused, { status: 409, code: 'TIEBREAKER_GAME_STARTED' });
  });

  it('refuses a member who is not a root admin', async () => {
    const member = await buildRegisteredUser({ displayName: 'Tiebreaker Member' });
    const eventId = expectDefined([...created.sportEventIds][0], 'the first test\'s event');

    expectFunctionalError(await listEventSlotTiebreakers({ client: member.client, path: { eventId } }), { status: 403, code: 'ROOT_ADMIN_ACCESS_REQUIRED' });
  });
});
