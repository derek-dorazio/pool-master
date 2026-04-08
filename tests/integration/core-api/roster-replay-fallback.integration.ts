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
import {
  ContestType,
  LeagueVisibility,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Roster Replay Fallback Integration', () => {
  it('serves roster replay from frozen roster history and contest entry state without contest results', async () => {
    const owner = await createTestUser({ displayName: 'Roster Replay Owner' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: {
        name: 'Roster Replay League',
        visibility: LeagueVisibility.PRIVATE,
      },
    });
    expect(leagueRes.statusCode).toBe(201);
    const leagueId = leagueRes.json().league.id;

    const contestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: owner.headers,
      payload: {
        name: 'Roster Replay Contest',
        sport: 'GOLF',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        selectionConfig: {
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

    const entryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(owner.headers),
    });
    expect([200, 201]).toContain(entryRes.statusCode);
    const entryId = entryRes.json().entry.id;

    const prisma = getPrisma();

    await prisma.contest.update({
      where: { id: contestId },
      data: {
        status: 'COMPLETED',
      },
    });

    await prisma.contestEntry.update({
      where: { id: entryId },
      data: {
        totalScore: 72.5,
        standingsPosition: 1,
      },
    });

    await prisma.teamRosterHistory.create({
      data: {
        contestId,
        entryId,
        lockedAt: new Date('2026-04-08T12:00:00Z'),
        roster: [
          {
            participantId: 'participant-1',
            participantName: 'Scottie Scheffler',
            tier: 1,
            salaryCost: 9800,
            draftRound: 1,
            draftPick: 1,
          },
        ],
      },
    });

    const replayRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contestId}/history/replay/${entryId}`,
      headers: owner.headers,
    });

    expect(replayRes.statusCode).toBe(200);
    expect(replayRes.json()).toEqual(
      expect.objectContaining({
        contestId,
        entryId,
        totalScore: 72.5,
        finalRank: 1,
        roster: [
          expect.objectContaining({
            participantId: 'participant-1',
            participantName: 'Scottie Scheffler',
            tier: '1',
            salaryCost: 9800,
            draftRound: 1,
            draftPick: 1,
          }),
        ],
      }),
    );
  });
});
