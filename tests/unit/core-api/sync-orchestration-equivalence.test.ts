/**
 * pool-master-rop.68.2.6 — scheduled/manual sync equivalence coverage.
 *
 * These tests prove that equivalent scheduled and manual sync requests persist
 * the same provider_sync_runs outcome and diagnostics: who asked is the run's trigger, not part
 * of what it records.
 */

import { JobTrigger, Sport, type ProviderSyncRun } from '@poolmaster/shared/domain';
import type { ProviderSyncRunRepository } from '@poolmaster/shared/db';
import { ProviderSyncRunLedger } from '../../../packages/core-api/src/modules/ingestion/persistence/provider-sync-run-ledger';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import type {
  IngestionFeedType,
  IngestionJobRecord,
} from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import type { NormalizedSyncRequest } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import type { StoredSyncRunDetails } from '../../support/sync-run-payload';
import { TEST_PROVIDER_ROWS } from '../../support/balldontlie-provider-rows';

/** A run's outcome and its detailed diagnostics, read together. */
type StoredSyncRun = Pick<ProviderSyncRun, 'summary' | 'stats' | 'changedCount' | 'errorCount'> & StoredSyncRunDetails;

function createLedgerStore() {
  const rows = new Map<string, ProviderSyncRun>();
  const details = new Map<string, Record<string, unknown>>();
  let nextId = 1;

  const syncRuns: ProviderSyncRunRepository = {
    create: jest.fn(async (input) => {
      const { providerCode, ...rest } = input;
      const row: ProviderSyncRun = {
        ...rest,
        providerId: TEST_PROVIDER_ROWS[providerCode].id,
        providerName: TEST_PROVIDER_ROWS[providerCode].name,
        eventId: null,
        id: `sync-run-${nextId}`,
        createdAt: input.createdAt ?? new Date(),
      };
      nextId += 1;
      rows.set(row.id, row);
      return row;
    }),
    update: jest.fn(async (id, update) => {
      const current = rows.get(id);
      if (!current) {
        throw new Error(`Missing sync run ${id}`);
      }
      rows.set(id, {
        ...current,
        status: update.status,
        startedAt: update.startedAt ?? current.startedAt,
        completedAt: update.completedAt ?? current.completedAt,
        summary: update.summary,
        stats: update.stats,
        changedCount: update.changedCount,
        errorCount: update.errorCount,
      });
      if (update.details) details.set(id, update.details);
    }),
    findAll: jest.fn(),
    findById: jest.fn(), createWithJob: jest.fn(), findManyByIds: jest.fn(), findByBackgroundJobIds: jest.fn(), clearDetailsBatchSubmittedBefore: jest.fn(), deleteBatchSubmittedBefore: jest.fn(), countFinishedByProvider: jest.fn(),
  };

  return {
    ledger: new ProviderSyncRunLedger(syncRuns),
    rowFor(syncRun: ProviderSyncRun) {
      const row = rows.get(syncRun.id);
      if (!row) {
        throw new Error(`Missing sync run ${syncRun.id}`);
      }
      return row;
    },
    detailsFor(syncRun: ProviderSyncRun) {
      return details.get(syncRun.id) ?? {};
    },
  };
}

function createOrchestrator(now: Date) {
  return new SyncOrchestrator({ now: () => now });
}

function createEventRequest(input: {
  source: 'SCHEDULED' | 'MANUAL';
  feed: 'EVENTPARTICIPANTS' | 'EVENTLIVESCORES';
  now: Date;
}): NormalizedSyncRequest {
  const actor = input.source === 'SCHEDULED'
    ? { type: 'SYSTEM', name: 'scheduler' } as const
    : { type: 'ROOT_ADMIN', userId: 'root-admin-1', email: 'admin@example.com' } as const;
  return createOrchestrator(input.now).normalizeRequest({
    source: input.source,
    actor,
    scope: {
      type: 'EVENT',
      sport: Sport.GOLF,
      providerId: 'balldontlie',
      eventId: 'event-1',
      feeds: [input.feed],
    },
  });
}

function createJob(input: {
  jobType: IngestionJobRecord['jobType'];
  feed: IngestionFeedType;
  eventId?: string;
  status?: IngestionJobRecord['status'];
  recordsProcessed: number;
  errors?: number;
  warnings?: IngestionJobRecord['warnings'];
  stats?: Record<string, number>;
}): IngestionJobRecord {
  return {
    jobType: input.jobType,
    providerId: 'balldontlie',
    sport: Sport.GOLF,
    eventExternalId: input.eventId,
    status: input.status ?? 'COMPLETED',
    startedAt: new Date('2026-05-30T12:00:01.000Z'),
    completedAt: new Date('2026-05-30T12:00:02.000Z'),
    recordsProcessed: input.recordsProcessed,
    errors: input.errors ?? 0,
    errorLog: input.status === 'FAILED'
      ? [{ error: 'Provider returned no live scores', at: new Date('2026-05-30T12:00:02.000Z') }]
      : [],
    providerPayload: {
      operation: input.feed,
      rawCaptured: true,
      rawTruncated: false,
      raw: [{
        operation: 'balldontlie.request',
        path: `/v1/test/${input.feed}`,
        capturedAt: '2026-05-30T12:00:02.000Z',
        raw: { feed: input.feed },
      }],
    },
    stats: input.stats,
    warnings: input.warnings ?? [],
  };
}

function clonePayload(payload: unknown): StoredSyncRun {
  return JSON.parse(JSON.stringify(payload)) as StoredSyncRun;
}

async function runAndReadPayload(input: {
  normalizedRequest: NormalizedSyncRequest;
  job: IngestionJobRecord;
}): Promise<unknown> {
  const { ledger, rowFor, detailsFor } = createLedgerStore();
  const syncRuns = await ledger.createSubmissions({
    normalizedRequest: input.normalizedRequest,
    providerId: 'balldontlie',
    submittedAt: new Date('2026-05-30T12:00:00.000Z'),
    trigger: JobTrigger.SCHEDULE,
  });
  const syncRun = syncRuns.at(0);
  if (!syncRun) {
    throw new Error('Expected a sync run to be created.');
  }

  await ledger.executeFeedRun(syncRun, async () => input.job);
  const { summary, stats, changedCount, errorCount } = rowFor(syncRun);
  return { summary, stats, changedCount, errorCount, ...detailsFor(syncRun) };
}

describe('sync orchestration equivalence', () => {
  it('records the same outcome and diagnostics for equivalent scheduled and manual field syncs', async () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    const job = createJob({
      jobType: 'EVENT_PARTICIPANTS_SYNC',
      feed: 'EVENTPARTICIPANTS',
      eventId: 'event-1',
      recordsProcessed: 0,
      warnings: [{
        code: 'NO_PROVIDER_PARTICIPANTS',
        message: 'Provider returned event details with no participants.',
      }],
      stats: {
        providerRecordsReturned: 0,
        eventsHydrated: 1,
        participantsReturned: 0,
      },
    });

    const scheduledPayload = await runAndReadPayload({
      normalizedRequest: createEventRequest({ source: 'SCHEDULED', feed: 'EVENTPARTICIPANTS', now }),
      job,
    });
    const manualPayload = await runAndReadPayload({
      normalizedRequest: createEventRequest({ source: 'MANUAL', feed: 'EVENTPARTICIPANTS', now }),
      job,
    });

    expect(clonePayload(scheduledPayload)).toEqual(clonePayload(manualPayload));
    expect(clonePayload(scheduledPayload)).toMatchObject({
      providerPayload: {
        operation: 'EVENTPARTICIPANTS',
        rawCaptured: true,
      },
      stats: {
        providerRecordsReturned: 0,
        eventsHydrated: 1,
        participantsReturned: 0,
      },
    });
  });

  it('records the same failed outcome and diagnostics for equivalent scheduled and manual live-score syncs', async () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    const job = createJob({
      jobType: 'EVENT_LIVE_SCORES_SYNC',
      feed: 'EVENTLIVESCORES',
      eventId: 'event-1',
      status: 'FAILED',
      recordsProcessed: 0,
      errors: 1,
      stats: {
        providerRecordsReturned: 0,
      },
    });

    const scheduledPayload = await runAndReadPayload({
      normalizedRequest: createEventRequest({ source: 'SCHEDULED', feed: 'EVENTLIVESCORES', now }),
      job,
    });
    const manualPayload = await runAndReadPayload({
      normalizedRequest: createEventRequest({ source: 'MANUAL', feed: 'EVENTLIVESCORES', now }),
      job,
    });

    expect(clonePayload(scheduledPayload)).toEqual(clonePayload(manualPayload));
    expect(clonePayload(scheduledPayload)).toMatchObject({
      summary: 'Failed Live scores and results sync for event-1: Provider returned no live scores',
      changedCount: null,
      errorCount: 1,
      providerPayload: {
        operation: 'EVENTLIVESCORES',
        rawCaptured: true,
        raw: [{
          operation: 'balldontlie.request',
          path: '/v1/test/EVENTLIVESCORES',
        }],
      },
      jobPayload: {
        jobType: 'EVENT_LIVE_SCORES_SYNC',
        eventExternalId: 'event-1',
        status: 'FAILED',
        recordsProcessed: 0,
        errors: 1,
      },
    });
  });
});
