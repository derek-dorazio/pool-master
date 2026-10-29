/**
 * Refresh-token retention (#1175): a refresh token is dead once it expires or is revoked, and
 * each refresh revokes one and issues the next, so the table grows by several rows per signed-in
 * member per day. The nightly cleanup deletes the rows expired for longer than
 * REFRESH_TOKENS_KEPT_DAYS. Expiry alone covers revoked tokens too: every token expires 7 days
 * after it is issued (AuthService's REFRESH_TOKEN_EXPIRY_DAYS), so one revoked a month ago is
 * deleted at most a week later, without an index on `revoked_at`, which every refresh writes.
 */

import type { PrismaClient } from '@prisma/client';
import { deleteInBatches, type NightlyCleanupStep } from '../../core/nightly-cleanup';

/** How long an expired refresh token is kept, for tracing a session's history. */
export const REFRESH_TOKENS_KEPT_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;

export class RefreshTokenRetention implements NightlyCleanupStep {
  readonly name = 'refreshTokens';

  constructor(private readonly prisma: PrismaClient) {}

  purge(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - REFRESH_TOKENS_KEPT_DAYS * DAY_MS);
    return deleteInBatches(async (limit) => {
      const batch = await this.prisma.refreshToken.findMany({
        where: { expiresAt: { lt: cutoff } },
        select: { id: true },
        take: limit,
      });
      if (batch.length === 0) return 0;
      const { count } = await this.prisma.refreshToken.deleteMany({
        where: { id: { in: batch.map((row) => row.id) } },
      });
      return count;
    });
  }
}
