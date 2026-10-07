import type { Sport } from '@poolmaster/shared/domain';
import type { IngestionFeedType, MockEventState } from '@poolmaster/shared/dto';
import type { ProviderEventSyncOptions } from './provider-interface';

/**
 * Internal sync-intent boundary for pool-master-rop.68.2.
 *
 * This boundary owns the canonical sync request shape. Scheduled jobs route
 * through it as of pool-master-rop.68.2.2; manual root-admin wiring is tracked
 * by pool-master-rop.68.2.3.
 */

export type { IngestionFeedType } from '@poolmaster/shared/dto';

/** Every feed is event-scoped: there is no sport-level sync (#126). */
export const EVENT_SYNC_FEEDS = [
  'EVENTPARTICIPANTS',
  'EVENTLIVESCORES',
] as const satisfies readonly IngestionFeedType[];

export type SyncRequestSource = 'SCHEDULED' | 'MANUAL';
export type EventSyncFeed = typeof EVENT_SYNC_FEEDS[number];

export interface SystemSyncActor {
  type: 'SYSTEM';
  name: 'scheduler';
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
  eventId: string;
  feeds: readonly IngestionFeedType[];
  mockEventState?: MockEventState;
}

export type SyncScopeInput = EventSyncScopeInput;

export interface SyncOrchestratorRequest {
  source: SyncRequestSource;
  actor: SyncActorContext;
  scope: SyncScopeInput;
  workflowContext?: Record<string, unknown>;
}

export interface NormalizedEventSyncScope {
  type: 'EVENT';
  sport: Sport;
  eventId: string;
  feeds: EventSyncFeed[];
  mockEventState?: MockEventState;
  providerOptions?: ProviderEventSyncOptions;
}

export type NormalizedSyncScope = NormalizedEventSyncScope;

export interface NormalizedSyncRequest {
  source: SyncRequestSource;
  actor: SyncActorContext;
  scope: NormalizedSyncScope;
  workflowContext: Record<string, unknown>;
  normalizedAt: Date;
}

export type SyncRequestValidationCode =
  | 'MANUAL_REQUIRES_ROOT_ADMIN_ACTOR'
  | 'SCHEDULED_REQUIRES_SYSTEM_ACTOR'
  | 'EMPTY_FEED_LIST'
  | 'INVALID_EVENT_FEED'
  | 'INVALID_EVENT_ID'
  | 'MOCK_EVENT_STATE_REQUIRES_MANUAL_SOURCE';

export class SyncRequestValidationError extends Error {
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
    workflowContext: request.workflowContext ?? {},
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

  if (request.scope.mockEventState && request.source !== 'MANUAL') {
    throw new SyncRequestValidationError(
      'MOCK_EVENT_STATE_REQUIRES_MANUAL_SOURCE',
      'Mock event-state overrides are only valid for manual event sync requests.',
    );
  }

  return {
    type: 'EVENT',
    sport: request.scope.sport,
    eventId,
    feeds: normalizeEventFeeds(request.scope.feeds),
    mockEventState: request.scope.mockEventState,
    providerOptions: request.scope.mockEventState
      ? { mockEventState: request.scope.mockEventState }
      : undefined,
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
}

function normalizeEventFeeds(feeds: readonly IngestionFeedType[]): EventSyncFeed[] {
  if (feeds.length === 0) {
    throw new SyncRequestValidationError('EMPTY_FEED_LIST', 'Sync requests require at least one feed.');
  }

  const normalized: EventSyncFeed[] = [];
  for (const feed of feeds) {
    if (!isEventSyncFeed(feed)) {
      throw new SyncRequestValidationError(
        'INVALID_EVENT_FEED',
        `Feed ${String(feed)} is not valid for this sync scope.`,
      );
    }
    if (!normalized.includes(feed)) {
      normalized.push(feed);
    }
  }
  return normalized;
}

function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}

function isEventSyncFeed(feed: IngestionFeedType): feed is EventSyncFeed {
  return (EVENT_SYNC_FEEDS as readonly IngestionFeedType[]).includes(feed);
}
