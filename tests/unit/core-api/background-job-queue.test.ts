import { BackgroundJobStatus, BackgroundJobType, ProviderCode, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import {
  BackgroundJobQueue,
  InvalidBackgroundJobPayloadError,
  NO_JOBS_FOR_WRITE,
  combineJobsForWrite,
  type BackgroundJobPayload,
} from '../../../packages/core-api/src/modules/background-jobs';
import { inMemoryBackgroundJobs, TEST_JOB_START, testCurrentJobStart } from '../../support/in-memory-background-jobs';

type SyncPayload = BackgroundJobPayload<typeof BackgroundJobType.SYNC_EVENT_FIELD>;

const PAYLOAD: SyncPayload = {
  sportEventId: '00000000-0000-4000-8000-0000000000e1',
  syncRunId: '00000000-0000-4000-8000-000000000001',
};

function setup() {
  const jobs = inMemoryBackgroundJobs();
  const queue = new BackgroundJobQueue({ jobs, currentStart: testCurrentJobStart });
  const runner = { wake: jest.fn() };
  queue.wakes(runner);
  return { jobs, queue, runner };
}

describe('background job queue (#1440)', () => {
  it('queues a job with a valid payload, due at once, and wakes the runner', async () => {
    const { jobs, queue, runner } = setup();

    await expect(queue.enqueue(BackgroundJobType.SYNC_EVENT_FIELD, PAYLOAD)).resolves.toBe(true);

    expect(jobs.rows).toEqual([expect.objectContaining({
      type: BackgroundJobType.SYNC_EVENT_FIELD,
      payload: PAYLOAD,
      status: BackgroundJobStatus.QUEUED,
      attempts: 0,
    })]);
    expect(runner.wake).toHaveBeenCalledTimes(1);
  });

  it('refuses a payload that fails its type\'s schema where it is made, writing nothing and waking nothing', async () => {
    const { jobs, queue, runner } = setup();
    const bad = { ...PAYLOAD, syncRunId: 'not-a-uuid' };

    await expect(queue.enqueue(BackgroundJobType.SYNC_EVENT_FIELD, bad)).rejects.toBeInstanceOf(InvalidBackgroundJobPayloadError);
    expect(() => queue.request(BackgroundJobType.SYNC_EVENT_FIELD, { ...PAYLOAD, sportEventId: '' }))
      .toThrow(/Invalid SYNC_EVENT_FIELD job payload/);

    expect(jobs.rows).toEqual([]);
    expect(runner.wake).not.toHaveBeenCalled();
  });

  it('coalesces a second enqueue with the dedupe key a job waiting for its first try holds into that one job', async () => {
    const { jobs, queue } = setup();

    await expect(queue.enqueue(BackgroundJobType.SYNC_EVENT_FIELD, PAYLOAD, { dedupeKey: 'sync:event-1' })).resolves.toBe(true);
    await expect(queue.enqueue(BackgroundJobType.SYNC_EVENT_FIELD, PAYLOAD, { dedupeKey: 'sync:event-1' })).resolves.toBe(false);
    await expect(queue.enqueue(BackgroundJobType.SYNC_EVENT_FIELD, PAYLOAD, { dedupeKey: 'sync:event-2' })).resolves.toBe(true);

    expect(jobs.rows.map((row) => row.dedupeKey)).toEqual(['sync:event-1', 'sync:event-2']);
  });

  it('builds a checked job for another write\'s transaction without writing it, keeping its run time and key', () => {
    const { jobs, queue, runner } = setup();
    const runAt = new Date('2026-11-07T12:05:00.000Z');

    const request = queue.request(BackgroundJobType.SYNC_EVENT_FIELD, PAYLOAD, { runAt, dedupeKey: 'sync:event-1' });

    expect(request).toEqual({ type: BackgroundJobType.SYNC_EVENT_FIELD, payload: PAYLOAD, sportEventId: PAYLOAD.sportEventId, runAt, dedupeKey: 'sync:event-1', start: TEST_JOB_START });
    expect(jobs.rows).toEqual([]);
    expect(runner.wake).not.toHaveBeenCalled();
    queue.queued();
    expect(runner.wake).toHaveBeenCalledTimes(1);
  });
});

describe('jobs a write carries (#1466)', () => {
  it('combines several writes\' jobs in order, and wakes each one\'s runner once the write commits', () => {
    const first = { jobs: [{ type: BackgroundJobType.SYNC_EVENT_FIELD, payload: 'a', start: TEST_JOB_START }], queued: jest.fn() };
    const second = { jobs: [{ type: BackgroundJobType.SYNC_EVENT_FIELD, payload: 'b', start: TEST_JOB_START }], queued: jest.fn() };

    const combined = combineJobsForWrite(first, NO_JOBS_FOR_WRITE, second);

    expect(combined.jobs.map((job) => job.payload)).toEqual(['a', 'b']);
    expect(first.queued).not.toHaveBeenCalled();
    combined.queued();
    expect(first.queued).toHaveBeenCalledTimes(1);
    expect(second.queued).toHaveBeenCalledTimes(1);
  });

  it('carries no job, and its wake does nothing, for a write that needs none', () => {
    expect(NO_JOBS_FOR_WRITE.jobs).toEqual([]);
    expect(() => { NO_JOBS_FOR_WRITE.queued(); }).not.toThrow();
  });

  it('scopes each job to the event or sport league its payload names, so Activity can filter on them (#1819)', () => {
    const { queue } = setup();
    const sportEventId = '00000000-0000-4000-8000-0000000000e1';
    const sportLeagueId = '00000000-0000-4000-8000-0000000000a1';
    const scopeOf = (request: BackgroundJobRequest) => ({ sportEventId: request.sportEventId, sportLeagueId: request.sportLeagueId });
    const onEvent = { sportEventId, sportLeagueId: undefined };
    const onNothing = { sportEventId: undefined, sportLeagueId: undefined };

    expect(scopeOf(queue.request(BackgroundJobType.SETTLE_SPORT_EVENT_CONTESTS, { sportEventId, completedAt: '2026-11-07T12:00:00.000Z' }))).toEqual(onEvent);
    expect(scopeOf(queue.request(BackgroundJobType.SYNC_LEAGUE_EVENTS, { sportLeagueId })))
      .toEqual({ sportEventId: undefined, sportLeagueId });
    expect(scopeOf(queue.request(BackgroundJobType.REBUILD_LEADERBOARDS, { subject: 'EVENT', id: sportEventId }))).toEqual(onEvent);
    // A contest's rebuild or results email may span several events, so it names none.
    expect(scopeOf(queue.request(BackgroundJobType.REBUILD_LEADERBOARDS, { subject: 'CONTEST', id: 'contest-1' }))).toEqual(onNothing);
    expect(scopeOf(queue.request(BackgroundJobType.CONTEST_SETTLED_EMAILS, { contestId: 'contest-1' }))).toEqual(onNothing);
    // An event sync names PoolMaster's event, which its payload always holds (#2009).
    expect(scopeOf(queue.request(BackgroundJobType.SYNC_EVENT_FIELD, { sportEventId }))).toEqual(onEvent);
    expect(scopeOf(queue.request(BackgroundJobType.SYNC_EVENT_SCORES, { sportEventId }))).toEqual(onEvent);
  });

  it('answers the job it queued, or the waiting job holding the same dedupe key, and wakes the runner either way (#1819)', async () => {
    const { jobs, queue, runner } = setup();

    const first = await queue.enqueueReturning(BackgroundJobType.SYNC_EVENT_FIELD, PAYLOAD, { dedupeKey: 'one-sync' });
    const second = await queue.enqueueReturning(BackgroundJobType.SYNC_EVENT_FIELD, PAYLOAD, { dedupeKey: 'one-sync' });

    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({ type: BackgroundJobType.SYNC_EVENT_FIELD, status: BackgroundJobStatus.QUEUED, payload: PAYLOAD });
    expect(jobs.rows).toHaveLength(1);
    expect(runner.wake).toHaveBeenCalledTimes(2);
  });
  it('keys a job to the Provider row of the code the caller names, and to none when that code has no row (#2040)', () => {
    const jobs = inMemoryBackgroundJobs();
    const sportLeagueId = '00000000-0000-4000-8000-0000000000a1';
    const keyed = new BackgroundJobQueue({ jobs, currentStart: testCurrentJobStart, providerIdOf: () => 'provider-row-1' });
    const unknown = new BackgroundJobQueue({ jobs, currentStart: testCurrentJobStart, providerIdOf: () => undefined });

    const keyedRequest = keyed.request(BackgroundJobType.SYNC_LEAGUE_EVENTS, { sportLeagueId }, { providerCode: ProviderCode.BALLDONTLIE });
    const unknownRequest = unknown.request(BackgroundJobType.SYNC_LEAGUE_EVENTS, { sportLeagueId }, { providerCode: ProviderCode.BALLDONTLIE });

    expect(keyedRequest.providerId).toBe('provider-row-1');
    expect(unknownRequest).not.toHaveProperty('providerId');
  });

  it('answers a new job for each enqueue with no options, since without a dedupe key nothing coalesces', async () => {
    const { jobs, queue } = setup();

    const first = await queue.enqueueReturning(BackgroundJobType.SYNC_EVENT_FIELD, PAYLOAD);
    const second = await queue.enqueueReturning(BackgroundJobType.SYNC_EVENT_FIELD, PAYLOAD);

    expect(first).toMatchObject({ status: BackgroundJobStatus.QUEUED, payload: PAYLOAD });
    expect(second.id).not.toBe(first.id);
    expect(jobs.rows).toHaveLength(2);
  });
});
