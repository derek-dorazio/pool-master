/**
 * IngestionScheduler — orchestrates periodic data polling from providers.
 *
 * Schedules jobs for:
 * - Event participant hydration (every 6h for the next unlocked field-ready events): on by default for
 *   synced sport leagues' events (ADR 0011, #1726), and for every linked event when the admin turns
 *   the feed on
 * - Live score polling (every 5 min during active events)
 *
 * Every feed is event-scoped. A synced sport league's events are created by
 * `SyncedEventCreationScheduler` (ADR 0011, #1725), not here; status follows each event's dates
 * through the lifecycle scheduler.
 *
 * Every server task runs this scheduler, and each provider loop runs on one of them (#1159): the
 * task holding that loop's job lock.
 */

import { JobTrigger, ProviderSyncFindingKind, ProviderSyncKind, type IngestionJobStatus, type Sport } from '@poolmaster/shared/domain';
import { INGESTION_SCHEDULE_SETTINGS } from '../../platform/ingestion-config-service';
import type { IngestionScheduleConfig } from '@poolmaster/shared/dto/config.dto';
import { SCHEDULE_RECHECK_MS, schedulePolicyDelayMs } from '../../../core/schedule-policy-delay';
import type { FastifyBaseLogger } from 'fastify';
import type { JobLock } from '../../../core/job-lock';
import type { ProviderRegistry } from './provider-registry';
import { SyncOrchestrator } from './sync-orchestrator';
import type { SyncWriteDiagnostics } from './sync-write-diagnostics';
import { syncWriteStats } from './sync-write-diagnostics';
import type {
  EventSyncFeed,
  IngestionFeedType,
  NormalizedSyncRequest,
  SyncOrchestratorRequest,
  SyncRequestSource,
} from './sync-orchestrator';
import type {
  ProviderPayloadCapture,
  ProviderPayloadCaptureSession,
  SportDataProvider,
  SportEventDetail,
} from './provider-interface';
import { supportsProviderPayloadDiagnostics } from './provider-interface';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type { ProviderSyncRunLedger } from '../persistence/provider-sync-run-ledger';
import type { LiveScorePersistenceResult } from './score-publisher';
import { countLiveScoreUpdates } from './live-score-count';
import { runWithJobStart, SCHEDULE_START } from '../../../core/job-start';
import { jobDeferredUntilOf } from '../../background-jobs/job-error-type';

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

/** A problem a feed run found; one whose code is a finding kind is raised as that finding by the ledger. */
export interface IngestionJobWarning {
  /** The finding kind the warning raises (#1999), typed so a renamed kind fails typecheck. */
  code: ProviderSyncFindingKind;
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
  /** The provider the event is linked to (#1495). */
  providerId: string;
  eventId: string;
  feeds: EventSyncFeed[];
}

/**
 * What writing a provider's event detail did: its write diagnostics. A score the feed sends for a
 * participant nothing maps is an UNMAPPED_PARTICIPANT finding (`publishLiveScoreUpdate`).
 */
export interface EventDetailPersisted {
  writeDiagnostics: SyncWriteDiagnostics;
}

export interface IngestionCallbacks {
  onEventDetail(detail: SportEventDetail): Promise<EventDetailPersisted>;
  onLiveScores(result: LiveScoreResult, providerId: string): Promise<LiveScorePersistenceResult>;
}

/** One schedule for every sport league (#1871). */
export interface IngestionScheduleConfigReader {
  getConfig(): Promise<IngestionScheduleConfig>;
}

/** A linked event a scheduled sweep syncs: the provider it is linked to and its id there. */
export interface ScheduledEventRef {
  providerId: string;
  externalId: string;
}

/** A linked event the live-score sweep syncs, with what its pace and quiet check read (#1499). */
export interface LiveScoreEventRef extends ScheduledEventRef {
  /** The code of the provider league its sport league's mapping names (`nfl`, #2004). */
  providerLeagueCode: string;
  /** Whether its sport is played in rounds, such as golf, rather than in matches. */
  playedInRounds: boolean;
  /** When the play now under way began (a round, or a match); null when none is. */
  playUnderwaySince: Date | null;
  /** When its provider last sent a webhook notification about it; null before the first. */
  lastProviderNotificationAt: Date | null;
}

export interface IngestionScheduledEventReader {
  /**
   * The next events per provider whose fields a participant sync loads: the events of synced sport
   * leagues only, whose sync names the event's provider (ADR 0011, #2086).
   */
  listEventsForFeed(input: {
    sport: Sport;
    feed: 'EVENTPARTICIPANTS';
    from?: Date;
    now: Date;
    to?: Date;
  }): Promise<ScheduledEventRef[]>;
  /** Every in-progress event the live-score sweep syncs. */
  listLiveScoreEvents(input: { sport: Sport; now: Date }): Promise<LiveScoreEventRef[]>;
}

/**
 * How the live-score sweep paces the events of providers that send webhook notifications
 * (#1499). Each notification syncs its event within a minute, so the sweep is only their safety
 * net: it polls each such event every `pollIntervalMs`, one played in rounds (golf) every
 * `roundPollIntervalMs` while a round is under way, and warns when play has gone on for the
 * event's `quietAfterMs` with no notification. Other providers' events keep the admin's interval.
 */
export interface NotifiedProviderCadence {
  providerIds: readonly string[];
  pollIntervalMs: number;
  roundPollIntervalMs: number;
  /**
   * How long an event may stay in play with no notification before the sweep warns: the longest
   * gap its league's notifications have in normal play, such as a quarter and halftime.
   */
  quietAfterMs: (sport: Sport, event: LiveScoreEventRef) => number;
}

/** How often the live-score sweep looks for due events while a provider's cadence is set. */
export const LIVE_SCORE_SWEEP_TICK_MS = 60_000;
/** How early within a tick an event's poll may come due, so a tick's own lag never skips one. */
const LIVE_POLL_DUE_SLACK_MS = 5_000;

/** What the live-score sweep remembers about one sport's events between ticks (#1499). */
interface LiveScorePacing {
  lastPolledAt: Map<string, number>;
  quietWarnedAt: Map<string, number>;
}

export interface IngestionSchedulerOptions {
  configReader?: IngestionScheduleConfigReader;
  eventReader?: IngestionScheduledEventReader;
  now?: () => Date;
  syncOrchestrator?: Pick<SyncOrchestrator, 'normalizeRequest'>;
  syncRunLedger?: Pick<ProviderSyncRunLedger, 'createSubmissions' | 'executeFeedRun'>;
  /** Keeps each provider loop to one server task; omitted, each loop runs on this task. */
  jobLock?: JobLock;
  /**
   * The cadence while a provider sends webhook notifications, read each sweep so a change to a
   * Provider row takes effect (#1997); omitted, or answering undefined, every event polls each sweep.
   */
  notifiedProviderCadence?: () => NotifiedProviderCadence | undefined;
}

const SCHEDULED_SYNC_SOURCE: SyncRequestSource = 'SCHEDULED';
const SCHEDULED_SYNC_ACTOR = {
  type: 'SYSTEM',
  name: 'scheduler',
} as const;
const WEBHOOK_SYNC_SOURCE: SyncRequestSource = 'WEBHOOK';
const WEBHOOK_SYNC_ACTOR = {
  type: 'SYSTEM',
  name: 'webhook',
} as const;

/** One linked event a provider's notification asked to sync (#1498). */
export interface NotifiedEventSync {
  sport: Sport;
  providerId: string;
  eventId: string;
  /** PoolMaster's event, when the job that asks knows it (#1819). */
  sportEventId?: string;
}

export class IngestionScheduler {
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private readonly startedSportLoops = new Set<Sport>();
  private readonly inFlightScheduledEventSyncs = new Set<string>();
  private readonly liveScorePacing = new Map<Sport, LiveScorePacing>();
  /** The unregistered scheduled sports last warned about, so an unchanged set is not re-warned every cycle. */
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
      'configured sport loop reconciliation',
      () => { this.reconcileConfiguredSportLoops(); return Promise.resolve(); },
      // eslint-disable-next-line @typescript-eslint/require-await -- resolveDelayMs must return Promise<number>; this constant needs the async wrap, not an await.
      async () => SCHEDULE_RECHECK_MS,
    );

    this.logger?.info('Ingestion scheduler started');
  }

  private reconcileConfiguredSportLoops(): void {
    try {
      const sports = this.getConfiguredScheduledSports();
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
          async () => this.getFieldSyncDelayMs(),
          `ingestion:${sport}:participants`,
        );
        this.startRecurringLoop(
          `${sport} live score sync`,
          async () => this.runConfiguredLiveScoreSweep(sport),
          async () => this.getLiveScoreSweepDelayMs(),
          `ingestion:${sport}:live-scores`,
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
    this.liveScorePacing.clear();
    this.logger?.info('Ingestion scheduler stopped');
  }

  private isRunning(): boolean {
    return this.running;
  }

  /** Runs a one-off event sync for explicit feed types. */
  async runEventSync(request: EventSyncRequest): Promise<IngestionJobRecord[]> {
    const jobs: IngestionJobRecord[] = [];
    this.logger?.info({
      sport: request.sport,
      eventId: request.eventId,
      feeds: request.feeds,
    }, 'Ad hoc event sync requested');

    for (const feed of dedupe(request.feeds)) {
      if (feed === 'EVENTPARTICIPANTS') {
        jobs.push(await this.runEventFieldSync(request.sport, request.providerId, request.eventId));
        continue;
      }

      jobs.push(await this.pollLiveScores(request.sport, request.providerId, request.eventId));
    }

    this.logger?.info({
      sport: request.sport,
      eventId: request.eventId,
      feeds: request.feeds,
      jobs: jobs.map(toJobLogPayload),
    }, 'Ad hoc event sync completed');

    return jobs;
  }

  /** Polls live scores for a specific event from the provider it is linked to. */
  async pollLiveScores(
    sport: Sport,
    providerId: string,
    eventId: string,
  ): Promise<IngestionJobRecord> {
    this.logger?.debug({ sport, providerId, eventId }, 'Polling live scores for event');
    const provider = this.providerServing(sport, providerId);
    if (!provider) {
      this.logger?.warn({ sport, providerId, eventId }, 'No provider registered for live score polling');
      return createFailedJob('EVENT_LIVE_SCORES_SYNC', providerId, sport, 'No provider registered', eventId);
    }

    return this.runJob('EVENT_LIVE_SCORES_SYNC', provider.providerId, sport, 'EVENTLIVESCORES', provider, async () => {
      const result = await provider.getLiveScores(eventId);
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
              code: ProviderSyncFindingKind.NO_PROVIDER_LIVE_SCORES,
              message: 'Provider returned no live-score updates for the requested event.',
            }]
          : [],
      };
    }, eventId);
  }

  private async runConfiguredSportFieldSync(sport: Sport): Promise<void> {
    if (!this.isSportScheduled(sport)) {
      this.logger?.debug({ sport }, 'Skipping scheduled participant sync because sport is not configured');
      return;
    }

    // The field sync always runs, for synced sport leagues only (ADR 0011, #2086): it has no switch.
    const config = await this.getGlobalConfig();

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

    const events = await eventReader.listEventsForFeed({
      sport,
      feed: 'EVENTPARTICIPANTS',
      from: window.from,
      now: this.getNow(),
      to: window.to,
    });

    this.logger?.debug({
      sport,
      eventCount: events.length,
      events,
    }, 'Resolved active event participant sync candidates');

    for (const event of events) {
      const normalized = this.normalizeScheduledEventSync({
        sport,
        providerId: event.providerId,
        eventId: event.externalId,
        feeds: ['EVENTPARTICIPANTS'],
      });
      const { scope } = normalized;
      await this.executeScheduledSyncRun(normalized, () =>
        this.runEventFieldSync(scope.sport, scope.providerId, scope.eventId),
      );
    }
  }

  private async runConfiguredLiveScoreSweep(sport: Sport): Promise<void> {
    const feed = 'EVENTLIVESCORES' as const;
    if (!this.isSportScheduled(sport)) {
      this.logger?.debug({ sport, feed }, 'Skipping scheduled event sync sweep because sport is not configured');
      return;
    }

    const config = await this.getGlobalConfig();
    if (!config.SCORES.enabled) {
      this.logger?.debug({ sport, feed }, 'Skipping scheduled event sync sweep because it is disabled');
      return;
    }

    const eventReader = this.options.eventReader;
    if (!eventReader) {
      this.logger?.debug({ sport, feed }, 'Skipping scheduled event sync because no event reader is configured');
      return;
    }

    const now = this.getNow();
    const listed = await eventReader.listLiveScoreEvents({ sport, now });
    const events = this.dueLiveScoreEvents(sport, listed, now, schedulePolicyDelayMs(config.SCORES));

    this.logger?.debug({
      sport,
      feed,
      eventCount: events.length,
      events,
    }, 'Resolved scheduled event sync candidates');

    for (const event of events) {
      const inFlightKey = buildScheduledEventSyncKey(sport, feed, event);
      if (this.inFlightScheduledEventSyncs.has(inFlightKey)) {
        this.logger?.debug({ sport, feed, ...event }, 'Skipping scheduled event sync because a run is already in flight');
        continue;
      }
      this.inFlightScheduledEventSyncs.add(inFlightKey);
      const normalized = this.normalizeScheduledEventSync({
        sport,
        providerId: event.providerId,
        eventId: event.externalId,
        feeds: [feed],
      });
      const { scope } = normalized;
      try {
        await this.executeScheduledSyncRun(normalized, () =>
          this.pollLiveScores(scope.sport, scope.providerId, scope.eventId),
        );
      } finally {
        this.inFlightScheduledEventSyncs.delete(inFlightKey);
      }
    }
  }

  /**
   * The listed events whose poll is due (#1499). With no notified provider cadence every event
   * is due each sweep, at the admin's interval. With one, the sweep ticks every minute and each
   * event comes due at its own interval: a notified provider's at its safety-net pace, any other
   * at the admin's. The sweep also warns about each notified provider's event in play that has
   * gone quiet. What it remembers is kept for the events still listed only.
   */
  private dueLiveScoreEvents(sport: Sport, listed: LiveScoreEventRef[], now: Date, adminIntervalMs: number): LiveScoreEventRef[] {
    const cadence = this.options.notifiedProviderCadence?.();
    if (!cadence) return listed;

    const previous = this.liveScorePacing.get(sport);
    const pacing: LiveScorePacing = { lastPolledAt: new Map(), quietWarnedAt: new Map() };
    this.liveScorePacing.set(sport, pacing);
    const nowMs = now.getTime();
    const due: LiveScoreEventRef[] = [];
    for (const event of listed) {
      const key = `${event.providerId}:${event.externalId}`;
      const notified = cadence.providerIds.includes(event.providerId);
      const quietWarnedAt = previous?.quietWarnedAt.get(key);
      if (quietWarnedAt !== undefined) pacing.quietWarnedAt.set(key, quietWarnedAt);
      if (notified) this.warnIfQuiet(sport, event, key, nowMs, cadence, pacing);

      const intervalMs = !notified
        ? adminIntervalMs
        : event.playedInRounds && event.playUnderwaySince !== null
          ? cadence.roundPollIntervalMs
          : cadence.pollIntervalMs;
      const lastPolledAt = previous?.lastPolledAt.get(key);
      if (lastPolledAt === undefined || nowMs - lastPolledAt >= intervalMs - LIVE_POLL_DUE_SLACK_MS) {
        pacing.lastPolledAt.set(key, nowMs);
        due.push(event);
      } else {
        pacing.lastPolledAt.set(key, lastPolledAt);
      }
    }
    return due;
  }

  /**
   * Warns, at most once per quiet stretch of the event's `quietAfterMs`, when a notified provider's event has
   * been in play that long with no notification about it: its webhook may have stopped, and
   * until it is fixed the event's scores move only at the safety-net pace. The warning's action
   * is what the log alarm counts (infrastructure/terraform).
   */
  private warnIfQuiet(
    sport: Sport,
    event: LiveScoreEventRef,
    key: string,
    nowMs: number,
    cadence: NotifiedProviderCadence,
    pacing: LiveScorePacing,
  ): void {
    if (event.playUnderwaySince === null) return;
    const quietAfterMs = cadence.quietAfterMs(sport, event);
    const heardFromAt = Math.max(event.playUnderwaySince.getTime(), event.lastProviderNotificationAt?.getTime() ?? 0);
    if (nowMs - heardFromAt < quietAfterMs) return;
    const warnedAt = pacing.quietWarnedAt.get(key);
    if (warnedAt !== undefined && nowMs - warnedAt < quietAfterMs) return;
    pacing.quietWarnedAt.set(key, nowMs);
    this.logger?.warn({
      action: 'ingestion.providerNotifications.quiet',
      data: {
        sport,
        providerId: event.providerId,
        eventId: event.externalId,
        playUnderwaySince: event.playUnderwaySince.toISOString(),
        lastProviderNotificationAt: event.lastProviderNotificationAt?.toISOString() ?? null,
        quietMinutes: Math.floor((nowMs - heardFromAt) / 60_000),
      },
    }, 'An event in play has had no webhook notification from its provider for a while; its webhook may have stopped');
  }

  /**
   * The PROVIDER_EVENT_SYNC job (#1498): one live-score sync of an event its provider's webhook
   * named, recorded in the sync history as a WEBHOOK run. It reads the provider's current state
   * over REST, so a duplicated, late or out-of-order notification writes nothing stale. It runs
   * only where the scheduled sweep would: a sport scheduled for ingestion, with live scores on.
   */
  async runNotifiedEventSync(request: NotifiedEventSync, context: { jobId: string; trigger: JobTrigger }): Promise<IngestionJobRecord | null> {
    const feed = 'EVENTLIVESCORES' as const;
    if (!this.isSportScheduled(request.sport)) {
      this.logger?.info({ ...request, feed }, 'Skipped a webhook event sync because the sport is not scheduled for ingestion');
      return null;
    }
    if (!(await this.getGlobalConfig()).SCORES.enabled) {
      this.logger?.info({ ...request, feed }, 'Skipped a webhook event sync because live score syncs are off for the sport');
      return null;
    }

    const normalized = this.syncOrchestrator.normalizeRequest({
      source: WEBHOOK_SYNC_SOURCE,
      actor: WEBHOOK_SYNC_ACTOR,
      scope: {
        type: 'EVENT',
        sport: request.sport,
        providerId: request.providerId,
        eventId: request.eventId,
        feeds: [feed],
      },
    } satisfies SyncOrchestratorRequest);
    const { scope } = normalized;
    return this.executeScheduledSyncRun(normalized, () =>
      this.pollLiveScores(scope.sport, scope.providerId, scope.eventId),
    { backgroundJobId: context.jobId, sportEventId: request.sportEventId, trigger: context.trigger });
  }

  private normalizeScheduledEventSync(input: {
    sport: Sport;
    providerId: string;
    eventId: string;
    feeds: readonly EventSyncFeed[];
  }): NormalizedSyncRequest {
    return this.syncOrchestrator.normalizeRequest({
      source: SCHEDULED_SYNC_SOURCE,
      actor: SCHEDULED_SYNC_ACTOR,
      scope: {
        type: 'EVENT',
        sport: input.sport,
        providerId: input.providerId,
        eventId: input.eventId,
        feeds: input.feeds,
      },
    } satisfies SyncOrchestratorRequest);
  }

  private async executeScheduledSyncRun(
    normalizedRequest: NormalizedSyncRequest,
    run: () => Promise<IngestionJobRecord>,
    scope: { backgroundJobId?: string; sportEventId?: string; trigger?: JobTrigger } = {},
  ): Promise<IngestionJobRecord> {
    const syncRunLedger = this.options.syncRunLedger;
    if (!syncRunLedger) {
      return run();
    }

    const syncRuns = await syncRunLedger.createSubmissions({
      normalizedRequest,
      providerId: normalizedRequest.scope.providerId,
      submittedAt: this.getNow(),
      ...scope,
      // A scheduled run has no job; a webhook's run records its job's trigger (#1861).
      trigger: scope.trigger ?? JobTrigger.SCHEDULE,
    });
    const syncRun = syncRuns.at(0);

    if (!syncRun) {
      throw new Error('Scheduled sync ledger did not create a provider sync run.');
    }

    return syncRunLedger.executeFeedRun(syncRun, run);
  }

  private async runEventFieldSync(
    sport: Sport,
    providerId: string,
    eventId: string,
  ): Promise<IngestionJobRecord> {
    this.logger?.debug({ sport, providerId, eventId }, 'Running participant sync for event');
    const provider = this.providerServing(sport, providerId);
    if (!provider) {
      this.logger?.warn({ sport, providerId, eventId }, 'No provider registered for event participant sync');
      return createFailedJob('EVENT_PARTICIPANTS_SYNC', providerId, sport, 'No provider registered', eventId);
    }

    return this.runJob('EVENT_PARTICIPANTS_SYNC', provider.providerId, sport, 'EVENTPARTICIPANTS', provider, async () => {
      const detail = await provider.getEventDetails(eventId);
      if (!detail) {
        this.logger?.warn({ sport, eventId, providerId: provider.providerId }, 'Provider returned no event detail for participant sync');
        throw new Error(`Provider returned no event detail for event ${eventId}`);
      }

      const { writeDiagnostics } = await this.callbacks.onEventDetail(detail);
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
          ...syncWriteStats(writeDiagnostics),
        },
        writeDiagnostics,
        warnings: detail.participants.length === 0
          ? [{
              code: ProviderSyncFindingKind.NO_PROVIDER_PARTICIPANTS,
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
      // The provider turned the call away for now (league model 1c): the caller's job is queued
      // again for when it will answer, so the failure is thrown, not kept as this run's outcome.
      if (jobDeferredUntilOf(err) !== null) throw err;
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
      durationMs: job.startedAt
        ? job.completedAt.getTime() - job.startedAt.getTime()
        : null,
    }, 'Ingestion job completed');
    return job;
  }

  /** `lockKey` names the job lock a loop that calls a provider holds; a local loop has none. */
  private startRecurringLoop(
    label: string,
    runner: () => Promise<void>,
    resolveDelayMs: () => Promise<number>,
    lockKey?: string,
  ): void {
    const tick = async () => {
      if (!this.running) {
        return;
      }

      try {
        this.logger?.debug({ label }, 'Recurring ingestion loop tick started');
        // Jobs a scheduled sync queues, such as settling an event it found final, record SCHEDULE (#1861).
        await runWithJobStart(SCHEDULE_START, () => (lockKey ? this.runExclusive(label, lockKey, runner) : runner()));
      } catch (error) {
        this.logger?.error({ error, label }, 'Recurring ingestion loop failed');
      }

      const delayMs = await this.safeResolveDelayMs(resolveDelayMs);
      // Read through a method: `stop()` can clear the flag during the await above, which
      // narrowing on the property cannot see.
      if (!this.isRunning()) {
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

  private async runExclusive(label: string, lockKey: string, runner: () => Promise<void>): Promise<void> {
    const jobLock = this.options.jobLock;
    if (!jobLock) {
      await runner();
      return;
    }
    if (!(await jobLock.runExclusive(lockKey, runner))) {
      this.logger?.debug({ label }, 'Skipped a recurring ingestion loop tick because another server task runs it');
    }
  }

  private async getGlobalDelayMs(kind: ProviderSyncKind): Promise<number> {
    const config = await this.getGlobalConfig();
    return schedulePolicyDelayMs(config[kind]);
  }

  /** The field loop's interval: the field sync has no switch (#2086), so it always runs on it. */
  private async getFieldSyncDelayMs(): Promise<number> {
    const config = await this.getGlobalConfig();
    return schedulePolicyDelayMs(config.FIELD);
  }

  /** The admin's live-score interval, shortened to a tick while a notified provider's cadence is set. */
  private async getLiveScoreSweepDelayMs(): Promise<number> {
    const adminDelayMs = await this.getGlobalDelayMs(ProviderSyncKind.SCORES);
    return this.options.notifiedProviderCadence?.() ? Math.min(adminDelayMs, LIVE_SCORE_SWEEP_TICK_MS) : adminDelayMs;
  }

  private async getGlobalConfig(): Promise<IngestionScheduleConfig> {
    if (!this.options.configReader) {
      return INGESTION_SCHEDULE_SETTINGS.defaults(process.env);
    }

    return this.options.configReader.getConfig();
  }

  /** The sports a running provider covers (#1997): its Provider league rows say which. */
  private getConfiguredScheduledSports(): Sport[] {
    return this.registry.getSupportedSports();
  }

  private isSportScheduled(sport: Sport): boolean {
    return this.getConfiguredScheduledSports().includes(sport);
  }

  /** The registered provider with this id, when it serves the sport. */
  private providerServing(sport: Sport, providerId: string): SportDataProvider | null {
    const provider = this.registry.getProviderById(providerId);
    return provider?.sportsCovered.includes(sport) ? provider : null;
  }

  private getNow(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async safeResolveDelayMs(resolveDelayMs: () => Promise<number>): Promise<number> {
    try {
      return await resolveDelayMs();
    } catch (error) {
      this.logger?.error({ error }, 'Falling back to config recheck delay because policy resolution failed');
      return SCHEDULE_RECHECK_MS;
    }
  }
}

function resolveEventParticipantSyncWindow(
  config: IngestionScheduleConfig,
  now: Date,
): { from: Date; to: Date } {
  const lookaheadDays = config.FIELD.lookaheadDays ?? 14;
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

function buildScheduledEventSyncKey(
  sport: Sport,
  feed: EventSyncFeed,
  event: ScheduledEventRef,
): string {
  return `${sport}:${feed}:${event.providerId}:${event.externalId}`;
}

function buildProviderPayload(
  operation: IngestionFeedType,
  provider: SportDataProvider,
  captureSession?: ProviderPayloadCaptureSession | null,
): IngestionJobProviderPayload {
  // A capture session's payloads first; else the provider's own, when it keeps any.
  const source = captureSession ?? (supportsProviderPayloadDiagnostics(provider) ? provider : null);
  if (!source) {
    return {
      operation,
      rawCaptured: false,
      rawTruncated: false,
    };
  }

  const raw = source.consumeProviderPayloads();
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
