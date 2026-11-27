import { JobErrorType, type ProviderSyncKind, type Sport } from '@poolmaster/shared/domain';
import { EventSyncKindSchema, type EventSyncKind, type SyncRequestSource } from '@poolmaster/shared/dto';

/**
 * Internal sync-intent boundary for pool-master-rop.68.2.
 *
 * This boundary owns the canonical sync request shape. Scheduled jobs route
 * through it as of pool-master-rop.68.2.2; manual root-admin wiring is tracked
 * by pool-master-rop.68.2.3.
 */

export type { EventSyncKind } from '@poolmaster/shared/dto';

/** Whether a run of this kind syncs one event (FIELD, SCORES), rather than a league's EVENTS. */
export function isEventSyncKind(kind: ProviderSyncKind): kind is EventSyncKind {
  return EventSyncKindSchema.options.some((eventKind) => eventKind === kind);
}

export type { SyncRequestSource } from '@poolmaster/shared/dto';

export interface SystemSyncActor {
  type: 'SYSTEM';
  /** The scheduler for a SCHEDULED sync, the provider webhook receiver for a WEBHOOK one (#1498). */
  name: 'scheduler' | 'webhook';
}

export interface RootAdminSyncActor {
  type: 'ROOT_ADMIN';
  userId: string;
  email: string;
}

export type SyncActorContext = SystemSyncActor | RootAdminSyncActor;

export interface EventSyncScopeInput {
  type: 'EVENT';
  sport: Sport;
  /** The provider the event is linked to; its sync reads that provider and no other (#1495). */
  providerId: string;
  eventId: string;
  kinds: readonly EventSyncKind[];
}

export type SyncScopeInput = EventSyncScopeInput;

export interface SyncOrchestratorRequest {
  source: SyncRequestSource;
  actor: SyncActorContext;
  scope: SyncScopeInput;
}

export interface NormalizedEventSyncScope {
  type: 'EVENT';
  sport: Sport;
  providerId: string;
  eventId: string;
  kinds: EventSyncKind[];
}

export type NormalizedSyncScope = NormalizedEventSyncScope;

export interface NormalizedSyncRequest {
  source: SyncRequestSource;
  actor: SyncActorContext;
  scope: NormalizedSyncScope;
  normalizedAt: Date;
}

export type SyncRequestValidationCode =
  | 'MANUAL_REQUIRES_ROOT_ADMIN_ACTOR'
  | 'SCHEDULED_REQUIRES_SYSTEM_ACTOR'
  | 'WEBHOOK_REQUIRES_WEBHOOK_ACTOR'
  | 'EMPTY_KIND_LIST'
  | 'INVALID_EVENT_ID';

export class SyncRequestValidationError extends Error {
  /** Activity's Error column (#1861). */
  readonly jobErrorType = JobErrorType.BAD_DATA;

  constructor(
    readonly code: SyncRequestValidationCode,
    message: string,
  ) {
    super(message);
    this.name = 'SyncRequestValidationError';
  }
}

export interface SyncOrchestratorOptions {
  now?: () => Date;
}

export class SyncOrchestrator {
  constructor(private readonly options: SyncOrchestratorOptions = {}) {}

  normalizeRequest(request: SyncOrchestratorRequest): NormalizedSyncRequest {
    return normalizeSyncRequest(request, this.options);
  }
}

export function normalizeSyncRequest(
  request: SyncOrchestratorRequest,
  options: SyncOrchestratorOptions = {},
): NormalizedSyncRequest {
  assertActorMatchesSource(request.source, request.actor);
  const normalizedAt = cloneDate(options.now?.() ?? new Date());

  return {
    source: request.source,
    actor: request.actor,
    scope: normalizeScope(request),
    normalizedAt,
  };
}

function normalizeScope(request: SyncOrchestratorRequest): NormalizedSyncScope {
  const eventId = request.scope.eventId.trim();
  if (!eventId) {
    throw new SyncRequestValidationError(
      'INVALID_EVENT_ID',
      'Event-scoped sync requests require a non-empty provider event ID.',
    );
  }

  return {
    type: 'EVENT',
    sport: request.scope.sport,
    providerId: request.scope.providerId,
    eventId,
    kinds: normalizeEventKinds(request.scope.kinds),
  };
}

function assertActorMatchesSource(source: SyncRequestSource, actor: SyncActorContext): void {
  if (source === 'MANUAL' && actor.type !== 'ROOT_ADMIN') {
    throw new SyncRequestValidationError(
      'MANUAL_REQUIRES_ROOT_ADMIN_ACTOR',
      'Manual sync requests require a root-admin actor context.',
    );
  }

  if (source === 'SCHEDULED' && actor.type !== 'SYSTEM') {
    throw new SyncRequestValidationError(
      'SCHEDULED_REQUIRES_SYSTEM_ACTOR',
      'Scheduled sync requests require a system actor context.',
    );
  }

  if (source === 'WEBHOOK' && (actor.type !== 'SYSTEM' || actor.name !== 'webhook')) {
    throw new SyncRequestValidationError(
      'WEBHOOK_REQUIRES_WEBHOOK_ACTOR',
      'Webhook sync requests require the webhook receiver as their actor.',
    );
  }
}

function normalizeEventKinds(kinds: readonly EventSyncKind[]): EventSyncKind[] {
  if (kinds.length === 0) {
    throw new SyncRequestValidationError('EMPTY_KIND_LIST', 'Sync requests require at least one sync kind.');
  }
  return [...new Set(kinds)];
}

function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}
