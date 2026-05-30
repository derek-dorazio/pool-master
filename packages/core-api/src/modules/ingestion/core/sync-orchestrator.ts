import type { Sport } from '@poolmaster/shared/domain';
import type { IngestionFeedType, MockEventState } from '@poolmaster/shared/dto';
import type { IngestionScheduleConfig } from '@poolmaster/shared/dto/config.dto';
import type { ProviderEventSyncOptions } from './provider-interface';

/**
 * Internal sync-intent boundary for pool-master-rop.68.2.
 *
 * This boundary owns the canonical sync request shape. Scheduled jobs route
 * through it as of pool-master-rop.68.2.2; manual root-admin wiring is tracked
 * by pool-master-rop.68.2.3.
 */

export type { IngestionFeedType } from '@poolmaster/shared/dto';

export const SPORT_SYNC_FEEDS = [
  'EVENTSCHEDULE',
  'EVENTPARTICIPANTS',
  'PARTICIPANTRANKINGS',
] as const satisfies readonly IngestionFeedType[];

export const EVENT_SYNC_FEEDS = [
  'EVENTPARTICIPANTS',
  'EVENTLIVESCORES',
  'EVENTRESULTS',
] as const satisfies readonly IngestionFeedType[];

const DEFAULT_SYNC_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_SCHEDULE_LOOKAHEAD_DAYS = 30;
const DEFAULT_PARTICIPANT_LEAD_DAYS = 7;

export type SyncRequestSource = 'SCHEDULED' | 'MANUAL';
export type SportSyncFeed = typeof SPORT_SYNC_FEEDS[number];
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

export interface SyncRequestedWindow {
  from?: Date;
  to?: Date;
}

export interface SyncWindowPolicy {
  defaultLookaheadDays?: number;
}

export interface SyncEffectiveWindow {
  from: Date;
  to: Date;
  defaultedFrom: boolean;
  defaultedTo: boolean;
}

export interface SportSyncScopeInput {
  type: 'SPORT';
  sport: Sport;
  feeds: readonly IngestionFeedType[];
  window?: SyncRequestedWindow;
  windowPolicy?: SyncWindowPolicy;
}

export interface EventSyncScopeInput {
  type: 'EVENT';
  sport: Sport;
  eventId: string;
  feeds: readonly IngestionFeedType[];
  mockEventState?: MockEventState;
}

export type SyncScopeInput = SportSyncScopeInput | EventSyncScopeInput;

export interface SyncOrchestratorRequest {
  source: SyncRequestSource;
  actor: SyncActorContext;
  scope: SyncScopeInput;
  workflowContext?: Record<string, unknown>;
}

export interface NormalizedSportSyncScope {
  type: 'SPORT';
  sport: Sport;
  feeds: SportSyncFeed[];
  requestedWindow: SyncRequestedWindow;
  effectiveWindow: SyncEffectiveWindow;
}

export interface NormalizedEventSyncScope {
  type: 'EVENT';
  sport: Sport;
  eventId: string;
  feeds: EventSyncFeed[];
  mockEventState?: MockEventState;
  providerOptions?: ProviderEventSyncOptions;
}

export type NormalizedSyncScope = NormalizedSportSyncScope | NormalizedEventSyncScope;

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
  | 'INVALID_SPORT_FEED'
  | 'INVALID_EVENT_FEED'
  | 'INVALID_EVENT_ID'
  | 'INVALID_SYNC_WINDOW'
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
    scope: normalizeScope(request, normalizedAt),
    workflowContext: request.workflowContext ?? {},
    normalizedAt,
  };
}

function normalizeScope(request: SyncOrchestratorRequest, now: Date): NormalizedSyncScope {
  if (request.scope.type === 'SPORT') {
    return {
      type: 'SPORT',
      sport: request.scope.sport,
      feeds: normalizeSportFeeds(request.scope.feeds),
      requestedWindow: cloneRequestedWindow(request.scope.window),
      effectiveWindow: resolveEffectiveWindow(request.scope.window, now, request.scope.windowPolicy),
    };
  }

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

function normalizeSportFeeds(feeds: readonly IngestionFeedType[]): SportSyncFeed[] {
  return dedupeAndValidateFeeds(feeds, isSportSyncFeed, 'INVALID_SPORT_FEED');
}

function normalizeEventFeeds(feeds: readonly IngestionFeedType[]): EventSyncFeed[] {
  return dedupeAndValidateFeeds(feeds, isEventSyncFeed, 'INVALID_EVENT_FEED');
}

function dedupeAndValidateFeeds<TFeed extends IngestionFeedType>(
  feeds: readonly IngestionFeedType[],
  isAllowedFeed: (feed: IngestionFeedType) => feed is TFeed,
  invalidCode: Extract<SyncRequestValidationCode, 'INVALID_SPORT_FEED' | 'INVALID_EVENT_FEED'>,
): TFeed[] {
  if (feeds.length === 0) {
    throw new SyncRequestValidationError('EMPTY_FEED_LIST', 'Sync requests require at least one feed.');
  }

  const normalized: TFeed[] = [];
  for (const feed of feeds) {
    if (!isAllowedFeed(feed)) {
      throw new SyncRequestValidationError(
        invalidCode,
        `Feed ${feed} is not valid for this sync scope.`,
      );
    }
    if (!normalized.includes(feed)) {
      normalized.push(feed);
    }
  }
  return normalized;
}

function resolveEffectiveWindow(
  requestedWindow: SyncRequestedWindow | undefined,
  now: Date,
  windowPolicy?: SyncWindowPolicy,
): SyncEffectiveWindow {
  const from = cloneDate(requestedWindow?.from ?? now);
  const defaultWindowMs = typeof windowPolicy?.defaultLookaheadDays === 'number'
    ? windowPolicy.defaultLookaheadDays * 24 * 60 * 60 * 1000
    : DEFAULT_SYNC_WINDOW_MS;
  const to = cloneDate(requestedWindow?.to ?? new Date(from.getTime() + defaultWindowMs));

  if (to.getTime() < from.getTime()) {
    throw new SyncRequestValidationError(
      'INVALID_SYNC_WINDOW',
      'Sync request window end must be greater than or equal to its start.',
    );
  }

  return {
    from,
    to,
    defaultedFrom: !requestedWindow?.from,
    defaultedTo: !requestedWindow?.to,
  };
}

export function resolveSportSyncWindowPolicy(input: {
  feeds: readonly IngestionFeedType[];
  config?: IngestionScheduleConfig;
}): SyncWindowPolicy {
  const feeds = normalizeSportFeeds(input.feeds);
  const scheduleLookaheadDays = input.config?.eventSchedule.lookaheadDays ?? DEFAULT_SCHEDULE_LOOKAHEAD_DAYS;
  const participantLeadDays = input.config?.eventParticipants.leadDaysBeforeStart ?? DEFAULT_PARTICIPANT_LEAD_DAYS;
  const defaultLookaheadDays = feeds.reduce((maxLookaheadDays, feed) => {
    if (feed === 'EVENTSCHEDULE') {
      return Math.max(maxLookaheadDays, scheduleLookaheadDays);
    }

    if (feed === 'EVENTPARTICIPANTS') {
      return Math.max(maxLookaheadDays, scheduleLookaheadDays, participantLeadDays);
    }

    return maxLookaheadDays;
  }, 0);

  return defaultLookaheadDays > 0 ? { defaultLookaheadDays } : {};
}

function cloneRequestedWindow(requestedWindow: SyncRequestedWindow | undefined): SyncRequestedWindow {
  return {
    from: requestedWindow?.from ? cloneDate(requestedWindow.from) : undefined,
    to: requestedWindow?.to ? cloneDate(requestedWindow.to) : undefined,
  };
}

function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}

function isSportSyncFeed(feed: IngestionFeedType): feed is SportSyncFeed {
  return (SPORT_SYNC_FEEDS as readonly IngestionFeedType[]).includes(feed);
}

function isEventSyncFeed(feed: IngestionFeedType): feed is EventSyncFeed {
  return (EVENT_SYNC_FEEDS as readonly IngestionFeedType[]).includes(feed);
}
