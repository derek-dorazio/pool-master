import { randomUUID } from 'node:crypto';
import {
  cleanupTestData,
  createTestUser,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import {
  PrismaContestEntryParticipantScoreEventRepository,
  PrismaContestEntryParticipantScoreRepository,
  PrismaContestEntryPrizeAwardRepository,
} from '../../../packages/core-api/src/adapters';
import {
  ContestEntryScoringResultService,
  scoreContestEntry,
} from '../../../packages/core-api/src/modules/contest-scoring';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Contest scoring result persistence integration', () => {
  it('supports CRUD for participant scores, score events, and prize awards', async () => {
    const fixture = await createScoringFixture();
    const prisma = getPrisma();
    const scoreRepo = new PrismaContestEntryParticipantScoreRepository(prisma);
    const eventRepo = new PrismaContestEntryParticipantScoreEventRepository(prisma);
    const awardRepo = new PrismaContestEntryPrizeAwardRepository(prisma);

    const score = await scoreRepo.create({
      entryId: fixture.entry.id,
      pickId: fixture.rosterPick.id,
      pointsEarned: 4,
    });

    expect(await scoreRepo.findById(score.id)).toMatchObject({
      id: score.id,
      entryId: fixture.entry.id,
      pickId: fixture.rosterPick.id,
      pointsEarned: 4,
    });

    const updatedScore = await scoreRepo.update(score.id, { pointsEarned: 12 });
    expect(updatedScore.pointsEarned).toBe(12);
    expect(await scoreRepo.findByEntry(fixture.entry.id)).toHaveLength(1);

    const event = await eventRepo.create({
      contestEntryParticipantScoreId: score.id,
      participantContestScoringRuleId: fixture.scoringRules.teamWin.id,
      points: 12,
      detailsJson: { completedWins: 1 },
    });

    expect(await eventRepo.findById(event.id)).toMatchObject({
      id: event.id,
      participantContestScoringRuleId: fixture.scoringRules.teamWin.id,
      points: 12,
    });
    expect(await eventRepo.findByParticipantScore(score.id)).toHaveLength(1);

    const award = await awardRepo.create({
      entryId: fixture.entry.id,
      contestPrizeDefinitionId: fixture.prizeDefinition.id,
      prizeDefinitionId: fixture.prizeDefinition.prizeDefinitionId,
      displayName: fixture.prizeDefinition.displayName,
      amount: 125,
      percentage: undefined,
      awardedAt: new Date('2026-04-08T12:00:00.000Z'),
    });

    expect(await awardRepo.findById(award.id)).toMatchObject({
      id: award.id,
      entryId: fixture.entry.id,
      contestPrizeDefinitionId: fixture.prizeDefinition.id,
      amount: 125,
    });
    expect(await awardRepo.findByEntry(fixture.entry.id)).toHaveLength(1);

    expect(await eventRepo.deleteByParticipantScore(score.id)).toBe(1);
    expect(await awardRepo.deleteByEntry(fixture.entry.id)).toBe(1);
    expect(await scoreRepo.deleteByEntry(fixture.entry.id)).toBe(1);
  });

  it('replaces an entry scoring result and recalculates persisted score rows after corrections', async () => {
    const fixture = await createScoringFixture();
    const prisma = getPrisma();
    const service = new ContestEntryScoringResultService(prisma);
    const scoreRepo = new PrismaContestEntryParticipantScoreRepository(prisma);
    const eventRepo = new PrismaContestEntryParticipantScoreEventRepository(prisma);
    const awardRepo = new PrismaContestEntryPrizeAwardRepository(prisma);

    const firstResult = scoreContestEntry({
      picks: [
        {
          id: fixture.rosterPick.id,
          sportEventParticipantId: fixture.sportEventParticipant.id,
        },
      ],
      sourceData: [
        {
          sportEventParticipantId: fixture.sportEventParticipant.id,
          rawPayload: {},
          normalizedData: {
            completedWins: [{ round: 1, seed: 10, opponentSeed: 7 }],
          },
        },
      ],
      scoringRules: [
        fixture.scoringRules.teamWin,
        fixture.scoringRules.roundMultiplier,
        fixture.scoringRules.seedDifferential,
      ],
      aggregationRule: fixture.aggregationRule,
    });

    await service.replaceEntryScoringResult({
      entryId: fixture.entry.id,
      totalScore: firstResult.totalScore,
      standingsPosition: 1,
      isEliminated: false,
      scoreResult: firstResult,
      prizeAwards: [
        {
          contestPrizeDefinitionId: fixture.prizeDefinition.id,
          prizeDefinitionId: fixture.prizeDefinition.prizeDefinitionId,
          displayName: fixture.prizeDefinition.displayName,
          amount: 150,
          percentage: undefined,
          awardedAt: new Date('2026-04-08T12:00:00.000Z'),
        },
      ],
    });

    const firstScores = await scoreRepo.findByEntry(fixture.entry.id);
    expect(firstScores).toHaveLength(1);
    expect(firstScores[0]?.pointsEarned).toBe(5);
    const firstEvents = await eventRepo.findByParticipantScore(firstScores[0]!.id);
    expect(firstEvents).toHaveLength(3);
    expect((await awardRepo.findByEntry(fixture.entry.id))[0]?.amount).toBe(150);

    const correctedResult = scoreContestEntry({
      picks: [
        {
          id: fixture.rosterPick.id,
          sportEventParticipantId: fixture.sportEventParticipant.id,
        },
      ],
      sourceData: [
        {
          sportEventParticipantId: fixture.sportEventParticipant.id,
          rawPayload: {},
          normalizedData: {
            completedWins: [{ round: 2, seed: 10, opponentSeed: 2 }],
          },
        },
      ],
      scoringRules: [
        fixture.scoringRules.teamWin,
        fixture.scoringRules.roundMultiplier,
        fixture.scoringRules.seedDifferential,
      ],
      aggregationRule: fixture.aggregationRule,
    });

    await service.replaceEntryScoringResult({
      entryId: fixture.entry.id,
      totalScore: correctedResult.totalScore,
      standingsPosition: 2,
      isEliminated: false,
      scoreResult: correctedResult,
      prizeAwards: [
        {
          contestPrizeDefinitionId: fixture.prizeDefinition.id,
          prizeDefinitionId: fixture.prizeDefinition.prizeDefinitionId,
          displayName: fixture.prizeDefinition.displayName,
          amount: 60,
          percentage: undefined,
          awardedAt: new Date('2026-04-08T13:00:00.000Z'),
        },
      ],
    });

    const updatedScores = await scoreRepo.findByEntry(fixture.entry.id);
    expect(updatedScores).toHaveLength(1);
    expect(updatedScores[0]?.pointsEarned).toBe(11);
    const updatedEvents = await eventRepo.findByParticipantScore(updatedScores[0]!.id);
    expect(updatedEvents).toHaveLength(3);
    expect(updatedEvents.map((event) => event.points).sort((left, right) => left - right)).toEqual([1, 2, 8]);

    const updatedAwards = await awardRepo.findByEntry(fixture.entry.id);
    expect(updatedAwards).toHaveLength(1);
    expect(updatedAwards[0]?.amount).toBe(60);

    const updatedEntry = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: fixture.entry.id },
    });
    expect(updatedEntry.totalScore).toBe(11);
    expect(updatedEntry.standingsPosition).toBe(2);
    expect(updatedEntry.isEliminated).toBe(false);
  });
});

async function createScoringFixture() {
  const prisma = getPrisma();
  const owner = await createTestUser({ displayName: 'Scoring Result Owner' });
  const sport = await prisma.sport.create({
    data: {
      name: `Scoring Sport ${randomUUID().slice(0, 8)}`,
      participantType: 'TEAM',
    },
  });

  const league = await prisma.league.create({
    data: {
      leagueCode: `SCOR${randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase()}`,
      name: `Scoring League ${randomUUID().slice(0, 8)}`,
      createdBy: owner.user.id,
    },
  });

  const squad = await prisma.squad.create({
    data: {
      leagueId: league.id,
      createdBy: owner.user.id,
      name: `Scoring Squad ${randomUUID().slice(0, 8)}`,
      isActive: true,
    },
  });

  await prisma.squadMembership.create({
    data: {
      leagueId: league.id,
      squadId: squad.id,
      userId: owner.user.id,
      status: 'ACTIVE',
    },
  });

  const participant = await prisma.participant.create({
    data: {
      sportId: sport.id,
      name: `Tiger ${randomUUID().slice(0, 8)}`,
      participantType: 'TEAM',
      status: 'ACTIVE',
    },
  });

  const sportEvent = await prisma.sportEvent.create({
    data: {
      externalId: `scoring-event-${randomUUID().slice(0, 8)}`,
      providerId: 'integration-test',
      sport: 'BASKETBALL',
      name: 'Scoring Integration Event',
      startDate: new Date('2026-04-08T12:00:00.000Z'),
      releaseAt: new Date('2026-04-08T12:00:00.000Z'),
      fieldLocksAt: new Date('2026-04-08T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });

  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id,
      sportEventId: sportEvent.id,
      name: 'Scoring Integration Contest',
      status: 'DRAFT',
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
      scoringEngine: 'REGISTRY',
    },
  });

  const configuration = await prisma.contestConfiguration.create({
    data: {
      contestId: contest.id,
      selectionType: 'TIERED',
      locksAt: new Date('2026-04-08T12:00:00.000Z'),
      minimumEntries: 1,
      maxEntriesPerSquad: 1,
      rosterSize: 1,
    },
  });

  const teamWinRule = await prisma.participantContestScoringRule.create({
    data: {
      contestConfigurationId: configuration.id,
      participantScoringDefinitionId: 'TEAM_WIN_POINTS',
      sortOrder: 1,
      config: { pointsPerWin: 1 },
      active: true,
    },
  });
  const roundMultiplierRule = await prisma.participantContestScoringRule.create({
    data: {
      contestConfigurationId: configuration.id,
      participantScoringDefinitionId: 'ROUND_MULTIPLIER',
      sortOrder: 2,
      config: { roundMultipliers: { '1': 1, '2': 2 } },
      active: true,
    },
  });
  const seedDifferentialRule = await prisma.participantContestScoringRule.create({
    data: {
      contestConfigurationId: configuration.id,
      participantScoringDefinitionId: 'SEED_DIFFERENTIAL_BONUS',
      sortOrder: 3,
      config: { underdogOnly: true },
      active: true,
    },
  });

  const aggregationRule = await prisma.contestEntryAggregationRule.create({
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
      amount: 150,
      active: true,
    },
  });

  const sportEventParticipant = await prisma.sportEventParticipant.create({
    data: {
      sportEventId: sportEvent.id,
      participantId: participant.id,
      status: 'ACTIVE',
      metadata: {},
    },
  });

  const entry = await prisma.contestEntry.create({
    data: {
      contestId: contest.id,
      squadId: squad.id,
      entryNumber: 1,
      name: 'Owner Entry',
      status: 'ACTIVE',
      totalScore: 0,
      isEliminated: false,
    },
  });

  const rosterPick = await prisma.contestEntryPick.create({
    data: {
      entryId: entry.id,
      sportEventParticipantId: sportEventParticipant.id,
      contestFormat: 'ROSTER',
      isAutoPicked: false,
    },
  });

  return {
    entry,
    rosterPick,
    sportEventParticipant,
    prizeDefinition,
    aggregationRule: {
      id: aggregationRule.id,
      aggregationDefinitionId: aggregationRule.aggregationDefinitionId as 'SUM_ALL_ENTRIES',
      config: aggregationRule.config as Record<string, unknown>,
      active: aggregationRule.active,
    },
    scoringRules: {
      teamWin: {
        id: teamWinRule.id,
        participantScoringDefinitionId:
          teamWinRule.participantScoringDefinitionId as 'TEAM_WIN_POINTS',
        sortOrder: teamWinRule.sortOrder,
        config: teamWinRule.config as Record<string, unknown>,
        active: teamWinRule.active,
      },
      roundMultiplier: {
        id: roundMultiplierRule.id,
        participantScoringDefinitionId:
          roundMultiplierRule.participantScoringDefinitionId as 'ROUND_MULTIPLIER',
        sortOrder: roundMultiplierRule.sortOrder,
        config: roundMultiplierRule.config as Record<string, unknown>,
        active: roundMultiplierRule.active,
      },
      seedDifferential: {
        id: seedDifferentialRule.id,
        participantScoringDefinitionId:
          seedDifferentialRule.participantScoringDefinitionId as 'SEED_DIFFERENTIAL_BONUS',
        sortOrder: seedDifferentialRule.sortOrder,
        config: seedDifferentialRule.config as Record<string, unknown>,
        active: seedDifferentialRule.active,
      },
    },
  };
}
