import { BackgroundJobStatus, BackgroundJobType } from '@poolmaster/shared/domain';
import { BackgroundJobRetention } from '../../../packages/core-api/src/modules/background-jobs';
import { inMemoryBackgroundJobs } from '../../support/in-memory-background-jobs';

const NOW = new Date('2026-11-07T08:00:00.000Z');
const DAY_MS = 24 * 60 * 60_000;

describe('background job retention (#1440)', () => {
  it('deletes jobs that succeeded over 7 days ago and failed over 30 days ago, and keeps newer ones and unfinished ones', async () => {
    const jobs = inMemoryBackgroundJobs(() => NOW);
    const finished = {
      succeededLongAgo: { status: BackgroundJobStatus.SUCCEEDED, daysAgo: 8 },
      succeededRecently: { status: BackgroundJobStatus.SUCCEEDED, daysAgo: 6 },
      failedLongAgo: { status: BackgroundJobStatus.FAILED, daysAgo: 31 },
      failedLastWeek: { status: BackgroundJobStatus.FAILED, daysAgo: 8 },
    };
    for (const [key, { status, daysAgo }] of Object.entries(finished)) {
      await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: { key }, dedupeKey: key });
      const row = jobs.rows[jobs.rows.length - 1];
      Object.assign(row, { status, completedAt: new Date(NOW.getTime() - daysAgo * DAY_MS) });
    }
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: { key: 'queued' }, dedupeKey: 'queued' });

    await expect(new BackgroundJobRetention(jobs).purge(NOW)).resolves.toBe(2);

    expect(jobs.rows.map((row) => row.dedupeKey)).toEqual(['succeededRecently', 'failedLastWeek', 'queued']);
  });
});
