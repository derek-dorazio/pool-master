import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { SelectionType } from '@poolmaster/shared/domain';
import {
  DebouncedLeaderboardRebuilds,
  LEADERBOARD_REBUILD_DELAY_MS,
  LEADERBOARD_REBUILD_MAX_WAIT_MS,
  LEADERBOARD_SNAPSHOT_MAX_AGE_MS,
  isSnapshotCurrent,
  leaderboardKindOf,
  LeaderboardKind,
  nextKickoffAfter,
  readLeaderboardRebuildDelayMs,
  readLeaderboardSnapshotMaxAgeMs,
  type LeaderboardChanges,
} from '../../../packages/core-api/src/modules/contests/leaderboard-snapshots';

/** Records each rebuild it is asked for; `gate`, when set, holds a rebuild until released. */
function recordingRebuilder() {
  const rebuilds: LeaderboardChanges[] = [];
  let release: (() => void) | null = null;
  let held = false;
  return {
    rebuilds,
    holdNext() {
      held = true;
    },
    release() {
      release?.();
    },
    rebuilder: {
      rebuildLeaderboardSnapshots: async (changes: LeaderboardChanges) => {
        rebuilds.push(changes);
        if (held) {
          held = false;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
      },
    },
  };
}

const logger = { error: jest.fn() };

afterEach(() => {
  jest.useRealTimers();
  logger.error.mockReset();
});

describe('DebouncedLeaderboardRebuilds', () => {
  it('rebuilds a burst of score writes once, for every event and contest they named, after the writes stop', async () => {
    jest.useFakeTimers();
    const recorder = recordingRebuilder();
    const rebuilds = new DebouncedLeaderboardRebuilds({ rebuilder: recorder.rebuilder, logger });

    await rebuilds.eventsChanged(['event-2']);
    jest.advanceTimersByTime(LEADERBOARD_REBUILD_DELAY_MS - 1);
    await rebuilds.eventsChanged(['event-1', 'event-2']);
    await rebuilds.contestsChanged(['contest-9']);
    jest.advanceTimersByTime(LEADERBOARD_REBUILD_DELAY_MS - 1);
    expect(recorder.rebuilds).toEqual([]);

    jest.advanceTimersByTime(1);
    await rebuilds.flush();

    expect(recorder.rebuilds).toEqual([{ sportEventIds: ['event-1', 'event-2'], contestIds: ['contest-9'] }]);
  });

  it('rebuilds at the max wait while writes keep arriving, as a provider sync writes, rather than waiting for them to stop', async () => {
    jest.useFakeTimers();
    const recorder = recordingRebuilder();
    const rebuilds = new DebouncedLeaderboardRebuilds({ rebuilder: recorder.rebuilder, logger });

    // A write every second for longer than the max wait: the debounce alone would never fire.
    for (let elapsed = 0; elapsed < LEADERBOARD_REBUILD_MAX_WAIT_MS; elapsed += 1_000) {
      await rebuilds.eventsChanged(['event-1']);
      jest.advanceTimersByTime(1_000);
    }
    await rebuilds.flush();

    expect(recorder.rebuilds).toEqual([{ sportEventIds: ['event-1'], contestIds: [] }]);
  });

  it('with no delay, rebuilds before the write that asked answers', async () => {
    const recorder = recordingRebuilder();
    const rebuilds = new DebouncedLeaderboardRebuilds({ rebuilder: recorder.rebuilder, logger, delayMs: 0 });

    await rebuilds.eventsChanged(['event-1']);

    expect(recorder.rebuilds).toEqual([{ sportEventIds: ['event-1'], contestIds: [] }]);
  });

  it('flush rebuilds what is waiting at once, and the timer it replaced fires nothing more', async () => {
    jest.useFakeTimers();
    const recorder = recordingRebuilder();
    const rebuilds = new DebouncedLeaderboardRebuilds({ rebuilder: recorder.rebuilder, logger });

    await rebuilds.eventsChanged(['event-1']);
    await rebuilds.flush();

    expect(recorder.rebuilds).toEqual([{ sportEventIds: ['event-1'], contestIds: [] }]);
    // The timer it replaced fires nothing more.
    jest.advanceTimersByTime(LEADERBOARD_REBUILD_DELAY_MS);
    await rebuilds.flush();
    expect(recorder.rebuilds).toHaveLength(1);
  });

  it('runs one rebuild at a time: writes during a rebuild wait for it, and flush answers only once both are done', async () => {
    const recorder = recordingRebuilder();
    const rebuilds = new DebouncedLeaderboardRebuilds({ rebuilder: recorder.rebuilder, logger, delayMs: 0 });
    recorder.holdNext();

    const first = rebuilds.eventsChanged(['event-1']);
    await Promise.resolve();
    const second = rebuilds.eventsChanged(['event-2']);
    let flushed = false;
    const flushing = rebuilds.flush().then(() => {
      flushed = true;
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(recorder.rebuilds).toEqual([{ sportEventIds: ['event-1'], contestIds: [] }]);
    expect(flushed).toBe(false);

    recorder.release();
    await Promise.all([first, second, flushing]);

    expect(recorder.rebuilds).toEqual([
      { sportEventIds: ['event-1'], contestIds: [] },
      { sportEventIds: ['event-2'], contestIds: [] },
    ]);
  });

  it('logs a failed rebuild without failing the write that asked, and the next write still rebuilds', async () => {
    let calls = 0;
    const rebuilds = new DebouncedLeaderboardRebuilds({
      rebuilder: {
        rebuildLeaderboardSnapshots: async () => {
          calls++;
          if (calls === 1) throw new Error('database went away');
        },
      },
      logger,
      delayMs: 0,
    });

    await expect(rebuilds.eventsChanged(['event-1'])).resolves.toBeUndefined();
    await rebuilds.eventsChanged(['event-1']);

    expect(calls).toBe(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]?.[0]).toMatchObject({
      action: 'leaderboard.rebuild.failed',
      data: { sportEventIds: ['event-1'], error: 'database went away' },
    });
  });

  it('asks for nothing when a write named no event or contest', async () => {
    const recorder = recordingRebuilder();
    const rebuilds = new DebouncedLeaderboardRebuilds({ rebuilder: recorder.rebuilder, logger, delayMs: 0 });

    await rebuilds.eventsChanged([]);
    await rebuilds.flush();

    expect(recorder.rebuilds).toEqual([]);
  });
});

describe('isSnapshotCurrent', () => {
  const contestUpdatedAt = new Date('2026-11-07T20:00:00.000Z');
  const computedFrom = new Date('2026-11-07T21:00:00.000Z');
  const later = (ms: number) => new Date(computedFrom.getTime() + ms);
  const stored = { computedFrom, validUntil: null, contestUpdatedAt };

  it('answers a read with the stored board until it reaches the max age, then not', () => {
    expect(isSnapshotCurrent(stored, { updatedAt: contestUpdatedAt }, later(LEADERBOARD_SNAPSHOT_MAX_AGE_MS - 1), LEADERBOARD_SNAPSHOT_MAX_AGE_MS)).toBe(true);
    expect(isSnapshotCurrent(stored, { updatedAt: contestUpdatedAt }, later(LEADERBOARD_SNAPSHOT_MAX_AGE_MS), LEADERBOARD_SNAPSHOT_MAX_AGE_MS)).toBe(false);
  });

  it('is no longer current once the next event it does not show has started', () => {
    const withNextEvent = { ...stored, validUntil: later(60_000) };

    expect(isSnapshotCurrent(withNextEvent, { updatedAt: contestUpdatedAt }, later(59_999), LEADERBOARD_SNAPSHOT_MAX_AGE_MS)).toBe(true);
    expect(isSnapshotCurrent(withNextEvent, { updatedAt: contestUpdatedAt }, later(60_000), LEADERBOARD_SNAPSHOT_MAX_AGE_MS)).toBe(false);
  });

  it('is no longer current once the contest itself changed, such as completing at settlement', () => {
    expect(isSnapshotCurrent(stored, { updatedAt: later(1) }, later(2), LEADERBOARD_SNAPSHOT_MAX_AGE_MS)).toBe(false);
  });
});

describe('nextKickoffAfter', () => {
  const now = new Date('2026-11-08T18:00:00.000Z');
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

  it('is the soonest event or game start still to come, skipping those already started and games with no date', () => {
    expect(nextKickoffAfter(now, [{ startDate: at(-48) }, { startDate: at(72) }], [{ scheduledDate: at(-1) }, { scheduledDate: null }, { scheduledDate: at(5) }]))
      .toEqual(at(5));
  });

  it('is null once everything has started, so only a write changes the board', () => {
    expect(nextKickoffAfter(now, [{ startDate: at(-48) }], [{ scheduledDate: now }])).toBeNull();
  });
});

describe('leaderboardKindOf', () => {
  it('stores lineup contests as the roster board, each prediction format as its own, and squares as none', () => {
    expect(Object.fromEntries(Object.values(SelectionType).map((selectionType) => [selectionType, leaderboardKindOf({ selectionType })]))).toEqual({
      [SelectionType.TIERED]: LeaderboardKind.ROSTER,
      [SelectionType.BUDGET_PICK]: LeaderboardKind.ROSTER,
      [SelectionType.RANDOM_DRAW]: LeaderboardKind.ROSTER,
      [SelectionType.BRACKET]: LeaderboardKind.BRACKET,
      [SelectionType.PICK_EM]: LeaderboardKind.PICK_EM,
      [SelectionType.SURVIVOR]: LeaderboardKind.SURVIVOR,
      [SelectionType.SQUARES]: null,
    });
  });
});

describe('leaderboard snapshot settings', () => {
  it('rebuilds 3 seconds after the last write and keeps a board up to 5 minutes when unset', () => {
    expect(readLeaderboardRebuildDelayMs({})).toBe(3_000);
    expect(readLeaderboardSnapshotMaxAgeMs({ LEADERBOARD_SNAPSHOT_MAX_AGE_MS: '' })).toBe(300_000);
  });

  it('reads 0 as rebuilding before the write answers, as the functional lane runs', () => {
    expect(readLeaderboardRebuildDelayMs({ LEADERBOARD_REBUILD_DELAY_MS: '0' })).toBe(0);
  });

  it.each(['-1', '1.5', 'soon'])('refuses to start with LEADERBOARD_REBUILD_DELAY_MS=%s rather than guess a delay', (raw) => {
    expect(() => readLeaderboardRebuildDelayMs({ LEADERBOARD_REBUILD_DELAY_MS: raw }))
      .toThrow('LEADERBOARD_REBUILD_DELAY_MS must be a whole number of milliseconds');
  });
});
