import { Sport } from '@poolmaster/shared/domain';
import {
  EventSyncRequestSchema,
  IngestionFeedTypeSchema,
  type IngestionFeedType,
} from '@poolmaster/shared/dto/ingestion.dto';
import * as ingestionDtos from '@poolmaster/shared/dto/ingestion.dto';
import * as syncOrchestratorModule from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import {
  EVENT_SYNC_FEEDS,
  SyncOrchestrator,
  SyncRequestValidationError,
  normalizeSyncRequest,
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
      workflowContext: { requestId: 'manual-123' },
    }, { now: () => new Date('2026-05-30T12:00:00.000Z') });

    expect(normalized.source).toBe('MANUAL');
    expect(normalized.actor).toEqual(rootAdminActor);
    expect(normalized.workflowContext).toEqual({ requestId: 'manual-123' });
    expect(normalized.normalizedAt).toEqual(new Date('2026-05-30T12:00:00.000Z'));
    expect(normalized.scope).toEqual({
      type: 'EVENT',
      sport: Sport.GOLF,
      eventId: 'golf-open-championship-2026',
      feeds: ['EVENTPARTICIPANTS', 'EVENTLIVESCORES'],
      mockEventState: 'live',
      providerOptions: { mockEventState: 'live' },
    });
  });

  it('normalizes a scheduled event sync with the system actor and no provider options', () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    const orchestrator = new SyncOrchestrator({ now: () => now });

    const normalized = orchestrator.normalizeRequest({
      source: 'SCHEDULED',
      actor: schedulerActor,
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        eventId: 'golf-masters-2026',
        feeds: ['EVENTLIVESCORES'],
      },
    });

    expect(normalized).toEqual({
      source: 'SCHEDULED',
      actor: schedulerActor,
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        eventId: 'golf-masters-2026',
        feeds: ['EVENTLIVESCORES'],
        mockEventState: undefined,
        providerOptions: undefined,
      },
      workflowContext: {},
      normalizedAt: now,
    });
  });

  it('pool-master-rop.68.2.1: rejects source and actor mismatches', () => {
    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({
      source: 'MANUAL',
      actor: schedulerActor,
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        eventId: 'golf-masters-2026',
        feeds: ['EVENTLIVESCORES'],
      },
    }), 'MANUAL_REQUIRES_ROOT_ADMIN_ACTOR');

    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({
      source: 'SCHEDULED',
      actor: rootAdminActor,
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        eventId: 'golf-masters-2026',
        feeds: ['EVENTLIVESCORES'],
      },
    }), 'SCHEDULED_REQUIRES_SYSTEM_ACTOR');
  });

  it('rejects an empty feed list and a feed the event scope does not run', () => {
    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({
      source: 'MANUAL',
      actor: rootAdminActor,
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        eventId: 'golf-open-championship-2026',
        feeds: [],
      },
    }), 'EMPTY_FEED_LIST');

    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({
      source: 'MANUAL',
      actor: rootAdminActor,
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        eventId: 'golf-open-championship-2026',
        // @ts-expect-error -- EVENTSCHEDULE is no longer a member of IngestionFeedType.
        feeds: ['EVENTSCHEDULE'],
      },
    }), 'INVALID_EVENT_FEED');
  });

  it.each(['PARTICIPANTRANKINGS', 'EVENTSCHEDULE', 'EVENTRESULTS'])(
    '#125/#126: %s is retired as a feed type — the contract, the event sync request and the orchestrator all refuse it',
    (retired) => {
      expect(IngestionFeedTypeSchema.safeParse(retired).success).toBe(false);
      expect(IngestionFeedTypeSchema.options).not.toContain(retired);
      expect(EventSyncRequestSchema.safeParse({ feeds: [retired] }).success).toBe(false);
      expect(EVENT_SYNC_FEEDS).not.toContain(retired);
      expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({
        source: 'MANUAL',
        actor: rootAdminActor,
        scope: {
          type: 'EVENT',
          sport: Sport.GOLF,
          eventId: 'golf-masters-2026',
          feeds: [retired as IngestionFeedType],
        },
      }), 'INVALID_EVENT_FEED');
    },
  );

  it('#126: there is no sport-level sync — every feed is event-scoped and no sport sync request exists', () => {
    expect(IngestionFeedTypeSchema.options).toEqual(['EVENTPARTICIPANTS', 'EVENTLIVESCORES']);
    expect(EVENT_SYNC_FEEDS).toEqual(['EVENTPARTICIPANTS', 'EVENTLIVESCORES']);
    expect(Reflect.get(ingestionDtos, 'SportSyncRequestSchema')).toBeUndefined();
    expect(Reflect.get(syncOrchestratorModule, 'SPORT_SYNC_FEEDS')).toBeUndefined();
    expect(Reflect.get(syncOrchestratorModule, 'resolveSportSyncWindowPolicy')).toBeUndefined();
  });

  it('pool-master-rop.68.2.1: rejects invalid event IDs and scheduled mock overrides', () => {
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
