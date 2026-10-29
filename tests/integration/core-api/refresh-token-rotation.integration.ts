/**
 * #1175 — refresh-token rotation against Postgres.
 *
 * A refresh token is single use: refreshing revokes it and issues the next one. That rule is
 * a database rule, because two refreshes with the same token can both read it as live before
 * either revokes it. Only a conditional update decides which one wins, so these run the real
 * service against the real table.
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getPrisma,
  createTestUser,
} from '../helpers';
import { PrismaUserRepository } from '../../../packages/core-api/src/adapters';
import { AuthService } from '../../../packages/core-api/src/modules/auth/auth-service';

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

function buildAuthService(): AuthService {
  return new AuthService(new PrismaUserRepository(getPrisma()), getPrisma());
}

describe('refresh-token rotation (#1175)', () => {
  it('lets only one of several concurrent refreshes with the same token succeed, so a replayed token cannot fork the session', async () => {
    const service = buildAuthService();
    const { user } = await createTestUser();
    const session = await service.issueSessionForUser(user.id);

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => service.refresh(session.refreshToken)),
    );

    const succeeded = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const refused = attempts.filter((attempt) => attempt.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(refused).toHaveLength(4);
    for (const attempt of refused) {
      expect(attempt.reason).toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    }

    const live = await getPrisma().refreshToken.findMany({
      where: { sessionId: session.sessionId, revokedAt: null },
    });
    expect(live).toHaveLength(1);
  });

  it('refuses a token that an earlier refresh already rotated', async () => {
    const service = buildAuthService();
    const { user } = await createTestUser();
    const session = await service.issueSessionForUser(user.id);

    const next = await service.refresh(session.refreshToken);

    await expect(service.refresh(session.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    await expect(service.refresh(next.refreshToken)).resolves.toMatchObject({
      sessionId: session.sessionId,
    });
  });
});
