import { BackgroundJobStatus, BackgroundJobType } from '@poolmaster/shared/domain';
import { BackgroundJobRetention } from '../../../packages/core-api/src/modules/background-jobs';
import { inMemoryBackgroundJobs, TEST_JOB_START } from '../../support/in-memory-background-jobs';

const NOW = new Date('2026-11-07T08:00:00.000Z');
const DAY_MS = 24 * 60 * 60_000;

describe('background job retention (#1440)', () => {
  it('deletes every finished job, succeeded or failed, 30 days after it finished, and keeps newer ones and unfinished ones (#1819)', async () => {
    const jobs = inMemoryBackgroundJobs(() => NOW);
    const finished = {
      succeededLongAgo: { status: BackgroundJobStatus.SUCCEEDED, daysAgo: 31 },
      succeededLastWeek: { status: BackgroundJobStatus.SUCCEEDED, daysAgo: 8 },
      failedLongAgo: { status: BackgroundJobStatus.FAILED, daysAgo: 31 },
      failedLastWeek: { status: BackgroundJobStatus.FAILED, daysAgo: 8 },
    };
    for (const [key, { status, daysAgo }] of Object.entries(finished)) {
      await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: { key }, dedupeKey: key, start: TEST_JOB_START });
      const row = jobs.rows[jobs.rows.length - 1];
      Object.assign(row, { status, completedAt: new Date(NOW.getTime() - daysAgo * DAY_MS) });
    }
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: { key: 'queued' }, dedupeKey: 'queued', start: TEST_JOB_START });

    await expect(new BackgroundJobRetention(jobs).purge(NOW)).resolves.toBe(2);

    expect(jobs.rows.map((row) => row.dedupeKey)).toEqual(['succeededLastWeek', 'failedLastWeek', 'queued']);
  });
});
