/**
 * A recurring sweep that runs on the one server task holding its job lock (#1159), never overlaps
 * itself, has a read memo per run (#1200) and survives a failure. The event lifecycle sweep and
 * each clock-driven email kind (#845) run on one.
 */
import type { PrismaClient } from '@prisma/client';
import { LockedSweep, type LockedSweepOptions } from '../../../packages/core-api/src/core/locked-sweep';
import { memoizedRead, ReadMemoKey } from '../../../packages/core-api/src/core/request-read-memo';
import { fakeLogger } from '../../support/fake-logger';
import { heldElsewhere, heldHere } from '../../support/job-locks';

const INTERVAL_MS = 60 * 1000;

function lockedSweep(work: () => Promise<void>, options: Partial<LockedSweepOptions> = {}) {
  return new LockedSweep({
    lockKey: 'test-sweep',
    jobLock: heldHere(),
    intervalMs: INTERVAL_MS,
    label: 'test sweep',
    logger: fakeLogger(),
    ...options,
  }, work);
}

describe('LockedSweep', () => {
  it('runs its work under its lock', async () => {
    const keys: string[] = [];
    const work = jest.fn(async () => undefined);
    const jobLock = { runExclusive: async (key: string, run: () => Promise<void>) => { keys.push(key); await run(); return true; } };

    await lockedSweep(work, { jobLock }).run();

    expect(work).toHaveBeenCalledTimes(1);
    expect(keys).toEqual(['test-sweep']);
  });

  it('does no work, and logs at debug, when another server task holds the lock', async () => {
    const work = jest.fn(async () => undefined);
    const logger = fakeLogger();

    await lockedSweep(work, { jobLock: heldElsewhere(), logger }).run();

    expect(work).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith({ action: 'lockedSweep.heldElsewhere', data: { lockKey: 'test-sweep' } }, expect.any(String));
  });

  it('skips a run that comes due while the last one is still running, and runs again after it ends', async () => {
    let finishFirst!: () => void;
    const work = jest.fn<Promise<void>, []>().mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; })).mockResolvedValue(undefined);
    const logger = fakeLogger();
    const sweep = lockedSweep(work, { logger });

    const first = sweep.run();
    await new Promise((resolve) => setImmediate(resolve));
    await sweep.run();

    expect(work).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith({ action: 'lockedSweep.overlap', data: { lockKey: 'test-sweep' } }, 'Skipped the test sweep because the previous one is still running');
    finishFirst();
    await first;
    await sweep.run();
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('logs a failed run rather than leaving the timer an unhandled rejection, and runs again next time', async () => {
    const work = jest.fn<Promise<void>, []>().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);
    const logger = fakeLogger();
    const sweep = lockedSweep(work, { logger });

    await expect(sweep.run()).resolves.toBeUndefined();
    await sweep.run();

    expect(logger.error).toHaveBeenCalledWith({ action: 'lockedSweep.failed', data: { lockKey: 'test-sweep', error: 'db down' } }, 'The test sweep failed');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('logs a thrown non-error as the failure\'s message', async () => {
    const logger = fakeLogger();

    await lockedSweep(jest.fn<Promise<void>, []>().mockRejectedValue('db down'), { logger }).run();

    expect(logger.error).toHaveBeenCalledWith({ action: 'lockedSweep.failed', data: { lockKey: 'test-sweep', error: 'db down' } }, expect.any(String));
  });

  it('gives each run its own read memo, so a read the run repeats is made once per run', async () => {
    // Stands in for the root Prisma client, the only one whose reads are remembered.
    const root = { $transaction: jest.fn() } as unknown as PrismaClient;
    const load = jest.fn(async () => ({ name: 'NFL' }));
    const read = () => memoizedRead(root, `${ReadMemoKey.sportLeague}nfl`, load);
    const sweep = lockedSweep(async () => { await read(); await read(); });

    await sweep.run();
    expect(load).toHaveBeenCalledTimes(1);
    await sweep.run();

    expect(load).toHaveBeenCalledTimes(2);
  });

  describe('on its timer', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('first runs a full interval after starting, then once per interval, and no more once stopped', async () => {
      const work = jest.fn(async () => undefined);
      const sweep = lockedSweep(work);

      sweep.start();
      await jest.advanceTimersByTimeAsync(INTERVAL_MS - 1);
      expect(work).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(work).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(work).toHaveBeenCalledTimes(2);
      sweep.stop();
      await jest.advanceTimersByTimeAsync(10 * INTERVAL_MS);

      expect(work).toHaveBeenCalledTimes(2);
    });

    it('first runs after the given delay when staggered, then once per interval from there', async () => {
      const work = jest.fn(async () => undefined);
      const sweep = lockedSweep(work, { firstRunAfterMs: INTERVAL_MS + 15_000 });

      sweep.start();
      await jest.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(work).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(15_000);
      expect(work).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(INTERVAL_MS);

      expect(work).toHaveBeenCalledTimes(2);
      sweep.stop();
    });

    it('never runs when stopped before its first run comes', async () => {
      const work = jest.fn(async () => undefined);
      const sweep = lockedSweep(work);

      sweep.start();
      sweep.stop();
      await jest.advanceTimersByTimeAsync(10 * INTERVAL_MS);

      expect(work).not.toHaveBeenCalled();
    });

    it('still runs once per interval when started twice', async () => {
      const work = jest.fn(async () => undefined);
      const sweep = lockedSweep(work);

      sweep.start();
      sweep.start();
      await jest.advanceTimersByTimeAsync(2 * INTERVAL_MS);

      expect(work).toHaveBeenCalledTimes(2);
      sweep.stop();
    });

    it('can be stopped before it was started, and then starts as usual', async () => {
      const work = jest.fn(async () => undefined);
      const sweep = lockedSweep(work);

      sweep.stop();
      sweep.start();
      await jest.advanceTimersByTimeAsync(INTERVAL_MS);

      expect(work).toHaveBeenCalledTimes(1);
      sweep.stop();
    });
  });
});
