import { expect } from '@jest/globals';
import { Sport, type ProviderSyncRun } from '@poolmaster/shared/domain';
import { ProviderSyncRunLedger } from '../../../packages/core-api/src/modules/ingestion/persistence/provider-sync-run-ledger';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import type { IngestionJobRecord } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import type { ProviderSyncRunRepository } from '@poolmaster/shared/db';
import { mockFn } from '../../support/mock-fn';

function createSyncRun(overrides: Partial<ProviderSyncRun> = {}): ProviderSyncRun {
  return {
    id: 'sync-run-1',
    providerId: 'mock-provider',
    sport: Sport.GOLF,
    eventId: 'event-1',
    status: 'SUBMITTED',
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-05-30T12:00:00.000Z'),
    payload: {
      requestedFeed: 'EVENTPARTICIPANTS',
      providerPayload: {
        operation: 'EVENTPARTICIPANTS',
        rawCaptured: false,
        rawTruncated: false,
      },
    },
    ...overrides,
  };
}

function createJob(overrides: Partial<IngestionJobRecord> = {}): IngestionJobRecord {
  return {
    jobType: 'EVENT_PARTICIPANTS_SYNC',
    providerId: 'mock-provider',
    sport: Sport.GOLF,
    eventExternalId: 'event-1',
    status: 'COMPLETED',
    startedAt: new Date('2026-05-30T12:00:01.000Z'),
    completedAt: new Date('2026-05-30T12:00:02.000Z'),
    recordsProcessed: 3,
    errors: 0,
    errorLog: [],
    providerPayload: {
      operation: 'EVENTPARTICIPANTS',
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
        type: 'EVENT',
        sport: Sport.GOLF,
        eventId: 'event-1',
        feeds: ['EVENTPARTICIPANTS'],
      },
    });
    const providerSyncRunCreate = mockFn<ProviderSyncRunRepository['create']>(async (input) => ({
      ...createSyncRun(),
      ...input,
    }));
    const ledger = new ProviderSyncRunLedger({ create: providerSyncRunCreate, update: jest.fn(), findAll: jest.fn() });

    const runs = await ledger.createSubmissions({
      normalizedRequest,
      providerId: 'mock-provider',
      submittedAt: now,
      runType: 'SCHEDULED_EVENT_SYNC',
    });

    expect(runs).toHaveLength(1);
    expect(providerSyncRunCreate).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'mock-provider',
      sport: Sport.GOLF,
      eventId: 'event-1',
      status: 'SUBMITTED',
      createdAt: now,
      payload: expect.objectContaining({
        runType: 'SCHEDULED_EVENT_SYNC',
        requestedFeeds: ['EVENTPARTICIPANTS'],
        requestedFeed: 'EVENTPARTICIPANTS',
        requestPayload: {
          sport: Sport.GOLF,
          eventId: 'event-1',
          source: 'SCHEDULED',
          actor: { type: 'SYSTEM', name: 'scheduler' },
          workflowContext: {},
          mockEventState: null,
          normalizedAt: '2026-05-30T12:00:00.000Z',
        },
        providerPayload: {
          operation: 'EVENTPARTICIPANTS',
          rawCaptured: false,
          rawTruncated: false,
        },
        outcome: {
          severity: 'SUCCESS',
          summary: 'Submitted event participants sync for event-1.',
          warnings: [],
          errors: 0,
        },
      }),
    }));
  });

  it('pool-master-rop.68.2.4 marks a provider sync run completed after a successful ingestion job', async () => {
    const providerSyncRunUpdate = mockFn<ProviderSyncRunRepository['update']>(async () => undefined);
    const ledger = new ProviderSyncRunLedger({ create: jest.fn(), update: providerSyncRunUpdate, findAll: jest.fn() });
    const syncRun = createSyncRun();
    const job = createJob();

    await expect(ledger.executeFeedRun(syncRun, async () => job)).resolves.toBe(job);

    expect(providerSyncRunUpdate).toHaveBeenNthCalledWith(1, syncRun.id, expect.objectContaining({
      status: 'IN_PROGRESS',
      startedAt: expect.any(Date),
      completedAt: null,
      payload: expect.objectContaining({
        detail: 'Started event participants sync.',
        outcome: expect.objectContaining({
          severity: 'SUCCESS',
          summary: 'Started event participants sync.',
        }),
      }),
    }));
    expect(providerSyncRunUpdate).toHaveBeenNthCalledWith(2, syncRun.id, expect.objectContaining({
      status: 'COMPLETED',
      startedAt: expect.any(Date),
      completedAt: expect.any(Date),
      payload: expect.objectContaining({
        detail: 'Completed event participants sync for event-1 (3 records).',
        jobPayload: expect.objectContaining({
          jobType: 'EVENT_PARTICIPANTS_SYNC',
          recordsProcessed: 3,
          errors: 0,
        }),
        providerPayload: job.providerPayload,
        writeDiagnostics: job.writeDiagnostics,
        outcome: expect.objectContaining({
          severity: 'SUCCESS',
          summary: 'Completed event participants sync for event-1 (3 records).',
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
    }));
    const completedPayload = providerSyncRunUpdate.mock.calls[1][1].payload;
    expect(completedPayload.writeDiagnostics).toBe(job.writeDiagnostics);
    expect(completedPayload.jobPayload).not.toHaveProperty('writeDiagnostics');
  });

  it('pool-master-rop.68.2.4 marks a provider sync run failed when the ingestion job returns FAILED', async () => {
    const providerSyncRunUpdate = mockFn<ProviderSyncRunRepository['update']>(async () => undefined);
    const ledger = new ProviderSyncRunLedger({ create: jest.fn(), update: providerSyncRunUpdate, findAll: jest.fn() });
    const syncRun = createSyncRun();
    const failedJob = createJob({
      status: 'FAILED',
      recordsProcessed: 0,
      errors: 1,
      errorLog: [{ error: 'No provider registered', at: new Date('2026-05-30T12:00:02.000Z') }],
      warnings: [{ code: 'NO_PROVIDER', message: 'No provider registered' }],
    });

    await expect(ledger.executeFeedRun(syncRun, async () => failedJob)).resolves.toBe(failedJob);

    expect(providerSyncRunUpdate).toHaveBeenNthCalledWith(2, syncRun.id, expect.objectContaining({
      status: 'FAILED',
      completedAt: expect.any(Date),
      payload: expect.objectContaining({
        detail: 'Failed event participants sync for event-1: No provider registered',
        outcome: {
          severity: 'ERROR',
          summary: 'Failed event participants sync for event-1: No provider registered',
          warnings: [{ code: 'NO_PROVIDER', message: 'No provider registered' }],
          errors: 1,
        },
        recordsProcessed: 0,
        errors: 1,
      }),
    }));
  });

  it('pool-master-rop.68.2.4 marks a provider sync run failed and rethrows when execution throws', async () => {
    const providerSyncRunUpdate = mockFn<ProviderSyncRunRepository['update']>(async () => undefined);
    const ledger = new ProviderSyncRunLedger({ create: jest.fn(), update: providerSyncRunUpdate, findAll: jest.fn() });
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
      payload: expect.objectContaining({
        detail: 'Failed event participants sync.',
        outcome: expect.objectContaining({
          severity: 'ERROR',
          summary: 'Failed event participants sync.',
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
    }));
  });

  it('pool-master-rop.68.2.4 can mark a submitted run failed without executing a job', async () => {
    const providerSyncRunUpdate = mockFn<ProviderSyncRunRepository['update']>(async () => undefined);
    const ledger = new ProviderSyncRunLedger({ create: jest.fn(), update: providerSyncRunUpdate, findAll: jest.fn() });
    const syncRun = createSyncRun();

    await ledger.failSubmittedRun(syncRun, new Error('unsupported feed'));

    expect(providerSyncRunUpdate).toHaveBeenCalledWith(syncRun.id, expect.objectContaining({
      status: 'FAILED',
      startedAt: expect.any(Date),
      completedAt: expect.any(Date),
      payload: expect.objectContaining({
        detail: 'Failed event participants sync.',
        errors: 1,
        failurePayload: {
          error: {
            name: 'Error',
            message: 'unsupported feed',
          },
        },
      }),
    }));
  });
});
