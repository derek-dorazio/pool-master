import { Sport } from '@poolmaster/shared/domain';
import { ProviderSyncRunLedger } from '../../../packages/core-api/src/modules/ingestion/persistence/provider-sync-run-ledger';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';

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
});
