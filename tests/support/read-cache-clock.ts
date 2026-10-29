/**
 * Each API task keeps a contest leaderboard it computed (#1162), and an event field it read
 * (#1163), for 30 seconds. A test that reads one, changes what it comes from without a write
 * that forgets it, and reads it again moves the clock past both TTLs between the reads, as a
 * viewer's next poll would be: only `Date` moves, so timers, Prisma and Fastify run as usual.
 * Call `restoreReadCacheClock` after the test.
 */
import { jest } from '@jest/globals';
import { readLeaderboardCacheTtlMs } from '../../packages/core-api/src/modules/contests/contest-leaderboard-cache';
import { readEventFieldCacheTtlMs } from '../../packages/core-api/src/modules/events/event-field-cache';

export function passReadCacheTtl(): void {
  jest.useFakeTimers({
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout',
    ],
    now: Date.now() + Math.max(readLeaderboardCacheTtlMs(process.env), readEventFieldCacheTtlMs(process.env)) + 1,
  });
}

export function restoreReadCacheClock(): void {
  jest.useRealTimers();
}
