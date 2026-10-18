import {
  acceptInvitation,
  addEventParticipants,
  applyEventParticipantUpload,
  autoAssignEventPrices,
  autoAssignEventTiers,
  clearGamePick,
  createContest,
  createEvent,
  createParticipant,
  createSportLeague,
  enterContest,
  generateInviteLink,
  getGamePicks,
  listEventParticipants,
  listSports,
  loadEventBracket,
  openContest,
  releaseEvent,
  saveGamePicks,
  submitGamePicks,
  transitionEvent,
} from '@poolmaster/shared/generated/hey-api';
import {
  ContestEntryStatus,
  ContestFormat,
  ContestStatus,
  MatchSide,
  MatchStatus,
  PickEmMode,
  SelectionType,
  Sport,
  findSportRow,
} from '@poolmaster/shared/domain';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';
import { expectDefined } from '../support/expect-defined';
import { unlinkContestsFromSportEvents } from '../support/contest-event-links';
import { standardEventPricing } from '../support/budget-pricing';

// A confidence pick'em week end to end over HTTP (#716). An admin builds a four-team basketball
// event and releases it; its final, whose teams are still to be decided, is called off, so the
// week is its two first-round games. A commissioner creates a CONFIDENCE pick'em contest on it
// and opens it, and the commissioner's team and a member's team enter.
//
// The commissioner's team picks both games, is refused submitting an incomplete week and a week
// with a repeated confidence value, then submits. The first game kicks off (its time and the
// event's start move into the past and the event goes IN_PROGRESS): its pick locks and shows to
// the member, the second game's stays open and hidden, a pick cannot be cleared, but it can be
// swapped to the other team. The member's team, still in draft at the first kickoff, can no
// longer pick.

const RUN = `pick-em-${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;
const TEAMS = ['Duke', 'Vermont', 'Houston', 'Texas'];

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
    await db.contestEntryMatchPrediction.deleteMany({ where: { sportEventMatch: { sportEventId: { in: eventIds } } } });
    await unlinkContestsFromSportEvents(db, eventIds);
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

describe('SDK Functional: a pick\'em week (#716)', () => {
  it('submits a confidence week only once complete with each value once, then locks and reveals each game at its own kickoff, refusing a clear and allowing a swap', async () => {
    const db = getFunctionalPrisma();
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await db.sport.upsert({
      where: { sport: Sport.BASKETBALL },
      create: { sport: Sport.BASKETBALL, participantType: 'TEAM', tournamentFormat: 'KNOCKOUT_BRACKET' },
      update: {},
    });
    const admin = await buildRegisteredUser({ displayName: 'Pickem Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectDefined((await listSports({ client: a })).data).sports, Sport.BASKETBALL)).id;

    // --- An event of two first-round games and a final, released ----------------------------
    const firstKickoff = new Date(Date.now() + 2 * DAY);
    const secondKickoff = new Date(firstKickoff.getTime() + DAY);
    const conference = await createSportLeague({ client: a, body: { sport: Sport.BASKETBALL, name: `Pickem Conference ${RUN}` } });
    const sportLeagueId = expectDefined(conference.data).sportLeague.id;
    created.sportLeagueIds.add(sportLeagueId);
    const tournament = await createEvent({
      client: a,
      body: { sportLeagueId, eventYear: 2099, name: `Pickem Classic ${RUN}`, startDate: firstKickoff.toISOString(), rounds: 2, autoLifecycleEnabled: false },
    });
    expect(tournament.response.status).toBe(201);
    const eventId = expectDefined(tournament.data).event.id;
    created.sportEventIds.add(eventId);

    const teamIds: string[] = [];
    for (const name of TEAMS) {
      const participant = await createParticipant({ client: a, body: { sportId, participantType: 'TEAM', name: `${name} ${RUN}` } });
      const id = expectDefined(participant.data).participant.id;
      created.participantIds.add(id);
      teamIds.push(id);
    }
    expect((await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: teamIds } })).data?.added).toBe(4);
    // Release asks every event for its roster setup too: seeds, four tiers of one team, and prices.
    expect((await applyEventParticipantUpload({
      client: a,
      path: { eventId },
      body: { rows: TEAMS.map((name, index) => ({ playerName: `${name} ${RUN}`, seedNumber: index + 1, oddsToWin: 2 + index * 5 })) },
    })).response.status).toBe(200);
    expect((await autoAssignEventTiers({ client: a, path: { eventId }, body: { source: 'ODDS', tierSize: 1 } })).response.status).toBe(200);
    expect((await autoAssignEventPrices({ client: a, path: { eventId }, body: standardEventPricing() })).response.status).toBe(200);
    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    const rowOf = (name: string) => expectDefined(field.find((row) => row.participant.name === `${name} ${RUN}`), name).id;

    const loaded = await loadEventBracket({
      client: a,
      path: { eventId },
      body: {
        matches: [
          { matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: rowOf('Duke'), awaySportEventParticipantId: rowOf('Vermont'), isNeutralSite: true, scheduledDate: firstKickoff.toISOString(), advancesTo: { matchNumber: 3, side: MatchSide.HOME } },
          { matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: rowOf('Houston'), awaySportEventParticipantId: rowOf('Texas'), isNeutralSite: true, scheduledDate: secondKickoff.toISOString(), advancesTo: { matchNumber: 3, side: MatchSide.AWAY } },
          { matchNumber: 3, roundNumber: 2, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesTo: null },
        ],
      },
    });
    expect(loaded.response.status).toBe(200);
    expect((await releaseEvent({ client: a, path: { eventId } })).data?.event.status).toBe('SCHEDULED');
    // The final is called off, so it is not one of the week's games.
    await db.sportEventMatch.updateMany({ where: { sportEventId: eventId, matchNumber: 3 }, data: { status: MatchStatus.CANCELLED } });
    const games = await db.sportEventMatch.findMany({ where: { sportEventId: eventId }, orderBy: { matchNumber: 'asc' } });
    const [game1, game2] = [expectDefined(games[0]), expectDefined(games[1])];

    // --- A confidence pick'em contest, opened and entered by two teams -------------------------
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Pickem Commissioner', leagueName: `Pickem League ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Pickem Member' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });

    const contestBody = {
      name: `Confidence ${RUN}`,
      sportEventIds: [eventId],
      contestFormat: ContestFormat.PREDICTION,
      selectionType: SelectionType.PICK_EM,
      configuration: {
        selectionType: SelectionType.PICK_EM,
        mode: PickEmMode.CONFIDENCE,
        maxEntriesPerSquad: 1,
        scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS' as const, config: { roundValues: [1, 2], upsetBonus: { rule: 'NONE' as const } } },
      },
    };
    expectFunctionalError(
      await createContest({ client: commissioner.client, path: { id: league.id }, body: { ...contestBody, contestFormat: ContestFormat.ROSTER } }),
      { status: 422, code: 'CONTEST_FORMAT_NOT_ALLOWED' },
    );
    const contest = await createContest({ client: commissioner.client, path: { id: league.id }, body: contestBody });
    expect(contest.response.status).toBe(201);
    const contestId = expectDefined(contest.data).contest.id;
    expect(expectDefined(contest.data).contest.contestFormat).toBe(ContestFormat.PREDICTION);
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

    const entryId = expectDefined((await enterContest({ client: commissioner.client, path: { contestId } })).data).entry.id;
    const memberEntryId = expectDefined((await enterContest({ client: member.client, path: { contestId } })).data).entry.id;
    const week = { contestId, entryId, sportEventId: eventId };
    const pick = (game: typeof game1, side: 'home' | 'away', confidence: number) => ({
      sportEventMatchId: game.id,
      sportEventParticipantId: expectDefined(side === 'home' ? game.homeSportEventParticipantId : game.awaySportEventParticipantId),
      confidence,
    });

    const empty = expectDefined((await getGamePicks({ client: commissioner.client, path: week })).data);
    expect([empty.mode, empty.status, empty.gameCount, empty.pickedCount, empty.canSubmit]).toEqual([PickEmMode.CONFIDENCE, ContestEntryStatus.DRAFT, 2, 0, false]);
    expect(empty.games.map((game) => game.matchNumber)).toEqual([1, 2]);

    // --- Picking and submitting before the first kickoff ---------------------------------------
    expectFunctionalError(
      await saveGamePicks({ client: member.client, path: week, body: { picks: [pick(game1, 'home', 1)] } }),
      { status: 403, code: 'ENTRY_ACCESS_DENIED' },
    );
    expectFunctionalError(
      await saveGamePicks({ client: commissioner.client, path: week, body: { picks: [pick(game1, 'home', 3)] } }),
      { status: 409, code: 'PREDICTION_CONFIDENCE_INVALID' },
    );
    expect((await saveGamePicks({ client: commissioner.client, path: week, body: { picks: [pick(game1, 'home', 2)] } })).data?.pickedCount).toBe(1);
    expectFunctionalError(await submitGamePicks({ client: commissioner.client, path: week }), { status: 409, code: 'PREDICTION_WEEK_INCOMPLETE' });

    expect((await saveGamePicks({ client: commissioner.client, path: week, body: { picks: [pick(game2, 'away', 2)] } })).data?.canSubmit).toBe(false);
    expectFunctionalError(await submitGamePicks({ client: commissioner.client, path: week }), { status: 409, code: 'PREDICTION_CONFIDENCE_INVALID' });

    expect((await saveGamePicks({ client: commissioner.client, path: week, body: { picks: [pick(game2, 'away', 1)] } })).data?.canSubmit).toBe(true);
    const submitted = expectDefined((await submitGamePicks({ client: commissioner.client, path: week })).data);
    expect(submitted.status).toBe(ContestEntryStatus.SUBMITTED);
    expect(submitted.submittedAt).not.toBeNull();

    // Before any kickoff the member sees none of the commissioner's picks.
    const hidden = expectDefined((await getGamePicks({ client: member.client, path: week })).data);
    expect([hidden.ownEntry, hidden.pickedCount]).toEqual([false, 0]);
    expect(hidden.games.map((game) => [game.revealed, game.pick])).toEqual([[false, null], [false, null]]);

    // --- The first game kicks off ---------------------------------------------------------------
    const kickedOff = new Date(Date.now() - 60 * 60 * 1000);
    await db.sportEvent.update({ where: { id: eventId }, data: { startDate: kickedOff } });
    await db.sportEventMatch.update({ where: { id: game1.id }, data: { scheduledDate: kickedOff } });
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');

    const own = expectDefined((await getGamePicks({ client: commissioner.client, path: week })).data);
    expect(own.games.map((game) => [game.matchNumber, game.locked])).toEqual([[1, true], [2, false]]);
    expect(own.status).toBe(ContestEntryStatus.SUBMITTED);

    const revealed = expectDefined((await getGamePicks({ client: member.client, path: week })).data);
    expect(revealed.games.map((game) => [game.matchNumber, game.revealed, game.pick?.sportEventParticipantId ?? null, game.pick?.confidence ?? null])).toEqual([
      [1, true, game1.homeSportEventParticipantId, 2],
      [2, false, null, null],
    ]);

    expectFunctionalError(
      await saveGamePicks({ client: commissioner.client, path: week, body: { picks: [pick(game1, 'away', 2)] } }),
      { status: 409, code: 'PREDICTION_GAME_STARTED' },
    );
    expectFunctionalError(
      await clearGamePick({ client: commissioner.client, path: { ...week, sportEventMatchId: game2.id } }),
      { status: 409, code: 'PREDICTION_CLEAR_AFTER_FIRST_KICKOFF' },
    );
    const swapped = expectDefined((await saveGamePicks({ client: commissioner.client, path: week, body: { picks: [pick(game2, 'home', 1)] } })).data);
    expect(swapped.status).toBe(ContestEntryStatus.SUBMITTED);
    expect(swapped.games.find((game) => game.matchNumber === 2)?.pick?.sportEventParticipantId).toBe(game2.homeSportEventParticipantId);

    // The member's team was still in draft at the first kickoff: its week no longer counts or changes.
    expectFunctionalError(
      await saveGamePicks({ client: member.client, path: { ...week, entryId: memberEntryId }, body: { picks: [pick(game2, 'home', 1)] } }),
      { status: 409, code: 'CONTEST_ENTRY_LOCKED' },
    );
  });
});
