/**
 * Each API task keeps a contest leaderboard it computed for 30 seconds (#1162). A test that reads
 * a board, changes what it is computed from, and reads it again moves the clock past that TTL
 * between the reads, as a viewer's next poll would be: only `Date` moves, so timers, Prisma
 * and Fastify run as usual. Call `restoreLeaderboardCacheClock` after the test.
 */
import { jest } from '@jest/globals';
import { readLeaderboardCacheTtlMs } from '../../packages/core-api/src/modules/contests/contest-leaderboard-cache';

export function passLeaderboardCacheTtl(): void {
  jest.useFakeTimers({
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout',
    ],
    now: Date.now() + readLeaderboardCacheTtlMs(process.env) + 1,
  });
}

export function restoreLeaderboardCacheClock(): void {
  jest.useRealTimers();
}

