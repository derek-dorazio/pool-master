import { BackgroundJobStatus, BackgroundJobType, Sport } from '@poolmaster/shared/domain';
import {
  BackgroundJobQueue,
  InvalidBackgroundJobPayloadError,
  type BackgroundJobPayload,
} from '../../../packages/core-api/src/modules/background-jobs';
import { inMemoryBackgroundJobs } from '../../support/in-memory-background-jobs';

type SyncPayload = BackgroundJobPayload<typeof BackgroundJobType.MANUAL_EVENT_SYNC>;

const PAYLOAD: SyncPayload = {
  syncRunIds: ['00000000-0000-4000-8000-000000000001'],
  sport: Sport.GOLF,
  eventId: 'golf-open-championship-2026',
};

function setup() {
  const jobs = inMemoryBackgroundJobs();
  const queue = new BackgroundJobQueue({ jobs });
  const runner = { wake: jest.fn() };
  queue.wakes(runner);
  return { jobs, queue, runner };
}

describe('background job queue (#1440)', () => {
  it('queues a job with a valid payload, due at once, and wakes the runner', async () => {
    const { jobs, queue, runner } = setup();

    await expect(queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, PAYLOAD)).resolves.toBe(true);

    expect(jobs.rows).toEqual([expect.objectContaining({
      type: BackgroundJobType.MANUAL_EVENT_SYNC,
      payload: PAYLOAD,
      status: BackgroundJobStatus.QUEUED,
      attempts: 0,
    })]);
    expect(runner.wake).toHaveBeenCalledTimes(1);
  });

  it('refuses a payload that fails its type\'s schema where it is made, writing nothing and waking nothing', async () => {
    const { jobs, queue, runner } = setup();
    const bad = { ...PAYLOAD, syncRunIds: ['not-a-uuid'] };

    await expect(queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, bad)).rejects.toBeInstanceOf(InvalidBackgroundJobPayloadError);
    expect(() => queue.request(BackgroundJobType.MANUAL_EVENT_SYNC, { ...PAYLOAD, syncRunIds: [] }))
      .toThrow(/Invalid MANUAL_EVENT_SYNC job payload/);

    expect(jobs.rows).toEqual([]);
    expect(runner.wake).not.toHaveBeenCalled();
  });

  it('coalesces a second enqueue with the dedupe key a queued job holds into that one job', async () => {
    const { jobs, queue } = setup();

    await expect(queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, PAYLOAD, { dedupeKey: 'sync:event-1' })).resolves.toBe(true);
    await expect(queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, PAYLOAD, { dedupeKey: 'sync:event-1' })).resolves.toBe(false);
    await expect(queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, PAYLOAD, { dedupeKey: 'sync:event-2' })).resolves.toBe(true);

    expect(jobs.rows.map((row) => row.dedupeKey)).toEqual(['sync:event-1', 'sync:event-2']);
  });

  it('builds a checked job for another write\'s transaction without writing it, keeping its run time and key', () => {
    const { jobs, queue, runner } = setup();
    const runAt = new Date('2026-11-07T12:05:00.000Z');

    const request = queue.request(BackgroundJobType.MANUAL_EVENT_SYNC, PAYLOAD, { runAt, dedupeKey: 'sync:event-1' });

    expect(request).toEqual({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: PAYLOAD, runAt, dedupeKey: 'sync:event-1' });
    expect(jobs.rows).toEqual([]);
    expect(runner.wake).not.toHaveBeenCalled();
    queue.queued();
    expect(runner.wake).toHaveBeenCalledTimes(1);
  });
});
