import { Sport } from '@poolmaster/shared/domain';
import {
  SyncOrchestrator,
  SyncRequestValidationError,
  normalizeSyncRequest,
  resolveSportSyncWindowPolicy,
} from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';

describe('SyncOrchestrator request model', () => {
  const rootAdminActor = {
    type: 'ROOT_ADMIN',
    userId: 'root-admin-1',
    email: 'root@example.com',
  } as const;

  const schedulerActor = {
    type: 'SYSTEM',
    name: 'scheduler',
  } as const;

  it('pool-master-rop.68.2.1: normalizes manual sport sync actor, feeds, and effective window', () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    const requestedFrom = new Date('2026-06-01T00:00:00.000Z');

    const normalized = normalizeSyncRequest({
      source: 'MANUAL',
      actor: rootAdminActor,
      scope: {
        type: 'SPORT',
        sport: Sport.GOLF,
        feeds: ['EVENTSCHEDULE', 'EVENTSCHEDULE', 'PARTICIPANTRANKINGS'],
        window: { from: requestedFrom },
      },
      workflowContext: { requestId: 'manual-123' },
    }, { now: () => now });

    expect(normalized.source).toBe('MANUAL');
    expect(normalized.actor).toEqual(rootAdminActor);
    expect(normalized.workflowContext).toEqual({ requestId: 'manual-123' });
    expect(normalized.normalizedAt).toEqual(now);
    expect(normalized.scope).toMatchObject({
      type: 'SPORT',
      sport: Sport.GOLF,
      feeds: ['EVENTSCHEDULE', 'PARTICIPANTRANKINGS'],
      requestedWindow: { from: requestedFrom },
      effectiveWindow: {
        from: requestedFrom,
        to: new Date('2026-06-15T00:00:00.000Z'),
        defaultedFrom: false,
        defaultedTo: true,
      },
    });
  });

  it('pool-master-rop.68.2.1: normalizes scheduled sport sync with system actor and default window', () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    const orchestrator = new SyncOrchestrator({ now: () => now });

    const normalized = orchestrator.normalizeRequest({
      source: 'SCHEDULED',
      actor: schedulerActor,
      scope: {
        type: 'SPORT',
        sport: Sport.GOLF,
        feeds: ['EVENTSCHEDULE'],
      },
    });

    expect(normalized.scope).toMatchObject({
      type: 'SPORT',
      sport: Sport.GOLF,
      feeds: ['EVENTSCHEDULE'],
      requestedWindow: {},
      effectiveWindow: {
        from: now,
        to: new Date('2026-06-13T12:00:00.000Z'),
        defaultedFrom: true,
        defaultedTo: true,
      },
    });
  });

  it('pool-master-rop.68.2.5: resolves the same configured sport window for scheduled and manual omitted-window sync', () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    const config = {
      scheduledSports: [Sport.GOLF],
      healthCheck: { enabled: true, intervalMinutes: 5 },
      eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 45 },
      eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 14 },
      participantRankings: { enabled: true, intervalMinutes: 1440 },
      eventLiveScores: { enabled: true, intervalSeconds: 30 },
      eventResults: { enabled: true, intervalMinutes: 30 },
      perSportOverrides: {},
    };
    const windowPolicy = resolveSportSyncWindowPolicy({
      feeds: ['EVENTSCHEDULE'],
      config,
    });

    const scheduled = normalizeSyncRequest({
      source: 'SCHEDULED',
      actor: schedulerActor,
      scope: {
        type: 'SPORT',
        sport: Sport.GOLF,
        feeds: ['EVENTSCHEDULE'],
        windowPolicy,
      },
    }, { now: () => now });
    const manual = normalizeSyncRequest({
      source: 'MANUAL',
      actor: rootAdminActor,
      scope: {
        type: 'SPORT',
        sport: Sport.GOLF,
        feeds: ['EVENTSCHEDULE'],
        windowPolicy,
      },
    }, { now: () => now });

    expect(scheduled.scope).toMatchObject({
      type: 'SPORT',
      effectiveWindow: {
        from: now,
        to: new Date('2026-07-14T12:00:00.000Z'),
        defaultedFrom: true,
        defaultedTo: true,
      },
    });
    expect(manual.scope).toEqual(scheduled.scope);
  });

  it('pool-master-rop.68.2.5: leaves windowless sport feeds on the default sync window policy', () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    const windowPolicy = resolveSportSyncWindowPolicy({
      feeds: ['PARTICIPANTRANKINGS'],
    });

    const normalized = normalizeSyncRequest({
      source: 'MANUAL',
      actor: rootAdminActor,
      scope: {
        type: 'SPORT',
        sport: Sport.GOLF,
        feeds: ['PARTICIPANTRANKINGS'],
        windowPolicy,
      },
    }, { now: () => now });

    expect(windowPolicy).toEqual({});
    expect(normalized.scope).toMatchObject({
      type: 'SPORT',
      effectiveWindow: {
        from: now,
        to: new Date('2026-06-13T12:00:00.000Z'),
        defaultedFrom: true,
        defaultedTo: true,
      },
    });
  });

  it('pool-master-rop.68.2.1: normalizes manual event sync mock override into provider options', () => {
    const normalized = normalizeSyncRequest({
      source: 'MANUAL',
      actor: rootAdminActor,
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        eventId: '  golf-open-championship-2026  ',
        feeds: ['EVENTPARTICIPANTS', 'EVENTLIVESCORES', 'EVENTPARTICIPANTS'],
        mockEventState: 'live',
      },
    }, { now: () => new Date('2026-05-30T12:00:00.000Z') });

    expect(normalized.scope).toEqual({
      type: 'EVENT',
      sport: Sport.GOLF,
      eventId: 'golf-open-championship-2026',
      feeds: ['EVENTPARTICIPANTS', 'EVENTLIVESCORES'],
      mockEventState: 'live',
      providerOptions: { mockEventState: 'live' },
    });
  });

  it('pool-master-rop.68.2.1: rejects source and actor mismatches', () => {
    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({
      source: 'MANUAL',
      actor: schedulerActor,
      scope: {
        type: 'SPORT',
        sport: Sport.GOLF,
        feeds: ['EVENTSCHEDULE'],
      },
    }), 'MANUAL_REQUIRES_ROOT_ADMIN_ACTOR');

    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({
      source: 'SCHEDULED',
      actor: rootAdminActor,
      scope: {
        type: 'SPORT',
        sport: Sport.GOLF,
        feeds: ['EVENTSCHEDULE'],
      },
    }), 'SCHEDULED_REQUIRES_SYSTEM_ACTOR');
  });

  it('pool-master-rop.68.2.1: rejects feeds outside the selected sync scope', () => {
    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({
      source: 'MANUAL',
      actor: rootAdminActor,
      scope: {
        type: 'SPORT',
        sport: Sport.GOLF,
        feeds: [],
      },
    }), 'EMPTY_FEED_LIST');

    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({
      source: 'MANUAL',
      actor: rootAdminActor,
      scope: {
        type: 'SPORT',
        sport: Sport.GOLF,
        feeds: ['EVENTPARTICIPANTS'],
      },
    }), 'INVALID_SPORT_FEED');

    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({
      source: 'MANUAL',
      actor: rootAdminActor,
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        eventId: 'golf-open-championship-2026',
        feeds: ['EVENTSCHEDULE'],
      },
    }), 'INVALID_EVENT_FEED');
  });

  it('pool-master-rop.68.2.1: rejects invalid event IDs, windows, and scheduled mock overrides', () => {
    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({
      source: 'MANUAL',
      actor: rootAdminActor,
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        eventId: '   ',
        feeds: ['EVENTLIVESCORES'],
      },
    }), 'INVALID_EVENT_ID');

    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({
      source: 'MANUAL',
      actor: rootAdminActor,
      scope: {
        type: 'SPORT',
        sport: Sport.GOLF,
        feeds: ['EVENTSCHEDULE'],
        window: {
          from: new Date('2026-06-15T00:00:00.000Z'),
          to: new Date('2026-06-01T00:00:00.000Z'),
        },
      },
    }), 'INVALID_SYNC_WINDOW');

    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({
      source: 'SCHEDULED',
      actor: schedulerActor,
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        eventId: 'golf-open-championship-2026',
        feeds: ['EVENTLIVESCORES'],
        mockEventState: 'live',
      },
    }), 'MOCK_EVENT_STATE_REQUIRES_MANUAL_SOURCE');
  });
});

function expectSyncRequestValidationErrorCode(
  received: () => unknown,
  expectedCode: SyncRequestValidationError['code'],
): void {
  try {
    received();
  } catch (error) {
    expect(error).toBeInstanceOf(SyncRequestValidationError);
    expect((error as SyncRequestValidationError).code).toBe(expectedCode);
    return;
  }

  throw new Error(`Expected SyncRequestValidationError ${expectedCode} to be thrown.`);
}
