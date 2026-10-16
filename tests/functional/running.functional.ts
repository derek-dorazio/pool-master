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

// Running end to end over HTTP (#627): an admin builds a marathon in the seeded World Marathon
// Majors (men) series and loads its elite field by upload with each runner's World Athletics
// ranking and the same order as seed, and no odds: odds are optional for every sport,
// so tiers come from ranking and prices from seed alone. A commissioner runs a contest from the
// series' default tiered template (its Top 10 points table comes with it), two entries pick one
// runner from each of the four tiers, the admin enters the official finishing order with one
// runner who dropped out as a DNF, and the board and the settled contest score each entry by Top
// 10 points.

const RUN = `running-${Date.now()}`;
const TOP_10_POINTS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
// Five runners in World Athletics ranking order, which is also their seed. Tiered by ranking one
// to a tier, the fourth and last tier takes the last two, so the two entries differ only in Tola
// or Abdi.
const RUNNERS = ['Kiplimo', 'Lemma', 'Kipruto', 'Tola', 'Abdi'];
// The official finishing order: Kiplimo wins (10), Kipruto second (9), Abdi third (8), Tola
// fourth (7), and Lemma dropped out, a DNF (0).
const FINISH: Record<string, number | null> = { Kiplimo: 1, Kipruto: 2, Abdi: 3, Tola: 4, Lemma: null };

const created = {
  sportEventIds: new Set<string>(),
  participantIds: new Set<string>(),
};

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  if (eventIds.length) {
    // The seeded series stays: only this run's event series goes with its race.
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

describe('SDK Functional: Running World Marathon Majors Top 10 points', () => {
  it('tiers and prices a field from ranking and seed with no odds, then scores and settles two tiered entries by Top 10 points, a dropout scoring 0, from the series\' default template', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Race Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectDefined((await listSports({ client: a })).data).sports, Sport.RUNNING)).id;

    // --- The seeded series, a race in it, and its field ----------------------------------------
    const series = expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.RUNNING } })).data).sportLeagues;
    expect(series.map((league) => league.name).sort()).toEqual(['World Marathon Majors (men)', 'World Marathon Majors (women)']);
    const majorsMen = expectDefined(series.find((league) => league.name === 'World Marathon Majors (men)'));

    const race = await createEvent({
      client: a,
      body: { sportLeagueId: majorsMen.id, eventYear: 2099, name: `Harbour Marathon ${RUN}`, startDate: '2099-04-19T13:30:00.000Z', autoLifecycleEnabled: false },
    });
    expect(race.response.status).toBe(201);
    const eventId = expectDefined(race.data).event.id;
    created.sportEventIds.add(eventId);
    expect(expectDefined(race.data).event.rounds).toBe(1);

    const runnerIds: string[] = [];
    for (const runner of RUNNERS) {
      const participant = await createParticipant({ client: a, body: { sportId, participantType: 'INDIVIDUAL', name: `${runner} ${RUN}` } });
      const id = expectDefined(participant.data).participant.id;
      created.participantIds.add(id);
      runnerIds.push(id);
    }
    expect((await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: runnerIds } })).data?.added).toBe(5);

    // The admin uploads each runner's ranking and the same order as seed, and no odds; tiers then
    // follow from ranking and prices from seed.
    const upload = await applyEventParticipantUpload({
      client: a,
      path: { eventId },
      body: { rows: RUNNERS.map((runner, index) => ({ playerName: `${runner} ${RUN}`, ranking: index + 1, seedNumber: index + 1 })) },
    });
    expect(upload.response.status).toBe(200);
    expect((await autoAssignEventTiers({ client: a, path: { eventId }, body: { source: 'RANKING', tierSize: 1 } })).response.status).toBe(200);
    expect((await autoAssignEventPrices({ client: a, path: { eventId }, body: standardEventPricing() })).response.status).toBe(200);
    expect((await releaseEvent({ client: a, path: { eventId } })).data?.event.status).toBe('SCHEDULED');

    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    const runnerOf = (fieldRowId: string) => expectDefined(field.find((row) => row.id === fieldRowId)).participant.name.replace(` ${RUN}`, '');
    const rowOf = (runner: string) => expectDefined(field.find((row) => row.participant.name === `${runner} ${RUN}`));
    const fieldRowOf = (runner: string) => rowOf(runner).id;
    const tierOf = (runner: string) => expectDefined(rowOf(runner).valuation?.sportEventTierId);
    const priceOf = (runner: string) => expectDefined(rowOf(runner).valuation?.price);
    // No odds anywhere, yet every runner has a tier and a price, so the race released.
    expect(field.map((row) => row.oddsToWin)).toEqual([null, null, null, null, null]);
    // A new running race has the sport's four tiers: one runner in each of the first three by
    // ranking, the last tier taking the rest.
    expect(new Set(RUNNERS.map(tierOf)).size).toBe(4);
    expect(tierOf('Tola')).toBe(tierOf('Abdi'));
    // Priced by seed alone: the best seed costs the most.
    const prices = RUNNERS.map(priceOf);
    expect([...prices].sort((left, right) => right - left)).toEqual(prices);
    expect(prices[0]).toBeGreaterThan(prices[4]);

    // --- A contest from the World Marathon Majors (men) default template ------------------------
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Pacer', leagueName: `Harriers ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Split Timer' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });

    // The series' templates come with the sport-wide ones, and never the women's series'.
    const templates = expectDefined((await listContestConfigTemplates({
      client: commissioner.client,
      query: { sport: Sport.RUNNING, sportLeagueId: majorsMen.id, contestFormat: ContestFormat.ROSTER, active: true },
    })).data).templates;
    expect(templates.map((template) => template.templateKey).sort()).toEqual([
      'wmm-men-budget-top-10', 'wmm-men-random-draw-top-10', 'wmm-men-tiered-top-10',
    ]);
    const tieredTemplate = expectDefined(templates.find((template) => template.isDefault), 'the series default');
    expect(tieredTemplate.templateKey).toBe('wmm-men-tiered-top-10');

    const contest = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: `Harbour Marathon Picks ${RUN}`,
        sportEventId: eventId,
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

    // --- Two entries, one runner from each tier ------------------------------------------------
    const enterWith = async (client: typeof a, lineup: string[]) => {
      const entryId = expectDefined((await enterContest({ client, path: { contestId } })).data).entry.id;
      for (const runner of lineup) {
        const pick = await submitContestSelection({ client, path: { contestId }, body: { entryId, participantId: fieldRowOf(runner) } });
        expect(pick.response.status).toBe(200);
      }
      expect((await submitContestEntry({ client, path: { contestId, entryId } })).response.status).toBe(200);
      return entryId;
    };
    const commissionerEntryId = await enterWith(commissioner.client, ['Kiplimo', 'Lemma', 'Kipruto', 'Tola']);
    const memberEntryId = await enterWith(member.client, ['Kiplimo', 'Lemma', 'Kipruto', 'Abdi']);

    // --- The race runs, and the official finishing order goes in, Lemma's dropout as a DNF -----
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    const rows = RUNNERS.map((runner) => ({
      playerName: `${runner} ${RUN}`,
      resultStatus: FINISH[runner] === null ? 'DID_NOT_FINISH' as const : 'FINISHED' as const,
      finishPosition: FINISH[runner],
      startPosition: null,
      riderName: null,
    }));
    const official = await applyEventRaceResults({ client: a, path: { eventId }, body: { isOfficial: true, rows } });
    expect(official.response.status).toBe(200);
    expect(Object.fromEntries(expectDefined(official.data).participants.map((row) => [runnerOf(row.id), row.race?.finishPosition ?? null])))
      .toEqual(FINISH);

    // --- The board, then the settled contest --------------------------------------------------
    // Member: 10 + 0 (Lemma dropped out) + 9 + 8 (Abdi third) = 27. Commissioner: Tola fourth for 7, so 26.
    const expected = {
      [memberEntryId]: { totalScore: 27, displayPosition: '1' },
      [commissionerEntryId]: { totalScore: 26, displayPosition: '2' },
    };
    const standingsOf = (entries: Array<{ entryId: string; displayPosition: string | null; totalScore: number | null }>) =>
      Object.fromEntries(entries.map((entry) => [entry.entryId, { totalScore: entry.totalScore, displayPosition: entry.displayPosition }]));
    const board = expectDefined((await getContestLeaderboard({ client: member.client, path: { contestId } })).data);
    expect(board.scoringDefinitionId).toBe('FINISH_POSITION_POINTS');
    expect(standingsOf(board.entries)).toEqual(expected);
    expect(board.entries.map((entry) => entry.entryId)).toEqual([memberEntryId, commissionerEntryId]);

    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    const settled = expectDefined((await getContestLeaderboard({ client: member.client, path: { contestId } })).data);
    expect(standingsOf(settled.entries)).toEqual(expected);
  });
});
