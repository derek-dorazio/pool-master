import { Prisma } from '@prisma/client';
import { Sport } from '@poolmaster/shared/domain';
import { ProviderSyncRunLedger } from '../../../packages/core-api/src/modules/ingestion/persistence/provider-sync-run-ledger';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import type {
  IngestionFeedType,
  IngestionJobRecord,
} from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import type { ProviderSyncRunRecord } from '../../../packages/core-api/src/modules/ingestion/persistence/provider-sync-run-ledger';
import type { NormalizedSyncRequest } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';

interface StoredSyncRunRow {
  id: string;
  providerId: string;
  sport: string;
  eventId: string | null;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  payloadJson: Prisma.JsonValue;
}

function createLedgerStore() {
  const rows = new Map<string, StoredSyncRunRow>();
  let nextId = 1;

  const providerSyncRun = {
    create: jest.fn(async (args: Prisma.ProviderSyncRunCreateArgs) => {
      const data = args.data as {
        providerId: string;
        sport: string;
        eventId: string | null;
        status: string;
        startedAt: Date | null;
        completedAt: Date | null;
        createdAt: Date;
        payloadJson: Prisma.JsonValue;
      };
      const row: StoredSyncRunRow = {
        id: `sync-run-${nextId}`,
        providerId: data.providerId,
        sport: data.sport,
        eventId: data.eventId,
        status: data.status,
        startedAt: data.startedAt,
        completedAt: data.completedAt,
        createdAt: data.createdAt,
        payloadJson: data.payloadJson,
      };
      nextId += 1;
      rows.set(row.id, row);
      return row;
    }),
    update: jest.fn(async (args: Prisma.ProviderSyncRunUpdateArgs) => {
      const id = String(args.where.id);
      const current = rows.get(id);
      if (!current) {
        throw new Error(`Missing sync run ${id}`);
      }
      const data = args.data as {
        status?: string;
        startedAt?: Date | null;
        completedAt?: Date | null;
        payloadJson?: Prisma.JsonValue;
      };
      const row: StoredSyncRunRow = {
        ...current,
        status: data.status ?? current.status,
        startedAt: data.startedAt ?? current.startedAt,
        completedAt: data.completedAt ?? current.completedAt,
        payloadJson: data.payloadJson ?? current.payloadJson,
      };
      rows.set(id, row);
      return row;
    }),
  };

  return {
    ledger: new ProviderSyncRunLedger({ providerSyncRun }),
    rowFor(syncRun: ProviderSyncRunRecord) {
      const row = rows.get(syncRun.id);
      if (!row) {
        throw new Error(`Missing sync run ${syncRun.id}`);
      }
      return row;
    },
  };
}

function createOrchestrator(now: Date) {
  return new SyncOrchestrator({ now: () => now });
}

function createSportRequest(input: {
  source: 'SCHEDULED' | 'MANUAL';
  feed: 'EVENTSCHEDULE';
  now: Date;
}): NormalizedSyncRequest {
  const actor = input.source === 'SCHEDULED'
    ? { type: 'SYSTEM', name: 'scheduler' } as const
    : { type: 'ROOT_ADMIN', userId: 'root-admin-1', email: 'admin@example.com' } as const;
  return createOrchestrator(input.now).normalizeRequest({
    source: input.source,
    actor,
    scope: {
      type: 'SPORT',
      sport: Sport.GOLF,
      feeds: [input.feed],
      windowPolicy: { defaultLookaheadDays: 30 },
    },
  });
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
    providerId: 'mock-provider',
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
        operation: 'mock-contest-feed.request',
        path: `/v1/test/${input.feed}`,
        capturedAt: '2026-05-30T12:00:02.000Z',
        raw: { feed: input.feed },
      }],
    },
    stats: input.stats,
    warnings: input.warnings ?? [],
  };
}

function clonePayload(payload: Prisma.JsonValue): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

function stripAllowedSourceDifferences(payload: Prisma.JsonValue): Record<string, unknown> {
  const clone = clonePayload(payload);
  delete clone.runType;
  const requestPayload = clone.requestPayload;
  if (requestPayload && typeof requestPayload === 'object' && !Array.isArray(requestPayload)) {
    delete (requestPayload as Record<string, unknown>).source;
    delete (requestPayload as Record<string, unknown>).actor;
  }
  return clone;
}

async function runAndReadPayload(input: {
  normalizedRequest: NormalizedSyncRequest;
  runType: string;
  job: IngestionJobRecord;
}): Promise<Prisma.JsonValue> {
  const { ledger, rowFor } = createLedgerStore();
  const [syncRun] = await ledger.createSubmissions({
    normalizedRequest: input.normalizedRequest,
    providerId: 'mock-provider',
    submittedAt: new Date('2026-05-30T12:00:00.000Z'),
    runType: input.runType,
  });
  if (!syncRun) {
    throw new Error('Expected a sync run to be created.');
  }

  await ledger.executeFeedRun(syncRun, async () => input.job);
  return rowFor(syncRun).payloadJson;
}

describe('sync orchestration equivalence', () => {
  it('pool-master-rop.68.2.6 persists equivalent scheduled and manual schedule diagnostics', async () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    const job = createJob({
      jobType: 'EVENT_SCHEDULE_SYNC',
      feed: 'EVENTSCHEDULE',
      recordsProcessed: 0,
      warnings: [{
        code: 'NO_PROVIDER_EVENTS',
        message: 'Provider returned no upcoming events for the requested sport/date window.',
      }],
      stats: {
        providerRecordsReturned: 0,
        eventsFetched: 0,
        eventsProcessed: 0,
      },
    });

    const scheduledPayload = await runAndReadPayload({
      normalizedRequest: createSportRequest({ source: 'SCHEDULED', feed: 'EVENTSCHEDULE', now }),
      runType: 'SCHEDULED_SPORT_SYNC',
      job,
    });
    const manualPayload = await runAndReadPayload({
      normalizedRequest: createSportRequest({ source: 'MANUAL', feed: 'EVENTSCHEDULE', now }),
      runType: 'MANUAL_SPORT_SYNC',
      job,
    });

    expect(stripAllowedSourceDifferences(scheduledPayload)).toEqual(stripAllowedSourceDifferences(manualPayload));
    expect(clonePayload(scheduledPayload)).toMatchObject({
      runType: 'SCHEDULED_SPORT_SYNC',
      requestPayload: {
        source: 'SCHEDULED',
        actor: { type: 'SYSTEM', name: 'scheduler' },
        effectiveWindow: {
          from: '2026-05-30T12:00:00.000Z',
          to: '2026-06-29T12:00:00.000Z',
          defaultedFrom: true,
          defaultedTo: true,
        },
      },
      outcome: {
        severity: 'WARNING',
        warnings: [{
          code: 'NO_PROVIDER_EVENTS',
          message: 'Provider returned no upcoming events for the requested sport/date window.',
        }],
      },
    });
    expect(clonePayload(manualPayload)).toMatchObject({
      runType: 'MANUAL_SPORT_SYNC',
      requestPayload: {
        source: 'MANUAL',
        actor: { type: 'ROOT_ADMIN', userId: 'root-admin-1', email: 'admin@example.com' },
        effectiveWindow: {
          from: '2026-05-30T12:00:00.000Z',
          to: '2026-06-29T12:00:00.000Z',
          defaultedFrom: true,
          defaultedTo: true,
        },
      },
    });
  });

  it('pool-master-rop.68.2.6 persists equivalent scheduled and manual event field diagnostics', async () => {
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
      runType: 'SCHEDULED_EVENT_SYNC',
      job,
    });
    const manualPayload = await runAndReadPayload({
      normalizedRequest: createEventRequest({ source: 'MANUAL', feed: 'EVENTPARTICIPANTS', now }),
      runType: 'MANUAL_EVENT_SYNC',
      job,
    });

    expect(stripAllowedSourceDifferences(scheduledPayload)).toEqual(stripAllowedSourceDifferences(manualPayload));
    expect(clonePayload(scheduledPayload)).toMatchObject({
      requestPayload: {
        eventId: 'event-1',
        source: 'SCHEDULED',
      },
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
    expect(clonePayload(scheduledPayload).requestPayload).not.toHaveProperty('effectiveWindow');
  });

  it('pool-master-rop.68.2.6 persists equivalent scheduled and manual failed live-score diagnostics', async () => {
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
      runType: 'SCHEDULED_EVENT_SYNC',
      job,
    });
    const manualPayload = await runAndReadPayload({
      normalizedRequest: createEventRequest({ source: 'MANUAL', feed: 'EVENTLIVESCORES', now }),
      runType: 'MANUAL_EVENT_SYNC',
      job,
    });

    expect(stripAllowedSourceDifferences(scheduledPayload)).toEqual(stripAllowedSourceDifferences(manualPayload));
    expect(clonePayload(scheduledPayload)).toMatchObject({
      outcome: {
        severity: 'ERROR',
        summary: 'Failed event live scores sync for event-1: Provider returned no live scores',
        errors: 1,
      },
      providerPayload: {
        operation: 'EVENTLIVESCORES',
        rawCaptured: true,
        raw: [{
          operation: 'mock-contest-feed.request',
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
