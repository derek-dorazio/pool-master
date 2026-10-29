/**
 * #1175 — the nightly cleanup's refresh-token step against Postgres: which rows count as dead
 * for 30 days is a query over two nullable timestamps, so it runs against the real table.
 */
import { randomUUID } from 'node:crypto';
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getPrisma,
  createTestUser,
} from '../helpers';
import { RefreshTokenRetention } from '../../../packages/core-api/src/modules/auth/refresh-token-retention';
import { hashRefreshToken } from '../../../packages/core-api/src/modules/auth/refresh-token-hash';

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

const NOW = new Date('2026-10-29T08:00:00.000Z');
const DAY_MS = 24 * 60 * 60_000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

describe('refresh-token retention (#1175)', () => {
  it('deletes tokens expired more than 30 days ago, revoked or not, and keeps live tokens and ones expired for less', async () => {
    const { user } = await createTestUser();
    // A token expires 7 days after it is issued, so a revoked one expires at most 7 days after its revoke.
    const tokens = {
      expiredLongAgo: { expiresAt: daysAgo(31), revokedAt: null },
      revokedAndExpiredLongAgo: { expiresAt: daysAgo(31), revokedAt: daysAgo(36) },
      revokedLongAgoExpiredRecently: { expiresAt: daysAgo(24), revokedAt: daysAgo(31) },
      live: { expiresAt: daysAgo(-7), revokedAt: null },
      expiredRecently: { expiresAt: daysAgo(29), revokedAt: null },
    };
    const ids = new Map<string, string>();
    for (const [name, dates] of Object.entries(tokens)) {
      const row = await getPrisma().refreshToken.create({
        data: { tokenHash: hashRefreshToken(randomUUID()), userId: user.id, ...dates },
      });
      ids.set(name, row.id);
    }

    const deleted = await new RefreshTokenRetention(getPrisma()).purge(NOW);

    expect(deleted).toBeGreaterThanOrEqual(2);
    const remaining = await getPrisma().refreshToken.findMany({ where: { userId: user.id }, select: { id: true } });
    expect(remaining).toHaveLength(3);
    expect(remaining.map((row) => row.id)).toEqual(expect.arrayContaining(
      [ids.get('live'), ids.get('expiredRecently'), ids.get('revokedLongAgoExpiredRecently')],
    ));
  });
});
