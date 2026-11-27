import type { FastifyBaseLogger } from 'fastify';
import { expect } from '@jest/globals';
import { SCHEDULED_SCORES_RUN } from '../../support/sync-run-fixtures';
import { BackgroundJobType, JobTrigger, ProviderCode, Sport, type ProviderSyncRun } from '@poolmaster/shared/domain';
import { ProviderSyncRunLedger } from '../../../packages/core-api/src/modules/ingestion/persistence/provider-sync-run-ledger';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import type { IngestionJobRecord } from '../../../packages/core-api/src/modules/ingestion/core/event-feed-sync';
import type { ProviderSyncRunRepository } from '@poolmaster/shared/db';
import { mockFn } from '../../support/mock-fn';
import { inMemorySyncRuns } from '../../support/in-memory-sync-runs';
import { TEST_JOB_START } from '../../support/in-memory-background-jobs';

function createSyncRun(overrides: Partial<ProviderSyncRun> = {}): ProviderSyncRun {
  return {
    id: 'sync-run-1',
    providerId: 'provider-row-1',
    providerName: 'Mock provider',
    sport: Sport.GOLF,
    eventId: 'event-1',
    ...SCHEDULED_SCORES_RUN,
    status: 'SUBMITTED',
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-05-30T12:00:00.000Z'),
    kind: 'FIELD',
    summary: 'Submitted Field sync for event-1.',
    stats: {},
    changedCount: null,
    errorCount: 0,
    ...overrides,
  };
}

function createJob(overrides: Partial<IngestionJobRecord> = {}): IngestionJobRecord {
  return {
    jobType: 'EVENT_PARTICIPANTS_SYNC',
    providerId: 'balldontlie',
    sport: Sport.GOLF,
    eventExternalId: 'event-1',
    status: 'COMPLETED',
    startedAt: new Date('2026-05-30T12:00:01.000Z'),
    completedAt: new Date('2026-05-30T12:00:02.000Z'),
    recordsProcessed: 3,
    errors: 0,
    errorLog: [],
    providerPayload: {
      
      rawCaptured: true,
      rawTruncated: false,
      raw: [],
    },
    stats: {
      events: 3,
      writeRows: 3,
      writeUnchanged: 1,
      writeCreated: 1,
      writeUpdated: 1,
      writeDeleted: 0,
    },
    writeDiagnostics: {
      summary: {
        total: 3,
        unchanged: 1,
        created: 1,
        updated: 1,
        deleted: 0,
      },
      rows: [
        {
          id: 'sport-event:balldontlie:event-1',
          entityType: 'SportEvent',
          disposition: 'UPDATED',
          providerId: 'balldontlie',
          externalId: 'event-1',
          name: 'Event 1',
          before: { status: 'SCHEDULED' },
          after: { status: 'IN_PROGRESS' },
        },
        {
          id: 'sport-event-participant:balldontlie:event-1:golfer-1',
          entityType: 'SportEventParticipant',
          disposition: 'UNCHANGED',
          providerId: 'balldontlie',
          externalId: 'event-1',
          participantExternalId: 'golfer-1',
          name: 'Golfer 1',
          before: { seedNumber: 1 },
          after: { seedNumber: 1 },
        },
        {
          id: 'sport-event-participant:balldontlie:event-1:golfer-2',
          entityType: 'SportEventParticipant',
          disposition: 'CREATED',
          providerId: 'balldontlie',
          externalId: 'event-1',
          participantExternalId: 'golfer-2',
          name: 'Golfer 2',
          after: { seedNumber: 2 },
        },
      ],
    },
    warnings: [],
    ...overrides,
  };
}

describe('ProviderSyncRunLedger records each run\'s event and sport league (#1847)', () => {
  const now = new Date('2026-05-30T12:00:00.000Z');
  const scheduled = new SyncOrchestrator({ now: () => now }).normalizeRequest({
    source: 'SCHEDULED',
    actor: { type: 'SYSTEM', name: 'scheduler' },
    scope: { type: 'EVENT', sport: Sport.GOLF, providerId: 'balldontlie', eventId: 'provider-event', kinds: ['SCORES'] },
  });

  it('keeps on each run the event and sport league its caller names, through either write', async () => {
    const ledger = new ProviderSyncRunLedger(inMemorySyncRuns());
    const named = { normalizedRequest: scheduled, providerId: 'balldontlie', submittedAt: now, sportEventId: 'named-event', sportLeagueId: 'named-league' };

    const [run] = await ledger.createSubmissions({ ...named, trigger: JobTrigger.SCHEDULE });
    const [withJob] = await ledger.createSubmissionsWithJob({
      ...named,
      trigger: JobTrigger.ADMIN,
      job: () => ({ type: BackgroundJobType.SYNC_EVENT_SCORES, payload: {}, start: TEST_JOB_START }),
    });

    expect(run).toMatchObject({ sportEventId: 'named-event', sportLeagueId: 'named-league' });
    expect(withJob).toMatchObject({ sportEventId: 'named-event', sportLeagueId: 'named-league' });
  });
});

describe('ProviderSyncRunLedger', () => {
  it('writes a manual sync\'s SUBMITTED runs through the one write that also queues their job, handing the job the runs', async () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    const normalizedRequest = new SyncOrchestrator({ now: () => now }).normalizeRequest({
      source: 'MANUAL',
      actor: { type: 'ROOT_ADMIN', userId: 'admin-1', email: 'admin@example.com' },
      scope: { type: 'EVENT', sport: Sport.GOLF, providerId: 'balldontlie', eventId: 'event-1', kinds: ['FIELD', 'SCORES'] },
    });
    const syncRuns = inMemorySyncRuns();
    const ledger = new ProviderSyncRunLedger(syncRuns);

    const runs = await ledger.createSubmissionsWithJob({
      normalizedRequest,
      providerId: 'balldontlie',
      submittedAt: now,
      trigger: JobTrigger.ADMIN,
      sportEventId: 'sport-event-1',
      sportLeagueId: 'pga-tour',
      job: (written) => ({ type: BackgroundJobType.SYNC_EVENT_FIELD, payload: { ids: written.map((run) => run.id) }, start: TEST_JOB_START }),
    });

    expect(syncRuns.create).not.toHaveBeenCalled();
    expect(runs.map((run) => [run.status, run.kind, run.createdAt, run.trigger])).toEqual([
      ['SUBMITTED', 'FIELD', now, JobTrigger.ADMIN],
      ['SUBMITTED', 'SCORES', now, JobTrigger.ADMIN],
    ]);
    expect(syncRuns.jobs.rows).toEqual([expect.objectContaining({ payload: { ids: runs.map((run) => run.id) } })]);
  });

  it('creates a scheduled run SUBMITTED, of the kind its feed syncs, with a summary naming the provider event and no counts yet', async () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    const normalizedRequest = new SyncOrchestrator({ now: () => now }).normalizeRequest({
      source: 'SCHEDULED',
      actor: { type: 'SYSTEM', name: 'scheduler' },
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        providerId: 'balldontlie',
        eventId: 'event-1',
        kinds: ['FIELD'],
      },
    });
    const providerSyncRunCreate = mockFn<ProviderSyncRunRepository['create']>(async (input) => ({
      ...createSyncRun(),
      ...input,
    }));
    const ledger = new ProviderSyncRunLedger({ create: providerSyncRunCreate, update: jest.fn(), findAll: jest.fn(), findById: jest.fn(), findByBackgroundJobIds: jest.fn(), createWithJob: jest.fn(), findManyByIds: jest.fn(), clearDetailsBatchSubmittedBefore: jest.fn(), deleteBatchSubmittedBefore: jest.fn(), countFinishedByProvider: jest.fn() });

    const runs = await ledger.createSubmissions({
      normalizedRequest,
      providerId: 'balldontlie',
      submittedAt: now,
      trigger: JobTrigger.SCHEDULE,
      sportEventId: 'sport-event-1',
      sportLeagueId: 'pga-tour',
    });

    expect(runs).toHaveLength(1);
    expect(providerSyncRunCreate).toHaveBeenCalledWith(expect.objectContaining({
      providerCode: ProviderCode.BALLDONTLIE,
      sport: Sport.GOLF,
      sportEventId: 'sport-event-1',
      status: 'SUBMITTED',
      createdAt: now,
      kind: 'FIELD',
      trigger: JobTrigger.SCHEDULE,
      summary: 'Submitted Field sync for event-1.',
      stats: {},
      changedCount: null,
      errorCount: 0,
    }));
  });

  it('marks a run IN_PROGRESS as it starts, then COMPLETED with its summary, counts and changed rows', async () => {
    const providerSyncRunUpdate = mockFn<ProviderSyncRunRepository['update']>(async () => undefined);
    const ledger = new ProviderSyncRunLedger({ create: jest.fn(), update: providerSyncRunUpdate, findAll: jest.fn(), findById: jest.fn(), findByBackgroundJobIds: jest.fn(), createWithJob: jest.fn(), findManyByIds: jest.fn(), clearDetailsBatchSubmittedBefore: jest.fn(), deleteBatchSubmittedBefore: jest.fn(), countFinishedByProvider: jest.fn() });
    const syncRun = createSyncRun();
    const job = createJob();

    await expect(ledger.executeFeedRun(syncRun, async () => job)).resolves.toBe(job);

    expect(providerSyncRunUpdate).toHaveBeenNthCalledWith(1, syncRun.id, expect.objectContaining({
      status: 'IN_PROGRESS',
      startedAt: expect.any(Date),
      completedAt: null,
      summary: 'Started Field sync.',
      changedCount: null,
      errorCount: 0,
      details: {
        providerPayload: { rawCaptured: false, rawTruncated: false },
      },
    }));
    expect(providerSyncRunUpdate).toHaveBeenNthCalledWith(2, syncRun.id, expect.objectContaining({
      status: 'COMPLETED',
      startedAt: expect.any(Date),
      completedAt: expect.any(Date),
      summary: 'Completed Field sync for event-1 (3 records).',
      stats: {
        events: 3,
        writeRows: 3,
        writeUnchanged: 1,
        writeCreated: 1,
        writeUpdated: 1,
        writeDeleted: 0,
      },
      // The rows it created or updated; the unchanged one is not counted.
      changedCount: 2,
      errorCount: 0,
      details: expect.objectContaining({
        jobPayload: expect.objectContaining({
          jobType: 'EVENT_PARTICIPANTS_SYNC',
          recordsProcessed: 3,
          errors: 0,
        }),
        providerPayload: job.providerPayload,
      }),
    }));
    const completed = providerSyncRunUpdate.mock.calls[1][1];
    expect(completed.details?.['jobPayload']).not.toHaveProperty('writeDiagnostics');
  });

  it('stores only the changed write rows while the summary still counts every row', async () => {
    const providerSyncRunUpdate = mockFn<ProviderSyncRunRepository['update']>(async () => undefined);
    const ledger = new ProviderSyncRunLedger({ create: jest.fn(), update: providerSyncRunUpdate, findAll: jest.fn(), findById: jest.fn(), findByBackgroundJobIds: jest.fn(), createWithJob: jest.fn(), findManyByIds: jest.fn(), clearDetailsBatchSubmittedBefore: jest.fn(), deleteBatchSubmittedBefore: jest.fn(), countFinishedByProvider: jest.fn() });
    const job = createJob();

    await ledger.executeFeedRun(createSyncRun(), async () => job);

    expect(providerSyncRunUpdate.mock.calls[1][1].details?.['writeDiagnostics']).toEqual({
      summary: { total: 3, unchanged: 1, created: 1, updated: 1, deleted: 0 },
      rows: [
        expect.objectContaining({ entityType: 'SportEvent', disposition: 'UPDATED' }),
        expect.objectContaining({ participantExternalId: 'golfer-2', disposition: 'CREATED' }),
      ],
    });
  });

  it('stores no write rows, only the summary, when a sync changed nothing', async () => {
    const providerSyncRunUpdate = mockFn<ProviderSyncRunRepository['update']>(async () => undefined);
    const ledger = new ProviderSyncRunLedger({ create: jest.fn(), update: providerSyncRunUpdate, findAll: jest.fn(), findById: jest.fn(), findByBackgroundJobIds: jest.fn(), createWithJob: jest.fn(), findManyByIds: jest.fn(), clearDetailsBatchSubmittedBefore: jest.fn(), deleteBatchSubmittedBefore: jest.fn(), countFinishedByProvider: jest.fn() });
    const unchangedRow = { id: 'row-1', entityType: 'SportEventParticipant', disposition: 'UNCHANGED' as const };
    const job = createJob({
      writeDiagnostics: {
        summary: { total: 2, unchanged: 2, created: 0, updated: 0, deleted: 0 },
        rows: [unchangedRow, { ...unchangedRow, id: 'row-2' }],
      },
    });

    await ledger.executeFeedRun(createSyncRun(), async () => job);

    expect(providerSyncRunUpdate.mock.calls[1][1].details?.['writeDiagnostics']).toEqual({
      summary: { total: 2, unchanged: 2, created: 0, updated: 0, deleted: 0 },
      rows: [],
    });
  });

  it('marks a run FAILED, with the job\'s first error as its summary and no changed count, when the ingestion job fails', async () => {
    const providerSyncRunUpdate = mockFn<ProviderSyncRunRepository['update']>(async () => undefined);
    const ledger = new ProviderSyncRunLedger({ create: jest.fn(), update: providerSyncRunUpdate, findAll: jest.fn(), findById: jest.fn(), findByBackgroundJobIds: jest.fn(), createWithJob: jest.fn(), findManyByIds: jest.fn(), clearDetailsBatchSubmittedBefore: jest.fn(), deleteBatchSubmittedBefore: jest.fn(), countFinishedByProvider: jest.fn() });
    const syncRun = createSyncRun();
    const failedJob = createJob({
      status: 'FAILED',
      recordsProcessed: 0,
      errors: 1,
      errorLog: [{ error: 'No provider registered', at: new Date('2026-05-30T12:00:02.000Z') }],
    });

    await expect(ledger.executeFeedRun(syncRun, async () => failedJob)).resolves.toBe(failedJob);

    expect(providerSyncRunUpdate).toHaveBeenNthCalledWith(2, syncRun.id, expect.objectContaining({
      status: 'FAILED',
      completedAt: expect.any(Date),
      summary: 'Failed Field sync for event-1: No provider registered',
      changedCount: null,
      errorCount: 1,
    }));
  });

  it('marks a run FAILED with the error as its summary, and rethrows, when its feed throws', async () => {
    const providerSyncRunUpdate = mockFn<ProviderSyncRunRepository['update']>(async () => undefined);
    const ledger = new ProviderSyncRunLedger({ create: jest.fn(), update: providerSyncRunUpdate, findAll: jest.fn(), findById: jest.fn(), findByBackgroundJobIds: jest.fn(), createWithJob: jest.fn(), findManyByIds: jest.fn(), clearDetailsBatchSubmittedBefore: jest.fn(), deleteBatchSubmittedBefore: jest.fn(), countFinishedByProvider: jest.fn() });
    const syncRun = createSyncRun();
    const executionError = new Error('provider exploded');

    await expect(ledger.executeFeedRun(syncRun, async () => {
      throw executionError;
    })).rejects.toThrow('provider exploded');

    expect(providerSyncRunUpdate).toHaveBeenCalledTimes(2);
    expect(providerSyncRunUpdate).toHaveBeenNthCalledWith(2, syncRun.id, expect.objectContaining({
      status: 'FAILED',
      startedAt: expect.any(Date),
      completedAt: expect.any(Date),
      summary: 'Failed Field sync: provider exploded',
      changedCount: null,
      errorCount: 1,
      details: {
        providerPayload: { rawCaptured: false, rawTruncated: false },
        failurePayload: {
          error: {
            name: 'Error',
            message: 'provider exploded',
          },
        },
      },
    }));
  });

  it('marks a submitted run FAILED without running its feed', async () => {
    const providerSyncRunUpdate = mockFn<ProviderSyncRunRepository['update']>(async () => undefined);
    const ledger = new ProviderSyncRunLedger({ create: jest.fn(), update: providerSyncRunUpdate, findAll: jest.fn(), findById: jest.fn(), findByBackgroundJobIds: jest.fn(), createWithJob: jest.fn(), findManyByIds: jest.fn(), clearDetailsBatchSubmittedBefore: jest.fn(), deleteBatchSubmittedBefore: jest.fn(), countFinishedByProvider: jest.fn() });
    const syncRun = createSyncRun();

    await ledger.failSubmittedRun(syncRun, new Error('unsupported feed'));

    expect(providerSyncRunUpdate).toHaveBeenCalledWith(syncRun.id, expect.objectContaining({
      status: 'FAILED',
      startedAt: expect.any(Date),
      completedAt: expect.any(Date),
      summary: 'Failed Field sync: unsupported feed',
      errorCount: 1,
      details: {
        providerPayload: { rawCaptured: false, rawTruncated: false },
        failurePayload: {
          error: {
            name: 'Error',
            message: 'unsupported feed',
          },
        },
      },
    }));
  });
});

describe('ProviderSyncRunLedger checks each completed run\'s event for its sync\'s finding (#1999)', () => {
  const linked = { sportLeagueId: 'nfl', sportEventId: 'week-1' };
  // The runs' writes go nowhere: these tests read the checks only.
  const syncRunsIgnoringWrites = () => ({ ...inMemorySyncRuns(), update: mockFn<ProviderSyncRunRepository['update']>(async () => undefined) });

  it.each([
    ['FIELD', 'NO_PROVIDER_PARTICIPANTS'],
  ] as const)('raises the %s run\'s %s finding on its event when the run warned of it', async (kind, findingKind) => {
    const findings = { checkEvent: jest.fn(async (_check: unknown) => undefined), checkRunOutcome: jest.fn(async (_run: unknown, _outcome: unknown) => undefined) };
    const ledger = new ProviderSyncRunLedger(syncRunsIgnoringWrites(), undefined, findings);

    await ledger.executeFeedRun(createSyncRun({ kind, ...linked }), async () => createJob({ warnings: [{ code: findingKind, message: 'Nothing came back.' }] }));

    expect(findings.checkEvent).toHaveBeenCalledWith({ kind: findingKind, sportLeagueId: 'nfl', sportEventId: 'week-1', providerId: 'provider-row-1', found: true });
  });

  it('raises nothing for a scores run that brought no updates, since the sync tick raises that once the league\'s quiet window has passed, and resolves it on a run that brought some (#2094)', async () => {
    const findings = { checkEvent: jest.fn(async (_check: unknown) => undefined), checkRunOutcome: jest.fn(async (_run: unknown, _outcome: unknown) => undefined) };
    const ledger = new ProviderSyncRunLedger(syncRunsIgnoringWrites(), undefined, findings);

    await ledger.executeFeedRun(createSyncRun({ kind: 'SCORES', ...linked }), async () => createJob({ warnings: [{ code: 'NO_PROVIDER_LIVE_SCORES', message: 'Nothing came back.' }] }));
    expect(findings.checkEvent).not.toHaveBeenCalled();

    await ledger.executeFeedRun(createSyncRun({ kind: 'SCORES', ...linked }), async () => createJob());
    expect(findings.checkEvent).toHaveBeenCalledWith({ kind: 'NO_PROVIDER_LIVE_SCORES', sportLeagueId: 'nfl', sportEventId: 'week-1', providerId: 'provider-row-1', found: false });
  });

  it('resolves the event\'s finding when a completed run did not warn of it', async () => {
    const findings = { checkEvent: jest.fn(async (_check: unknown) => undefined), checkRunOutcome: jest.fn(async (_run: unknown, _outcome: unknown) => undefined) };
    const ledger = new ProviderSyncRunLedger(syncRunsIgnoringWrites(), undefined, findings);

    await ledger.executeFeedRun(createSyncRun(linked), async () => createJob());

    expect(findings.checkEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'NO_PROVIDER_PARTICIPANTS', found: false }));
  });

  it('checks nothing for a run whose job failed, or a run linked to no event of ours', async () => {
    const findings = { checkEvent: jest.fn(async (_check: unknown) => undefined), checkRunOutcome: jest.fn(async (_run: unknown, _outcome: unknown) => undefined) };
    const ledger = new ProviderSyncRunLedger(syncRunsIgnoringWrites(), undefined, findings);

    await ledger.executeFeedRun(createSyncRun(linked), async () => createJob({ status: 'FAILED', errors: 1, errorLog: [{ error: 'down', at: new Date() }] }));
    await ledger.executeFeedRun(createSyncRun(), async () => createJob());

    expect(findings.checkEvent).not.toHaveBeenCalled();
  });

  it('returns the completed job and logs the failure when the findings check throws after the run is recorded', async () => {
    const findings = { checkEvent: jest.fn(async (_check: unknown) => { throw new Error('connection reset'); }), checkRunOutcome: jest.fn(async (_run: unknown, _outcome: unknown) => undefined) };
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const ledger = new ProviderSyncRunLedger(syncRunsIgnoringWrites(), logger as unknown as FastifyBaseLogger, findings);
    const job = createJob();

    await expect(ledger.executeFeedRun(createSyncRun(linked), async () => job)).resolves.toBe(job);

    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'ingestion.syncFinding.checkFailed' }), expect.any(String));
  });
});

describe('ProviderSyncRunLedger checks each run\'s outcome for its failed-sync finding (#2092)', () => {
  const linked = { sportLeagueId: 'nfl', sportEventId: 'week-1' };
  const syncRunsIgnoringWrites = () => ({ ...inMemorySyncRuns(), update: mockFn<ProviderSyncRunRepository['update']>(async () => undefined) });
  const checks = () => ({ checkEvent: jest.fn(async (_check: unknown) => undefined), checkRunOutcome: jest.fn(async (_run: unknown, _outcome: unknown) => undefined) });

  it('checks a completed run as COMPLETED, so its failed-sync finding resolves', async () => {
    const findings = checks();
    const ledger = new ProviderSyncRunLedger(syncRunsIgnoringWrites(), undefined, findings);
    const run = createSyncRun(linked);

    await ledger.executeFeedRun(run, async () => createJob());

    expect(findings.checkRunOutcome).toHaveBeenCalledTimes(1);
    expect(findings.checkRunOutcome).toHaveBeenCalledWith(run, 'COMPLETED');
  });

  it('checks a run whose job failed as FAILED, and checks its event for nothing else', async () => {
    const findings = checks();
    const ledger = new ProviderSyncRunLedger(syncRunsIgnoringWrites(), undefined, findings);
    const run = createSyncRun(linked);

    await ledger.executeFeedRun(run, async () => createJob({ status: 'FAILED', errors: 1, errorLog: [{ error: 'down', at: new Date() }] }));

    expect(findings.checkRunOutcome).toHaveBeenCalledWith(run, 'FAILED');
    expect(findings.checkEvent).not.toHaveBeenCalled();
  });

  it('checks a run whose feed threw as FAILED once, and still throws the feed\'s error', async () => {
    const findings = checks();
    const ledger = new ProviderSyncRunLedger(syncRunsIgnoringWrites(), undefined, findings);
    const run = createSyncRun(linked);

    await expect(ledger.executeFeedRun(run, async () => { throw new Error('provider down'); })).rejects.toThrow('provider down');

    expect(findings.checkRunOutcome).toHaveBeenCalledTimes(1);
    expect(findings.checkRunOutcome).toHaveBeenCalledWith(run, 'FAILED');
  });

  it('checks a submitted run it fails without a feed as FAILED', async () => {
    const findings = checks();
    const ledger = new ProviderSyncRunLedger(syncRunsIgnoringWrites(), undefined, findings);
    const run = createSyncRun(linked);

    await ledger.failSubmittedRun(run, new Error('Interrupted'));

    expect(findings.checkRunOutcome).toHaveBeenCalledWith(run, 'FAILED');
  });
});
