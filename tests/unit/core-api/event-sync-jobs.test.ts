/**
 * The event sync jobs (#2009): a SYNC_EVENT_FIELD or SYNC_EVENT_SCORES job syncs one event's feed
 * of its kind as one sync run. A root admin's Sync now runs the run it submitted; the tick's and a
 * webhook's record a run of their own. The jobs run here through the real queue and runner, over
 * in-memory tables, with the event's feed the one stand-in.
 */

import { expect } from '@jest/globals';
import type { PrismaClient } from '@prisma/client';
import {
  BackgroundJobStatus,
  JobTrigger,
  ProviderCode,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  Sport,
  type SportEvent,
} from '@poolmaster/shared/domain';
import { BackgroundJobQueue, BackgroundJobRunner } from '../../../packages/core-api/src/modules/background-jobs';
import { PermanentBackgroundJobError } from '../../../packages/core-api/src/modules/background-jobs/background-job-runner';
import { memoizedRead, ReadMemoKey, runWithReadMemo } from '../../../packages/core-api/src/core/request-read-memo';
import type { IngestionJobRecord } from '../../../packages/core-api/src/modules/ingestion/core/event-feed-sync';
import { ProviderRateLimitedError } from '../../../packages/core-api/src/modules/ingestion/core/provider-call-policy';
import { EventSyncJobs } from '../../../packages/core-api/src/modules/ingestion/event-sync-jobs';
import { IngestionService } from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { ProviderSyncRunLedger } from '../../../packages/core-api/src/modules/ingestion/persistence/provider-sync-run-ledger';
import { INGESTION_SCHEDULE_SETTINGS } from '../../../packages/core-api/src/modules/platform/ingestion-config-service';
import { expectDefined } from '../../support/expect-defined';
import { fakeLogger } from '../../support/fake-logger';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { jobHandlers, testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { inMemorySyncRuns, type InMemorySyncRuns } from '../../support/in-memory-sync-runs';
import { fakeSportEventRepo } from '../../support/repo-fakes';
import { SCHEDULED_SCORES_RUN } from '../../support/sync-run-fixtures';
import { syncRunOutcome } from '../../support/sync-run-payload';

const EVENT_ID = '0b6f3d2a-4c1e-4a8b-9d27-5e3f1c8a6b40';

/** One of our events, linked to its league's provider under `golf-open-2026`. */
function linkedEvent(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    id: EVENT_ID,
    sportLeagueId: 'pga-tour',
    sport: Sport.GOLF,
    status: 'IN_PROGRESS',
    syncProviderId: 'balldontlie',
    providerMappings: [{ providerCode: ProviderCode.BALLDONTLIE, providerName: 'BALLDONTLIE', externalId: 'golf-open-2026' }],
    ...overrides,
  } as unknown as SportEvent;
}

const COMPLETED_FEED: IngestionJobRecord = {
  jobType: 'EVENT_LIVE_SCORES_SYNC', providerId: 'balldontlie', sport: Sport.GOLF, eventExternalId: 'golf-open-2026',
  status: 'COMPLETED', startedAt: new Date('2026-05-30T12:00:00.000Z'), completedAt: new Date('2026-05-30T12:00:01.000Z'),
  recordsProcessed: 0, errors: 0, errorLog: [], warnings: [],
};

/** The jobs, the Sync now that submits them, and the runner, as the app wires them. */
function setup(options: {
  runEventSync?: jest.Mock;
  event?: SportEvent | null;
  scoresOn?: boolean;
  running?: boolean;
  syncRuns?: InMemorySyncRuns;
} = {}) {
  const runs = options.syncRuns ?? inMemorySyncRuns();
  const runEventSync = options.runEventSync ?? jest.fn().mockResolvedValue([COMPLETED_FEED]);
  const registry = registryWith(options.running === false ? null : fakeSportDataProvider({ providerId: 'balldontlie' }));
  const sportEvents = fakeSportEventRepo({ findById: jest.fn().mockResolvedValue(options.event === undefined ? linkedEvent() : options.event) });
  const ledger = new ProviderSyncRunLedger(runs);
  const defaults = INGESTION_SCHEDULE_SETTINGS.defaults({});
  const eventSyncJobs = new EventSyncJobs({
    sportEvents,
    feeds: { runEventSync },
    syncRuns: runs,
    syncRunLedger: ledger,
    registry,
    schedule: { getConfig: () => Promise.resolve({ ...defaults, SCORES: { ...defaults.SCORES, enabled: options.scoresOn ?? true } }) },
    logger: fakeLogger(),
  });
  const queue = new BackgroundJobQueue({ jobs: runs.jobs, currentStart: testCurrentJobStart });
  const ingestion = new IngestionService({
    registry,
    sportEvents,
    syncRuns: runs,
    sportLeagues: { findEventSynced: () => Promise.resolve([]) },
    providerSettings: { all: () => [], bySourceId: () => undefined },
    webhooks: { isOn: () => false, isSecretSet: () => false },
    jobHistory: { countByScope: () => Promise.resolve([]) },
    syncRunLedger: ledger,
    jobs: queue,
    logger: fakeLogger(),
  });
  const runner = new BackgroundJobRunner({
    jobs: runs.jobs,
    handlers: jobHandlers({
      SYNC_EVENT_FIELD: (payload, context) => eventSyncJobs.run(ProviderSyncKind.FIELD, payload, context),
      SYNC_EVENT_SCORES: (payload, context) => eventSyncJobs.run(ProviderSyncKind.SCORES, payload, context),
    }),
    logger: fakeLogger(),
  });
  queue.wakes(runner);
  return { runs, runEventSync, eventSyncJobs, ingestion, queue, runner };
}

/** A run of the event a Sync now submitted and its job has not run yet, or an earlier try left. */
function storedRun(runs: InMemorySyncRuns, status: ProviderSyncRunStatus, kind: ProviderSyncKind = ProviderSyncKind.SCORES) {
  return runs.create({
    ...SCHEDULED_SCORES_RUN,
    kind,
    trigger: JobTrigger.ADMIN,
    sportEventId: EVENT_ID,
    sportLeagueId: 'pga-tour',
    providerCode: ProviderCode.BALLDONTLIE,
    status,
    startedAt: status === ProviderSyncRunStatus.SUBMITTED ? null : new Date(),
    completedAt: null,
    ...syncRunOutcome(),
  });
}

const firstTry = { jobId: 'job-1', attempt: 1, trigger: JobTrigger.ADMIN };

describe('a Sync now\'s event sync jobs (#1441)', () => {
  it('runs no feed until its jobs run, then each kind\'s feed by the event\'s id at its provider, as its own run naming its own job', async () => {
    const { runs, runEventSync, ingestion, runner } = setup();

    const submitted = await ingestion.syncSportEvent(EVENT_ID, [ProviderSyncKind.FIELD, ProviderSyncKind.SCORES], 'admin-1', 'a@x.test');
    expect(runEventSync).not.toHaveBeenCalled();
    await runner.drain();

    expect(runEventSync.mock.calls).toEqual([
      [{ sport: Sport.GOLF, providerId: 'balldontlie', eventId: 'golf-open-2026', kinds: [ProviderSyncKind.FIELD] }],
      [{ sport: Sport.GOLF, providerId: 'balldontlie', eventId: 'golf-open-2026', kinds: [ProviderSyncKind.SCORES] }],
    ]);
    expect(runs.jobs.rows.map((job) => job.status)).toEqual([BackgroundJobStatus.SUCCEEDED, BackgroundJobStatus.SUCCEEDED]);
    // The job that ran each run is named on it, so Activity opens a job's runs.
    expect(submitted.syncRuns.map((run) => runs.rows.find((row) => row.id === run.id)?.backgroundJobId)).toEqual(runs.jobs.rows.map((job) => job.id));
    expect(runs.rows.map((run) => run.status)).toEqual([ProviderSyncRunStatus.COMPLETED, ProviderSyncRunStatus.COMPLETED]);
  });

  it('records a failed feed on its run and finishes the job, and the other kind\'s job still runs its feed', async () => {
    const runEventSync = jest.fn().mockRejectedValueOnce(new Error('field feed exploded')).mockResolvedValueOnce([COMPLETED_FEED]);
    const { runs, ingestion, runner } = setup({ runEventSync });

    await ingestion.syncSportEvent(EVENT_ID, [ProviderSyncKind.FIELD, ProviderSyncKind.SCORES], 'admin-1', 'a@x.test');
    await runner.drain();

    expect(runs.rows.map((run) => [run.kind, run.status])).toEqual([
      [ProviderSyncKind.FIELD, ProviderSyncRunStatus.FAILED],
      [ProviderSyncKind.SCORES, ProviderSyncRunStatus.COMPLETED],
    ]);
    expect(runs.jobs.rows.map((job) => job.status)).toEqual([BackgroundJobStatus.SUCCEEDED, BackgroundJobStatus.SUCCEEDED]);
  });

  it('marks its run rate limited and queues the job again without counting the try, and the next try leaves the run as it is', async () => {
    // Already due again, so the one drain runs the deferred try too.
    const refusal = new ProviderRateLimitedError('balldontlie', new Date(Date.now() - 1_000), 'its circuit is open');
    const runEventSync = jest.fn().mockRejectedValueOnce(refusal).mockResolvedValue([COMPLETED_FEED]);
    const { runs, ingestion, runner } = setup({ runEventSync });

    await ingestion.syncSportEvent(EVENT_ID, [ProviderSyncKind.SCORES], 'admin-1', 'a@x.test');
    await runner.drain();

    expect(runEventSync).toHaveBeenCalledTimes(1);
    expect(runs.rows.map((run) => run.status)).toEqual([ProviderSyncRunStatus.FAILED]);
    expect(runs.jobs.rows).toEqual([expect.objectContaining({ status: BackgroundJobStatus.SUCCEEDED, attempts: 1 })]);
  });

  it('on a retry, marks its run an earlier try left IN_PROGRESS FAILED as interrupted and runs no feed (#1445)', async () => {
    const { runs, runEventSync, eventSyncJobs } = setup();
    const started = await storedRun(runs, ProviderSyncRunStatus.IN_PROGRESS);

    await eventSyncJobs.run(ProviderSyncKind.SCORES, { sportEventId: EVENT_ID, syncRunId: started.id }, { ...firstTry, attempt: 2 });

    expect(runEventSync).not.toHaveBeenCalled();
    const interrupted = runs.rows.find((run) => run.id === started.id);
    expect(interrupted?.status).toBe(ProviderSyncRunStatus.FAILED);
    expect(interrupted?.completedAt).toBeInstanceOf(Date);
    const failedWith = runs.update.mock.calls.find(([id, update]) => id === started.id && update.status === ProviderSyncRunStatus.FAILED)?.[1];
    expect(JSON.stringify(failedWith?.details)).toContain('Interrupted');
  });

  it('on a first try, leaves a run already IN_PROGRESS alone, since only a retry can know an earlier try stopped', async () => {
    const { runs, runEventSync, eventSyncJobs } = setup();
    const started = await storedRun(runs, ProviderSyncRunStatus.IN_PROGRESS);

    await eventSyncJobs.run(ProviderSyncKind.SCORES, { sportEventId: EVENT_ID, syncRunId: started.id }, firstTry);

    expect(runEventSync).not.toHaveBeenCalled();
    expect(runs.rows.find((run) => run.id === started.id)?.status).toBe(ProviderSyncRunStatus.IN_PROGRESS);
  });

  it('runs no feed for a run that is no longer stored', async () => {
    const { runEventSync, eventSyncJobs } = setup();

    await expect(eventSyncJobs.run(ProviderSyncKind.SCORES, { sportEventId: EVENT_ID, syncRunId: '00000000-0000-4000-8000-000000000009' }, firstTry))
      .resolves.toEqual({ changedCount: 0 });
    expect(runEventSync).not.toHaveBeenCalled();
  });

  it('fails the job when a failed feed\'s run could not be marked FAILED, so its retry marks the run interrupted (#1445)', async () => {
    const runs = inMemorySyncRuns();
    const update = expectDefined(runs.update.getMockImplementation());
    let refuseFailedWrite = true;
    runs.update.mockImplementation((id, change) => {
      if (change.status === ProviderSyncRunStatus.FAILED && refuseFailedWrite) {
        refuseFailedWrite = false;
        return Promise.reject(new Error('connection reset'));
      }
      return update(id, change);
    });
    const { runEventSync, eventSyncJobs } = setup({ syncRuns: runs, runEventSync: jest.fn().mockRejectedValue(new Error('provider timed out')) });
    const failing = await storedRun(runs, ProviderSyncRunStatus.SUBMITTED);
    const payload = { sportEventId: EVENT_ID, syncRunId: failing.id };

    await expect(eventSyncJobs.run(ProviderSyncKind.SCORES, payload, firstTry)).rejects.toThrow(`The outcome of sync run ${failing.id} could not be recorded`);
    expect(runs.rows.find((run) => run.id === failing.id)?.status).toBe(ProviderSyncRunStatus.IN_PROGRESS);

    await eventSyncJobs.run(ProviderSyncKind.SCORES, payload, { ...firstTry, attempt: 2 });

    expect(runs.rows.find((run) => run.id === failing.id)?.status).toBe(ProviderSyncRunStatus.FAILED);
    expect(runEventSync).toHaveBeenCalledTimes(1);
  });

  it('runs outside the submitting request\'s read memo, so the background sync reads afresh', async () => {
    // Stands in for the root Prisma client, the only one whose reads are remembered.
    const root = { $transaction: jest.fn() } as unknown as PrismaClient;
    const load = jest.fn(async () => linkedEvent());
    const runEventSync = jest.fn(async () => {
      await memoizedRead(root, `${ReadMemoKey.sportEvent}${EVENT_ID}`, load);
      await memoizedRead(root, `${ReadMemoKey.sportEvent}${EVENT_ID}`, load);
      return [COMPLETED_FEED];
    });
    const { ingestion, runner } = setup({ runEventSync });

    await runWithReadMemo(async () => {
      await memoizedRead(root, `${ReadMemoKey.sportEvent}${EVENT_ID}`, load);
      await ingestion.syncSportEvent(EVENT_ID, [ProviderSyncKind.SCORES], 'admin-1', 'a@x.test');
    });
    await runner.drain();

    expect(runEventSync).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe('the tick\'s and a webhook\'s event sync jobs (#2009)', () => {
  it('records a run of its own, as the schedule\'s, naming the event, its sport league and the job, and syncs the event\'s feed of its kind', async () => {
    const { runs, runEventSync, eventSyncJobs } = setup();

    await expect(eventSyncJobs.run(ProviderSyncKind.FIELD, { sportEventId: EVENT_ID }, { jobId: 'job-7', attempt: 1, trigger: JobTrigger.SCHEDULE }))
      .resolves.toEqual({ changedCount: 0 });

    expect(runEventSync).toHaveBeenCalledWith({ sport: Sport.GOLF, providerId: 'balldontlie', eventId: 'golf-open-2026', kinds: [ProviderSyncKind.FIELD] });
    expect(runs.rows).toEqual([expect.objectContaining({
      kind: ProviderSyncKind.FIELD, trigger: JobTrigger.SCHEDULE, sportEventId: EVENT_ID, sportLeagueId: 'pga-tour',
      backgroundJobId: 'job-7', status: ProviderSyncRunStatus.COMPLETED,
    })]);
  });

  it('records a webhook\'s job as the webhook\'s', async () => {
    const { runs, eventSyncJobs } = setup();

    await eventSyncJobs.run(ProviderSyncKind.SCORES, { sportEventId: EVENT_ID }, { jobId: 'job-8', attempt: 1, trigger: JobTrigger.WEBHOOK });

    expect(runs.rows).toEqual([expect.objectContaining({ trigger: JobTrigger.WEBHOOK, backgroundJobId: 'job-8' })]);
  });

  it('syncs nothing and records no run while the event\'s provider is not running here, or for scores while live score syncs are off', async () => {
    const stopped = setup({ running: false });
    const scoresOff = setup({ scoresOn: false });

    await stopped.eventSyncJobs.run(ProviderSyncKind.FIELD, { sportEventId: EVENT_ID }, { ...firstTry, trigger: JobTrigger.SCHEDULE });
    await scoresOff.eventSyncJobs.run(ProviderSyncKind.SCORES, { sportEventId: EVENT_ID }, { ...firstTry, trigger: JobTrigger.WEBHOOK });

    expect([...stopped.runs.rows, ...scoresOff.runs.rows]).toEqual([]);
    expect(stopped.runEventSync).not.toHaveBeenCalled();
    expect(scoresOff.runEventSync).not.toHaveBeenCalled();
  });

  it('still syncs a field while live score syncs are off: the field sync has no switch (#2086)', async () => {
    const { runEventSync, eventSyncJobs } = setup({ scoresOn: false });

    await eventSyncJobs.run(ProviderSyncKind.FIELD, { sportEventId: EVENT_ID }, { ...firstTry, trigger: JobTrigger.SCHEDULE });

    expect(runEventSync).toHaveBeenCalledTimes(1);
  });

  it('on a retry, marks the run an earlier try of the job left IN_PROGRESS FAILED as interrupted, then records and runs a new one', async () => {
    const { runs, runEventSync, eventSyncJobs } = setup();
    const left = await runs.create({
      ...SCHEDULED_SCORES_RUN, providerCode: ProviderCode.BALLDONTLIE, sportEventId: EVENT_ID, sportLeagueId: 'pga-tour',
      backgroundJobId: 'job-9', status: ProviderSyncRunStatus.IN_PROGRESS, startedAt: new Date(), completedAt: null, ...syncRunOutcome(),
    });

    await eventSyncJobs.run(ProviderSyncKind.SCORES, { sportEventId: EVENT_ID }, { jobId: 'job-9', attempt: 2, trigger: JobTrigger.SCHEDULE });

    expect(runs.rows.map((run) => [run.id === left.id, run.status])).toEqual([
      [true, ProviderSyncRunStatus.FAILED],
      [false, ProviderSyncRunStatus.COMPLETED],
    ]);
    expect(runEventSync).toHaveBeenCalledTimes(1);
  });
});

describe('an event sync job whose event cannot be synced', () => {
  it('fails for good when the event is gone, or has no id at its league\'s provider any more, calling no provider', async () => {
    const gone = setup({ event: null });
    const unlinked = setup({ event: linkedEvent({ providerMappings: [] }) });

    await expect(gone.eventSyncJobs.run(ProviderSyncKind.SCORES, { sportEventId: EVENT_ID }, firstTry)).rejects.toBeInstanceOf(PermanentBackgroundJobError);
    await expect(unlinked.eventSyncJobs.run(ProviderSyncKind.SCORES, { sportEventId: EVENT_ID }, firstTry)).rejects.toBeInstanceOf(PermanentBackgroundJobError);
    expect(gone.runEventSync).not.toHaveBeenCalled();
    expect(unlinked.runEventSync).not.toHaveBeenCalled();
  });
});
