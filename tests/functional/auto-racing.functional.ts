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
  replaceEventTiers,
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

// Auto racing end to end over HTTP (#624): an admin builds a race in the seeded NASCAR Cup Series
// and loads its field's odds by upload, a commissioner runs a contest from the series' default
// tiered template (its NASCAR points table comes with it), two entries pick one driver from each
// of the five tiers, the admin enters the official finishing order, and the board and the settled
// contest score each entry by NASCAR Cup Series points. Then Formula 1 (#625): a race set to four
// tiers, a contest from the series' default budget template, scored by F1 points.

const RUN = `auto-${Date.now()}`;
const NASCAR_CUP_POINTS = [40, 35, ...Array.from({ length: 34 }, (_, index) => 34 - index), 1, 1, 1, 1];
// Six drivers, shortest odds first. Tiered from odds one to a tier, the fifth tier takes the last
// two, so the two entries differ only in Elliott or Hamlin.
const DRIVERS = ['Larson', 'Byron', 'Bell', 'Blaney', 'Elliott', 'Hamlin'];
// Larson wins (40), Byron second (35), Blaney third (34), Hamlin fourth (33), Elliott fifth (32),
// and Bell does not finish (0).
const FINISH: Record<string, number | null> = { Larson: 1, Byron: 2, Blaney: 3, Hamlin: 4, Elliott: 5, Bell: null };

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

describe('SDK Functional: Auto racing NASCAR Cup Series points', () => {
  it('scores and settles two tiered entries by NASCAR Cup Series points from the series\' default template', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Race Control' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectDefined((await listSports({ client: a })).data).sports, Sport.AUTO_RACING)).id;

    // --- The seeded series, a race in it, and its field ----------------------------------------
    const series = expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.AUTO_RACING } })).data).sportLeagues;
    expect(series.map((league) => league.name).sort()).toEqual(['Formula 1', 'IndyCar', 'NASCAR Cup Series']);
    const nascar = expectDefined(series.find((league) => league.name === 'NASCAR Cup Series'));

    const race = await createEvent({
      client: a,
      body: { sportLeagueId: nascar.id, eventYear: 2099, name: `Harbour 400 ${RUN}`, startDate: '2099-02-15T19:30:00.000Z', autoLifecycleEnabled: false },
    });
    expect(race.response.status).toBe(201);
    const eventId = expectDefined(race.data).event.id;
    created.sportEventIds.add(eventId);
    // A race is one round, with the sport's five tiers.
    expect(expectDefined(race.data).event.rounds).toBe(1);

    const driverIds: string[] = [];
    for (const driver of DRIVERS) {
      const participant = await createParticipant({ client: a, body: { sportId, participantType: 'INDIVIDUAL', name: `${driver} ${RUN}` } });
      const id = expectDefined(participant.data).participant.id;
      created.participantIds.add(id);
      driverIds.push(id);
    }
    expect((await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: driverIds } })).data?.added).toBe(6);

    // The admin uploads each driver's odds, then tiers and prices follow from them.
    const upload = await applyEventParticipantUpload({
      client: a,
      path: { eventId },
      body: { rows: DRIVERS.map((driver, index) => ({ playerName: `${driver} ${RUN}`, oddsToWin: 4 + index * 2 })) },
    });
    expect(upload.response.status).toBe(200);
    expect((await autoAssignEventTiers({ client: a, path: { eventId }, body: { source: 'ODDS', tierSize: 1 } })).response.status).toBe(200);
    expect((await autoAssignEventPrices({ client: a, path: { eventId }, body: standardEventPricing() })).response.status).toBe(200);
    expect((await releaseEvent({ client: a, path: { eventId } })).data?.event.status).toBe('SCHEDULED');

    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    const driverOf = (fieldRowId: string) => expectDefined(field.find((row) => row.id === fieldRowId)).participant.name.replace(` ${RUN}`, '');
    const fieldRowOf = (driver: string) => expectDefined(field.find((row) => row.participant.name === `${driver} ${RUN}`)).id;
    const tierOf = (driver: string) => expectDefined(field.find((row) => row.id === fieldRowOf(driver))?.valuation?.sportEventTierId);
    expect(new Set(DRIVERS.map(tierOf)).size).toBe(5);
    expect(tierOf('Elliott')).toBe(tierOf('Hamlin'));

    // --- A contest from the NASCAR series' default template ------------------------------------
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Crew Chief', leagueName: `Pit Row ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Spotter' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });

    // The series' templates come with the sport-wide ones, and never IndyCar's.
    const templates = expectDefined((await listContestConfigTemplates({
      client: commissioner.client,
      query: { sport: Sport.AUTO_RACING, sportLeagueId: nascar.id, contestFormat: ContestFormat.ROSTER, active: true },
    })).data).templates;
    expect(templates.map((template) => template.templateKey).sort()).toEqual([
      'nascar-cup-budget-points', 'nascar-cup-random-draw-points', 'nascar-cup-tiered-points',
    ]);
    const tieredTemplate = expectDefined(templates.find((template) => template.isDefault), 'the series default');
    expect(tieredTemplate.templateKey).toBe('nascar-cup-tiered-points');

    const contest = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: `Harbour 400 Picks ${RUN}`,
        sportEventId: eventId,
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        templateId: tieredTemplate.id,
      },
    });
    expect(contest.response.status).toBe(201);
    const contestId = expectDefined(contest.data).contest.id;
    // The template's NASCAR points table is the contest's scoring rule.
    const scoringRule = await getFunctionalPrisma().participantContestScoringRule.findFirstOrThrow({
      where: { contestConfiguration: { contestId } },
    });
    expect(scoringRule.participantScoringDefinitionId).toBe('FINISH_POSITION_POINTS');
    expect(scoringRule.config).toEqual({ pointsTable: NASCAR_CUP_POINTS, didNotFinishPoints: 0 });

    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

    // --- Two entries, one driver from each tier ------------------------------------------------
    const enterWith = async (client: typeof a, lineup: string[]) => {
      const entryId = expectDefined((await enterContest({ client, path: { contestId } })).data).entry.id;
      for (const driver of lineup) {
        const pick = await submitContestSelection({ client, path: { contestId }, body: { entryId, participantId: fieldRowOf(driver) } });
        expect(pick.response.status).toBe(200);
      }
      expect((await submitContestEntry({ client, path: { contestId, entryId } })).response.status).toBe(200);
      return entryId;
    };
    const commissionerEntryId = await enterWith(commissioner.client, ['Larson', 'Byron', 'Bell', 'Blaney', 'Elliott']);
    const memberEntryId = await enterWith(member.client, ['Larson', 'Byron', 'Bell', 'Blaney', 'Hamlin']);

    // --- The race runs, and the official finishing order goes in ---------------------------
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    const rows = DRIVERS.map((driver) => ({
      playerName: `${driver} ${RUN}`,
      resultStatus: FINISH[driver] === null ? 'DID_NOT_FINISH' as const : 'FINISHED' as const,
      finishPosition: FINISH[driver],
      startPosition: null,
      riderName: null,
    }));
    const official = await applyEventRaceResults({ client: a, path: { eventId }, body: { isOfficial: true, rows } });
    expect(official.response.status).toBe(200);
    expect(Object.fromEntries(expectDefined(official.data).participants.map((row) => [driverOf(row.id), row.race?.finishPosition ?? null])))
      .toEqual(FINISH);

    // --- The board, then the settled contest --------------------------------------------------
    // Commissioner: 40 + 35 + 0 + 34 + 32 (Elliott fifth) = 141. Member: Hamlin fourth for 33, so 142.
    const expected = {
      [memberEntryId]: { totalScore: 142, displayPosition: '1' },
      [commissionerEntryId]: { totalScore: 141, displayPosition: '2' },
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

const FORMULA_1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
// Eight drivers, shortest odds first, so the first is priced highest and the last five lowest.
const F1_DRIVERS = ['Verstappen', 'Leclerc', 'Norris', 'Piastri', 'Hamilton', 'Russell', 'Sainz', 'Alonso'];
// Norris wins (25), Piastri second (18), Verstappen third (15), Leclerc fourth (12), Russell
// fifth (10), Alonso sixth (8), Hamilton seventh (6), and Sainz does not finish (0).
const F1_FINISH: Record<string, number | null> = {
  Norris: 1, Piastri: 2, Verstappen: 3, Leclerc: 4, Russell: 5, Alonso: 6, Hamilton: 7, Sainz: null,
};

describe('SDK Functional: Auto racing Formula 1 points', () => {
  it('scores and settles two budget entries by F1 points from the Formula 1 default template, on a race set to four tiers', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Race Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectDefined((await listSports({ client: a })).data).sports, Sport.AUTO_RACING)).id;
    const series = expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.AUTO_RACING } })).data).sportLeagues;
    const formula1 = expectDefined(series.find((league) => league.name === 'Formula 1'), 'the seeded Formula 1 series');

    // --- A grand prix, its field, four tiers and prices -------------------------------------------
    const race = await createEvent({
      client: a,
      body: { sportLeagueId: formula1.id, eventYear: 2099, name: `Harbour Grand Prix ${RUN}`, startDate: '2099-05-24T13:00:00.000Z', autoLifecycleEnabled: false },
    });
    expect(race.response.status).toBe(201);
    const eventId = expectDefined(race.data).event.id;
    created.sportEventIds.add(eventId);

    const driverIds: string[] = [];
    for (const driver of F1_DRIVERS) {
      const participant = await createParticipant({ client: a, body: { sportId, participantType: 'INDIVIDUAL', name: `${driver} ${RUN}` } });
      const id = expectDefined(participant.data).participant.id;
      created.participantIds.add(id);
      driverIds.push(id);
    }
    expect((await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: driverIds } })).data?.added).toBe(8);
    expect((await applyEventParticipantUpload({
      client: a,
      path: { eventId },
      body: { rows: F1_DRIVERS.map((driver, index) => ({ playerName: `${driver} ${RUN}`, oddsToWin: 2 + index * 3 })) },
    })).response.status).toBe(200);

    // A Formula 1 race is set to four tiers on the event's Tiers card, over the sport's five.
    const fourTiers = await replaceEventTiers({
      client: a,
      path: { eventId },
      body: { tiers: [1, 2, 3, 4].map((n) => ({ tierKey: `tier-${n}`, label: `Tier ${n}`, tierNumber: n })) },
    });
    expect(fourTiers.response.status).toBe(200);
    expect(expectDefined(fourTiers.data).tiers).toHaveLength(4);
    expect((await autoAssignEventTiers({ client: a, path: { eventId }, body: { source: 'ODDS', tierSize: 2 } })).response.status).toBe(200);
    expect((await autoAssignEventPrices({ client: a, path: { eventId }, body: standardEventPricing() })).response.status).toBe(200);
    expect((await releaseEvent({ client: a, path: { eventId } })).data?.event.status).toBe('SCHEDULED');

    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    const fieldRowOf = (driver: string) => expectDefined(field.find((row) => row.participant.name === `${driver} ${RUN}`));
    expect(new Set(F1_DRIVERS.map((driver) => fieldRowOf(driver).valuation?.sportEventTierId)).size).toBe(4);

    // --- A contest from the Formula 1 default: the budget preset ---------------------------------
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Team Principal', leagueName: `Paddock ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Race Engineer' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });

    const templates = expectDefined((await listContestConfigTemplates({
      client: commissioner.client,
      query: { sport: Sport.AUTO_RACING, sportLeagueId: formula1.id, contestFormat: ContestFormat.ROSTER, active: true },
    })).data).templates;
    expect(templates.map((template) => template.templateKey).sort()).toEqual([
      'formula-1-budget-points', 'formula-1-random-draw-points', 'formula-1-tiered-points',
    ]);
    const budgetTemplate = expectDefined(templates.find((template) => template.isDefault), 'the Formula 1 default');
    expect(budgetTemplate.templateKey).toBe('formula-1-budget-points');

    const contest = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: `Harbour Grand Prix Picks ${RUN}`,
        sportEventId: eventId,
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.BUDGET_PICK,
        templateId: budgetTemplate.id,
      },
    });
    expect(contest.response.status).toBe(201);
    const contestId = expectDefined(contest.data).contest.id;
    const scoringRule = await getFunctionalPrisma().participantContestScoringRule.findFirstOrThrow({
      where: { contestConfiguration: { contestId } },
    });
    expect(scoringRule.config).toEqual({ pointsTable: FORMULA_1_POINTS, didNotFinishPoints: 0 });
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

    // --- Two five-driver entries under the $50,000 cap -------------------------------------------
    const enterWith = async (client: typeof a, lineup: string[]) => {
      const entryId = expectDefined((await enterContest({ client, path: { contestId } })).data).entry.id;
      for (const driver of lineup) {
        const pick = await submitContestSelection({ client, path: { contestId }, body: { entryId, participantId: fieldRowOf(driver).id } });
        expect(pick.response.status).toBe(200);
      }
      expect((await submitContestEntry({ client, path: { contestId, entryId } })).response.status).toBe(200);
      return entryId;
    };
    // The five cheapest, and the favourite in place of Piastri.
    const commissionerEntryId = await enterWith(commissioner.client, ['Piastri', 'Hamilton', 'Russell', 'Sainz', 'Alonso']);
    const memberEntryId = await enterWith(member.client, ['Verstappen', 'Hamilton', 'Russell', 'Sainz', 'Alonso']);

    // --- The grand prix runs, and its classification goes in --------------------------------------
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    const official = await applyEventRaceResults({
      client: a,
      path: { eventId },
      body: {
        isOfficial: true,
        rows: F1_DRIVERS.map((driver) => ({
          playerName: `${driver} ${RUN}`,
          resultStatus: F1_FINISH[driver] === null ? 'DID_NOT_FINISH' as const : 'FINISHED' as const,
          finishPosition: F1_FINISH[driver],
          startPosition: null,
          riderName: null,
        })),
      },
    });
    expect(official.response.status).toBe(200);

    // Commissioner: 18 + 6 + 10 + 0 + 8 = 42. Member: Verstappen third for 15, so 39.
    const expected = {
      [commissionerEntryId]: { totalScore: 42, displayPosition: '1' },
      [memberEntryId]: { totalScore: 39, displayPosition: '2' },
    };
    const standingsOf = (entries: Array<{ entryId: string; displayPosition: string | null; totalScore: number | null }>) =>
      Object.fromEntries(entries.map((entry) => [entry.entryId, { totalScore: entry.totalScore, displayPosition: entry.displayPosition }]));

    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    const settled = expectDefined((await getContestLeaderboard({ client: member.client, path: { contestId } })).data);
    expect(settled.scoringDefinitionId).toBe('FINISH_POSITION_POINTS');
    expect(standingsOf(settled.entries)).toEqual(expected);
    expect(settled.entries.map((entry) => entry.entryId)).toEqual([commissionerEntryId, memberEntryId]);
  });
});
