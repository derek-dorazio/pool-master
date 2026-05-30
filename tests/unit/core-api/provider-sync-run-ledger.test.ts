import { Sport } from '@poolmaster/shared/domain';
import { ProviderSyncRunLedger } from '../../../packages/core-api/src/modules/ingestion/persistence/provider-sync-run-ledger';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import type { IngestionJobRecord } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import type { ProviderSyncRunRecord } from '../../../packages/core-api/src/modules/ingestion/persistence/provider-sync-run-ledger';

function createSyncRun(overrides: Partial<ProviderSyncRunRecord> = {}): ProviderSyncRunRecord {
  return {
    id: 'sync-run-1',
    providerId: 'mock-provider',
    sport: Sport.GOLF,
    eventId: null,
    status: 'SUBMITTED',
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-05-30T12:00:00.000Z'),
    payload: {
      requestedFeed: 'EVENTSCHEDULE',
      providerPayload: {
        operation: 'EVENTSCHEDULE',
        rawCaptured: false,
        rawTruncated: false,
      },
    },
    ...overrides,
  };
}

function createJob(overrides: Partial<IngestionJobRecord> = {}): IngestionJobRecord {
  return {
    jobType: 'EVENT_SCHEDULE_SYNC',
    providerId: 'mock-provider',
    sport: Sport.GOLF,
    status: 'COMPLETED',
    startedAt: new Date('2026-05-30T12:00:01.000Z'),
    completedAt: new Date('2026-05-30T12:00:02.000Z'),
    recordsProcessed: 3,
    errors: 0,
    errorLog: [],
    providerPayload: {
      operation: 'EVENTSCHEDULE',
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
          id: 'sport-event:mock-provider:event-1',
          entityType: 'SportEvent',
          disposition: 'UPDATED',
          providerId: 'mock-provider',
          externalId: 'event-1',
          name: 'Event 1',
          before: { status: 'SCHEDULED' },
          after: { status: 'IN_PROGRESS' },
        },
      ],
    },
    warnings: [],
    ...overrides,
  };
}

describe('ProviderSyncRunLedger', () => {
  it('pool-master-rop.68.2.4 creates scheduled provider sync run rows with normalized request diagnostics', async () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    const normalizedRequest = new SyncOrchestrator({ now: () => now }).normalizeRequest({
      source: 'SCHEDULED',
      actor: { type: 'SYSTEM', name: 'scheduler' },
      scope: {
        type: 'SPORT',
        sport: Sport.GOLF,
        feeds: ['EVENTSCHEDULE'],
        windowPolicy: { defaultLookaheadDays: 30 },
      },
    });
    const providerSyncRunCreate = jest.fn().mockImplementation(async ({ data }) => ({
      id: 'sync-run-1',
      providerId: data.providerId,
      sport: data.sport,
      eventId: data.eventId,
      status: data.status,
      startedAt: data.startedAt,
      completedAt: data.completedAt,
      createdAt: data.createdAt,
      payloadJson: data.payloadJson,
    }));
    const ledger = new ProviderSyncRunLedger({
      providerSyncRun: {
        create: providerSyncRunCreate,
        update: jest.fn(),
      },
    });

    const runs = await ledger.createSubmissions({
      normalizedRequest,
      providerId: 'mock-provider',
      submittedAt: now,
      runType: 'SCHEDULED_SPORT_SYNC',
    });

    expect(runs).toHaveLength(1);
    expect(providerSyncRunCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerId: 'mock-provider',
        sport: Sport.GOLF,
        eventId: null,
        status: 'SUBMITTED',
        createdAt: now,
        payloadJson: expect.objectContaining({
          runType: 'SCHEDULED_SPORT_SYNC',
          requestedFeeds: ['EVENTSCHEDULE'],
          requestedFeed: 'EVENTSCHEDULE',
          requestPayload: expect.objectContaining({
            sport: Sport.GOLF,
            eventId: null,
            source: 'SCHEDULED',
            actor: { type: 'SYSTEM', name: 'scheduler' },
            from: null,
            to: null,
            effectiveWindow: {
              from: '2026-05-30T12:00:00.000Z',
              to: '2026-06-29T12:00:00.000Z',
              defaultedFrom: true,
              defaultedTo: true,
            },
          }),
          providerPayload: {
            operation: 'EVENTSCHEDULE',
            rawCaptured: false,
            rawTruncated: false,
          },
          outcome: {
            severity: 'SUCCESS',
            summary: 'Submitted event schedule sync for GOLF.',
            warnings: [],
            errors: 0,
          },
        }),
      }),
    });
  });

  it('pool-master-rop.68.2.4 marks a provider sync run completed after a successful ingestion job', async () => {
    const providerSyncRunUpdate = jest.fn().mockResolvedValue({});
    const ledger = new ProviderSyncRunLedger({
      providerSyncRun: {
        create: jest.fn(),
        update: providerSyncRunUpdate,
      },
    });
    const syncRun = createSyncRun();
    const job = createJob();

    await expect(ledger.executeFeedRun(syncRun, async () => job)).resolves.toBe(job);

    expect(providerSyncRunUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: syncRun.id },
      data: expect.objectContaining({
        status: 'IN_PROGRESS',
        startedAt: expect.any(Date),
        completedAt: null,
        payloadJson: expect.objectContaining({
          detail: 'Started event schedule sync.',
          outcome: expect.objectContaining({
            severity: 'SUCCESS',
            summary: 'Started event schedule sync.',
          }),
        }),
      }),
    });
    expect(providerSyncRunUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: syncRun.id },
      data: expect.objectContaining({
        status: 'COMPLETED',
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
        payloadJson: expect.objectContaining({
          detail: 'Completed event schedule sync for GOLF (3 records).',
          jobPayload: expect.objectContaining({
            jobType: 'EVENT_SCHEDULE_SYNC',
            recordsProcessed: 3,
            errors: 0,
          }),
          providerPayload: job.providerPayload,
          writeDiagnostics: job.writeDiagnostics,
          outcome: expect.objectContaining({
            severity: 'SUCCESS',
            summary: 'Completed event schedule sync for GOLF (3 records).',
          }),
          stats: {
            events: 3,
            writeRows: 3,
            writeUnchanged: 1,
            writeCreated: 1,
            writeUpdated: 1,
            writeDeleted: 0,
          },
          recordsProcessed: 3,
          errors: 0,
        }),
      }),
    });
    const completedPayload = providerSyncRunUpdate.mock.calls[1][0].data.payloadJson;
    expect(completedPayload.writeDiagnostics).toBe(job.writeDiagnostics);
    expect(completedPayload.jobPayload).not.toHaveProperty('writeDiagnostics');
  });

  it('pool-master-rop.68.2.4 marks a provider sync run failed when the ingestion job returns FAILED', async () => {
    const providerSyncRunUpdate = jest.fn().mockResolvedValue({});
    const ledger = new ProviderSyncRunLedger({
      providerSyncRun: {
        create: jest.fn(),
        update: providerSyncRunUpdate,
      },
    });
    const syncRun = createSyncRun();
    const failedJob = createJob({
      status: 'FAILED',
      recordsProcessed: 0,
      errors: 1,
      errorLog: [{ error: 'No provider registered' }],
      warnings: [{ code: 'NO_PROVIDER', message: 'No provider registered' }],
    });

    await expect(ledger.executeFeedRun(syncRun, async () => failedJob)).resolves.toBe(failedJob);

    expect(providerSyncRunUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: syncRun.id },
      data: expect.objectContaining({
        status: 'FAILED',
        completedAt: expect.any(Date),
        payloadJson: expect.objectContaining({
          detail: 'Failed event schedule sync for GOLF: No provider registered',
          outcome: {
            severity: 'ERROR',
            summary: 'Failed event schedule sync for GOLF: No provider registered',
            warnings: [{ code: 'NO_PROVIDER', message: 'No provider registered' }],
            errors: 1,
          },
          recordsProcessed: 0,
          errors: 1,
        }),
      }),
    });
  });

  it('pool-master-rop.68.2.4 marks a provider sync run failed and rethrows when execution throws', async () => {
    const providerSyncRunUpdate = jest.fn().mockResolvedValue({});
    const ledger = new ProviderSyncRunLedger({
      providerSyncRun: {
        create: jest.fn(),
        update: providerSyncRunUpdate,
      },
    });
    const syncRun = createSyncRun();
    const executionError = new Error('provider exploded');

    await expect(ledger.executeFeedRun(syncRun, async () => {
      throw executionError;
    })).rejects.toThrow('provider exploded');

    expect(providerSyncRunUpdate).toHaveBeenCalledTimes(2);
    expect(providerSyncRunUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: syncRun.id },
      data: expect.objectContaining({
        status: 'FAILED',
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
        payloadJson: expect.objectContaining({
          detail: 'Failed event schedule sync.',
          outcome: expect.objectContaining({
            severity: 'ERROR',
            summary: 'Failed event schedule sync.',
            errors: 1,
          }),
          errors: 1,
          failurePayload: {
            error: {
              name: 'Error',
              message: 'provider exploded',
            },
          },
        }),
      }),
    });
  });

  it('pool-master-rop.68.2.4 can mark a submitted run failed without executing a job', async () => {
    const providerSyncRunUpdate = jest.fn().mockResolvedValue({});
    const ledger = new ProviderSyncRunLedger({
      providerSyncRun: {
        create: jest.fn(),
        update: providerSyncRunUpdate,
      },
    });
    const syncRun = createSyncRun();

    await ledger.failSubmittedRun(syncRun, new Error('unsupported feed'));

    expect(providerSyncRunUpdate).toHaveBeenCalledWith({
      where: { id: syncRun.id },
      data: expect.objectContaining({
        status: 'FAILED',
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
        payloadJson: expect.objectContaining({
          detail: 'Failed event schedule sync.',
          errors: 1,
          failurePayload: {
            error: {
              name: 'Error',
              message: 'unsupported feed',
            },
          },
        }),
      }),
    });
  });
});
