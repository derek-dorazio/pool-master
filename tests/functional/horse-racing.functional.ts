import {
  acceptInvitation,
  addEventParticipants,
  applyEventRaceResults,
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
  getSelectionState,
  listContestConfigTemplates,
  listEventParticipants,
  listSports,
  openContest,
  previewEventRaceResults,
  releaseEvent,
  runContestDraw,
  transitionEvent,
  updateEventParticipants,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, ContestStatus, SelectionType, Sport, findSportRow } from '@poolmaster/shared/domain';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';
import { expectDefined } from '../support/expect-defined';
import { standardEventPricing } from '../support/budget-pricing';

// Horse racing end to end over HTTP (#622, #623): an admin builds a race and its field, a
// commissioner runs a Win/Place/Show contest from the sport's template, the draw deals each entry
// a horse, the admin enters the finishing order (provisional, then official), and the board and
// the settled contest score each entry by its horse's place.

const RUN = `race-${Date.now()}`;
const HORSES = ['Arrow', 'Bolt', 'Comet', 'Drift'];
// The template's points table is 5, 3, 1 with 0 for a non-finisher: Bolt and Comet dead-heat for
// second, so each takes second's 3 points.
const POINTS_BY_HORSE: Record<string, number> = { Arrow: 5, Bolt: 3, Comet: 3, Drift: 0 };

const created = {
  sportEventIds: new Set<string>(),
  sportLeagueIds: new Set<string>(),
  participantIds: new Set<string>(),
};

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  if (eventIds.length) {
    // Race results cascade with their field rows; standings, valuations and picks do not.
    await db.contestEntryPick.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
  }
  const leagueIds = [...created.sportLeagueIds];
  if (leagueIds.length) {
    await db.eventSeries.deleteMany({ where: { sportLeagueId: { in: leagueIds } } });
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

describe('SDK Functional: Horse racing Win/Place/Show', () => {
  it('scores and settles each drawn horse by its official finishing place, after refusing an incomplete official result', async () => {
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await getFunctionalPrisma().sport.upsert({
      where: { sport: Sport.HORSE_RACING },
      create: { sport: Sport.HORSE_RACING, participantType: 'INDIVIDUAL', tournamentFormat: 'RACE' },
      update: {},
    });
    const admin = await buildRegisteredUser({ displayName: 'Race Admin' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectDefined((await listSports({ client: a })).data).sports, Sport.HORSE_RACING)).id;

    // --- The race and its field ------------------------------------------------------------
    const circuit = await createSportLeague({ client: a, body: { sport: Sport.HORSE_RACING, name: `Harbour Racing ${RUN}` } });
    expect(circuit.response.status).toBe(201);
    const sportLeagueId = expectDefined(circuit.data).sportLeague.id;
    created.sportLeagueIds.add(sportLeagueId);

    const race = await createEvent({
      client: a,
      body: { sportLeagueId, eventYear: 2099, name: `Harbour Stakes ${RUN}`, startDate: '2099-05-02T22:00:00.000Z', autoLifecycleEnabled: false },
    });
    expect(race.response.status).toBe(201);
    const eventId = expectDefined(race.data).event.id;
    created.sportEventIds.add(eventId);
    // A race is one round by the sport's default.
    expect(expectDefined(race.data).event.rounds).toBe(1);

    const horseIds: string[] = [];
    for (const horse of HORSES) {
      const participant = await createParticipant({
        client: a,
        body: { sportId, participantType: 'INDIVIDUAL', name: `${horse} ${RUN}` },
      });
      const id = expectDefined(participant.data).participant.id;
      created.participantIds.add(id);
      horseIds.push(id);
    }
    expect((await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: horseIds } })).data?.added).toBe(4);
    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    const horseByFieldRow = new Map(field.map((row) => [row.id, row.participant.name.replace(` ${RUN}`, '')]));
    // Release needs every runner tiered and priced and no tier empty: the admin enters each horse's
    // odds, and tiers and prices follow from them. Four runners can't fill three tiers of three, so
    // auto-assign spreads them 2/1/1.
    await updateEventParticipants({
      client: a,
      path: { eventId },
      body: { participants: field.map((row, index) => ({ sportEventParticipantId: row.id, oddsToWin: 2 + index * 3 })) },
    });
    expect((await autoAssignEventTiers({ client: a, path: { eventId }, body: { source: 'ODDS' } })).response.status).toBe(200);
    expect((await autoAssignEventPrices({ client: a, path: { eventId }, body: standardEventPricing() })).response.status).toBe(200);
    expect((await releaseEvent({ client: a, path: { eventId } })).data?.event.status).toBe('SCHEDULED');

    // --- A Win/Place/Show contest from the sport's template, entered and drawn ------------------
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Race Commissioner', leagueName: `Paddock ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Race Member' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });

    // A horse racing contest's points table has no default: sent neither scoring nor a template, it is refused.
    expectFunctionalError(await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: `No Points ${RUN}`,
        sportEventId: eventId,
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.RANDOM_DRAW,
        configuration: { selectionType: SelectionType.RANDOM_DRAW, maxEntriesPerSquad: 1, picksPerEntry: 1, countedScores: 1 },
      },
    }), { status: 422, code: 'CONTEST_SCORING_SETTINGS_REQUIRED' });

    const templates = expectDefined((await listContestConfigTemplates({
      client: commissioner.client,
      query: { sport: Sport.HORSE_RACING, contestFormat: ContestFormat.ROSTER, active: true },
    })).data).templates;
    const drawTemplate = expectDefined(templates.find((template) => template.selectionType === SelectionType.RANDOM_DRAW), 'the random-draw template');
    const contest = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: `Win Place Show ${RUN}`,
        sportEventId: eventId,
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.RANDOM_DRAW,
        templateId: drawTemplate.id,
      },
    });
    expect(contest.response.status).toBe(201);
    const contestId = expectDefined(contest.data).contest.id;
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);
    const commissionerEntryId = expectDefined((await enterContest({ client: commissioner.client, path: { contestId } })).data).entry.id;
    const memberEntryId = expectDefined((await enterContest({ client: member.client, path: { contestId } })).data).entry.id;
    expect((await runContestDraw({ client: commissioner.client, path: { contestId } })).response.status).toBe(200);
    const picks = expectDefined((await getSelectionState({ client: commissioner.client, path: { contestId }, query: { entryId: commissionerEntryId } })).data).pickHistories;
    const horseOfEntry = new Map(picks.map((pick) => [pick.entryId, expectDefined(horseByFieldRow.get(expectDefined(pick.participantId)))]));
    expect(horseOfEntry.size).toBe(2);

    // The race runs.
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');

    // --- The finishing order: previewed, provisional, refused incomplete, then official -----
    const rows = [
      { playerName: `Arrow ${RUN}`, resultStatus: 'FINISHED' as const, finishPosition: 1, startPosition: 3, riderName: 'J. Velez' },
      { playerName: `Bolt ${RUN}`, resultStatus: 'FINISHED' as const, finishPosition: 2, startPosition: 1, riderName: null },
      { playerName: `Comet ${RUN}`, resultStatus: 'FINISHED' as const, finishPosition: 2, startPosition: null, riderName: null },
      { playerName: `Drift ${RUN}`, resultStatus: 'DID_NOT_FINISH' as const, finishPosition: null, startPosition: null, riderName: null },
    ];
    const preview = expectDefined((await previewEventRaceResults({ client: a, path: { eventId }, body: { isOfficial: true, rows } })).data);
    expect(preview.rollup).toMatchObject({ total: 4, matched: 4, unresolved: 0, invalid: 0 });
    expect(preview.orderErrors).toEqual([]);

    // Official needs every active runner: an official result missing one is refused, writing nothing.
    expectFunctionalError(
      await applyEventRaceResults({ client: a, path: { eventId }, body: { isOfficial: true, rows: rows.slice(0, 3) } }),
      { status: 422, code: 'RACE_RESULT_FIELD_INCOMPLETE' },
    );

    const provisional = await applyEventRaceResults({ client: a, path: { eventId }, body: { isOfficial: false, rows } });
    expect(provisional.response.status).toBe(200);
    expect(expectDefined(provisional.data).participants.map((row) => row.race?.isOfficial)).toEqual([false, false, false, false]);
    const provisionalBoard = expectDefined((await getContestLeaderboard({ client: member.client, path: { contestId } })).data);
    expect(provisionalBoard.entries.map((entry) => entry.race?.totalPoints ?? null)).toEqual([null, null]);

    const official = await applyEventRaceResults({ client: a, path: { eventId }, body: { isOfficial: true, rows } });
    expect(official.response.status).toBe(200);
    const officialField = expectDefined(official.data).participants;
    expect(Object.fromEntries(officialField.map((row) => [horseByFieldRow.get(row.id), row.standing?.displayPosition ?? null]))).toEqual({
      Arrow: '1', Bolt: 'T2', Comet: 'T2', Drift: null,
    });

    // --- The board, then the settled contest ------------------------------------------------
    // Each entry scores its drawn horse's points, ranked higher first (two 3s share first as T1).
    const pointsOf = (entryId: string) => POINTS_BY_HORSE[expectDefined(horseOfEntry.get(entryId))];
    const [commissionerPoints, memberPoints] = [pointsOf(commissionerEntryId), pointsOf(memberEntryId)];
    const placeOf = (own: number, other: number) => (own === other ? 'T1' : own > other ? '1' : '2');
    const expected = {
      [commissionerEntryId]: { totalPoints: commissionerPoints, displayPosition: placeOf(commissionerPoints, memberPoints) },
      [memberEntryId]: { totalPoints: memberPoints, displayPosition: placeOf(memberPoints, commissionerPoints) },
    };
    const standingsOf = (entries: Array<{ entryId: string; displayPosition: string | null; race: { totalPoints: number | null } | null }>) =>
      Object.fromEntries(entries.map((entry) => [entry.entryId, { totalPoints: entry.race?.totalPoints, displayPosition: entry.displayPosition }]));
    const board = expectDefined((await getContestLeaderboard({ client: member.client, path: { contestId } })).data);
    expect(board.scoringDefinitionId).toBe('FINISH_POSITION_POINTS');
    expect(standingsOf(board.entries)).toEqual(expected);
    expect(board.entries.every((entry) => entry.golf === null)).toBe(true);

    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    const settled = expectDefined((await getContestLeaderboard({ client: member.client, path: { contestId } })).data);
    expect(standingsOf(settled.entries)).toEqual(expected);
  });
});
