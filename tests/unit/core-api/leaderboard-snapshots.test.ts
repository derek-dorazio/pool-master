import { describe, expect, it, jest } from '@jest/globals';
import { BackgroundJobStatus, BackgroundJobType, SelectionType } from '@poolmaster/shared/domain';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs';
import { leaderboardChangesOf, LeaderboardRebuildSubject } from '../../../packages/core-api/src/modules/contests/leaderboard-rebuild-job-requests';
import {
  JobLeaderboardRebuilds,
  LEADERBOARD_SNAPSHOT_MAX_AGE_MS,
  isSnapshotCurrent,
  leaderboardKindOf,
  LeaderboardKind,
  nextKickoffAfter,
  readLeaderboardSnapshotMaxAgeMs,
} from '../../../packages/core-api/src/modules/contests/leaderboard-snapshots';
import { inMemoryBackgroundJobs, type InMemoryBackgroundJobs } from '../../support/in-memory-background-jobs';

function setup() {
  const jobs = inMemoryBackgroundJobs();
  const queue = new BackgroundJobQueue({ jobs });
  const runner = { wake: jest.fn() };
  queue.wakes(runner);
  return { jobs, queue, runner, rebuilds: new JobLeaderboardRebuilds(queue) };
}

const waiting = (jobs: InMemoryBackgroundJobs) => jobs.rows
  .filter((row) => row.status === BackgroundJobStatus.QUEUED)
  .map((row) => ({ type: row.type, payload: row.payload }));

describe('JobLeaderboardRebuilds', () => {
  it('hands a write the event\'s rebuild job without queuing it, and wakes the runner only when the write says it committed (#1466)', () => {
    const { jobs, rebuilds, runner } = setup();

    const rebuild = rebuilds.forEvent('event-1');

    expect(rebuild.jobs).toEqual([{
      type: BackgroundJobType.REBUILD_LEADERBOARDS,
      payload: { subject: LeaderboardRebuildSubject.EVENT, id: 'event-1' },
      dedupeKey: `${BackgroundJobType.REBUILD_LEADERBOARDS}:EVENT:event-1`,
    }]);
    expect(waiting(jobs)).toEqual([]);
    expect(runner.wake).not.toHaveBeenCalled();
    rebuild.queued();
    expect(runner.wake).toHaveBeenCalledTimes(1);
  });

  it('hands a pick\'em or survivor write the contest\'s rebuild job without queuing it, and wakes the runner only once it committed (#1466)', () => {
    const { jobs, rebuilds, runner } = setup();

    const rebuild = rebuilds.forContest('contest-9');

    expect(rebuild.jobs).toEqual([{
      type: BackgroundJobType.REBUILD_LEADERBOARDS,
      payload: { subject: LeaderboardRebuildSubject.CONTEST, id: 'contest-9' },
      dedupeKey: `${BackgroundJobType.REBUILD_LEADERBOARDS}:CONTEST:contest-9`,
    }]);
    expect(waiting(jobs)).toEqual([]);
    expect(runner.wake).not.toHaveBeenCalled();
    rebuild.queued();
    expect(runner.wake).toHaveBeenCalledTimes(1);
  });

  it('queues one rebuild job per event a burst of writes names, however often each is named', async () => {
    const { jobs, rebuilds, runner } = setup();

    await rebuilds.eventsChanged(['event-1', 'event-1', 'event-2']);
    await rebuilds.eventsChanged(['event-1']);

    expect(waiting(jobs)).toEqual([
      { type: BackgroundJobType.REBUILD_LEADERBOARDS, payload: { subject: LeaderboardRebuildSubject.EVENT, id: 'event-1' } },
      { type: BackgroundJobType.REBUILD_LEADERBOARDS, payload: { subject: LeaderboardRebuildSubject.EVENT, id: 'event-2' } },
    ]);
    expect(runner.wake).toHaveBeenCalledTimes(2);
  });

  it('queues one more rebuild for a write made while the event\'s rebuild runs, so that write is not missed', async () => {
    const { jobs, rebuilds } = setup();
    await rebuilds.eventsChanged(['event-1']);

    // The runner claims the waiting job, which releases its key, as a rebuild starting does.
    await jobs.claimDue({ now: new Date(Date.now() + 1_000), limit: 10, leaseUntil: new Date(Date.now() + 60_000) });
    await rebuilds.eventsChanged(['event-1']);
    await rebuilds.eventsChanged(['event-1']);

    expect(jobs.rows.map((row) => row.status)).toEqual([BackgroundJobStatus.RUNNING, BackgroundJobStatus.QUEUED]);
  });

  it('writes nothing and wakes nothing when a write named no event', async () => {
    const { jobs, rebuilds, runner } = setup();

    await rebuilds.eventsChanged([]);

    expect(jobs.rows).toEqual([]);
    expect(runner.wake).not.toHaveBeenCalled();
  });
});

describe('leaderboardChangesOf', () => {
  it('rebuilds every board on the job\'s event, or the boards of the job\'s contest', () => {
    expect(leaderboardChangesOf({ subject: LeaderboardRebuildSubject.EVENT, id: 'event-1' })).toEqual({ sportEventIds: ['event-1'], contestIds: [] });
    expect(leaderboardChangesOf({ subject: LeaderboardRebuildSubject.CONTEST, id: 'contest-9' })).toEqual({ sportEventIds: [], contestIds: ['contest-9'] });
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
  it('keeps a stored board up to 5 minutes when the max age is unset', () => {
    expect(readLeaderboardSnapshotMaxAgeMs({ LEADERBOARD_SNAPSHOT_MAX_AGE_MS: '' })).toBe(300_000);
  });
});
