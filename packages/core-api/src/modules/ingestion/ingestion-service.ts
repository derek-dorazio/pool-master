/**
 * IngestionService — the root-admin operations over sports-data ingestion: the provider
 * list, sync submissions and their history, competitors a provider could not match, and the
 * provider catalog browse.
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
import {
  BackgroundJobType,
  ProviderSyncRunStatus,
  type Sport,
  SportEventSyncScope,
  type ProviderSyncRun,
  type ProviderSyncRunWithDetails,
} from '@poolmaster/shared/domain';
import type { ProviderRegistry } from './core/provider-registry';
import type { SportDataProvider } from './core/provider-interface';
import { supportsLiveSimulation, supportsMockEventStateControls } from './core/provider-interface';
import type {
  EventSyncRequest,
  IngestionFeedType,
  IngestionScheduleConfigReader,
  IngestionScheduler,
} from './core/ingestion-scheduler';
import { SyncOrchestrator } from './core/sync-orchestrator';
import {
  ProviderSyncRunLedger,
  SyncRunOutcomeUnrecordedError,
  isEventSyncFeedType,
  readPayload,
} from './persistence/provider-sync-run-ledger';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import type { ManualEventSyncJobPayload } from './manual-event-sync-job';

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
  /** The covered sports this provider is the default for (catalog browse, new links). */
  primaryForSports: Sport[];
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

export interface UnmappedParticipantFilters {
  /** Only this provider's competitors. */
  providerId?: string;
  /** Only the competitor the provider knows by this identifier. */
  externalId?: string;
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

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SportProviderNotFoundError extends Error {
  constructor(sport: Sport, providerId: string) {
    super(`No provider ${providerId} is registered for sport ${sport}`);
    this.name = 'SportProviderNotFoundError';
  }
}

export class ProviderSyncRunNotFoundError extends Error {
  constructor(syncRunId: string) {
    super(`No sync run ${syncRunId}`);
    this.name = 'ProviderSyncRunNotFoundError';
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
  /** Queues the job that runs a manual event sync's submitted runs (#1441). */
  jobs: Pick<BackgroundJobQueue, 'request' | 'queued'>;
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
  private readonly jobs: Pick<BackgroundJobQueue, 'request' | 'queued'>;
  private readonly logger?: FastifyBaseLogger;

  constructor(deps: IngestionServiceDependencies) {
    this.registry = deps.registry;
    this.sportEvents = deps.sportEvents;
    this.participantMappings = deps.participantMappings;
    this.syncRuns = deps.syncRuns;
    this.scheduler = deps.scheduler;
    this.ingestionConfigReader = deps.ingestionConfigReader;
    this.jobs = deps.jobs;
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
   * A linked event (`SCORES_ONLY`) accepts both event feeds: live scores, and the field
   * feed (EVENTPARTICIPANTS), from the field loop or the admin's Load/Refresh field action.
   * The field feed writes only the field and its size; a synced event's details are kept
   * current by `SportEventService.keepProviderEventsCurrent`, never here (ADR 0011).
   * An unlinked event (`NONE`) accepts neither.
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

  private async buildUnmappedParticipantsForProvider(provider: SportDataProvider, externalId: string | undefined): Promise<UnmappedParticipant[]> {
    const results: UnmappedParticipant[] = [];

    for (const sport of await this.getConfiguredSportsForProvider(provider)) {
      const participants = (await provider.getParticipants(sport))
        .filter((participant) => externalId === undefined || participant.externalId === externalId);
      if (participants.length === 0) continue;
      // poolmaster-allow-query-in-loop: once per sport the provider is configured for, a handful
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
      const sportsCovered = await this.getConfiguredSportsForProvider(provider);
      return {
        providerId: provider.providerId,
        providerName: provider.providerName,
        status: health.status,
        errorRate: health.errorRateLastHour,
        latencyMs: health.latencyMsP95,
        lastEventAt: events?.lastChangedAt ?? health.lastSuccessfulPoll ?? null,
        sportsCovered,
        primaryForSports: sportsCovered.filter((sport) => this.registry.getProvider(sport)?.providerId === provider.providerId),
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

  /** One run with its detailed diagnostics, which the list leaves out (#1174). */
  async getSyncRun(syncRunId: string): Promise<ProviderSyncRunWithDetails> {
    const run = await this.syncRuns.findById(syncRunId);
    if (!run) throw new ProviderSyncRunNotFoundError(syncRunId);
    return run;
  }

  async syncEventData(
    request: EventSyncRequest,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<ProviderManualSyncSubmissionResult> {
    if (!this.scheduler) {
      throw new Error('Ingestion scheduler is required for manual event sync');
    }

    // The event's own provider, which must serve its sport (#1495).
    const provider = this.registry.getProviderById(request.providerId);
    if (!provider?.sportsCovered.includes(request.sport)) {
      this.logger?.error(
        { sport: request.sport, providerId: request.providerId, eventId: request.eventId },
        'Manual event sync was requested without a configured provider',
      );
      throw new SportProviderNotFoundError(request.sport, request.providerId);
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
        providerId: provider.providerId,
        eventId: request.eventId,
        feeds: request.feeds,
        mockEventState: request.mockEventState,
      },
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
    // The runs and the job that runs them commit together; the job runs on whichever task claims it.
    const syncRuns = await this.syncRunLedger.createSubmissionsWithJob({
      normalizedRequest,
      providerId: provider.providerId,
      submittedAt,
      runType: 'MANUAL_EVENT_SYNC',
      job: (runs) => this.jobs.request(BackgroundJobType.MANUAL_EVENT_SYNC, {
        syncRunIds: runs.map((run) => run.id),
        sport: normalizedScope.sport,
        providerId: normalizedScope.providerId,
        eventId: normalizedScope.eventId,
        mockEventState: normalizedScope.mockEventState,
      }),
    });
    this.jobs.queued();

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

  /**
   * The MANUAL_EVENT_SYNC job (#1441): runs each submitted run's feed, one after another. A run
   * that is no longer SUBMITTED was started by an earlier try of this job, so a retry skips it:
   * the sync-run ledger is what makes the job idempotent. A feed that fails is recorded on its run
   * and the rest still run; only a failure the ledger could not record fails the job.
   *
   * On a retry, a run still IN_PROGRESS was left so by an earlier try that stopped mid-feed, or
   * whose failure could not be written (#1445): it is marked FAILED as interrupted, rather than
   * left showing as running for good, and is not run again.
   */
  async runManualEventSync(payload: ManualEventSyncJobPayload, context: { attempt: number }): Promise<void> {
    const scheduler = this.scheduler;
    if (!scheduler) {
      throw new Error('Ingestion scheduler is required for manual event sync');
    }
    const scope = { sport: payload.sport, providerId: payload.providerId, eventId: payload.eventId, mockEventState: payload.mockEventState ?? null };
    this.logger?.debug({ ...scope, syncRunIds: payload.syncRunIds }, 'Executing submitted manual event sync');
    const stored = new Map((await this.syncRuns.findManyByIds(payload.syncRunIds)).map((run) => [run.id, run]));
    // Runs whose outcome the ledger could not write: the job fails after the rest have run.
    const unrecorded: string[] = [];
    for (const syncRunId of payload.syncRunIds) {
      const syncRun = stored.get(syncRunId);
      if (syncRun?.status === ProviderSyncRunStatus.IN_PROGRESS && context.attempt > 1) {
        await this.syncRunLedger.failSubmittedRun(
          syncRun,
          new Error('Interrupted: an earlier try of this sync stopped before the feed finished'),
          syncRun.startedAt,
        );
        continue;
      }
      if (syncRun?.status !== ProviderSyncRunStatus.SUBMITTED) {
        this.logger?.info({ ...scope, syncRunId, status: syncRun?.status ?? null }, 'Skipped a manual sync run that is no longer submitted');
        continue;
      }
      const { requestedFeed } = readPayload(syncRun);
      if (!isEventSyncFeedType(requestedFeed)) {
        await this.syncRunLedger.failSubmittedRun(syncRun, new Error(`Unsupported event sync feed: ${String(requestedFeed)}`));
        continue;
      }

      try {
        await this.syncRunLedger.executeFeedRun(syncRun, () =>
          scheduler.runEventSync({
            sport: payload.sport,
            providerId: payload.providerId,
            eventId: payload.eventId,
            feeds: [requestedFeed],
            mockEventState: payload.mockEventState,
          }),
        );
      } catch (error) {
        if (error instanceof SyncRunOutcomeUnrecordedError) {
          unrecorded.push(syncRun.id);
          this.logger?.error({ ...scope, syncRunId: syncRun.id, requestedFeed, error }, 'Manual event sync feed failed and its run could not be marked FAILED; the job will be retried');
          continue;
        }
        this.logger?.error({
          ...scope,
          syncRunId: syncRun.id,
          requestedFeed,
          error,
        }, 'Manual event sync feed failed; its run is marked FAILED');
        // The ledger marked the run failed; the job moves on to the remaining feeds.
      }
    }
    if (unrecorded.length > 0) {
      // A retry marks these runs interrupted rather than leaving them IN_PROGRESS for good.
      throw new Error(`Manual event sync left ${String(unrecorded.length)} run(s) without a recorded outcome: ${unrecorded.join(', ')}`);
    }
  }

  /**
   * Competitors the providers report that no participant is mapped to. `providerId` asks only
   * that provider and `externalId` keeps only that competitor, so a page about one competitor
   * reads one mapping (#1251).
   */
  async getUnmappedParticipants(filters: UnmappedParticipantFilters = {}): Promise<UnmappedParticipant[]> {
    const providers = this.registry.getAllProviders()
      .filter((provider) => filters.providerId === undefined || provider.providerId === filters.providerId);
    const unmapped: UnmappedParticipant[] = [];

    for (const provider of providers) {
      unmapped.push(...await this.buildUnmappedParticipantsForProvider(provider, filters.externalId));
    }

    return unmapped;
  }
}
