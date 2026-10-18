import {
  acceptInvitation,
  addEventParticipants,
  applyEventParticipantUpload,
  applyEventRaceResults,
  autoAssignEventPrices,
  autoAssignEventTiers,
  createContest,
  createEvent,
  createParticipant,
  enterContest,
  generateInviteLink,
  getContest,
  getContestLeaderboard,
  listContestConfigTemplates,
  listEventParticipants,
  listSportLeagues,
  listSports,
  openContest,
  releaseEvent,
  submitContestEntry,
  submitContestSelection,
  transitionEvent,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, ContestStatus, SelectionType, Sport, findSportRow } from '@poolmaster/shared/domain';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  getFunctionalPrisma,
} from './setup';
import { expectDefined } from '../support/expect-defined';
import { standardEventPricing } from '../support/budget-pricing';

// Cycling end to end over HTTP (#626): an admin builds a race in the seeded UCI WorldTour and loads
// its field's odds by upload, a commissioner runs a contest from the tour's default tiered template
// (its Top 10 points table comes with it), two entries pick one rider from each of the five tiers,
// the admin enters the final overall classification with one rider who abandoned as a DNF, and the
// board and the settled contest score each entry by Top 10 points.

const RUN = `cycling-${Date.now()}`;
const TOP_10_POINTS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
// Six riders, shortest odds first. Tiered from odds one to a tier, the fifth tier takes the last
// two, so the two entries differ only in Roglic or Almeida.
const RIDERS = ['Pogacar', 'Vingegaard', 'Evenepoel', 'Ayuso', 'Roglic', 'Almeida'];
// The final overall order: Pogacar wins (10), Vingegaard second (9), Evenepoel third (8), Roglic
// fourth (7), Almeida fifth (6), and Ayuso abandoned mid-race, a DNF (0).
const FINISH: Record<string, number | null> = { Pogacar: 1, Vingegaard: 2, Evenepoel: 3, Roglic: 4, Almeida: 5, Ayuso: null };

const created = {
  sportEventIds: new Set<string>(),
  participantIds: new Set<string>(),
};

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  if (eventIds.length) {
    // The seeded tour stays: only this run's event series goes with its race.
    const seriesIds = (await db.sportEvent.findMany({ where: { id: { in: eventIds } }, select: { eventSeriesId: true } }))
      .map((event) => event.eventSeriesId);
    await db.contestEntryPick.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
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
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Cycling UCI WorldTour Top 10 points', () => {
  it('scores and settles two tiered entries by Top 10 points on the final overall order, an abandon scoring 0, from the tour\'s default template', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Race Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectDefined((await listSports({ client: a })).data).sports, Sport.CYCLING)).id;

    // --- The seeded tour, a race in it, and its field ------------------------------------------
    const tours = expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.CYCLING } })).data).sportLeagues;
    expect(tours.map((league) => league.name).sort()).toEqual(['UCI Women\'s WorldTour', 'UCI WorldTour']);
    const worldTour = expectDefined(tours.find((league) => league.name === 'UCI WorldTour'));

    const race = await createEvent({
      client: a,
      body: { sportLeagueId: worldTour.id, eventYear: 2099, name: `Tour of the Harbour ${RUN}`, startDate: '2099-07-03T10:00:00.000Z', autoLifecycleEnabled: false },
    });
    expect(race.response.status).toBe(201);
    const eventId = expectDefined(race.data).event.id;
    created.sportEventIds.add(eventId);
    // A stage race is one round: its result is the final overall classification, not one per stage.
    expect(expectDefined(race.data).event.rounds).toBe(1);

    const riderIds: string[] = [];
    for (const rider of RIDERS) {
      const participant = await createParticipant({ client: a, body: { sportId, participantType: 'INDIVIDUAL', name: `${rider} ${RUN}` } });
      const id = expectDefined(participant.data).participant.id;
      created.participantIds.add(id);
      riderIds.push(id);
    }
    expect((await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: riderIds } })).data?.added).toBe(6);

    // The admin uploads each rider's odds to win overall, then tiers and prices follow from them.
    const upload = await applyEventParticipantUpload({
      client: a,
      path: { eventId },
      body: { rows: RIDERS.map((rider, index) => ({ playerName: `${rider} ${RUN}`, oddsToWin: 2 + index * 3 })) },
    });
    expect(upload.response.status).toBe(200);
    expect((await autoAssignEventTiers({ client: a, path: { eventId }, body: { source: 'ODDS', tierSize: 1 } })).response.status).toBe(200);
    expect((await autoAssignEventPrices({ client: a, path: { eventId }, body: standardEventPricing() })).response.status).toBe(200);
    expect((await releaseEvent({ client: a, path: { eventId } })).data?.event.status).toBe('SCHEDULED');

    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    const riderOf = (fieldRowId: string) => expectDefined(field.find((row) => row.id === fieldRowId)).participant.name.replace(` ${RUN}`, '');
    const fieldRowOf = (rider: string) => expectDefined(field.find((row) => row.participant.name === `${rider} ${RUN}`)).id;
    const tierOf = (rider: string) => expectDefined(field.find((row) => row.id === fieldRowOf(rider))?.valuation?.sportEventTierId);
    expect(new Set(RIDERS.map(tierOf)).size).toBe(5);
    expect(tierOf('Roglic')).toBe(tierOf('Almeida'));

    // --- A contest from the UCI WorldTour's default template -----------------------------------
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Directeur Sportif', leagueName: `Peloton ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Soigneur' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });

    // The tour's templates come with the sport-wide ones, and never the women's tour's.
    const templates = expectDefined((await listContestConfigTemplates({
      client: commissioner.client,
      query: { sport: Sport.CYCLING, sportLeagueId: worldTour.id, contestFormat: ContestFormat.ROSTER, active: true },
    })).data).templates;
    expect(templates.map((template) => template.templateKey).sort()).toEqual([
      'uci-worldtour-budget-top-10', 'uci-worldtour-random-draw-top-10', 'uci-worldtour-tiered-top-10',
    ]);
    const tieredTemplate = expectDefined(templates.find((template) => template.isDefault), 'the tour default');
    expect(tieredTemplate.templateKey).toBe('uci-worldtour-tiered-top-10');

    const contest = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: `Tour of the Harbour Picks ${RUN}`,
        sportEventIds: [eventId],
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        templateId: tieredTemplate.id,
      },
    });
    expect(contest.response.status).toBe(201);
    const contestId = expectDefined(contest.data).contest.id;
    // The template's Top 10 points table is the contest's scoring rule.
    const scoringRule = await getFunctionalPrisma().participantContestScoringRule.findFirstOrThrow({
      where: { contestConfiguration: { contestId } },
    });
    expect(scoringRule.participantScoringDefinitionId).toBe('FINISH_POSITION_POINTS');
    expect(scoringRule.config).toEqual({ pointsTable: TOP_10_POINTS, didNotFinishPoints: 0 });

    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

    // --- Two entries, one rider from each tier -------------------------------------------------
    const enterWith = async (client: typeof a, lineup: string[]) => {
      const entryId = expectDefined((await enterContest({ client, path: { contestId } })).data).entry.id;
      for (const rider of lineup) {
        const pick = await submitContestSelection({ client, path: { contestId }, body: { entryId, participantId: fieldRowOf(rider) } });
        expect(pick.response.status).toBe(200);
      }
      expect((await submitContestEntry({ client, path: { contestId, entryId, sportEventId: eventId } })).response.status).toBe(200);
      return entryId;
    };
    const commissionerEntryId = await enterWith(commissioner.client, ['Pogacar', 'Vingegaard', 'Evenepoel', 'Ayuso', 'Roglic']);
    const memberEntryId = await enterWith(member.client, ['Pogacar', 'Vingegaard', 'Evenepoel', 'Ayuso', 'Almeida']);

    // --- The race runs, and the final overall order goes in, Ayuso's abandon as a DNF ----------
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    const rows = RIDERS.map((rider) => ({
      playerName: `${rider} ${RUN}`,
      resultStatus: FINISH[rider] === null ? 'DID_NOT_FINISH' as const : 'FINISHED' as const,
      finishPosition: FINISH[rider],
      startPosition: null,
      riderName: null,
    }));
    const official = await applyEventRaceResults({ client: a, path: { eventId }, body: { isOfficial: true, rows } });
    expect(official.response.status).toBe(200);
    expect(Object.fromEntries(expectDefined(official.data).participants.map((row) => [riderOf(row.id), row.race?.finishPosition ?? null])))
      .toEqual(FINISH);

    // --- The board, then the settled contest --------------------------------------------------
    // Commissioner: 10 + 9 + 8 + 0 (Ayuso abandoned) + 7 (Roglic fourth) = 34. Member: Almeida fifth for 6, so 33.
    const expected = {
      [commissionerEntryId]: { totalScore: 34, displayPosition: '1' },
      [memberEntryId]: { totalScore: 33, displayPosition: '2' },
    };
    const standingsOf = (entries: Array<{ entryId: string; displayPosition: string | null; totalScore: number | null }>) =>
      Object.fromEntries(entries.map((entry) => [entry.entryId, { totalScore: entry.totalScore, displayPosition: entry.displayPosition }]));
    const board = expectDefined((await getContestLeaderboard({ client: member.client, path: { contestId } })).data);
    expect(board.scoringDefinitionId).toBe('FINISH_POSITION_POINTS');
    expect(standingsOf(board.entries)).toEqual(expected);
    expect(board.entries.map((entry) => entry.entryId)).toEqual([commissionerEntryId, memberEntryId]);

    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    const settled = expectDefined((await getContestLeaderboard({ client: member.client, path: { contestId } })).data);
    expect(standingsOf(settled.entries)).toEqual(expected);
  });
});
