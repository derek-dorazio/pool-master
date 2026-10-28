/**
 * Each API task keeps a contest leaderboard it computed for 30 seconds (#1162). A test that reads
 * a board, changes what it is computed from, and reads it again moves the clock past that TTL
 * between the reads, as a viewer's next poll would be: only `Date` moves, so timers, Prisma
 * and Fastify run as usual. Call `restoreLeaderboardCacheClock` after the test.
 */
import { jest } from '@jest/globals';
import { CONTEST_LEADERBOARD_CACHE_TTL_MS } from '../../packages/core-api/src/modules/contests/contest-leaderboard-cache';

export function passLeaderboardCacheTtl(): void {
  jest.useFakeTimers({
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout',
    ],
    now: Date.now() + CONTEST_LEADERBOARD_CACHE_TTL_MS + 1,
  });
}

export function restoreLeaderboardCacheClock(): void {
  jest.useRealTimers();
}

/**
 * The functional API runs in its own process, whose clock a test cannot move: a functional test
 * that reads a board, changes it and reads it again waits the TTL out, as a viewer's next poll would.
 */
export function waitOutLeaderboardCache(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, CONTEST_LEADERBOARD_CACHE_TTL_MS + 500));
}
