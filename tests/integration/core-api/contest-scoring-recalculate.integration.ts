import {
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { Sport } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Contest scoring recalculation integration', () => {
  // Reactivated by SKIP: pool-master-rop.78.7 — recalculation depends on
  // sportEventParticipantSourceData (dropped per plans/117 §13.2).
  it.skip('recalculates entry totals, participant score rows, standings, and prize awards from the new model', async () => {
    const owner = await createTestUser({ displayName: 'Contest Scoring Recalc Owner' });
    const coOwner = await createTestUser({ displayName: 'Contest Scoring Recalc CoOwner' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contest Scoring Recalc League'),
    });

    expect(leagueRes.statusCode).toBe(201);
    const leagueId = leagueRes.json().league.id;

    const prisma = getPrisma();
    const sport = await prisma.sport.create({
      data: {
        name: `Basketball ${Date.now()}`,
        participantType: 'TEAM',
      },
    });

    const ownerSquadMembership = await prisma.squadMembership.findFirst({
      where: {
        leagueId,
        userId: owner.user.id,
        status: 'ACTIVE',
      },
      include: {
        squad: true,
      },
    });

    expect(ownerSquadMembership?.squad).toBeDefined();
    const squadA = ownerSquadMembership!.squad;

    await prisma.leagueMembership.create({
      data: {
        leagueId,
        userId: coOwner.user.id,
        role: 'MEMBER',
        status: 'ACTIVE',
      },
    });

    const squadB = await prisma.squad.create({
      data: {
        leagueId,
        createdBy: coOwner.user.id,
        name: 'Squad B',
      },
    });

    await prisma.squadMembership.createMany({
      data: [
        {
          squadId: squadB.id,
          leagueId,
          userId: coOwner.user.id,
          status: 'ACTIVE',
        },
      ],
    });

    const sportEvent = await prisma.sportEvent.create({
      data: {
        externalId: `recalc-event-${Date.now()}`,
        providerId: 'integration-test',
        sport: Sport.NCAA_BASKETBALL,
        name: 'Recalc Event',
        startDate: new Date('2026-04-09T12:00:00.000Z'),
        releaseAt: new Date('2026-04-09T12:00:00.000Z'),
        fieldLocksAt: new Date('2026-04-09T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });

    const contest = await prisma.contest.create({
      data: {
        leagueId,
        sportEventId: sportEvent.id,
        name: 'Recalc Contest',
        status: 'LOCKED',
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        scoringEngine: 'REGISTRY',
      },
    });

    const configuration = await prisma.contestConfiguration.create({
      data: {
        contestId: contest.id,
        selectionType: 'TIERED',
        locksAt: new Date('2026-04-09T11:00:00.000Z'),
        minimumEntries: 1,
        maxEntriesPerSquad: 2,
        rosterSize: 1,
        totalPrizePoolAmount: 100,
      },
    });

    await prisma.participantContestScoringRule.createMany({
      data: [
        {
          contestConfigurationId: configuration.id,
          participantScoringDefinitionId: 'TEAM_WIN_POINTS',
          sortOrder: 1,
          config: { pointsPerWin: 1 },
          active: true,
        },
        {
          contestConfigurationId: configuration.id,
          participantScoringDefinitionId: 'ROUND_MULTIPLIER',
          sortOrder: 2,
          config: { roundMultipliers: { '1': 1, '2': 2 } },
          active: true,
        },
        {
          contestConfigurationId: configuration.id,
          participantScoringDefinitionId: 'SEED_DIFFERENTIAL_BONUS',
          sortOrder: 3,
          config: { underdogOnly: true },
          active: true,
        },
      ],
    });

    await prisma.contestEntryAggregationRule.create({
      data: {
        contestConfigurationId: configuration.id,
        aggregationDefinitionId: 'SUM_ALL_ENTRIES',
        config: {},
        active: true,
      },
    });

    const prizeDefinition = await prisma.contestPrizeDefinition.create({
      data: {
        contestConfigurationId: configuration.id,
        prizeDefinitionId: 'FINAL_PLACE',
        displayName: 'Champion',
        sortOrder: 1,
        ruleConfig: { place: 1 },
        payoutType: 'FIXED_AMOUNT',
        amount: 100,
        active: true,
      },
    });

    const participantA = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: 'Tiger A',
        participantType: 'TEAM',
        status: 'ACTIVE',
      },
    });
    const participantB = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: 'Tiger B',
        participantType: 'TEAM',
        status: 'ACTIVE',
      },
    });

    const sepA = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participantA.id,
        status: 'ACTIVE',
      },
    });
    const sepB = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participantB.id,
        status: 'ACTIVE',
      },
    });

    // sportEventParticipantSourceData was dropped per plans/117 §13.2.
    // rop.78.7 rebuilds the recalculation path against SportEventParticipantGolfRound
    // and the per-(category × contestFormat) contribution table.

    const entryA = await prisma.contestEntry.create({
      data: {
        contestId: contest.id,
        squadId: squadA.id,
        entryNumber: 1,
        name: 'Entry A',
        status: 'ACTIVE',
      },
    });
    const entryB = await prisma.contestEntry.create({
      data: {
        contestId: contest.id,
        squadId: squadB.id,
        entryNumber: 1,
        name: 'Entry B',
        status: 'ACTIVE',
      },
    });

    await prisma.contestEntryPick.createMany({
      data: [
        {
          entryId: entryA.id,
          sportEventParticipantId: sepA.id,
          contestFormat: 'ROSTER',
        },
        {
          entryId: entryB.id,
          sportEventParticipantId: sepB.id,
          contestFormat: 'ROSTER',
        },
      ],
    });

    const res = await getApp().inject({
      method: 'POST',
      url: `/api/v1/contests/${contest.id}/scoring/recalculate`,
      headers: withoutJsonBodyHeaders(owner.headers),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({
        contestId: contest.id,
        teamsAffected: 2,
        standingsChanged: true,
      }),
    );

    const updatedEntries = await prisma.contestEntry.findMany({
      where: { contestId: contest.id },
      orderBy: { standingsPosition: 'asc' },
    });
    expect(updatedEntries.map((entry) => ({
      id: entry.id,
      totalScore: entry.totalScore,
      standingsPosition: entry.standingsPosition,
    }))).toEqual([
      { id: entryA.id, totalScore: 11, standingsPosition: 1 },
      { id: entryB.id, totalScore: 2, standingsPosition: 2 },
    ]);

    const participantScores = await prisma.contestEntryParticipantScore.findMany({
      where: { entryId: entryA.id },
    });
    expect(participantScores).toHaveLength(1);
    expect(participantScores[0]?.pointsEarned).toBe(11);

    const scoreEvents = await prisma.contestEntryParticipantScoreEvent.findMany({
      where: { contestEntryParticipantScoreId: participantScores[0]!.id },
    });
    expect(scoreEvents).toHaveLength(3);

    const awards = await prisma.contestEntryPrizeAward.findMany({
      where: { contestPrizeDefinitionId: prizeDefinition.id },
      orderBy: { entryId: 'asc' },
    });
    expect(awards).toHaveLength(1);
    expect(awards[0]).toMatchObject({
      entryId: entryA.id,
      displayName: 'Champion',
      amount: 100,
    });
  });
});
