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
  ProviderSyncRunRepository,
  SportEventRepository,
  SportLeagueRepository,
} from '@poolmaster/shared/db';
import {
  eventFeedRef,
  eventSyncKindsOf,
  type ProviderEventRef,
  JobErrorType,
  JobTrigger,
  type ProviderHealthStatus,
  type ProviderSyncRunStatus,
  type JobStart,
  type Sport,
  type ProviderSyncRun,
  type ProviderSyncRunWithDetails,
  type ProviderSettings,
  providerHealthOfRuns,
  providerSourceIdOf,
} from '@poolmaster/shared/domain';
import type { ProviderRegistry } from './core/provider-registry';
import { SyncOrchestrator, type EventSyncKind } from './core/sync-orchestrator';
import { ProviderSyncRunLedger } from './persistence/provider-sync-run-ledger';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import { eventSyncJob } from './event-sync-job-requests';
import type { ProviderSettingsStore } from './provider-settings-store';
import type { ProviderWebhookSwitch } from './provider-webhook-switch';

/** The window the provider list counts rate-limited jobs over (#1881). */
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderSummary {
  providerId: string;
  providerName: string;
  /** From its sync runs of the last hour; null, with the error rate, when none finished (#1999). */
  status: ProviderHealthStatus | null;
  errorRate: number | null;
  lastEventAt: Date | null;
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
  requestedKinds: EventSyncKind[];
  submittedAt: Date;
  syncRuns: ProviderSyncRun[];
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

/** A manual sync asked of a provider that is not running here (404 SPORT_PROVIDER_NOT_FOUND). */
export class SportProviderNotFoundError extends Error {
  constructor(sport: Sport, providerId: string) {
    super(`Provider ${providerId}, which syncs this ${sport} event, is not running here`);
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
 * A manual sync of one of our events (#2004) that its league's provider has no id for (409
 * EVENT_NOT_LINKED: a test event), that does not exist (404 EVENT_NOT_FOUND), or that asks for a
 * kind the event cannot run now (422 EVENT_SYNC_KIND_UNAVAILABLE, #2238: `eventSyncKindsOf`).
 */
export class SportEventNotSyncedError extends Error {
  constructor(
    message: string,
    readonly code: 'EVENT_NOT_FOUND' | 'EVENT_NOT_LINKED' | 'EVENT_SYNC_KIND_UNAVAILABLE',
    readonly statusCode: 404 | 409 | 422,
  ) {
    super(message);
    this.name = 'SportEventNotSyncedError';
  }
}

/**
 * The provider id a root admin's sync of these kinds reads for one of our events (#2004): refused
 * when its league's provider has no id for it (409 EVENT_NOT_LINKED), and for a kind it cannot run
 * now (422 EVENT_SYNC_KIND_UNAVAILABLE, #2238), the same rule its DTO's `syncKinds` answers.
 */
function requireSyncableEvent(
  event: Parameters<typeof eventSyncKindsOf>[0] & { id: string },
  kinds: readonly EventSyncKind[],
): ProviderEventRef {
  const feedRef = eventFeedRef(event);
  if (feedRef === undefined) {
    throw new SportEventNotSyncedError(`Sport event ${event.id} has no id at its league's provider, so nothing syncs it.`, 'EVENT_NOT_LINKED', 409);
  }
  const available = eventSyncKindsOf(event);
  const unavailable = kinds.filter((kind) => !available.includes(kind));
  if (unavailable.length > 0) {
    throw new SportEventNotSyncedError(
      `Sport event ${event.id} cannot run a ${unavailable.join(', ')} sync while it is ${event.status}.`,
      'EVENT_SYNC_KIND_UNAVAILABLE',
      422,
    );
  }
  return feedRef;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface IngestionServiceDependencies {
  registry: ProviderRegistry;
  sportEvents: SportEventRepository;
  syncRuns: ProviderSyncRunRepository;
  /** The synced sport leagues, counted per provider on the provider list. */
  sportLeagues: Pick<SportLeagueRepository, 'findEventSynced'>;
  /** The Provider rows (#1997). */
  providerSettings: Pick<ProviderSettingsStore, 'all' | 'bySourceId'>;
  /** Whether each provider's webhooks are on, and its secret set. */
  webhooks: Pick<ProviderWebhookSwitch, 'isOn' | 'isSecretSet'>;
  /** Background jobs that hit a provider's rate limit, counted per provider on the provider list. */
  jobHistory: Pick<BackgroundJobRepository, 'countByScope'>;
  now?: () => Date;
  syncOrchestrator?: Pick<SyncOrchestrator, 'normalizeRequest'>;
  syncRunLedger?: ProviderSyncRunLedger;
  /** Queues the job that runs a manual event sync's submitted runs (#1441). */
  jobs: Pick<BackgroundJobQueue, 'request' | 'queued'>;
  logger?: FastifyBaseLogger;
}

export class IngestionService {
  private readonly registry: ProviderRegistry;
  private readonly sportEvents: SportEventRepository;
  private readonly syncRuns: ProviderSyncRunRepository;
  private readonly sportLeagues: Pick<SportLeagueRepository, 'findEventSynced'>;
  private readonly providerSettings: Pick<ProviderSettingsStore, 'all' | 'bySourceId'>;
  private readonly webhooks: Pick<ProviderWebhookSwitch, 'isOn' | 'isSecretSet'>;
  private readonly jobHistory: Pick<BackgroundJobRepository, 'countByScope'>;
  private readonly now: () => Date;
  private readonly syncOrchestrator: Pick<SyncOrchestrator, 'normalizeRequest'>;
  private readonly syncRunLedger: ProviderSyncRunLedger;
  private readonly jobs: Pick<BackgroundJobQueue, 'request' | 'queued'>;
  private readonly logger?: FastifyBaseLogger;

  constructor(deps: IngestionServiceDependencies) {
    this.registry = deps.registry;
    this.sportEvents = deps.sportEvents;
    this.syncRuns = deps.syncRuns;
    this.sportLeagues = deps.sportLeagues;
    this.providerSettings = deps.providerSettings;
    this.webhooks = deps.webhooks;
    this.jobHistory = deps.jobHistory;
    this.now = deps.now ?? (() => new Date());
    this.jobs = deps.jobs;
    this.logger = deps.logger;
    this.syncOrchestrator = deps.syncOrchestrator ?? new SyncOrchestrator();
    this.syncRunLedger = deps.syncRunLedger ?? new ProviderSyncRunLedger(deps.syncRuns, deps.logger);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Every registered provider, with its health from its own sync runs of the last hour (#1999):
   * no route calls a provider live.
   */
  async listProviders(): Promise<ProviderSummary[]> {
    const providers = this.registry.all();
    const rows = this.providerSettings.all();
    // Each provider's name, by id: its Provider row's where it has one, else its adapter's.
    const providerNames = new Map([
      ...providers.map((provider) => [provider.providerId, provider.providerName] as const),
      ...rows.map((row) => [providerSourceIdOf(row.code), row.name] as const),
    ]);
    const providerIds = [...providerNames.keys()];
    const [eventSummaries, syncedLeagues, rateLimited, runCounts] = await Promise.all([
      this.sportEvents.summarizeByProviders(providerIds),
      this.sportLeagues.findEventSynced(),
      this.jobHistory.countByScope({ errorType: JobErrorType.RATE_LIMITED, since: new Date(this.now().getTime() - DAY_MS) }),
      this.syncRuns.countFinishedByProvider(new Date(this.now().getTime() - HOUR_MS)),
    ]);
    const runCountsByProvider = new Map(runCounts.map((counts) => [counts.providerId, counts]));
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
    const summaries = [...providerNames].map(([providerId, providerName]): ProviderSummary => {
      const provider = this.registry.bySourceId(providerId);
      const row = rowsById.get(providerId);
      const health = providerHealthOfRuns(row === undefined ? undefined : runCountsByProvider.get(row.id));
      const events = eventSummaries.get(providerId);
      return {
        providerId,
        providerName,
        status: health.status,
        errorRate: health.errorRate,
        lastEventAt: events?.lastChangedAt ?? null,
        activeEventCount: events?.activeEventCount ?? 0,
        requestsPerMinute: row?.requestsPerMinute ?? provider?.requestsPerMinute ?? null,
        webhooksEnabled: row !== undefined && this.webhooks.isOn(row),
        syncedSportLeagueCount: syncedLeagueCounts.get(providerId) ?? 0,
        rateLimitedJobsLast24h: rateLimitedCounts.get(providerId) ?? 0,
        settings: row === undefined ? null : { ...row, webhookSecretSet: this.webhooks.isSecretSet(row.code) },
      };
    });
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

  /**
   * A root admin's Sync now on one of our events (#2004): the requested sync kinds of the event at its
   * league's provider, by the id the sync gave it. Each kind's run is submitted with the event sync
   * job that runs it (#2009), the same job the sync tick and a webhook queue, in one transaction.
   */
  async syncSportEvent(
    sportEventId: string,
    kinds: readonly EventSyncKind[],
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<ProviderManualSyncSubmissionResult> {
    const event = await this.sportEvents.findById(sportEventId);
    if (!event) throw new SportEventNotSyncedError(`Sport event ${sportEventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    const feedRef = requireSyncableEvent(event, kinds);
    // The provider the event's league selects (#2073), by the id its feed gives the event.
    const provider = this.registry.bySourceId(feedRef.providerId);
    if (provider === null) {
      this.logger?.error({ sport: event.sport, providerId: feedRef.providerId, sportEventId }, 'Manual event sync was requested without a configured provider');
      throw new SportProviderNotFoundError(event.sport, feedRef.providerId);
    }
    const scope = { type: 'EVENT', sport: event.sport, providerId: provider.providerId, eventId: feedRef.externalId } as const;
    const actor = { type: 'ROOT_ADMIN', userId: rootAdminUserId, email: rootAdminEmail } as const;
    const requestedKinds = this.syncOrchestrator.normalizeRequest({ source: 'MANUAL', actor, scope: { ...scope, kinds } }).scope.kinds;
    const submittedAt = this.now();
    // Each run records the root admin who asked, as its job does (#1861).
    const start: JobStart = { trigger: JobTrigger.ADMIN, startedByUserId: rootAdminUserId };
    this.logger?.info({ sport: event.sport, sportEventId, requestedKinds, providerId: provider.providerId, rootAdminUserId }, 'Submitting manual event sync');
    const syncRuns: ProviderSyncRun[] = [];
    for (const kind of requestedKinds) {
      // One run and its job per requested sync kind, two at most.
      syncRuns.push(...await this.syncRunLedger.createSubmissionsWithJob({
        normalizedRequest: this.syncOrchestrator.normalizeRequest({ source: 'MANUAL', actor, scope: { ...scope, kinds: [kind] } }),
        providerId: provider.providerId,
        submittedAt,
        trigger: start.trigger,
        sportEventId: event.id,
        sportLeagueId: event.sportLeagueId,
        job: (runs) => eventSyncJob(this.jobs, kind, { sportEventId: event.id, syncRunId: requireSubmittedRun(runs).id }, {
          start,
          providerCode: provider.providerCode,
        }),
      }));
    }
    this.jobs.queued();
    this.logger?.info({ sport: event.sport, sportEventId, providerId: provider.providerId, requestedKinds, syncRunIds: syncRuns.map((run) => run.id) }, 'Submitted manual event sync');
    return { sport: event.sport, eventId: feedRef.externalId, requestedKinds, submittedAt, syncRuns };
  }
}

/** The one run a Sync now submits for one sync kind, which its job runs. */
function requireSubmittedRun(runs: readonly ProviderSyncRun[]): ProviderSyncRun {
  const run = runs.at(0);
  if (run === undefined || runs.length !== 1) throw new Error(`A Sync now of one kind submitted ${String(runs.length)} runs, not one`);
  return run;
}
