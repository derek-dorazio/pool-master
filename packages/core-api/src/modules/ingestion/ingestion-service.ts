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
  BackgroundJobRepository,
  BackgroundJobScopeCount,
  ParticipantProviderMappingRepository,
  ProviderSyncRunRepository,
  SportEventRepository,
  SportLeagueRepository,
} from '@poolmaster/shared/db';
import {
  BackgroundJobType,
  JobErrorType,
  JobTrigger,
  type ProviderHealthStatus,
  ProviderSyncRunStatus,
  type BackgroundJobOutcome,
  type JobStart,
  type Sport,
  SportEventSyncScope,
  type ProviderSyncRun,
  type ProviderSyncRunWithDetails,
  type ProviderSettings,
  providerSourceIdOf,
} from '@poolmaster/shared/domain';
import type { ProviderRegistry } from './core/provider-registry';
import type { SportDataProvider } from './core/provider-interface';
import type {
  EventSyncRequest,
  IngestionFeedType,
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
import { syncChangedRows } from './core/sync-write-diagnostics';
import type { ProviderSettingsStore } from './provider-settings-store';
import type { ProviderWebhookSwitch } from './provider-webhook-switch';
import { jobDeferredUntilOf } from '../background-jobs/job-error-type';

/** The window the provider list counts rate-limited jobs over (#1881). */
const DAY_MS = 24 * 3_600_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderSummary {
  providerId: string;
  providerName: string;
  /** Null, with the error rate and latency, when the provider is not running in this task. */
  status: ProviderHealthStatus | null;
  errorRate: number | null;
  latencyMs: number | null;
  lastEventAt: Date | null;
  sportsCovered: Sport[];
  /** The covered sports this provider is the default for (catalog browse, new links). */
  primaryForSports: Sport[];
  activeEventCount: number;
  /** The request rate its adapter holds to, a minute; null when the adapter does not pace itself. */
  requestsPerMinute: number | null;
  /** Whether its webhooks are on: switched on for it and its signing secret set. */
  webhooksEnabled: boolean;
  /** The active sport leagues whose events its sync creates. */
  syncedSportLeagueCount: number;
  /** Its jobs that ended on its rate limit, or wait to retry after it, in the last 24 hours (#1881). */
  rateLimitedJobsLast24h: number;
  /** Its Provider row and leagues, with whether its signing secret is set; null for a provider running without a row. */
  settings: (ProviderSettings & { webhookSecretSet: boolean }) | null;
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
  /** The synced sport leagues, counted per provider on the provider list. */
  sportLeagues: Pick<SportLeagueRepository, 'findEventSynced'>;
  /** The Provider rows (#1997). */
  providerSettings: Pick<ProviderSettingsStore, 'all'>;
  /** Whether each provider's webhooks are on, and its secret set. */
  webhooks: Pick<ProviderWebhookSwitch, 'isOn' | 'isSecretSet'>;
  /** Background jobs that hit a provider's rate limit, counted per provider on the provider list. */
  jobHistory: Pick<BackgroundJobRepository, 'countByScope'>;
  now?: () => Date;
  scheduler?: IngestionScheduler;
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
  private readonly sportLeagues: Pick<SportLeagueRepository, 'findEventSynced'>;
  private readonly providerSettings: Pick<ProviderSettingsStore, 'all'>;
  private readonly webhooks: Pick<ProviderWebhookSwitch, 'isOn' | 'isSecretSet'>;
  private readonly jobHistory: Pick<BackgroundJobRepository, 'countByScope'>;
  private readonly now: () => Date;
  private readonly scheduler?: IngestionScheduler;
  private readonly syncOrchestrator: Pick<SyncOrchestrator, 'normalizeRequest'>;
  private readonly syncRunLedger: ProviderSyncRunLedger;
  private readonly jobs: Pick<BackgroundJobQueue, 'request' | 'queued'>;
  private readonly logger?: FastifyBaseLogger;

  constructor(deps: IngestionServiceDependencies) {
    this.registry = deps.registry;
    this.sportEvents = deps.sportEvents;
    this.participantMappings = deps.participantMappings;
    this.syncRuns = deps.syncRuns;
    this.sportLeagues = deps.sportLeagues;
    this.providerSettings = deps.providerSettings;
    this.webhooks = deps.webhooks;
    this.jobHistory = deps.jobHistory;
    this.now = deps.now ?? (() => new Date());
    this.scheduler = deps.scheduler;
    this.jobs = deps.jobs;
    this.logger = deps.logger;
    this.syncOrchestrator = deps.syncOrchestrator ?? new SyncOrchestrator();
    this.syncRunLedger = deps.syncRunLedger ?? new ProviderSyncRunLedger(deps.syncRuns, deps.logger, deps.sportEvents);
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
  ): Promise<{ sportEventId: string; sportLeagueId: string } | null> {
    const event = await this.sportEvents.findByProviderRef(providerId, eventId);
    if (!event) {
      return null;
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
    return { sportEventId: event.id, sportLeagueId: event.sportLeagueId };
  }

  private async buildUnmappedParticipantsForProvider(provider: SportDataProvider, externalId: string | undefined): Promise<UnmappedParticipant[]> {
    const results: UnmappedParticipant[] = [];

    for (const sport of provider.sportsCovered) {
      const participants = (await provider.getParticipants(sport))
        .filter((participant) => externalId === undefined || participant.externalId === externalId);
      if (participants.length === 0) continue;
      // poolmaster-allow-query-in-loop: once per sport the provider is configured for, a handful
      const mapped = await this.participantMappings.findByProviderExternalIds(
        provider.providerId,
        // A feed id is mapped once per sport league (#1853): one mapped in any of the sport's counts.
        { sport },
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
    const rows = this.providerSettings.all();
    const providerIds = [...new Set([...providers.map((provider) => provider.providerId), ...rows.map((row) => providerSourceIdOf(row.code))])];
    const [eventSummaries, syncedLeagues, rateLimited] = await Promise.all([
      this.sportEvents.summarizeByProviders(providerIds),
      this.sportLeagues.findEventSynced(),
      this.jobHistory.countByScope({ errorType: JobErrorType.RATE_LIMITED, since: new Date(this.now().getTime() - DAY_MS) }),
    ]);
    const syncedLeagueCounts = new Map<string, number>();
    const leagueProviders = new Map<string, string>();
    for (const league of syncedLeagues) {
      const providerId = league.selectedProviderMapping?.providerId;
      if (providerId !== undefined) {
        syncedLeagueCounts.set(providerId, (syncedLeagueCounts.get(providerId) ?? 0) + 1);
        leagueProviders.set(league.id, providerId);
      }
    }
    const rateLimitedCounts = await this.countPerProvider(rateLimited, leagueProviders);
    const rowsById = new Map(rows.map((row) => [providerSourceIdOf(row.code), row]));
    const summaries = await Promise.all(providerIds.map(async (providerId): Promise<ProviderSummary> => {
      const provider = this.registry.getProviderById(providerId);
      const row = rowsById.get(providerId);
      const health = provider === null ? null : await provider.healthCheck();
      const events = eventSummaries.get(providerId);
      const sportsCovered = provider?.sportsCovered ?? [];
      return {
        providerId,
        providerName: row?.name ?? provider?.providerName ?? providerId,
        status: health?.status ?? null,
        errorRate: health?.errorRateLastHour ?? null,
        latencyMs: health?.latencyMsP95 ?? null,
        lastEventAt: events?.lastChangedAt ?? health?.lastSuccessfulPoll ?? null,
        sportsCovered,
        primaryForSports: sportsCovered.filter((sport) => this.registry.getProvider(sport)?.providerId === providerId),
        activeEventCount: events?.activeEventCount ?? 0,
        requestsPerMinute: row?.requestsPerMinute ?? provider?.requestsPerMinute ?? null,
        webhooksEnabled: row !== undefined && this.webhooks.isOn(row),
        syncedSportLeagueCount: syncedLeagueCounts.get(providerId) ?? 0,
        rateLimitedJobsLast24h: rateLimitedCounts.get(providerId) ?? 0,
        settings: row === undefined ? null : { ...row, webhookSecretSet: this.webhooks.isSecretSet(row.code) },
      };
    }));
    return summaries.sort((a, b) => a.providerName.localeCompare(b.providerName));
  }

  /**
   * Job counts per provider (#1881): a sport league's own jobs belong to the provider that syncs
   * the league, and an event's jobs to the provider the event is
   * linked to, read in one more query for all such events. A job on neither, on an unsynced
   * league or on an event no longer there counts for none.
   */
  private async countPerProvider(
    scopes: readonly BackgroundJobScopeCount[],
    leagueProviders: ReadonlyMap<string, string>,
  ): Promise<Map<string, number>> {
    const eventIds = [...new Set(scopes.flatMap((scope) => (scope.sportEventId ? [scope.sportEventId] : [])))];
    const links = await this.sportEvents.findLinks(eventIds);
    const eventProviders = new Map(links.map((link) => [link.id, link.providerId]));
    const counts = new Map<string, number>();
    for (const scope of scopes) {
      const providerId = scope.sportEventId
        ? eventProviders.get(scope.sportEventId)
        : scope.sportLeagueId ? leagueProviders.get(scope.sportLeagueId) : undefined;
      if (providerId) {
        counts.set(providerId, (counts.get(providerId) ?? 0) + scope.count);
      }
    }
    return counts;
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
      },
    });
    const normalizedScope = normalizedRequest.scope;
    const linkedEvent = await this.assertFeedsAllowedForSyncScope(
      provider.providerId,
      normalizedScope.eventId,
      normalizedScope.feeds,
    );

    const submittedAt = new Date();
    this.logger?.info({
      sport: normalizedScope.sport,
      eventId: normalizedScope.eventId,
      requestedFeeds: normalizedScope.feeds,
      providerId: provider.providerId,
      rootAdminUserId,
    }, 'Submitting manual event sync');
    // The runs and the job that runs them commit together; the job runs on whichever task claims it.
    // Both record the root admin who asked (#1861).
    const start: JobStart = { trigger: JobTrigger.ADMIN, startedByUserId: rootAdminUserId };
    const syncRuns = await this.syncRunLedger.createSubmissionsWithJob({
      normalizedRequest,
      providerId: provider.providerId,
      submittedAt,
      runType: 'MANUAL_EVENT_SYNC',
      trigger: start.trigger,
      ...(linkedEvent && linkedEvent),
      // poolmaster-allow-direct-job: a root admin's manual event sync starts the job
      job: (runs) => this.jobs.request(BackgroundJobType.MANUAL_EVENT_SYNC, {
        syncRunIds: runs.map((run) => run.id),
        sport: normalizedScope.sport,
        providerId: normalizedScope.providerId,
        eventId: normalizedScope.eventId,
        ...(linkedEvent && { sportEventId: linkedEvent.sportEventId }),
      }, { start }),
    });
    this.jobs.queued();

    this.logger?.info({
      sport: normalizedScope.sport,
      eventId: normalizedScope.eventId,
      providerId: provider.providerId,
      requestedFeeds: normalizedScope.feeds,
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
  async runManualEventSync(payload: ManualEventSyncJobPayload, context: { attempt: number; jobId: string }): Promise<BackgroundJobOutcome> {
    const scheduler = this.scheduler;
    if (!scheduler) {
      throw new Error('Ingestion scheduler is required for manual event sync');
    }
    const scope = { sport: payload.sport, providerId: payload.providerId, eventId: payload.eventId };
    this.logger?.debug({ ...scope, syncRunIds: payload.syncRunIds }, 'Executing submitted manual event sync');
    const stored = new Map((await this.syncRuns.findManyByIds(payload.syncRunIds)).map((run) => [run.id, run]));
    // Runs whose outcome the ledger could not write: the job fails after the rest have run.
    const unrecorded: string[] = [];
    // The rows the feeds this try ran wrote (#1861).
    let changedCount = 0;
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
        const record = await this.syncRunLedger.executeFeedRun(syncRun, () =>
          scheduler.runEventSync({
            sport: payload.sport,
            providerId: payload.providerId,
            eventId: payload.eventId,
            feeds: [requestedFeed],
          }),
          { backgroundJobId: context.jobId },
        );
        changedCount += syncChangedRows(record.writeDiagnostics);
      } catch (error) {
        // The provider turned the feed away for now (league model 1c): its run is marked FAILED
        // as rate limited, and the job is queued again for when the provider will answer, so the
        // runs still SUBMITTED run then rather than be refused one after another now.
        if (jobDeferredUntilOf(error) !== null) throw error;
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
    return { changedCount };
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
