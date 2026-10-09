/**
 * IngestionScheduler — orchestrates periodic data polling from providers.
 *
 * Schedules jobs for:
 * - Event participant hydration (every 6h for the next unlocked field-ready events; off by default)
 * - Live score polling (every 5 min during active events)
 * - Provider health checks (every 5 min)
 *
 * Every feed is event-scoped. There is no scheduled event discovery: an admin creates each
 * event and moves its lifecycle by hand (#126).
 */

import type { IngestionJobStatus, Sport } from '@poolmaster/shared/domain';
import type { IngestionScheduleConfig } from '@poolmaster/shared/dto/config.dto';
import type { FastifyBaseLogger } from 'fastify';
import type { ProviderRegistry } from './provider-registry';
import { SyncOrchestrator } from './sync-orchestrator';
import type { SyncWriteDiagnostics } from './sync-write-diagnostics';
import { syncWriteStats } from './sync-write-diagnostics';
import type {
  EventSyncFeed,
  IngestionFeedType,
  NormalizedSyncRequest,
  NormalizedEventSyncScope,
  SyncOrchestratorRequest,
  SyncRequestSource,
} from './sync-orchestrator';
import type {
  ProviderEventSyncOptions,
  ProviderPayloadCapture,
  ProviderPayloadCaptureSession,
  SportDataProvider,
  SportEventDetail,
} from './provider-interface';
import { supportsMockEventStateControls, supportsProviderPayloadDiagnostics } from './provider-interface';
import type { LiveScoreResult, MockEventState } from '@poolmaster/shared/dto';
import type { ProviderSyncRunLedger } from '../persistence/provider-sync-run-ledger';
import type { LiveScorePersistenceResult } from './score-publisher';

export type { IngestionFeedType } from './sync-orchestrator';

export type JobType =
  | 'EVENT_PARTICIPANTS_SYNC'
  | 'EVENT_LIVE_SCORES_SYNC';

export interface IngestionJobErrorLogEntry {
  error: string;
  at: Date;
}

export interface IngestionJobRecord {
  jobType: JobType;
  providerId: string;
  sport: Sport;
  eventExternalId?: string;
  status: IngestionJobStatus;
  startedAt?: Date;
  completedAt?: Date;
  recordsProcessed: number;
  errors: number;
  errorLog: IngestionJobErrorLogEntry[];
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

export interface EventSyncRequest {
  sport: Sport;
  eventId: string;
  feeds: EventSyncFeed[];
  mockEventState?: MockEventState;
}

export interface IngestionCallbacks {
  onEventDetail(detail: SportEventDetail): Promise<SyncWriteDiagnostics | void>;
  onLiveScores(result: LiveScoreResult, providerId: string): Promise<LiveScorePersistenceResult>;
}

export interface IngestionScheduleConfigReader {
  getConfig(): Promise<IngestionScheduleConfig>;
  getPerSportConfig(sport: string): Promise<IngestionScheduleConfig>;
}

export interface IngestionScheduledEventReader {
  listEventIdsForFeed(input: {
    sport: Sport;
    feed: EventSyncFeed;
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
  private readonly inFlightScheduledEventSyncs = new Set<string>();
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
      // eslint-disable-next-line @typescript-eslint/require-await -- resolveDelayMs must return Promise<number>; this constant needs the async wrap, not an await.
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
          `${sport} participant sync`,
          async () => this.runConfiguredSportFieldSync(sport),
          async () => this.getSportDelayMs(sport, 'eventParticipants'),
        );
        this.startRecurringLoop(
          `${sport} live score sync`,
          async () => this.runConfiguredLiveScoreSweep(sport),
          async () => this.getSportDelayMs(sport, 'eventLiveScores'),
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
    this.inFlightScheduledEventSyncs.clear();
    this.logger?.info('Ingestion scheduler stopped');
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

      jobs.push(await this.pollLiveScores(request.sport, request.eventId, options));
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
      const persistenceResult = await this.callbacks.onLiveScores(result, provider.providerId);
      const writeDiagnostics = persistenceResult.writeDiagnostics;
      const updatesPersisted = persistenceResult.updatesPersisted;
      const updatesSkipped = persistenceResult.updatesSkipped;
      this.logger?.info({
        sport,
        eventId,
        providerId: provider.providerId,
        category: result.category,
        updatesProcessed: updatesPersisted,
        updatesSkipped,
      }, 'Completed live score poll');
      return {
        recordsProcessed: updateCount,
        stats: {
          providerRecordsReturned: updateCount,
          liveScoreUpdatesReturned: updateCount,
          liveScoreUpdatesProcessed: updatesPersisted,
          liveScoreUpdatesSkipped: updatesSkipped,
          ...syncWriteStats(writeDiagnostics),
        },
        writeDiagnostics,
        warnings: updateCount === 0
          ? [{
              code: 'NO_PROVIDER_LIVE_SCORES',
              message: 'Provider returned no live-score updates for the requested event.',
            }]
          : [],
      };
    }, eventId);
  }

  private async runHealthChecks(): Promise<void> {
    if (!(await this.getGlobalConfig()).healthCheck.enabled) {
      this.logger?.debug('Skipping provider health checks because they are disabled');
      return;
    }
    this.logger?.debug('Running provider health checks');
    const providers = this.registry.getAllProviders();
    for (const provider of providers) {
      try {
        const health = await provider.healthCheck();
        this.logger?.info({
          providerId: provider.providerId,
          status: health.status,
        }, 'Completed provider health check');
      } catch (error) {
        const failure = toIngestionFailureLog(error);
        this.logger?.error({
          providerId: provider.providerId,
          ...failure,
        }, 'Provider health check threw exception');
      }
    }
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

  private async runConfiguredLiveScoreSweep(sport: Sport): Promise<void> {
    const feed = 'EVENTLIVESCORES' as const;
    if (!(await this.isSportScheduled(sport))) {
      this.logger?.debug({ sport, feed }, 'Skipping scheduled event sync sweep because sport is not configured');
      return;
    }

    const config = await this.getSportConfig(sport);
    if (!config.eventLiveScores.enabled) {
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
      const inFlightKey = buildScheduledEventSyncKey(sport, feed, eventId);
      if (this.inFlightScheduledEventSyncs.has(inFlightKey)) {
        this.logger?.debug({ sport, feed, eventId }, 'Skipping scheduled event sync because a run is already in flight');
        continue;
      }
      this.inFlightScheduledEventSyncs.add(inFlightKey);
      const normalized = this.normalizeScheduledEventSync({
        sport,
        eventId,
        feeds: [feed],
      });
      const scope = assertScheduledEventScope(normalized);
      try {
        await this.executeScheduledSyncRun(normalized, () =>
          this.pollLiveScores(scope.sport, scope.eventId, scope.providerOptions),
        );
      } finally {
        this.inFlightScheduledEventSyncs.delete(inFlightKey);
      }
    }
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

    const provider = this.registry.getProvider(normalizedRequest.scope.sport);
    const providerId = provider?.providerId ?? 'none';
    const [syncRun] = await syncRunLedger.createSubmissions({
      normalizedRequest,
      providerId,
      submittedAt: this.getNow(),
      runType: 'SCHEDULED_EVENT_SYNC',
    });

    if (!syncRun) {
      throw new Error('Scheduled sync ledger did not create a provider sync run.');
    }

    return syncRunLedger.executeFeedRun(syncRun, run);
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

function resolveEventParticipantSyncWindow(
  config: IngestionScheduleConfig,
  now: Date,
): { from: Date; to: Date } {
  const lookaheadDays = config.eventParticipants.lookaheadDays ?? 14;
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

function assertScheduledEventScope(normalized: NormalizedSyncRequest): NormalizedEventSyncScope {
  if (normalized.scope.type !== 'EVENT') {
    throw new Error('Scheduled event sync normalization returned a sport scope.');
  }
  return normalized.scope;
}

function buildProviderEventSyncOptions(
  mockEventState: MockEventState | undefined,
): ProviderEventSyncOptions | undefined {
  return mockEventState ? { mockEventState } : undefined;
}

function buildScheduledEventSyncKey(
  sport: Sport,
  feed: EventSyncFeed,
  eventId: string,
): string {
  return `${sport}:${feed}:${eventId}`;
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
      rawTruncated: raw.some((entry) => entry.rawOmitted === true),
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
    rawTruncated: raw.some((entry) => entry.rawOmitted === true),
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
    eventParticipants: {
        enabled: false,
        intervalMinutes: 360,
        lookaheadDays: 14,
      },
    eventLiveScores: {
        enabled: true,
        intervalSeconds: 300,
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
