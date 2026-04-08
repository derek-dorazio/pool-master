import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { LeagueVisibility, Sport } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Contest scoring recalculation integration', () => {
  it('recalculates entry totals, participant score rows, standings, and prize awards from the new model', async () => {
    const owner = await createTestUser({ displayName: 'Contest Scoring Recalc Owner' });
    const coOwner = await createTestUser({ displayName: 'Contest Scoring Recalc CoOwner' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: {
        name: 'Contest Scoring Recalc League',
        visibility: LeagueVisibility.PRIVATE,
      },
    });

    expect(leagueRes.statusCode).toBe(201);
    const leagueId = leagueRes.json().league.id;

    const prisma = getPrisma();
    const sport = await prisma.sport.create({
      data: {
        name: `Basketball ${Date.now()}`,
        participantType: 'TEAM',
        statSchema: {},
      },
    });

    const squadA = await prisma.squad.create({
      data: {
        leagueId,
        createdBy: owner.user.id,
        name: 'Squad A',
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
          squadId: squadA.id,
          leagueId,
          userId: owner.user.id,
          status: 'ACTIVE',
        },
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
        status: 'SCHEDULED',
      },
    });

    const contest = await prisma.contest.create({
      data: {
        leagueId,
        sportEventId: sportEvent.id,
        name: 'Recalc Contest',
        status: 'LOCKED',
        contestType: 'SINGLE_EVENT',
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

    await prisma.sportEventParticipantSourceData.createMany({
      data: [
        {
          sportEventParticipantId: sepA.id,
          providerId: 'integration-test',
          externalId: 'sep-a',
          rawPayload: {},
          normalizedData: {
            completedWins: [{ round: 2, seed: 10, opponentSeed: 2 }],
          },
          receivedAt: new Date('2026-04-09T12:00:00.000Z'),
        },
        {
          sportEventParticipantId: sepB.id,
          providerId: 'integration-test',
          externalId: 'sep-b',
          rawPayload: {},
          normalizedData: {
            completedWins: [{ round: 1, seed: 2, opponentSeed: 10 }],
          },
          receivedAt: new Date('2026-04-09T12:00:00.000Z'),
        },
      ],
    });

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

    await prisma.rosterPick.createMany({
      data: [
        {
          entryId: entryA.id,
          sportEventParticipantId: sepA.id,
        },
        {
          entryId: entryB.id,
          sportEventParticipantId: sepB.id,
        },
      ],
    });

    const res = await getApp().inject({
      method: 'POST',
      url: `/api/v1/contests/${contest.id}/scoring/recalculate`,
      headers: withoutJsonBodyHeaders({
        ...owner.headers,
        'x-tenant-id': owner.user.tenantId,
      }),
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
