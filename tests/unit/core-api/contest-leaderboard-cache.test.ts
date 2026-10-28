import { ContestLeaderboardCache } from '../../../packages/core-api/src/modules/contests/contest-leaderboard-cache';
import type { ContestLeaderboardModel } from '../../../packages/core-api/src/mappers/contests.mapper';

// The contest leaderboard cache (#1162): a board computed for a contest answers for it for 30
// seconds, a computation in flight is shared, and a failed one is never kept.

const T0 = new Date('2026-10-28T20:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

function board(asOf: string): ContestLeaderboardModel {
  return {
    contestId: 'contest-1',
    sportEventId: 'event-1',
    sport: 'GOLF',
    participantType: null,
    scoringFamily: null,
    scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
    countingRule: { type: 'BEST_N', count: 2 },
    participants: [],
    entries: [],
    asOf: new Date(asOf),
  };
}

describe('ContestLeaderboardCache', () => {
  it('answers a contest from the board computed within the last 30 seconds, and computes a new one once 30 seconds have passed', async () => {
    const cache = new ContestLeaderboardCache();
    const first = board('2026-10-28T20:00:00.000Z');
    const second = board('2026-10-28T20:00:30.000Z');

    await expect(cache.get('contest-1', undefined, at(0), async () => first)).resolves.toBe(first);
    await expect(cache.get('contest-1', undefined, at(29_999), async () => second)).resolves.toBe(first);
    await expect(cache.get('contest-1', undefined, at(30_000), async () => second)).resolves.toBe(second);
  });

  it('keeps each contest and each shown event apart', async () => {
    const cache = new ContestLeaderboardCache();
    const latest = board('2026-10-28T20:00:00.000Z');
    const masters = board('2026-10-28T20:00:01.000Z');
    const other = board('2026-10-28T20:00:02.000Z');

    await cache.get('contest-1', undefined, at(0), async () => latest);

    await expect(cache.get('contest-1', 'event-masters', at(1), async () => masters)).resolves.toBe(masters);
    await expect(cache.get('contest-2', undefined, at(1), async () => other)).resolves.toBe(other);
  });

  it('gives a second viewer the board still being computed for the first, rather than computing it twice', async () => {
    const cache = new ContestLeaderboardCache();
    let finish: (value: ContestLeaderboardModel) => void = () => undefined;
    const computing = new Promise<ContestLeaderboardModel>((resolve) => { finish = resolve; });
    const computed = board('2026-10-28T20:00:00.000Z');

    const firstViewer = cache.get('contest-1', undefined, at(0), () => computing);
    const secondViewer = cache.get('contest-1', undefined, at(5), async () => board('2026-10-28T20:00:05.000Z'));
    finish(computed);

    await expect(firstViewer).resolves.toBe(computed);
    await expect(secondViewer).resolves.toBe(computed);
  });

  it('does not keep a board that failed to compute, so the next viewer computes it again', async () => {
    const cache = new ContestLeaderboardCache();
    const computed = board('2026-10-28T20:00:01.000Z');

    await expect(cache.get('contest-1', undefined, at(0), async () => { throw new Error('database unavailable'); }))
      .rejects.toThrow('database unavailable');

    await expect(cache.get('contest-1', undefined, at(1), async () => computed)).resolves.toBe(computed);
  });
});
