/**
 * IngestionService — the root-admin operations over sports-data ingestion: the provider
 * list, sync submissions and their history, competitors a provider could not match, the
 * stale-event cleanup, and the provider catalog browse.
 *
 * Reads and writes go through ports. The live provider state (health, catalog, the
 * competitors a provider reports) comes from the provider registry, not from storage.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ParticipantProviderMappingRepository,
  ProviderSyncRunRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import { Sport, SportEventSyncScope, type ProviderSyncRun, type ProviderSyncRunStatus } from '@poolmaster/shared/domain';
import type { ProviderRegistry } from './core/provider-registry';
import type { SportDataProvider } from './core/provider-interface';
import { supportsLiveSimulation, supportsMockEventStateControls } from './core/provider-interface';
import type {
  EventSyncRequest,
  IngestionFeedType,
  IngestionScheduleConfigReader,
  IngestionScheduler,
} from './core/ingestion-scheduler';
import {
  SyncOrchestrator,
  type NormalizedEventSyncScope,
} from './core/sync-orchestrator';
import {
  ProviderSyncRunLedger,
  isEventSyncFeedType,
} from './persistence/provider-sync-run-ledger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderHealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export interface ProviderSummary {
  providerId: string;
  providerName: string;
  status: ProviderHealthStatus;
  errorRate: number;
  latencyMs: number;
  lastEventAt: Date | null;
  sportsCovered: Sport[];
  activeEventCount: number;
  supportsLiveSimulation: boolean;
}

export interface ProviderManualSyncSubmissionResult {
  sport: Sport;
  eventId: string;
  requestedFeeds: IngestionFeedType[];
  submittedAt: Date;
  syncRuns: ProviderSyncRun[];
}

export interface UnmappedParticipant {
  providerId: string;
  providerName: string;
  externalId: string;
  externalName: string;
  sport: Sport;
}

export interface SyncRunListFilters {
  providerId?: string;
  sport?: Sport;
  status?: ProviderSyncRunStatus;
  from?: Date;
  to?: Date;
}

/**
 * The window a sync-run list covers when the caller names no start. Six hours is the longest
 * interval that recurs for every upcoming event (the field sync), so a healthy system always
 * has a run inside it; during a live tournament it holds roughly ninety.
 */
export const DEFAULT_SYNC_RUN_WINDOW_HOURS = 6;

export type ProviderEventCleanupMode = 'DRY_RUN' | 'EXECUTE';
export type ProviderEventCleanupStaleReason = 'NON_GOLF_EVENT' | 'PAST_GOLF_EVENT';
export type ProviderEventCleanupBlockedReason =
  | 'DIRECT_CONTEST_REFERENCE'
  | 'CONTEST_ENTRY_PICK_REFERENCE';

export interface ProviderEventCleanupRow {
  id: string;
  providerId: string;
  externalId: string;
  sport: string;
  name: string;
  status: string;
  startDate: Date;
  endDate: Date | null;
  staleReason: ProviderEventCleanupStaleReason;
  deletable: boolean;
  deleted: boolean;
  blockedReasons: ProviderEventCleanupBlockedReason[];
  directContestCount: number;
  sportEventParticipantCount: number;
  valuationCount: number;
  roundCount: number;
  pickCount: number;
}

export interface ProviderEventCleanupSummary {
  inventoriedEventCount: number;
  deletableEventCount: number;
  blockedEventCount: number;
  deletedEventCount: number;
  sportEventParticipantCount: number;
  valuationCount: number;
  roundCount: number;
  pickCount: number;
}

export interface ProviderEventCleanupGroup {
  key: string;
  eventCount: number;
  deletableEventCount: number;
  deletedEventCount: number;
}

export interface ProviderEventCleanupResult {
  mode: ProviderEventCleanupMode;
  executed: boolean;
  inventoriedAt: Date;
  summary: ProviderEventCleanupSummary;
  bySport: ProviderEventCleanupGroup[];
  byProvider: ProviderEventCleanupGroup[];
  byStatus: ProviderEventCleanupGroup[];
  events: ProviderEventCleanupRow[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SportProviderNotFoundError extends Error {
  constructor(sport: Sport) {
    super(`No provider is registered for sport ${sport}`);
    this.name = 'SportProviderNotFoundError';
  }
}

export class SportSyncNotConfiguredError extends Error {
  constructor(sport: Sport) {
    super(`Sport ${sport} is not enabled in ingestion scheduledSports config`);
    this.name = 'SportSyncNotConfiguredError';
  }
}

export class MockEventStateUnsupportedError extends Error {
  constructor(providerId: string) {
    super(`Provider ${providerId} does not support mock event state controls`);
    this.name = 'MockEventStateUnsupportedError';
  }
}

/**
 * A one-off manual sync can't bypass SportEvent.syncScope any more than the
 * scheduled feeds can (plans/124 §4.4) — thrown when any requested feed
 * isn't allowed for the target event's current scope.
 */
export class SportEventSyncScopeError extends Error {
  constructor(eventId: string, syncScope: string, disallowedFeeds: string[]) {
    super(
      `Event ${eventId} has syncScope ${syncScope}, which does not allow: ${disallowedFeeds.join(', ')}`,
    );
    this.name = 'SportEventSyncScopeError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupCleanupRows(
  rows: ProviderEventCleanupRow[],
  keyFor: (row: ProviderEventCleanupRow) => string,
): ProviderEventCleanupGroup[] {
  const groups = new Map<string, ProviderEventCleanupGroup>();
  for (const row of rows) {
    const key = keyFor(row);
    const existing = groups.get(key) ?? {
      key,
      eventCount: 0,
      deletableEventCount: 0,
      deletedEventCount: 0,
    };
    existing.eventCount += 1;
    if (row.deletable) existing.deletableEventCount += 1;
    if (row.deleted) existing.deletedEventCount += 1;
    groups.set(key, existing);
  }

  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function summarizeCleanupRows(rows: ProviderEventCleanupRow[]): ProviderEventCleanupSummary {
  return rows.reduce<ProviderEventCleanupSummary>((summary, row) => {
    summary.inventoriedEventCount += 1;
    if (row.deletable) summary.deletableEventCount += 1;
    if (!row.deletable) summary.blockedEventCount += 1;
    if (row.deleted) summary.deletedEventCount += 1;
    summary.sportEventParticipantCount += row.sportEventParticipantCount;
    summary.valuationCount += row.valuationCount;
    summary.roundCount += row.roundCount;
    summary.pickCount += row.pickCount;
    return summary;
  }, {
    inventoriedEventCount: 0,
    deletableEventCount: 0,
    blockedEventCount: 0,
    deletedEventCount: 0,
    sportEventParticipantCount: 0,
    valuationCount: 0,
    roundCount: 0,
    pickCount: 0,
  });
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface IngestionServiceDependencies {
  registry: ProviderRegistry;
  sportEvents: SportEventRepository;
  participantMappings: ParticipantProviderMappingRepository;
  syncRuns: ProviderSyncRunRepository;
  scheduler?: IngestionScheduler;
  ingestionConfigReader?: IngestionScheduleConfigReader;
  syncOrchestrator?: Pick<SyncOrchestrator, 'normalizeRequest'>;
  syncRunLedger?: ProviderSyncRunLedger;
  logger?: FastifyBaseLogger;
}

export class IngestionService {
  private readonly registry: ProviderRegistry;
  private readonly sportEvents: SportEventRepository;
  private readonly participantMappings: ParticipantProviderMappingRepository;
  private readonly syncRuns: ProviderSyncRunRepository;
  private readonly scheduler?: IngestionScheduler;
  private readonly ingestionConfigReader?: IngestionScheduleConfigReader;
  private readonly syncOrchestrator: Pick<SyncOrchestrator, 'normalizeRequest'>;
  private readonly syncRunLedger: ProviderSyncRunLedger;
  private readonly logger?: FastifyBaseLogger;

  constructor(deps: IngestionServiceDependencies) {
    this.registry = deps.registry;
    this.sportEvents = deps.sportEvents;
    this.participantMappings = deps.participantMappings;
    this.syncRuns = deps.syncRuns;
    this.scheduler = deps.scheduler;
    this.ingestionConfigReader = deps.ingestionConfigReader;
    this.logger = deps.logger;
    this.syncOrchestrator = deps.syncOrchestrator ?? new SyncOrchestrator();
    this.syncRunLedger = deps.syncRunLedger ?? new ProviderSyncRunLedger(deps.syncRuns, deps.logger);
  }

  private async getConfiguredSportsForProvider(provider: SportDataProvider): Promise<Sport[]> {
    if (!this.ingestionConfigReader) {
      return provider.sportsCovered;
    }

    const config = await this.ingestionConfigReader.getConfig();
    const configuredSports = new Set(config.scheduledSports);
    return provider.sportsCovered.filter((sport) => configuredSports.has(sport));
  }

  private async assertSportSyncConfigured(sport: Sport): Promise<void> {
    if (!this.ingestionConfigReader) {
      return;
    }

    const config = await this.ingestionConfigReader.getConfig();
    if (!config.scheduledSports.includes(sport)) {
      this.logger?.warn({
        sport,
        scheduledSports: config.scheduledSports,
      }, 'Sync requested for sport that is not enabled in ingestion config');
      throw new SportSyncNotConfiguredError(sport);
    }
  }

  /**
   * A one-off manual sync can't bypass SportEvent.syncScope any more than the
   * scheduled feeds can (plans/124 §4.4). No-op when no local SportEvent row
   * exists yet for (providerId, externalId) — there is no scope to violate.
   *
   * EVENTPARTICIPANTS (the field/"details" feed) is allowed for any linked
   * event (`syncScope != 'NONE'`), not only `FULL` — plans/125 §3.2's
   * already-decided design, which plans/124 §4.4a's admin-triggered
   * Load/Refresh Participant Field action depends on. It is a separate
   * concern from the scores feed (EVENTLIVESCORES): a
   * `SCORES_ONLY` tournament is still admin-managed for setup/field/tiers
   * (§3.5), so an explicit, on-demand field refresh must not be blocked the
   * way an automatic sync of a provider-owned event's header correctly is.
   */
  private async assertFeedsAllowedForSyncScope(
    providerId: string,
    eventId: string,
    feeds: string[],
  ): Promise<void> {
    const event = await this.sportEvents.findByProviderRef(providerId, eventId);
    if (!event) {
      return;
    }

    const allowedFeeds: string[] = event.syncScope === SportEventSyncScope.NONE
      ? []
      : ['EVENTPARTICIPANTS', 'EVENTLIVESCORES'];
    const disallowedFeeds = feeds.filter((feed) => !allowedFeeds.includes(feed));
    if (disallowedFeeds.length > 0) {
      this.logger?.warn({
        providerId,
        eventId,
        syncScope: event.syncScope,
        requestedFeeds: feeds,
        disallowedFeeds,
      }, 'Manual event sync rejected — requested feed(s) not allowed for this event\'s syncScope');
      throw new SportEventSyncScopeError(eventId, event.syncScope, disallowedFeeds);
    }
  }

  private async buildUnmappedParticipantsForProvider(provider: SportDataProvider): Promise<UnmappedParticipant[]> {
    const results: UnmappedParticipant[] = [];

    for (const sport of await this.getConfiguredSportsForProvider(provider)) {
      const participants = await provider.getParticipants(sport);
      const mapped = await this.participantMappings.findByProviderExternalIds(
        provider.providerId,
        participants.map((participant) => participant.externalId),
      );
      const mappedIds = new Set(mapped.map((mapping) => mapping.externalId));
      for (const participant of participants) {
        if (mappedIds.has(participant.externalId)) {
          continue;
        }
        results.push({
          providerId: provider.providerId,
          providerName: provider.providerName,
          externalId: participant.externalId,
          externalName: participant.name,
          sport,
        });
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Every registered provider with its live health. A provider whose live check throws
   * fails the list: there is no stored health to fall back on.
   */
  async listProviders(): Promise<ProviderSummary[]> {
    const providers = this.registry.getAllProviders();
    const eventSummaries = await this.sportEvents.summarizeByProviders(
      providers.map((provider) => provider.providerId),
    );
    const summaries = await Promise.all(providers.map(async (provider): Promise<ProviderSummary> => {
      const health = await provider.healthCheck();
      const events = eventSummaries.get(provider.providerId);
      return {
        providerId: provider.providerId,
        providerName: provider.providerName,
        status: health.status,
        errorRate: health.errorRateLastHour,
        latencyMs: health.latencyMsP95,
        lastEventAt: events?.lastChangedAt ?? health.lastSuccessfulPoll ?? null,
        sportsCovered: await this.getConfiguredSportsForProvider(provider),
        activeEventCount: events?.activeEventCount ?? 0,
        supportsLiveSimulation: supportsLiveSimulation(provider),
      };
    }));
    return summaries.sort((a, b) => a.providerName.localeCompare(b.providerName));
  }

  /** Runs submitted inside the window; `from` defaults to DEFAULT_SYNC_RUN_WINDOW_HOURS before `to`, and `to` to now. */
  async listSyncRuns(filters: SyncRunListFilters = {}): Promise<ProviderSyncRun[]> {
    const createdTo = filters.to ?? new Date();
    const createdFrom = filters.from ?? new Date(createdTo.getTime() - DEFAULT_SYNC_RUN_WINDOW_HOURS * 3_600_000);
    return this.syncRuns.findAll({
      providerId: filters.providerId,
      sport: filters.sport,
      status: filters.status,
      createdFrom,
      createdTo,
    });
  }

  async syncEventData(
    request: EventSyncRequest,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<ProviderManualSyncSubmissionResult> {
    if (!this.scheduler) {
      throw new Error('Ingestion scheduler is required for manual event sync');
    }

    const provider = this.registry.getProvider(request.sport);
    if (!provider) {
      this.logger?.error(
        { sport: request.sport, eventId: request.eventId },
        'Manual event sync was requested without a configured provider',
      );
      throw new SportProviderNotFoundError(request.sport);
    }
    await this.assertSportSyncConfigured(request.sport);
    if (request.mockEventState && !supportsMockEventStateControls(provider)) {
      throw new MockEventStateUnsupportedError(provider.providerId);
    }
    const normalizedRequest = this.syncOrchestrator.normalizeRequest({
      source: 'MANUAL',
      actor: {
        type: 'ROOT_ADMIN',
        userId: rootAdminUserId,
        email: rootAdminEmail,
      },
      scope: {
        type: 'EVENT',
        sport: request.sport,
        eventId: request.eventId,
        feeds: request.feeds,
        mockEventState: request.mockEventState,
      },
      workflowContext: request.workflowContext,
    });
    const normalizedScope = normalizedRequest.scope;
    await this.assertFeedsAllowedForSyncScope(
      provider.providerId,
      normalizedScope.eventId,
      normalizedScope.feeds,
    );

    const submittedAt = new Date();
    this.logger?.info({
      sport: normalizedScope.sport,
      eventId: normalizedScope.eventId,
      requestedFeeds: normalizedScope.feeds,
      mockEventState: normalizedScope.mockEventState ?? null,
      providerId: provider.providerId,
      rootAdminUserId,
    }, 'Submitting manual event sync');
    const syncRuns = await this.syncRunLedger.createSubmissions({
      normalizedRequest,
      providerId: provider.providerId,
      submittedAt,
      runType: 'MANUAL_EVENT_SYNC',
    });

    setImmediate(() => {
      void this.executeSubmittedEventSync({
        normalizedScope,
        syncRuns,
      });
    });

    this.logger?.info({
      sport: normalizedScope.sport,
      eventId: normalizedScope.eventId,
      providerId: provider.providerId,
      requestedFeeds: normalizedScope.feeds,
      mockEventState: normalizedScope.mockEventState ?? null,
      syncRunIds: syncRuns.map((run) => run.id),
    }, 'Submitted manual event sync');

    return {
      sport: normalizedScope.sport,
      eventId: normalizedScope.eventId,
      requestedFeeds: normalizedScope.feeds,
      submittedAt,
      syncRuns,
    };
  }

  private async executeSubmittedEventSync(input: {
    normalizedScope: NormalizedEventSyncScope;
    syncRuns: ProviderSyncRun[];
  }): Promise<void> {
    this.logger?.debug({
      sport: input.normalizedScope.sport,
      eventId: input.normalizedScope.eventId,
      requestedFeeds: input.normalizedScope.feeds,
      mockEventState: input.normalizedScope.mockEventState ?? null,
      syncRunIds: input.syncRuns.map((run) => run.id),
    }, 'Executing submitted manual event sync');
    for (const syncRun of input.syncRuns) {
      const requestedFeed = syncRun.payload.requestedFeed;
      if (!isEventSyncFeedType(requestedFeed)) {
        await this.syncRunLedger.failSubmittedRun(syncRun, new Error(`Unsupported event sync feed: ${String(requestedFeed)}`));
        continue;
      }

      try {
        await this.syncRunLedger.executeFeedRun(syncRun, () =>
          this.scheduler!.runEventSync({
            sport: input.normalizedScope.sport,
            eventId: input.normalizedScope.eventId,
            feeds: [requestedFeed],
            mockEventState: input.normalizedScope.mockEventState,
          }),
        );
      } catch (error) {
        this.logger?.error({
          syncRunId: syncRun.id,
          sport: input.normalizedScope.sport,
          eventId: input.normalizedScope.eventId,
          requestedFeed,
          error,
        }, 'Manual event sync feed failed after provider sync run was marked failed');
        // The ledger already marks the submitted run as failed; keep the
        // asynchronous manual submission worker moving through remaining feeds.
      }
    }
  }

  async cleanupStaleProviderEvents(
    mode: ProviderEventCleanupMode,
    options: {
      now?: Date;
    } = {},
  ): Promise<ProviderEventCleanupResult> {
    const inventoriedAt = options.now ?? new Date();
    this.logger?.debug({
      mode,
      inventoriedAt,
    }, 'Starting stale provider event cleanup inventory');

    const inventory = await this.buildStaleProviderEventInventory(inventoriedAt);
    const deletableIds = inventory.filter((row) => row.deletable).map((row) => row.id);
    const deletedIds = mode === 'EXECUTE'
      ? await this.deleteStaleProviderEvents(deletableIds)
      : new Set<string>();
    const events = inventory.map((row) => ({
      ...row,
      deleted: deletedIds.has(row.id),
    }));
    const result: ProviderEventCleanupResult = {
      mode,
      executed: mode === 'EXECUTE',
      inventoriedAt,
      summary: summarizeCleanupRows(events),
      bySport: groupCleanupRows(events, (row) => row.sport),
      byProvider: groupCleanupRows(events, (row) => row.providerId),
      byStatus: groupCleanupRows(events, (row) => row.status),
      events,
    };

    this.logger?.info({
      mode,
      inventoriedEventCount: result.summary.inventoriedEventCount,
      deletableEventCount: result.summary.deletableEventCount,
      deletedEventCount: result.summary.deletedEventCount,
      blockedEventCount: result.summary.blockedEventCount,
    }, 'Completed stale provider event cleanup');

    return result;
  }

  private async buildStaleProviderEventInventory(now: Date): Promise<ProviderEventCleanupRow[]> {
    const stale = (await this.sportEvents.findAll({}))
      .map((event) => ({
        event,
        staleReason: this.resolveStaleProviderEventReason({
          sport: event.sport,
          startDate: event.startDate,
          endDate: event.endDate ?? null,
          now,
        }),
      }))
      .filter((row): row is { event: typeof row.event; staleReason: ProviderEventCleanupStaleReason } => row.staleReason !== null)
      .sort((a, b) => a.event.sport.localeCompare(b.event.sport)
        || a.event.providerId.localeCompare(b.event.providerId)
        || a.event.startDate.getTime() - b.event.startDate.getTime()
        || a.event.externalId.localeCompare(b.event.externalId));
    const ids = stale.map(({ event }) => event.id);
    const [contestCounts, participantCounts, fieldRecordCounts] = await Promise.all([
      this.sportEvents.countContests(ids),
      this.sportEvents.countParticipants(ids),
      this.sportEvents.countFieldRecords(ids),
    ]);

    return stale.map(({ event, staleReason }): ProviderEventCleanupRow => {
      const directContestCount = contestCounts.get(event.id) ?? 0;
      const fieldRecords = fieldRecordCounts.get(event.id) ?? { valuations: 0, rounds: 0, picks: 0 };
      const blockedReasons: ProviderEventCleanupBlockedReason[] = [];
      if (directContestCount > 0) blockedReasons.push('DIRECT_CONTEST_REFERENCE');
      if (fieldRecords.picks > 0) blockedReasons.push('CONTEST_ENTRY_PICK_REFERENCE');

      return {
        id: event.id,
        providerId: event.providerId,
        externalId: event.externalId,
        sport: event.sport,
        name: event.name,
        status: event.status,
        startDate: event.startDate,
        endDate: event.endDate ?? null,
        staleReason,
        deletable: blockedReasons.length === 0,
        deleted: false,
        blockedReasons,
        directContestCount,
        sportEventParticipantCount: participantCounts.get(event.id) ?? 0,
        valuationCount: fieldRecords.valuations,
        roundCount: fieldRecords.rounds,
        pickCount: fieldRecords.picks,
      };
    });
  }

  private resolveStaleProviderEventReason(input: {
    sport: string;
    startDate: Date;
    endDate: Date | null;
    now: Date;
  }): ProviderEventCleanupStaleReason | null {
    if (input.sport !== Sport.GOLF) {
      return 'NON_GOLF_EVENT';
    }

    const eventEnd = input.endDate ?? input.startDate;
    if (eventEnd.getTime() < input.now.getTime()) {
      return 'PAST_GOLF_EVENT';
    }

    return null;
  }

  /**
   * Each event goes through the port's delete, which clears its field first; each delete is
   * its own transaction. An event whose delete fails — something came to reference it after
   * the inventory — stays, and is reported as not deleted.
   */
  private async deleteStaleProviderEvents(eventIds: string[]): Promise<Set<string>> {
    const deletedIds = new Set<string>();
    for (const eventId of eventIds) {
      try {
        await this.sportEvents.delete(eventId);
        deletedIds.add(eventId);
      } catch (error) {
        this.logger?.warn({ eventId, error }, 'Stale provider event cleanup could not delete an event; leaving it in place');
      }
    }
    return deletedIds;
  }

  async getUnmappedParticipants(): Promise<UnmappedParticipant[]> {
    const providers = this.registry.getAllProviders();
    const unmapped: UnmappedParticipant[] = [];

    for (const provider of providers) {
      unmapped.push(...await this.buildUnmappedParticipantsForProvider(provider));
    }

    return unmapped;
  }
}
