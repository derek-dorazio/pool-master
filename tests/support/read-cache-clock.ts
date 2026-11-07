/**
 * Each API task keeps an event field it read for 30 seconds (#1163). A test that reads one,
 * changes what it comes from without a write that forgets it, and reads it again moves the clock
 * past the TTL between the reads, as a viewer's next poll would be: only `Date` moves, so timers,
 * Prisma and Fastify run as usual. Call `restoreReadCacheClock` after the test.
 */
import { jest } from '@jest/globals';
import type { PrismaClient } from '@prisma/client';
import { readEventFieldCacheTtlMs } from '../../packages/core-api/src/modules/events/event-field-cache';

export function passReadCacheTtl(): void {
  jest.useFakeTimers({
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout',
    ],
    now: Date.now() + readEventFieldCacheTtlMs(process.env) + 1,
  });
}

export function restoreReadCacheClock(): void {
  jest.useRealTimers();
}

/**
 * Drops every stored contest leaderboard (#1435), for a test that changes scores in the database
 * directly: the app rebuilds a stored board when a write tells it, and a row written by the test
 * tells nothing, so the next read computes the board afresh, as it would after that write.
 */
export async function forgetStoredLeaderboards(prisma: PrismaClient): Promise<void> {
  await prisma.contestLeaderboardSnapshot.deleteMany();
}
