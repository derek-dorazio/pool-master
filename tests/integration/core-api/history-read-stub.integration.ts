import { randomUUID } from 'node:crypto';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('pool-master-eux.5: history read deferral after legacy scoring removal', () => {
  it('pool-master-eux.5: returns not found for completed contest history until Golf settlement persists', async () => {
    const prisma = getPrisma();
    const suffix = randomUUID().slice(0, 8);
    const owner = await createTestUser({ displayName: `History Stub ${suffix}` });
    const league = await prisma.league.create({
      data: {
        leagueCode: `HST${suffix.toUpperCase()}`,
        name: `History Stub League ${suffix}`,
        createdBy: owner.user.id,
      },
    });
    await prisma.leagueMembership.create({
      data: {
        leagueId: league.id,
        userId: owner.user.id,
        role: 'COMMISSIONER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
    const contest = await prisma.contest.create({
      data: {
        leagueId: league.id,
        name: `Completed History Stub Contest ${suffix}`,
        status: 'COMPLETED',
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        scoringEngine: 'STROKE_PLAY',
      },
    });

    const response = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contest.id}/history/summary`,
      headers: owner.headers,
    });

    expect(response.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.parse(response.json())).toEqual({
      error: {
        code: 'CONTEST_HISTORY_NOT_FOUND',
        message: 'No history exists for this contest',
      },
    });
  });
});
