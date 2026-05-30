/**
 * IngestionScheduler — orchestrates periodic data polling from providers.
 *
 * Schedules jobs for:
 * - Event schedule sync (daily)
 * - Event participant hydration (daily)
 * - Ranking updates (daily)
 * - Live score polling (every 30s during active events)
 * - Provider health checks (every 5 min)
 */

import type { Sport } from '@poolmaster/shared/domain';
import type { IngestionScheduleConfig } from '@poolmaster/shared/dto/config.dto';
import type { FastifyBaseLogger } from 'fastify';
import type { ProviderRegistry } from './provider-registry';
import { resolveRankingType } from './ranking-types';
import { SyncOrchestrator } from './sync-orchestrator';
import { resolveSportSyncWindowPolicy } from './sync-orchestrator';
import type { SyncWriteDiagnostics } from './sync-write-diagnostics';
import { syncWriteStats } from './sync-write-diagnostics';
import type {
  EventSyncFeed,
  IngestionFeedType,
  NormalizedSyncRequest,
  NormalizedEventSyncScope,
  NormalizedSportSyncScope,
  SportSyncFeed,
  SyncOrchestratorRequest,
  SyncRequestSource,
  SyncWindowPolicy,
} from './sync-orchestrator';
import type {
  ProviderEventSyncOptions,
  ProviderPayloadCapture,
  ProviderPayloadCaptureSession,
  ProviderRanking,
  SportDataProvider,
  SportEvent,
  SportEventDetail,
} from './provider-interface';
import { supportsMockEventStateControls, supportsProviderPayloadDiagnostics } from './provider-interface';
import type { LiveScoreResult, MockEventState } from '@poolmaster/shared/dto';
import type { ProviderSyncRunLedger } from '../persistence/provider-sync-run-ledger';

export type { IngestionFeedType } from './sync-orchestrator';

export type JobType =
  | 'EVENT_SCHEDULE_SYNC'
  | 'EVENT_PARTICIPANTS_SYNC'
  | 'PARTICIPANT_RANKINGS_SYNC'
  | 'EVENT_LIVE_SCORES_SYNC'
  | 'EVENT_RESULTS_SYNC'
  | 'HEALTH_CHECK';

export interface IngestionJobRecord {
  jobType: JobType;
  providerId: string;
  sport: Sport;
  eventExternalId?: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt?: Date;
  completedAt?: Date;
  recordsProcessed: number;
  errors: number;
  errorLog: unknown[];
  providerPayload?: IngestionJobProviderPayload;
  stats?: Record<string, number>;
  warnings?: IngestionJobWarning[];
  writeDiagnostics?: SyncWriteDiagnostics;
}

export interface IngestionJobWarning {
  code: string;
  message: string;
}

export interface IngestionJobProviderPayload {
  operation: IngestionFeedType;
  rawCaptured: boolean;
  rawTruncated: boolean;
  raw?: ProviderPayloadCapture[];
}

interface IngestionJobWorkResult {
  recordsProcessed: number;
  stats?: Record<string, number>;
  warnings?: IngestionJobWarning[];
  writeDiagnostics?: SyncWriteDiagnostics;
}

export interface SportSyncRequest {
  sport: Sport;
  feeds: Array<'EVENTSCHEDULE' | 'PARTICIPANTRANKINGS'>;
  from?: Date;
  to?: Date;
  workflowContext?: Record<string, unknown>;
}

export interface EventSyncRequest {
  sport: Sport;
  eventId: string;
  feeds: Array<'EVENTPARTICIPANTS' | 'EVENTLIVESCORES' | 'EVENTRESULTS'>;
  mockEventState?: MockEventState;
  workflowContext?: Record<string, unknown>;
}

export interface IngestionCallbacks {
  onEvents(events: SportEvent[]): Promise<SyncWriteDiagnostics | void>;
  onEventDetail(detail: SportEventDetail): Promise<SyncWriteDiagnostics | void>;
  onRankings(rankings: ProviderRanking[]): Promise<SyncWriteDiagnostics | void>;
  onLiveScores(result: LiveScoreResult, providerId: string): Promise<void>;
  onJobComplete(job: IngestionJobRecord): Promise<void>;
}

export interface IngestionScheduleConfigReader {
  getConfig(): Promise<IngestionScheduleConfig>;
  getPerSportConfig(sport: string): Promise<IngestionScheduleConfig>;
}

export interface IngestionScheduledEventReader {
  listEventIdsForFeed(input: {
    sport: Sport;
    feed: 'EVENTPARTICIPANTS' | 'EVENTLIVESCORES' | 'EVENTRESULTS';
    from?: Date;
    now: Date;
    to?: Date;
  }): Promise<string[]>;
}

export interface IngestionSchedulerOptions {
  configReader?: IngestionScheduleConfigReader;
  eventReader?: IngestionScheduledEventReader;
  now?: () => Date;
  syncOrchestrator?: Pick<SyncOrchestrator, 'normalizeRequest'>;
  syncRunLedger?: Pick<ProviderSyncRunLedger, 'createSubmissions' | 'executeFeedRun'>;
}

const SCHEDULED_SYNC_SOURCE: SyncRequestSource = 'SCHEDULED';
const SCHEDULED_SYNC_ACTOR = {
  type: 'SYSTEM',
  name: 'scheduler',
} as const;

export class IngestionScheduler {
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private readonly startedSportLoops = new Set<Sport>();
  private readonly syncOrchestrator: Pick<SyncOrchestrator, 'normalizeRequest'>;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly callbacks: IngestionCallbacks,
    private readonly logger?: FastifyBaseLogger,
    private readonly options: IngestionSchedulerOptions = {},
  ) {
    this.syncOrchestrator = options.syncOrchestrator ?? new SyncOrchestrator({
      now: () => this.getNow(),
    });
  }

  /** Starts all scheduled ingestion jobs. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger?.debug('Starting ingestion scheduler');
    this.startRecurringLoop(
      'health checks',
      async () => this.runHealthChecks(),
      async () => this.getGlobalDelayMs('healthCheck'),
    );

    this.startRecurringLoop(
      'configured sport loop reconciliation',
      async () => this.reconcileConfiguredSportLoops(),
      async () => CONFIG_RECHECK_MS,
    );

    this.logger?.info('Ingestion scheduler started');
  }

  private async reconcileConfiguredSportLoops(): Promise<void> {
    try {
      const sports = await this.getConfiguredScheduledSports();
      if (!this.running) {
        return;
      }
      for (const sport of sports) {
        if (this.startedSportLoops.has(sport)) {
          continue;
        }

        this.startRecurringLoop(
          `${sport} schedule sync`,
          async () => this.runConfiguredSportScheduleSync(sport),
          async () => this.getSportDelayMs(sport, 'eventSchedule'),
        );
        this.startRecurringLoop(
          `${sport} participant sync`,
          async () => this.runConfiguredSportFieldSync(sport),
          async () => this.getSportDelayMs(sport, 'eventParticipants'),
        );
        this.startRecurringLoop(
          `${sport} ranking sync`,
          async () => this.runConfiguredSportRankingSync(sport),
          async () => this.getSportDelayMs(sport, 'participantRankings'),
        );
        this.startRecurringLoop(
          `${sport} live score sync`,
          async () => this.runConfiguredEventSyncSweep(sport, 'EVENTLIVESCORES'),
          async () => this.getSportDelayMs(sport, 'eventLiveScores'),
        );
        this.startRecurringLoop(
          `${sport} results sync`,
          async () => this.runConfiguredEventSyncSweep(sport, 'EVENTRESULTS'),
          async () => this.getSportDelayMs(sport, 'eventResults'),
        );
        this.startedSportLoops.add(sport);
      }

      this.logger?.info({
        sports,
        startedSports: Array.from(this.startedSportLoops),
      }, 'Reconciled configured sport ingestion loops');
    } catch (error) {
      this.logger?.error({ error }, 'Failed to reconcile configured sport ingestion loops');
    }
  }

  /** Stops all scheduled jobs. */
  stop(): void {
    this.running = false;
    for (const timer of this.timers) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    this.timers = [];
    this.startedSportLoops.clear();
    this.logger?.info('Ingestion scheduler stopped');
  }

  /** Backward-compatible wrapper for a schedule-only sport sync. */
  async syncSport(sport: Sport): Promise<IngestionJobRecord> {
    return this.runScheduleSync(sport);
  }

  /** Runs a one-off sport sync for explicit feed types. */
  async runSportSync(request: SportSyncRequest): Promise<IngestionJobRecord[]> {
    const jobs: IngestionJobRecord[] = [];
    this.logger?.info({
      sport: request.sport,
      feeds: request.feeds,
      from: request.from?.toISOString() ?? null,
      to: request.to?.toISOString() ?? null,
    }, 'Ad hoc sport sync requested');

    for (const feed of dedupe(request.feeds)) {
      if (feed === 'EVENTSCHEDULE') {
        jobs.push(await this.runScheduleSync(request.sport, request.from, request.to));
        continue;
      }

      jobs.push(await this.runRankingSync(request.sport));
    }

    this.logger?.info({
      sport: request.sport,
      feeds: request.feeds,
      jobs: jobs.map(toJobLogPayload),
    }, 'Ad hoc sport sync completed');

    return jobs;
  }

  /** Runs a one-off event sync for explicit feed types. */
  async runEventSync(request: EventSyncRequest): Promise<IngestionJobRecord[]> {
    const jobs: IngestionJobRecord[] = [];
    this.logger?.info({
      sport: request.sport,
      eventId: request.eventId,
      feeds: request.feeds,
      mockEventState: request.mockEventState ?? null,
    }, 'Ad hoc event sync requested');

    const options = buildProviderEventSyncOptions(request.mockEventState);
    for (const feed of dedupe(request.feeds)) {
      if (feed === 'EVENTPARTICIPANTS') {
        jobs.push(await this.runEventFieldSync(request.sport, request.eventId, options));
        continue;
      }

      if (feed === 'EVENTLIVESCORES') {
        jobs.push(await this.pollLiveScores(request.sport, request.eventId, options));
        continue;
      }

      jobs.push(await this.fetchEventResults(request.sport, request.eventId, options));
    }

    this.logger?.info({
      sport: request.sport,
      eventId: request.eventId,
      feeds: request.feeds,
      mockEventState: request.mockEventState ?? null,
      jobs: jobs.map(toJobLogPayload),
    }, 'Ad hoc event sync completed');

    return jobs;
  }

  /** Polls live scores for a specific event. */
  async pollLiveScores(
    sport: Sport,
    eventId: string,
    options?: ProviderEventSyncOptions,
  ): Promise<IngestionJobRecord> {
    this.logger?.debug({ sport, eventId, mockEventState: options?.mockEventState ?? null }, 'Polling live scores for event');
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      this.logger?.warn({ sport, eventId }, 'No provider registered for live score polling');
      return createFailedJob('EVENT_LIVE_SCORES_SYNC', 'none', sport, 'No provider registered', eventId);
    }
    const unsupportedJob = createUnsupportedMockEventStateJob(provider, 'EVENT_LIVE_SCORES_SYNC', sport, eventId, options);
    if (unsupportedJob) {
      return unsupportedJob;
    }

    return this.runJob('EVENT_LIVE_SCORES_SYNC', provider.providerId, sport, 'EVENTLIVESCORES', provider, async () => {
      const result = options
        ? await provider.getLiveScores(eventId, options)
        : await provider.getLiveScores(eventId);
      const updateCount = countLiveScoreUpdates(result);
      this.logger?.debug({
        sport,
        eventId,
        providerId: provider.providerId,
        category: result.category,
        updatesReturned: updateCount,
      }, 'Provider returned live scores');
      await this.callbacks.onLiveScores(result, provider.providerId);
      this.logger?.info({
        sport,
        eventId,
        providerId: provider.providerId,
        category: result.category,
        updatesProcessed: updateCount,
      }, 'Completed live score poll');
      return {
        recordsProcessed: updateCount,
        stats: {
          providerRecordsReturned: updateCount,
          liveScoreUpdatesReturned: updateCount,
          liveScoreUpdatesProcessed: updateCount,
        },
        warnings: updateCount === 0
          ? [{
              code: 'NO_PROVIDER_LIVE_SCORES',
              message: 'Provider returned no live-score updates for the requested event.',
            }]
          : [],
      };
    }, eventId);
  }

  /** Fetches final results for a completed event. */
  async fetchEventResults(
    sport: Sport,
    eventId: string,
    options?: ProviderEventSyncOptions,
  ): Promise<IngestionJobRecord> {
    this.logger?.debug({ sport, eventId, mockEventState: options?.mockEventState ?? null }, 'Fetching event results');
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      this.logger?.warn({ sport, eventId }, 'No provider registered for event results fetch');
      return createFailedJob('EVENT_RESULTS_SYNC', 'none', sport, 'No provider registered', eventId);
    }
    const unsupportedJob = createUnsupportedMockEventStateJob(provider, 'EVENT_RESULTS_SYNC', sport, eventId, options);
    if (unsupportedJob) {
      return unsupportedJob;
    }

    return this.runJob('EVENT_RESULTS_SYNC', provider.providerId, sport, 'EVENTRESULTS', provider, async () => {
      const results = options
        ? await provider.getEventResults(eventId, options)
        : await provider.getEventResults(eventId);
      if (!results) {
        this.logger?.warn({ sport, eventId, providerId: provider.providerId }, 'Provider returned no event results');
        return {
          recordsProcessed: 0,
          stats: {
            providerRecordsReturned: 0,
            resultsReturned: 0,
          } as Record<string, number>,
          warnings: [{
            code: 'NO_PROVIDER_RESULTS',
            message: 'Provider returned no final results for the requested event.',
          }],
        };
      }

      // pool-master-rop.78.3 — the previous path synthesized a
      // ProviderStatEvent[] from final-result rows by hardcoding
      // statKey='FINISH_POSITION', then routed it through onLiveScores so
      // scoring could pick it up. With the typed LiveScoreResult contract
      // (plans/117 §10.2) final-result rows no longer fit the live-score
      // shape — final position is not a per-round update. The synthetic
      // bridge has been removed; rop.78.7 reconstitutes the final-result
      // → contribution path against the typed substrate. This handler
      // still records the job count so admin event-results triggers
      // remain observable.
      this.logger?.info({
        sport,
        eventId,
        providerId: provider.providerId,
        resultsReturned: results.results.length,
      }, 'Fetched event results (no live-score bridge — rop.78.7 rebuilds)');
      return {
        recordsProcessed: results.results.length,
        stats: {
          providerRecordsReturned: results.results.length,
          resultsReturned: results.results.length,
          resultsProcessed: results.results.length,
        } as Record<string, number>,
        warnings: results.results.length === 0
          ? [{
              code: 'NO_PROVIDER_RESULTS',
              message: 'Provider returned an empty final-results payload.',
            }]
          : [],
      };
    }, eventId);
  }

  private async runHealthChecks(): Promise<void> {
    this.logger?.debug('Running provider health checks');
    const providers = this.registry.getAllProviders();
    for (const provider of providers) {
      try {
        const health = await provider.healthCheck();
        this.registry.updateHealth(provider.providerId, health);
        this.logger?.info({
          providerId: provider.providerId,
          status: health.status,
        }, 'Completed provider health check');
      } catch (error) {
        const failure = toIngestionFailureLog(error);
        this.registry.updateHealth(provider.providerId, {
          providerId: provider.providerId,
          status: 'DOWN',
          errorRateLastHour: 1,
          latencyMsP95: 0,
          message: `Health check failed: ${failure.errorMessage}`,
        });
        this.logger?.error({
          providerId: provider.providerId,
          ...failure,
        }, 'Provider health check threw exception');
      }
    }
  }

  private async runConfiguredSportScheduleSync(sport: Sport): Promise<void> {
    if (!(await this.isSportScheduled(sport))) {
      this.logger?.debug({ sport }, 'Skipping scheduled sport schedule sync because sport is not configured');
      return;
    }

    const config = await this.getSportConfig(sport);
    if (!config.eventSchedule.enabled) {
      this.logger?.debug({ sport }, 'Skipping scheduled sport schedule sync because it is disabled');
      return;
    }

    const normalized = this.normalizeScheduledSportSync({
      sport,
      feeds: ['EVENTSCHEDULE'],
      windowPolicy: resolveSportSyncWindowPolicy({ feeds: ['EVENTSCHEDULE'], config }),
    });
    const scope = assertScheduledSportScope(normalized);
    this.logger?.debug({
      sport,
      from: scope.effectiveWindow.from.toISOString(),
      to: scope.effectiveWindow.to.toISOString(),
    }, 'Running configured sport schedule sync');
    await this.executeScheduledSyncRun(normalized, () =>
      this.runScheduleSync(scope.sport, scope.effectiveWindow.from, scope.effectiveWindow.to),
    );
  }

  private async runConfiguredSportFieldSync(sport: Sport): Promise<void> {
    if (!(await this.isSportScheduled(sport))) {
      this.logger?.debug({ sport }, 'Skipping scheduled participant sync because sport is not configured');
      return;
    }

    const config = await this.getSportConfig(sport);
    if (!config.eventParticipants.enabled) {
      this.logger?.debug({ sport }, 'Skipping scheduled participant sync because it is disabled');
      return;
    }

    const window = resolveEventParticipantSyncWindow(config, this.getNow());
    this.logger?.debug({
      sport,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    }, 'Running configured sport participant sync');
    await this.runConfiguredActiveFieldSync(sport, window);
  }

  private async runConfiguredActiveFieldSync(
    sport: Sport,
    window: { from: Date; to: Date },
  ): Promise<void> {
    const eventReader = this.options.eventReader;
    if (!eventReader) {
      this.logger?.debug({ sport }, 'Skipping active event participant sync because no event reader is configured');
      return;
    }

    const eventIds = await eventReader.listEventIdsForFeed({
      sport,
      feed: 'EVENTPARTICIPANTS',
      from: window.from,
      now: this.getNow(),
      to: window.to,
    });

    this.logger?.debug({
      sport,
      eventCount: eventIds.length,
      eventIds,
    }, 'Resolved active event participant sync candidates');

    for (const eventId of eventIds) {
      const normalized = this.normalizeScheduledEventSync({
        sport,
        eventId,
        feeds: ['EVENTPARTICIPANTS'],
      });
      const scope = assertScheduledEventScope(normalized);
      await this.executeScheduledSyncRun(normalized, () =>
        this.runEventFieldSync(scope.sport, scope.eventId, scope.providerOptions),
      );
    }
  }

  private async runConfiguredSportRankingSync(sport: Sport): Promise<void> {
    if (!(await this.isSportScheduled(sport))) {
      this.logger?.debug({ sport }, 'Skipping scheduled ranking sync because sport is not configured');
      return;
    }

    const config = await this.getSportConfig(sport);
    if (!config.participantRankings.enabled) {
      this.logger?.debug({ sport }, 'Skipping scheduled ranking sync because it is disabled');
      return;
    }

    this.logger?.debug({ sport }, 'Running configured sport ranking sync');
    const normalized = this.normalizeScheduledSportSync({
      sport,
      feeds: ['PARTICIPANTRANKINGS'],
    });
    const scope = assertScheduledSportScope(normalized);
    await this.executeScheduledSyncRun(normalized, () => this.runRankingSync(scope.sport));
  }

  private async runConfiguredEventSyncSweep(
    sport: Sport,
    feed: 'EVENTLIVESCORES' | 'EVENTRESULTS',
  ): Promise<void> {
    if (!(await this.isSportScheduled(sport))) {
      this.logger?.debug({ sport, feed }, 'Skipping scheduled event sync sweep because sport is not configured');
      return;
    }

    const config = await this.getSportConfig(sport);
    const policy = feed === 'EVENTLIVESCORES' ? config.eventLiveScores : config.eventResults;
    if (!policy.enabled) {
      this.logger?.debug({ sport, feed }, 'Skipping scheduled event sync sweep because it is disabled');
      return;
    }

    const eventReader = this.options.eventReader;
    if (!eventReader) {
      this.logger?.debug({ sport, feed }, 'Skipping scheduled event sync because no event reader is configured');
      return;
    }

    const eventIds = await eventReader.listEventIdsForFeed({
      sport,
      feed,
      now: this.getNow(),
    });

    this.logger?.debug({
      sport,
      feed,
      eventCount: eventIds.length,
      eventIds,
    }, 'Resolved scheduled event sync candidates');

    for (const eventId of eventIds) {
      const normalized = this.normalizeScheduledEventSync({
        sport,
        eventId,
        feeds: [feed],
      });
      const scope = assertScheduledEventScope(normalized);
      if (scope.feeds[0] === 'EVENTLIVESCORES') {
        await this.executeScheduledSyncRun(normalized, () =>
          this.pollLiveScores(scope.sport, scope.eventId, scope.providerOptions),
        );
      } else {
        await this.executeScheduledSyncRun(normalized, () =>
          this.fetchEventResults(scope.sport, scope.eventId, scope.providerOptions),
        );
      }
    }
  }

  private normalizeScheduledSportSync(input: {
    sport: Sport;
    feeds: readonly SportSyncFeed[];
    window?: { from?: Date; to?: Date };
    windowPolicy?: SyncWindowPolicy;
  }): NormalizedSyncRequest {
    const normalized = this.syncOrchestrator.normalizeRequest({
      source: SCHEDULED_SYNC_SOURCE,
      actor: SCHEDULED_SYNC_ACTOR,
      scope: {
        type: 'SPORT',
        sport: input.sport,
        feeds: input.feeds,
        window: input.window,
        windowPolicy: input.windowPolicy,
      },
    } satisfies SyncOrchestratorRequest);

    if (normalized.scope.type !== 'SPORT') {
      throw new Error('Scheduled sport sync normalization returned an event scope.');
    }

    return normalized;
  }

  private normalizeScheduledEventSync(input: {
    sport: Sport;
    eventId: string;
    feeds: readonly EventSyncFeed[];
  }): NormalizedSyncRequest {
    const normalized = this.syncOrchestrator.normalizeRequest({
      source: SCHEDULED_SYNC_SOURCE,
      actor: SCHEDULED_SYNC_ACTOR,
      scope: {
        type: 'EVENT',
        sport: input.sport,
        eventId: input.eventId,
        feeds: input.feeds,
      },
    } satisfies SyncOrchestratorRequest);

    if (normalized.scope.type !== 'EVENT') {
      throw new Error('Scheduled event sync normalization returned a sport scope.');
    }

    return normalized;
  }

  private async executeScheduledSyncRun(
    normalizedRequest: NormalizedSyncRequest,
    run: () => Promise<IngestionJobRecord>,
  ): Promise<IngestionJobRecord> {
    const syncRunLedger = this.options.syncRunLedger;
    if (!syncRunLedger) {
      return run();
    }

    const target = getNormalizedSyncTarget(normalizedRequest);
    const provider = this.registry.getProvider(target.sport);
    const providerId = provider?.providerId ?? 'none';
    const [syncRun] = await syncRunLedger.createSubmissions({
      normalizedRequest,
      providerId,
      submittedAt: this.getNow(),
      runType: target.eventId ? 'SCHEDULED_EVENT_SYNC' : 'SCHEDULED_SPORT_SYNC',
    });

    if (!syncRun) {
      throw new Error('Scheduled sync ledger did not create a provider sync run.');
    }

    return syncRunLedger.executeFeedRun(syncRun, run);
  }

  private async runScheduleSync(
    sport: Sport,
    from?: Date,
    to?: Date,
  ): Promise<IngestionJobRecord> {
    const dateRange = resolveDateRange(from, to);
    this.logger?.debug({
      sport,
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
    }, 'Running schedule sync for sport');
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      this.logger?.warn({ sport }, 'No provider registered for schedule sync');
      return createFailedJob('EVENT_SCHEDULE_SYNC', 'none', sport, 'No provider registered');
    }

    return this.runJob('EVENT_SCHEDULE_SYNC', provider.providerId, sport, 'EVENTSCHEDULE', provider, async () => {
      const events = await provider.getUpcomingEvents(sport, dateRange);
      this.logger?.debug({
        sport,
        providerId: provider.providerId,
        eventsReturned: events.length,
        eventSample: events.slice(0, 10).map(toEventSample),
      }, 'Provider returned upcoming events');
      if (events.length === 0) {
        this.logger?.warn({
          sport,
          providerId: provider.providerId,
          from: dateRange.from.toISOString(),
          to: dateRange.to.toISOString(),
        }, 'Provider returned no upcoming events for schedule sync');
      }
      const writeDiagnostics = await this.callbacks.onEvents(events);
      this.logger?.info({
        sport,
        providerId: provider.providerId,
        eventsProcessed: events.length,
        from: dateRange.from.toISOString(),
        to: dateRange.to.toISOString(),
      }, 'Completed schedule sync for sport');
      return {
        recordsProcessed: events.length,
        stats: {
          providerRecordsReturned: events.length,
          eventsFetched: events.length,
          eventsProcessed: events.length,
          ...syncWriteStats(writeDiagnostics ?? undefined),
        },
        writeDiagnostics: writeDiagnostics ?? undefined,
        warnings: events.length === 0
          ? [{
              code: 'NO_PROVIDER_EVENTS',
              message: 'Provider returned no upcoming events for the requested sport/date window.',
            }]
          : [],
      };
    });
  }

  private async runEventFieldSync(
    sport: Sport,
    eventId: string,
    options?: ProviderEventSyncOptions,
  ): Promise<IngestionJobRecord> {
    this.logger?.debug({ sport, eventId, mockEventState: options?.mockEventState ?? null }, 'Running participant sync for event');
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      this.logger?.warn({ sport, eventId }, 'No provider registered for event participant sync');
      return createFailedJob('EVENT_PARTICIPANTS_SYNC', 'none', sport, 'No provider registered', eventId);
    }
    const unsupportedJob = createUnsupportedMockEventStateJob(provider, 'EVENT_PARTICIPANTS_SYNC', sport, eventId, options);
    if (unsupportedJob) {
      return unsupportedJob;
    }

    return this.runJob('EVENT_PARTICIPANTS_SYNC', provider.providerId, sport, 'EVENTPARTICIPANTS', provider, async () => {
      const detail = options
        ? await provider.getEventDetails(eventId, options)
        : await provider.getEventDetails(eventId);
      if (!detail) {
        this.logger?.warn({ sport, eventId, providerId: provider.providerId }, 'Provider returned no event detail for participant sync');
        throw new Error(`Provider returned no event detail for event ${eventId}`);
      }

      const writeDiagnostics = await this.callbacks.onEventDetail(detail);
      this.logger?.info({
        sport,
        eventId,
        providerId: provider.providerId,
        participantCount: detail.participants.length,
      }, 'Completed participant sync for event');
      return {
        recordsProcessed: detail.participants.length,
        stats: {
          providerRecordsReturned: detail.participants.length,
          eventsHydrated: 1,
          participantsReturned: detail.participants.length,
          ...syncWriteStats(writeDiagnostics ?? undefined),
        },
        writeDiagnostics: writeDiagnostics ?? undefined,
        warnings: detail.participants.length === 0
          ? [{
              code: 'NO_PROVIDER_PARTICIPANTS',
              message: 'Provider returned event details with no participants.',
            }]
          : [],
      };
    }, eventId);
  }

  private async runRankingSync(sport: Sport): Promise<IngestionJobRecord> {
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      this.logger?.warn({ sport }, 'No provider registered for ranking sync');
      return createFailedJob('PARTICIPANT_RANKINGS_SYNC', 'none', sport, 'No provider registered');
    }

    return this.runJob('PARTICIPANT_RANKINGS_SYNC', provider.providerId, sport, 'PARTICIPANTRANKINGS', provider, async () => {
      const rankingType = resolveRankingType(sport);
      const rankings = await provider.getRankings(sport, rankingType);
      this.logger?.debug({
        sport,
        providerId: provider.providerId,
        rankingType,
        rankingsReturned: rankings.length,
      }, 'Provider returned rankings');
      const writeDiagnostics = await this.callbacks.onRankings(rankings);
      this.logger?.info({
        sport,
        providerId: provider.providerId,
        rankingsProcessed: rankings.length,
      }, 'Completed ranking sync for sport');
      return {
        recordsProcessed: rankings.length,
        stats: {
          providerRecordsReturned: rankings.length,
          rankingsFetched: rankings.length,
          rankingsProcessed: rankings.length,
          ...syncWriteStats(writeDiagnostics ?? undefined),
        },
        writeDiagnostics: writeDiagnostics ?? undefined,
        warnings: rankings.length === 0
          ? [{
              code: 'NO_PROVIDER_RANKINGS',
              message: 'Provider returned no participant rankings.',
            }]
          : [],
      };
    });
  }

  private async runJob(
    jobType: JobType,
    providerId: string,
    sport: Sport,
    feed: IngestionFeedType,
    provider: SportDataProvider,
    work: () => Promise<number | IngestionJobWorkResult>,
    eventExternalId?: string,
  ): Promise<IngestionJobRecord> {
    const job: IngestionJobRecord = {
      jobType,
      providerId,
      sport,
      eventExternalId,
      status: 'RUNNING',
      startedAt: new Date(),
      recordsProcessed: 0,
      errors: 0,
      errorLog: [],
    };

    const payloadCaptureSession = createProviderPayloadCaptureSession(provider);

    try {
      this.logger?.debug({
        jobType,
        providerId,
        sport,
        eventExternalId: eventExternalId ?? null,
        startedAt: job.startedAt?.toISOString() ?? null,
      }, 'Ingestion job started');
      if (supportsProviderPayloadDiagnostics(provider) && !payloadCaptureSession) {
        provider.clearProviderPayloads();
      }
      const result = payloadCaptureSession
        ? await payloadCaptureSession.run(work)
        : await work();
      if (typeof result === 'number') {
        job.recordsProcessed = result;
      } else {
        job.recordsProcessed = result.recordsProcessed;
        job.stats = result.stats;
        job.warnings = result.warnings;
        job.writeDiagnostics = result.writeDiagnostics;
      }
      job.providerPayload = buildProviderPayload(feed, provider, payloadCaptureSession);
      job.status = 'COMPLETED';
      job.completedAt = new Date();
    } catch (err) {
      job.providerPayload = buildProviderPayload(feed, provider, payloadCaptureSession);
      const failure = toIngestionFailureLog(err);
      this.logger?.error({
        jobType,
        providerId,
        sport,
        eventExternalId,
        ...failure,
      }, 'Ingestion job failed');
      job.status = 'FAILED';
      job.errors = 1;
      job.errorLog = [{ error: failure.errorMessage, at: new Date() }];
      job.completedAt = new Date();
    }

    await this.callbacks.onJobComplete(job);
    this.logger?.info({
      ...toJobLogPayload(job),
      durationMs: job.completedAt && job.startedAt
        ? job.completedAt.getTime() - job.startedAt.getTime()
        : null,
    }, 'Ingestion job completed');
    return job;
  }

  private startRecurringLoop(
    label: string,
    runner: () => Promise<void>,
    resolveDelayMs: () => Promise<number>,
  ): void {
    const tick = async () => {
      if (!this.running) {
        return;
      }

      try {
        this.logger?.debug({ label }, 'Recurring ingestion loop tick started');
        await runner();
      } catch (error) {
        this.logger?.error({ error, label }, 'Recurring ingestion loop failed');
      }

      const delayMs = await this.safeResolveDelayMs(resolveDelayMs);
      if (!this.running) {
        return;
      }

      const timer = setTimeout(() => {
        void tick();
      }, delayMs);
      this.timers.push(timer);
      this.logger?.debug({ label, delayMs }, 'Recurring ingestion loop scheduled next tick');
    };

    void tick();
  }

  private async getGlobalDelayMs(
    feed: keyof Pick<IngestionScheduleConfig, 'healthCheck'>,
  ): Promise<number> {
    const config = await this.getGlobalConfig();
    return toDelayMs(config[feed]);
  }

  private async getSportDelayMs(
    sport: Sport,
    feed: keyof Omit<IngestionScheduleConfig, 'perSportOverrides' | 'scheduledSports'>,
  ): Promise<number> {
    const config = await this.getSportConfig(sport);
    return toDelayMs(config[feed]);
  }

  private async getGlobalConfig(): Promise<IngestionScheduleConfig> {
    if (!this.options.configReader) {
      return defaultIngestionScheduleConfig();
    }

    return this.options.configReader.getConfig();
  }

  private async getConfiguredScheduledSports(): Promise<Sport[]> {
    const config = await this.getGlobalConfig();
    const registeredSports = new Set(this.registry.getSupportedSports());
    const configuredSports = Array.from(new Set(config.scheduledSports));
    const unregisteredSports = configuredSports.filter((sport) => !registeredSports.has(sport));
    if (unregisteredSports.length > 0) {
      this.logger?.warn({
        configuredSports,
        unregisteredSports,
      }, 'Configured scheduled ingestion sports have no registered provider');
    }

    return configuredSports.filter((sport) => registeredSports.has(sport));
  }

  private async isSportScheduled(sport: Sport): Promise<boolean> {
    const sports = await this.getConfiguredScheduledSports();
    return sports.includes(sport);
  }

  private async getSportConfig(sport: Sport): Promise<IngestionScheduleConfig> {
    if (!this.options.configReader) {
      return defaultIngestionScheduleConfig();
    }

    return this.options.configReader.getPerSportConfig(sport);
  }

  private getNow(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async safeResolveDelayMs(resolveDelayMs: () => Promise<number>): Promise<number> {
    try {
      return await resolveDelayMs();
    } catch (error) {
      this.logger?.error({ error }, 'Falling back to config recheck delay because policy resolution failed');
      return CONFIG_RECHECK_MS;
    }
  }
}

/**
 * Count the number of per-category updates inside a `LiveScoreResult` so
 * the scheduler can record `recordsProcessed` consistently regardless of
 * the result's category. Per plans/117 §10.2 each category exposes its
 * updates under a category-specific key (rounds, games, results, matches).
 */
function countLiveScoreUpdates(result: LiveScoreResult): number {
  switch (result.category) {
    case 'GOLF':
      return result.rounds.length;
    case 'BASKETBALL':
      return result.games.length;
    case 'F1':
      return result.results.length;
    case 'NFL':
      return result.games.length;
    case 'NASCAR':
      return result.results.length;
    case 'TENNIS':
      return result.matches.length;
    case 'SOCCER':
      return result.matches.length;
  }
}

function resolveDateRange(from?: Date, to?: Date): { from: Date; to: Date } {
  const resolvedFrom = from ?? new Date();
  const resolvedTo = to ?? new Date(resolvedFrom.getTime() + 14 * 24 * 60 * 60 * 1000);
  return {
    from: resolvedFrom,
    to: resolvedTo,
  };
}

function resolveEventParticipantSyncWindow(
  config: IngestionScheduleConfig,
  now: Date,
): { from: Date; to: Date } {
  const lookaheadDays = config.eventSchedule.lookaheadDays ?? 30;
  return {
    from: now,
    to: new Date(now.getTime() + lookaheadDays * 24 * 60 * 60 * 1000),
  };
}

function createFailedJob(
  jobType: JobType,
  providerId: string,
  sport: Sport,
  error: string,
  eventExternalId?: string,
): IngestionJobRecord {
  return {
    jobType,
    providerId,
    sport,
    eventExternalId,
    status: 'FAILED',
    startedAt: new Date(),
    completedAt: new Date(),
    recordsProcessed: 0,
    errors: 1,
    errorLog: [{ error, at: new Date() }],
    warnings: [],
  };
}

function assertScheduledSportScope(normalized: NormalizedSyncRequest): NormalizedSportSyncScope {
  if (normalized.scope.type !== 'SPORT') {
    throw new Error('Scheduled sport sync normalization returned an event scope.');
  }
  return normalized.scope;
}

function assertScheduledEventScope(normalized: NormalizedSyncRequest): NormalizedEventSyncScope {
  if (normalized.scope.type !== 'EVENT') {
    throw new Error('Scheduled event sync normalization returned a sport scope.');
  }
  return normalized.scope;
}

function getNormalizedSyncTarget(normalized: NormalizedSyncRequest): {
  sport: Sport;
  eventId: string | null;
} {
  if (normalized.scope.type === 'SPORT') {
    return {
      sport: normalized.scope.sport,
      eventId: null,
    };
  }

  return {
    sport: normalized.scope.sport,
    eventId: normalized.scope.eventId,
  };
}

function buildProviderEventSyncOptions(
  mockEventState: MockEventState | undefined,
): ProviderEventSyncOptions | undefined {
  return mockEventState ? { mockEventState } : undefined;
}

function createUnsupportedMockEventStateJob(
  provider: SportDataProvider,
  jobType: JobType,
  sport: Sport,
  eventId: string,
  options?: ProviderEventSyncOptions,
): IngestionJobRecord | null {
  if (!options?.mockEventState || supportsMockEventStateControls(provider)) {
    return null;
  }

  return createFailedJob(
    jobType,
    provider.providerId,
    sport,
    `Provider ${provider.providerId} does not support mock event state controls.`,
    eventId,
  );
}

function buildProviderPayload(
  operation: IngestionFeedType,
  provider: SportDataProvider,
  captureSession?: ProviderPayloadCaptureSession | null,
): IngestionJobProviderPayload {
  if (captureSession) {
    const raw = captureSession.consumeProviderPayloads();
    const payload: IngestionJobProviderPayload = {
      operation,
      rawCaptured: raw.length > 0,
      rawTruncated: false,
    };
    if (raw.length > 0) {
      payload.raw = raw;
    }
    return payload;
  }

  if (!supportsProviderPayloadDiagnostics(provider)) {
    return {
      operation,
      rawCaptured: false,
      rawTruncated: false,
    };
  }

  const raw = provider.consumeProviderPayloads();
  const payload: IngestionJobProviderPayload = {
    operation,
    rawCaptured: raw.length > 0,
    rawTruncated: false,
  };
  if (raw.length > 0) {
    payload.raw = raw;
  }
  return payload;
}

function createProviderPayloadCaptureSession(
  provider: SportDataProvider,
): ProviderPayloadCaptureSession | null {
  if (
    supportsProviderPayloadDiagnostics(provider)
    && typeof provider.beginProviderPayloadCapture === 'function'
  ) {
    return provider.beginProviderPayloadCapture();
  }

  return null;
}

function dedupe<T extends string>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}

function toEventSample(event: SportEvent): Record<string, unknown> {
  return {
    externalId: event.externalId,
    providerId: event.providerId,
    name: event.name,
    status: event.status,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate?.toISOString() ?? null,
    participantCount: event.participantCount ?? null,
    releaseAt: event.metadata.releaseAt ?? null,
    fieldLocksAt: event.metadata.fieldLocksAt ?? null,
  };
}

function toJobLogPayload(job: IngestionJobRecord): Record<string, unknown> {
  return {
    jobType: job.jobType,
    providerId: job.providerId,
    sport: job.sport,
    eventExternalId: job.eventExternalId ?? null,
    status: job.status,
    recordsProcessed: job.recordsProcessed,
    errors: job.errors,
    stats: job.stats ?? null,
    warnings: job.warnings ?? [],
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

function toIngestionFailureLog(error: unknown): {
  err?: Error;
  errorMessage: string;
  errorName: string;
} {
  if (error instanceof Error) {
    return {
      err: error,
      errorMessage: error.message,
      errorName: error.name,
    };
  }

  return {
    errorMessage: String(error),
    errorName: typeof error,
  };
}

const CONFIG_RECHECK_MS = 60 * 1000;

function defaultIngestionScheduleConfig(): IngestionScheduleConfig {
    return {
      scheduledSports: ['GOLF' as Sport],
      healthCheck: {
        enabled: true,
        intervalMinutes: 5,
      },
    eventSchedule: {
        enabled: true,
        intervalMinutes: 360,
        lookaheadDays: 30,
      },
    eventParticipants: {
        enabled: true,
        intervalMinutes: 720,
      },
    participantRankings: {
        enabled: true,
        intervalMinutes: 1440,
      },
    eventLiveScores: {
        enabled: true,
        intervalSeconds: 30,
      },
    eventResults: {
        enabled: true,
        intervalMinutes: 30,
      },
    perSportOverrides: {},
  };
}

function toDelayMs(
  policy: IngestionScheduleConfig[keyof Omit<IngestionScheduleConfig, 'perSportOverrides' | 'scheduledSports'>],
): number {
  if (!policy.enabled) {
    return CONFIG_RECHECK_MS;
  }

  if (policy.intervalSeconds) {
    return policy.intervalSeconds * 1000;
  }

  if (policy.intervalMinutes) {
    return policy.intervalMinutes * 60 * 1000;
  }

  return CONFIG_RECHECK_MS;
}
