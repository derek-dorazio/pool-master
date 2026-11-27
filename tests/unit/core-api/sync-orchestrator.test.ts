import { Sport } from '@poolmaster/shared/domain';
import { EventSyncKindSchema } from '@poolmaster/shared/dto/common.dto';
import { EventSyncRequestSchema } from '@poolmaster/shared/dto/ingestion.dto';
import * as ingestionDtos from '@poolmaster/shared/dto/ingestion.dto';
import * as syncOrchestratorModule from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import {
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

  it('pool-master-rop.68.2.1: normalizes a manual event sync: trims the event id and drops repeated sync kinds', () => {
    const normalized = normalizeSyncRequest({
      source: 'MANUAL',
      actor: rootAdminActor,
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        providerId: 'mock-provider',
        eventId: '  golf-open-championship-2026  ',
        kinds: ['FIELD', 'SCORES', 'FIELD'],
      },
    }, { now: () => new Date('2026-05-30T12:00:00.000Z') });

    expect(normalized.source).toBe('MANUAL');
    expect(normalized.actor).toEqual(rootAdminActor);
    expect(normalized.normalizedAt).toEqual(new Date('2026-05-30T12:00:00.000Z'));
    expect(normalized.scope).toEqual({
      type: 'EVENT',
      sport: Sport.GOLF,
      providerId: 'mock-provider',
      eventId: 'golf-open-championship-2026',
      kinds: ['FIELD', 'SCORES'],
    });
  });

  it('normalizes a scheduled event sync with the system actor', () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    const orchestrator = new SyncOrchestrator({ now: () => now });

    const normalized = orchestrator.normalizeRequest({
      source: 'SCHEDULED',
      actor: schedulerActor,
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        providerId: 'mock-provider',
        eventId: 'golf-masters-2026',
        kinds: ['SCORES'],
      },
    });

    expect(normalized).toEqual({
      source: 'SCHEDULED',
      actor: schedulerActor,
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        providerId: 'mock-provider',
        eventId: 'golf-masters-2026',
        kinds: ['SCORES'],
      },
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
        providerId: 'mock-provider',
        eventId: 'golf-masters-2026',
        kinds: ['SCORES'],
      },
    }), 'MANUAL_REQUIRES_ROOT_ADMIN_ACTOR');

    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({
      source: 'SCHEDULED',
      actor: rootAdminActor,
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        providerId: 'mock-provider',
        eventId: 'golf-masters-2026',
        kinds: ['SCORES'],
      },
    }), 'SCHEDULED_REQUIRES_SYSTEM_ACTOR');
  });

  it('accepts a webhook sync only from the webhook receiver, refusing one claimed by the scheduler or a root admin', () => {
    const webhookScope = {
      type: 'EVENT' as const,
      sport: Sport.GOLF,
      providerId: 'balldontlie',
      eventId: '1133',
      kinds: ['SCORES' as const],
    };

    expect(normalizeSyncRequest({ source: 'WEBHOOK', actor: { type: 'SYSTEM', name: 'webhook' }, scope: webhookScope }).source)
      .toBe('WEBHOOK');
    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({ source: 'WEBHOOK', actor: schedulerActor, scope: webhookScope }),
      'WEBHOOK_REQUIRES_WEBHOOK_ACTOR');
    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({ source: 'WEBHOOK', actor: rootAdminActor, scope: webhookScope }),
      'WEBHOOK_REQUIRES_WEBHOOK_ACTOR');
  });

  it('rejects a sync request with no sync kind', () => {
    expectSyncRequestValidationErrorCode(() => normalizeSyncRequest({
      source: 'MANUAL',
      actor: rootAdminActor,
      scope: {
        type: 'EVENT',
        sport: Sport.GOLF,
        providerId: 'mock-provider',
        eventId: 'golf-open-championship-2026',
        kinds: [],
      },
    }), 'EMPTY_KIND_LIST');
  });

  it.each(['EVENTS', 'EVENTPARTICIPANTS', 'EVENTLIVESCORES', 'EVENTSCHEDULE'])(
    'the event sync request refuses %s: an event syncs its FIELD or its SCORES, never a league\'s EVENTS or an old feed name',
    (refused) => {
      expect(EventSyncRequestSchema.safeParse({ kinds: [refused] }).success).toBe(false);
    },
  );

  it('the event sync request takes sync kinds, not the old feeds list', () => {
    expect(EventSyncRequestSchema.safeParse({ kinds: ['FIELD', 'SCORES'] }).success).toBe(true);
    expect(EventSyncRequestSchema.safeParse({ feeds: ['EVENTPARTICIPANTS'] }).success).toBe(false);
  });

  it('#126: there is no sport-level sync — an event syncs its FIELD and SCORES, and a league\'s EVENTS is no event sync', () => {
    expect(EventSyncKindSchema.options).toEqual(['FIELD', 'SCORES']);
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
        providerId: 'mock-provider',
        eventId: '   ',
        kinds: ['SCORES'],
      },
    }), 'INVALID_EVENT_ID');
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
