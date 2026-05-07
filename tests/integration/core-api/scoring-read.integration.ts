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
import {
  ContestFormat,
  InvitationStatus,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Scoring Read Integration', () => {
  it('validates scoring configs and exposes scoring service health', async () => {
    const user = await createTestUser({ displayName: 'Scoring Config User' });

    const invalidValidationRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/scoring/config/validate',
      headers: user.headers,
      payload: {
        sport: 'GOLF',
        scoring_type: 'STROKE_PLAY',
        stat_rules: [
          {
            stat_key: 'unknown_metric',
            points_per_unit: 1,
          },
        ],
        counting_method: 'BEST_N',
        lower_is_better: true,
      },
    });
    expect(invalidValidationRes.statusCode).toBe(200);
    expect(invalidValidationRes.json()).toEqual(
      expect.objectContaining({
        valid: false,
        warnings: expect.any(Array),
      }),
    );

    const healthRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/scoring/health',
      headers: user.headers,
    });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json()).toEqual(
      expect.objectContaining({
        status: 'ok',
        service: 'scoring-service',
        rollupRunning: expect.any(Boolean),
        activeContests: expect.any(Number),
      }),
    );
  });

  it('pool-master-rop.6: serves scoring reads and returns 404 for missing entry breakdowns', async () => {
    const owner = await createTestUser({ displayName: 'Scoring Read Owner' });
    const challenger = await createTestUser({
      displayName: 'Scoring Read Challenger',
    });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Scoring Read League'),
    });
    expect(leagueRes.statusCode).toBe(201);
    const leagueId = leagueRes.json().league.id;

    const inviteRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: owner.headers,
      payload: {
        emails: [challenger.user.email],
      },
    });
    expect(inviteRes.statusCode).toBe(201);
    expect(inviteRes.json().sent[0].status).toBe(InvitationStatus.PENDING);

    const acceptRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.invitations.accept,
      headers: challenger.headers,
      payload: {
        inviteCode: inviteRes.json().sent[0].inviteCode,
      },
    });
    expect(acceptRes.statusCode).toBe(201);

    const contestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: owner.headers,
      payload: {
        name: 'Scoring Read Contest',
        sport: 'NCAA_BASKETBALL',
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        contestConfiguration: {
          rounds: 1,
          tierAssignmentMethod: 'AUTO_ODDS',
          tierConfig: [
            {
              tierId: 'tier-1',
              tierName: 'Tier 1',
              tierNumber: 1,
              picksFromTier: 1,
              participantIds: [],
            },
          ],
        },
      },
    });
    expect(contestRes.statusCode).toBe(201);
    const contestId = contestRes.json().contest.id;

    const ownerEntryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(owner.headers),
    });
    expect([200, 201]).toContain(ownerEntryRes.statusCode);
    const ownerEntryId = ownerEntryRes.json().entry.id;

    const challengerEntryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(challenger.headers),
    });
    expect([200, 201]).toContain(challengerEntryRes.statusCode);
    const challengerEntryId = challengerEntryRes.json().entry.id;

    const prisma = getPrisma();
    const sport = await prisma.sport.create({
      data: {
        name: `Scoring Sport ${Date.now()}`,
        participantType: 'TEAM',
      },
    });
    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: 'Underdog Team',
        participantType: 'TEAM',
        status: 'ACTIVE',
      },
    });
    const event = await prisma.sportEvent.create({
      data: {
        externalId: `scoring-read-event-${Date.now()}`,
        providerId: 'integration-test',
        sport: 'NCAA_BASKETBALL',
        name: 'Scoring Read Event',
        startDate: new Date('2026-04-09T12:00:00.000Z'),
        releaseAt: new Date('2026-04-09T12:00:00.000Z'),
        fieldLocksAt: new Date('2026-04-09T12:00:00.000Z'),
        status: 'IN_PROGRESS',
      },
    });
    const eventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: event.id,
        participantId: participant.id,
        status: 'ACTIVE',
      },
    });

    const ownerPick = await prisma.contestEntryPick.create({
      data: {
        entryId: ownerEntryId,
        sportEventParticipantId: eventParticipant.id,
        contestFormat: 'ROSTER',
      },
    });

    await prisma.contestEntry.update({
      where: { id: ownerEntryId },
      data: {
        totalScore: 11,
        standingsPosition: 1,
      },
    });
    await prisma.contestEntry.update({
      where: { id: challengerEntryId },
      data: {
        totalScore: 2,
        standingsPosition: 2,
      },
    });

    const configuration = await prisma.contestConfiguration.findUniqueOrThrow({
      where: { contestId },
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
    const bonusRule = await prisma.participantContestScoringRule.create({
      data: {
        contestConfigurationId: configuration.id,
        participantScoringDefinitionId: 'SEED_DIFFERENTIAL_BONUS',
        sortOrder: 2,
        config: { underdogOnly: true },
        active: true,
      },
    });

    const participantScore = await prisma.contestEntryParticipantScore.create({
      data: {
        entryId: ownerEntryId,
        pickId: ownerPick.id,
        pointsEarned: 11,
      },
    });
    await prisma.contestEntryParticipantScoreEvent.createMany({
      data: [
        {
          contestEntryParticipantScoreId: participantScore.id,
          participantContestScoringRuleId: teamWinRule.id,
          points: 1,
          detailsJson: {
            eventType: 'TEAM_WIN_POINTS',
            round: 2,
            pointsPerWin: 1,
          },
        },
        {
          contestEntryParticipantScoreId: participantScore.id,
          participantContestScoringRuleId: bonusRule.id,
          points: 10,
          detailsJson: {
            eventType: 'SEED_DIFFERENTIAL_BONUS',
            differential: 10,
          },
        },
      ],
    });

    const leaderboardRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/scoring/contests/${contestId}/leaderboard`,
      headers: owner.headers,
    });
    expect(leaderboardRes.statusCode).toBe(200);
    expect(leaderboardRes.json().leaderboard).toEqual([
      expect.objectContaining({
        entryId: ownerEntryId,
        rank: 1,
        totalScore: 11,
      }),
      expect.objectContaining({
        entryId: challengerEntryId,
        rank: 2,
        totalScore: 2,
      }),
    ]);

    const entryRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/scoring/contests/${contestId}/entry/${ownerEntryId}`,
      headers: owner.headers,
    });
    expect(entryRes.statusCode).toBe(200);
    expect(entryRes.json()).toEqual(
      expect.objectContaining({
        contestId,
        entryId: ownerEntryId,
        totalScore: 11,
      }),
    );
    expect(entryRes.json().timeline).toHaveLength(2);
    expect(
      entryRes.json().timeline.map((event: { participantBreakdowns: Array<Record<string, unknown>> }) =>
        event.participantBreakdowns[0],
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantId: participant.id,
          participantName: 'Underdog Team',
          statPoints: 1,
          finalScore: 1,
        }),
        expect.objectContaining({
          participantId: participant.id,
          bonusPoints: 10,
          finalScore: 10,
        }),
      ]),
    );

    const missingEntryRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/scoring/contests/${contestId}/entry/00000000-0000-4000-8000-000000000000`,
      headers: owner.headers,
    });
    expect(missingEntryRes.statusCode).toBe(404);
    expect(missingEntryRes.json()).toEqual({
      error: expect.objectContaining({
        code: 'CONTEST_ENTRY_NOT_FOUND',
      }),
    });

    const participantRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/scoring/contests/${contestId}/participant/${participant.id}`,
      headers: owner.headers,
    });
    expect(participantRes.statusCode).toBe(200);
    expect(participantRes.json()).toEqual(
      expect.objectContaining({
        contestId,
        participantId: participant.id,
        totalPoints: 11,
      }),
    );
    expect(participantRes.json().scores).toHaveLength(2);

    await prisma.contestEntry.update({
      where: { id: ownerEntryId },
      data: { totalScore: 5, standingsPosition: null },
    });
    await prisma.contestEntry.update({
      where: { id: challengerEntryId },
      data: { totalScore: 8, standingsPosition: null },
    });

    const rollupRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/scoring/contests/${contestId}/rollup`,
      headers: withoutJsonBodyHeaders(owner.headers),
    });
    expect(rollupRes.statusCode).toBe(200);
    expect(rollupRes.json()).toEqual(
      expect.objectContaining({
        contestId,
        entriesUpdated: 2,
      }),
    );

    const updatedEntries = await prisma.contestEntry.findMany({
      where: { contestId },
      orderBy: { standingsPosition: 'asc' },
      select: { id: true, standingsPosition: true },
    });
    expect(updatedEntries).toEqual([
      { id: challengerEntryId, standingsPosition: 1 },
      { id: ownerEntryId, standingsPosition: 2 },
    ]);
  });
});
