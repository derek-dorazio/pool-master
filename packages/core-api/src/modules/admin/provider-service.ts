/**
 * ProviderService — business logic for admin sports data provider management.
 *
 * The service is backed by the live provider registry plus persisted Prisma
 * tables for health logs, sport events, ingestion jobs, and participant
 * mappings. It no longer synthesizes provider state from static mock data.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { Sport } from '@poolmaster/shared/domain';
import { logAdminAction } from './admin-audit-service';
import { ProviderRegistry } from '../ingestion/core/provider-registry';
import type {
  SportDataProvider,
  ProviderHealthStatus as AdapterHealthStatus,
} from '../ingestion/core/provider-interface';
import { IngestionPersistence } from '../ingestion/persistence/ingestion-persistence';
import type {
  EventSyncRequest,
  IngestionFeedType,
  IngestionJobRecord,
  IngestionScheduleConfigReader,
  IngestionScheduler,
  SportSyncRequest,
} from '../ingestion/core/ingestion-scheduler';

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
}

export interface ProviderHealthCheck {
  providerId: string;
  providerName: string;
  status: ProviderHealthStatus;
  errorRate: number;
  latencyMs: number;
  checkedAt: Date;
  details: string;
}

export interface ProviderIngestionStat {
  sport: Sport;
  providerId: string;
  lastPollAt: Date | null;
  lastEventReceivedAt: Date | null;
  eventsToday: number;
  errorsToday: number;
  activeEventCount: number;
  contestsDepending: number;
}

export interface IngestionJob {
  id: string;
  providerId: string;
  sport: Sport;
  eventId: string | null;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt: Date | null;
  completedAt: Date | null;
  recordsProcessed: number;
  errors: number;
}

export interface ProviderSyncRun {
  id: string;
  providerId: string;
  sport: Sport;
  eventId: string | null;
  status: 'SUBMITTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  payload: Record<string, unknown>;
}

export interface ProviderManualSyncSubmissionResult {
  sport: Sport;
  eventId: string | null;
  requestedFeeds: IngestionFeedType[];
  submittedAt: Date;
  syncRuns: ProviderSyncRun[];
}

export interface IngestionError {
  providerId: string;
  errorType: string;
  message: string;
  occurredAt: Date;
  eventId?: string | null;
}

export interface IngestionDashboard {
  sportProviderStatus: ProviderIngestionStat[];
  recentErrors: IngestionError[];
  activeJobs: IngestionJob[];
  recentCompletedJobs: IngestionJob[];
  throughputPerMinute: number;
}

export interface UnmappedParticipant {
  providerId: string;
  providerName: string;
  externalId: string;
  externalName: string;
  sport: Sport;
}

export interface ProviderDetail extends ProviderSummary {
  recentHealthChecks: ProviderHealthCheck[];
  ingestionStats: ProviderIngestionStat[];
  recentErrors: IngestionError[];
  recentJobs: IngestionJob[];
  unmappedParticipants: UnmappedParticipant[];
  mappedParticipantCount: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ProviderNotFoundError extends Error {
  constructor(providerId: string) {
    super(`Provider not found: ${providerId}`);
    this.name = 'ProviderNotFoundError';
  }
}

export class ProviderConfigUnsupportedError extends Error {
  constructor(providerId: string) {
    super(`Provider configuration is not persisted for ${providerId}`);
    this.name = 'ProviderConfigUnsupportedError';
  }
}

export class ProviderEventNotFoundError extends Error {
  constructor(providerId: string, eventId: string) {
    super(`Event ${eventId} was not found for provider ${providerId}`);
    this.name = 'ProviderEventNotFoundError';
  }
}

export class ProviderSportCoverageError extends Error {
  constructor(providerId: string) {
    super(`Provider ${providerId} does not expose any covered sports`);
    this.name = 'ProviderSportCoverageError';
  }
}

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

export class ProviderEventParticipantsMissingError extends Error {
  constructor(providerId: string, eventId: string) {
    super(`Event ${eventId} returned zero participants from provider ${providerId}`);
    this.name = 'ProviderEventParticipantsMissingError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfUtcDay(date = new Date()): Date {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function mapHealthStatus(status: AdapterHealthStatus['status']): ProviderHealthStatus {
  return status;
}

function parseErrorLogEntry(entry: unknown): { errorType: string; message: string } | null {
  if (!entry || typeof entry !== 'object') return null;
  const row = entry as Record<string, unknown>;
  const errorType = typeof row.errorType === 'string' ? row.errorType : typeof row.type === 'string' ? row.type : null;
  const message = typeof row.message === 'string' ? row.message : typeof row.error === 'string' ? row.error : null;
  if (!errorType || !message) return null;
  return { errorType, message };
}

function providerDisplayName(provider: SportDataProvider): string {
  return provider.providerName;
}

function normalizeSyncRunPayload(payload: Prisma.JsonValue): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  return payload as Record<string, unknown>;
}

function mapJobTypeToFeed(jobType: IngestionJobRecord['jobType']): IngestionFeedType {
  switch (jobType) {
    case 'EVENT_SCHEDULE_SYNC':
      return 'EVENTSCHEDULE';
    case 'EVENT_PARTICIPANTS_SYNC':
      return 'EVENTPARTICIPANTS';
    case 'PARTICIPANT_RANKINGS_SYNC':
      return 'PARTICIPANTRANKINGS';
    case 'EVENT_LIVE_SCORES_SYNC':
      return 'EVENTLIVESCORES';
    case 'EVENT_RESULTS_SYNC':
      return 'EVENTRESULTS';
    case 'HEALTH_CHECK':
      return 'EVENTSCHEDULE';
  }
}

function buildSubmittedSyncRunDetail(
  feed: IngestionFeedType,
  sport: Sport,
  eventId: string | null,
): string {
  const target = eventId ?? sport;
  return `Submitted ${formatFeedLabel(feed)} sync for ${target}.`;
}

function toJsonSafeErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    message: String(error),
  };
}

function toSerializableJob(job: IngestionJobRecord): Record<string, unknown> {
  return {
    jobType: job.jobType,
    providerId: job.providerId,
    sport: job.sport,
    eventExternalId: job.eventExternalId ?? null,
    status: job.status,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    recordsProcessed: job.recordsProcessed,
    errors: job.errors,
    errorLog: job.errorLog,
  };
}

function isSportSyncFeedType(
  feed: unknown,
): feed is SportSyncRequest['feeds'][number] {
  return feed === 'EVENTSCHEDULE'
    || feed === 'EVENTPARTICIPANTS'
    || feed === 'PARTICIPANTRANKINGS';
}

function isEventSyncFeedType(
  feed: unknown,
): feed is EventSyncRequest['feeds'][number] {
  return feed === 'EVENTPARTICIPANTS'
    || feed === 'EVENTLIVESCORES'
    || feed === 'EVENTRESULTS';
}

function formatFeedLabel(feed: IngestionFeedType): string {
  switch (feed) {
    case 'EVENTSCHEDULE':
      return 'event schedule';
    case 'EVENTPARTICIPANTS':
      return 'event participants';
    case 'PARTICIPANTRANKINGS':
      return 'participant rankings';
    case 'EVENTLIVESCORES':
      return 'event live scores';
    case 'EVENTRESULTS':
      return 'event results';
  }
}

function buildManualSyncRunDetail(
  job: IngestionJobRecord,
  eventId: string | null,
): string {
  const target = eventId ?? job.eventExternalId ?? job.sport;
  const feed = formatFeedLabel(mapJobTypeToFeed(job.jobType));
  if (job.status === 'FAILED') {
    const error =
      typeof job.errorLog[0] === 'object'
      && job.errorLog[0] !== null
      && 'error' in job.errorLog[0]
      && typeof (job.errorLog[0] as { error?: unknown }).error === 'string'
        ? (job.errorLog[0] as { error: string }).error
        : 'Unknown ingestion failure';
    return `Failed ${feed} sync for ${target}: ${error}`;
  }

  return `Completed ${feed} sync for ${target} (${job.recordsProcessed} records).`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ProviderService {
  private readonly ingestionPersistence: IngestionPersistence;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: ProviderRegistry = new ProviderRegistry(),
    private readonly scheduler?: IngestionScheduler,
    private readonly logger?: FastifyBaseLogger,
    private readonly ingestionConfigReader?: IngestionScheduleConfigReader,
  ) {
    this.ingestionPersistence = new IngestionPersistence(prisma, logger);
  }

  private getProviderOrThrow(providerId: string): SportDataProvider {
    const provider = this.registry.getProviderById(providerId);
    if (!provider) {
      throw new ProviderNotFoundError(providerId);
    }
    return provider;
  }

  private async fetchProviderHealth(
    provider: SportDataProvider,
  ): Promise<{ health: AdapterHealthStatus; checkedAt: Date }> {
    try {
      const health = await provider.healthCheck();
      return { health, checkedAt: new Date() };
    } catch (error) {
      const lastLog = await this.prisma.providerHealthLog.findFirst({
        where: { providerId: provider.providerId },
        orderBy: { recordedAt: 'desc' },
      });

      if (!lastLog) {
        throw error;
      }

      return {
        health: {
          providerId: provider.providerId,
          status: (lastLog.status === 'HEALTHY' || lastLog.status === 'DEGRADED' || lastLog.status === 'DOWN')
            ? lastLog.status
            : 'DOWN',
          errorRateLastHour: Number(lastLog.errorRate ?? 0),
          latencyMsP95: lastLog.avgLatencyMs ?? 0,
          lastSuccessfulPoll: undefined,
          message: 'Using the most recent persisted provider health log because the live health check failed.',
        },
        checkedAt: lastLog.recordedAt,
      };
    }
  }

  private async buildProviderSummary(provider: SportDataProvider): Promise<ProviderSummary> {
    const healthResult = await this.fetchProviderHealth(provider);
    const sportsCovered = await this.getConfiguredSportsForProvider(provider);
    const [lastEvent, activeEvents] = await Promise.all([
      this.prisma.sportEvent.findFirst({
        where: { providerId: provider.providerId },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        select: { updatedAt: true, createdAt: true },
      }),
      this.prisma.sportEvent.count({
        where: {
          providerId: provider.providerId,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        },
      }),
    ]);

    return {
      providerId: provider.providerId,
      providerName: providerDisplayName(provider),
      status: mapHealthStatus(healthResult.health.status),
      errorRate: healthResult.health.errorRateLastHour,
      latencyMs: healthResult.health.latencyMsP95,
      lastEventAt: lastEvent?.updatedAt ?? lastEvent?.createdAt ?? healthResult.health.lastSuccessfulPoll ?? null,
      sportsCovered,
      activeEventCount: activeEvents,
    };
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

  private async buildIngestionStat(
    provider: SportDataProvider,
    sport: Sport,
  ): Promise<ProviderIngestionStat> {
    const dayStart = startOfUtcDay();

    const [lastPollJob, lastEvent, eventsToday, errorsToday, activeEventRows] =
      await Promise.all([
        this.prisma.ingestionJob.findFirst({
          where: { providerId: provider.providerId, sport },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, startedAt: true },
        }),
        this.prisma.sportEvent.findFirst({
          where: { providerId: provider.providerId, sport },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
          select: { updatedAt: true, createdAt: true },
        }),
        this.prisma.sportEvent.count({
          where: { providerId: provider.providerId, sport, createdAt: { gte: dayStart } },
        }),
        this.prisma.ingestionJob.findMany({
          where: {
            providerId: provider.providerId,
            sport,
            createdAt: { gte: dayStart },
            errors: { gt: 0 },
          },
          select: { errors: true },
        }).then((rows) => rows.reduce((sum, row) => sum + row.errors, 0)),
        this.prisma.sportEvent.findMany({
          where: {
            providerId: provider.providerId,
            sport,
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          },
          select: { id: true },
        }),
      ]);

    const contestsDepending = activeEventRows.length > 0
      ? await this.prisma.contest.count({
          where: {
            sportEventId: { in: activeEventRows.map((row) => row.id) },
          },
        })
      : 0;

    return {
      sport,
      providerId: provider.providerId,
      lastPollAt: lastPollJob?.startedAt ?? lastPollJob?.createdAt ?? null,
      lastEventReceivedAt: lastEvent?.updatedAt ?? lastEvent?.createdAt ?? null,
      eventsToday,
      errorsToday,
      activeEventCount: activeEventRows.length,
      contestsDepending,
    };
  }

  private mapJob(row: {
    id: string;
    providerId: string;
    sport: string;
    eventExternalId: string | null;
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
    recordsProcessed: number;
    errors: number;
  }): IngestionJob {
    return {
      id: row.id,
      providerId: row.providerId,
      sport: row.sport as Sport,
      eventId: row.eventExternalId,
      status: row.status as IngestionJob['status'],
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      recordsProcessed: row.recordsProcessed,
      errors: row.errors,
    };
  }

  private mapErrorFromJob(row: {
    providerId: string;
    sport: string;
    eventExternalId: string | null;
    errorLog: Prisma.JsonValue;
    createdAt: Date;
  }): IngestionError[] {
    const entries = Array.isArray(row.errorLog) ? row.errorLog : [];
    const parsed = entries
      .map((entry) => parseErrorLogEntry(entry))
      .filter((entry): entry is { errorType: string; message: string } => entry !== null);
    if (parsed.length > 0) {
      return parsed.map((entry) => ({
        providerId: row.providerId,
        errorType: entry.errorType,
        message: entry.message,
        occurredAt: row.createdAt,
        eventId: row.eventExternalId,
      }));
    }

    return [{
      providerId: row.providerId,
      errorType: 'INGESTION_FAILURE',
      message: `${row.providerId} ingestion failed for ${row.sport}`,
      occurredAt: row.createdAt,
      eventId: row.eventExternalId,
    }];
  }

  private async buildUnmappedParticipantsForProvider(provider: SportDataProvider): Promise<UnmappedParticipant[]> {
    const mappings = await this.prisma.participantProviderMapping.findMany({
      where: { providerId: provider.providerId },
      select: { externalId: true },
    });
    const mappedIds = new Set(mappings.map((row) => row.externalId));
    const results: UnmappedParticipant[] = [];

    for (const sport of await this.getConfiguredSportsForProvider(provider)) {
      const participants = await provider.getParticipants(sport);
      for (const participant of participants) {
        if (mappedIds.has(participant.externalId)) {
          continue;
        }
        results.push({
          providerId: provider.providerId,
          providerName: providerDisplayName(provider),
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

  async listProviders(): Promise<ProviderSummary[]> {
    const providers = this.registry.getAllProviders();
    const summaries = await Promise.all(
      providers.map((provider) => this.buildProviderSummary(provider)),
    );
    return summaries.sort((a, b) => a.providerName.localeCompare(b.providerName));
  }

  async getProviderDetail(providerId: string): Promise<ProviderDetail> {
    const provider = this.getProviderOrThrow(providerId);
    const summary = await this.buildProviderSummary(provider);
    const recentHealthChecks = await this.prisma.providerHealthLog.findMany({
      where: { providerId },
      orderBy: { recordedAt: 'desc' },
      take: 10,
    });

    const ingestionStats = await Promise.all(
      (await this.getConfiguredSportsForProvider(provider)).map((sport) => this.buildIngestionStat(provider, sport)),
    );

    const recentJobsRows = await this.prisma.ingestionJob.findMany({
      where: { providerId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const failedJobRows = await this.prisma.ingestionJob.findMany({
      where: { providerId, errors: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const unmappedParticipants = await this.buildUnmappedParticipantsForProvider(provider);
    const mappedParticipantCount = await this.prisma.participantProviderMapping.count({
      where: { providerId },
    });

    return {
      ...summary,
      recentHealthChecks: recentHealthChecks.map((log) => ({
        providerId: log.providerId,
        providerName: summary.providerName,
        status: mapHealthStatus(log.status as AdapterHealthStatus['status']),
        errorRate: Number(log.errorRate ?? 0),
        latencyMs: log.avgLatencyMs ?? 0,
        checkedAt: log.recordedAt,
        details: log.consecutiveFailures > 0
          ? `${log.consecutiveFailures} consecutive failures`
          : `Status ${log.status}`,
      })),
      ingestionStats,
      recentErrors: failedJobRows.flatMap((row) => this.mapErrorFromJob(row)),
      recentJobs: recentJobsRows.map((row) => this.mapJob(row)),
      unmappedParticipants,
      mappedParticipantCount,
    };
  }

  async listSyncRuns(filters: {
    providerId?: string;
    sport?: Sport;
    status?: ProviderSyncRun['status'];
    limit?: number;
  } = {}): Promise<ProviderSyncRun[]> {
    const runs = await this.prisma.providerSyncRun.findMany({
      where: {
        providerId: filters.providerId,
        sport: filters.sport,
        status: filters.status,
      },
      orderBy: [
        { startedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      take: filters.limit ?? 20,
    });

    return runs.map((row) => ({
      id: row.id,
      providerId: row.providerId,
      sport: row.sport as Sport,
      eventId: row.eventId,
      status: row.status as ProviderSyncRun['status'],
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      payload: normalizeSyncRunPayload(row.payloadJson),
    }));
  }

  async updateProviderConfig(
    providerId: string,
    _updates: Record<string, unknown>,
    _rootAdminUserId: string,
    _rootAdminEmail: string,
  ): Promise<never> {
    this.getProviderOrThrow(providerId);
    throw new ProviderConfigUnsupportedError(providerId);
  }

  async triggerHealthCheck(
    providerId: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<ProviderHealthCheck> {
    this.logger?.debug({ providerId }, 'Triggering manual provider health check');
    const provider = this.getProviderOrThrow(providerId);
    const health = await provider.healthCheck();
    const checkedAt = new Date();

    await this.prisma.providerHealthLog.create({
      data: {
        providerId,
        status: health.status,
        errorRate: new Prisma.Decimal(health.errorRateLastHour),
        avgLatencyMs: health.latencyMsP95,
        consecutiveFailures: health.status === 'DOWN' ? 1 : 0,
        recordedAt: checkedAt,
      },
    });

    const result: ProviderHealthCheck = {
      providerId,
      providerName: providerDisplayName(provider),
      status: mapHealthStatus(health.status),
      errorRate: health.errorRateLastHour,
      latencyMs: health.latencyMsP95,
      checkedAt,
      details: health.message ?? (health.status === 'HEALTHY'
        ? 'Provider responded successfully.'
        : 'Provider returned a degraded health status.'),
    };

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'sportsdata.health_check',
      resourceType: 'PROVIDER',
      resourceId: providerId,
      description: `Manual health check for ${provider.providerName} — status: ${result.status}`,
      afterState: result as unknown as Record<string, unknown>,
    });

    this.logger?.info({
      providerId,
      status: result.status,
      checkedAt: checkedAt.toISOString(),
    }, 'Completed manual provider health check');
    return result;
  }

  async prepareSportSync(
    request: SportSyncRequest,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<ProviderManualSyncSubmissionResult> {
    const { sport } = request;
    this.logger?.info({
      sport,
      requestedFeeds: request.feeds,
      from: request.from?.toISOString() ?? null,
      to: request.to?.toISOString() ?? null,
      rootAdminUserId,
    }, 'Submitting manual sport sync');
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      this.logger?.error({ sport }, 'Manual sport sync was requested without a configured provider');
      throw new SportProviderNotFoundError(sport);
    }
    await this.assertSportSyncConfigured(sport);
    if (!this.scheduler) {
      throw new Error('Ingestion scheduler is required for manual sport sync');
    }

    const submittedAt = new Date();
    const syncRuns = await this.createManualSyncRunSubmissions({
      sport,
      eventId: null,
      requestedFeeds: request.feeds,
      providerId: provider.providerId,
      requestContext: {
        from: request.from?.toISOString() ?? null,
        to: request.to?.toISOString() ?? null,
      },
      submittedAt,
    });

    setImmediate(() => {
      void this.executeSubmittedSportSync({
        sport,
        request,
        syncRuns,
      });
    });

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'sportsdata.sync_sport_submitted',
      resourceType: 'SPORT',
      resourceId: sport,
      description: `Submitted ${sport} manual feed sync for ${request.feeds.join(', ')}`,
      afterState: {
        sport,
        providerId: provider.providerId,
        requestedFeeds: request.feeds,
        syncRunIds: syncRuns.map((run) => run.id),
      },
    });

    this.logger?.info({
      sport,
      providerId: provider.providerId,
      requestedFeeds: request.feeds,
      from: request.from?.toISOString() ?? null,
      to: request.to?.toISOString() ?? null,
      syncRunIds: syncRuns.map((run) => run.id),
    }, 'Submitted manual sport sync');
    return {
      sport,
      eventId: null,
      requestedFeeds: request.feeds,
      submittedAt,
      syncRuns,
    };
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

    const submittedAt = new Date();
    this.logger?.info({
      sport: request.sport,
      eventId: request.eventId,
      requestedFeeds: request.feeds,
      providerId: provider.providerId,
      rootAdminUserId,
    }, 'Submitting manual event sync');
    const syncRuns = await this.createManualSyncRunSubmissions({
      sport: request.sport,
      eventId: request.eventId,
      requestedFeeds: request.feeds,
      providerId: provider.providerId,
      requestContext: {},
      submittedAt,
    });

    setImmediate(() => {
      void this.executeSubmittedEventSync({
        request,
        syncRuns,
      });
    });

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'sportsdata.sync_event_submitted',
      resourceType: 'SPORT_EVENT',
      resourceId: `${request.sport}:${request.eventId}`,
      description: `Submitted ${request.sport} manual event sync for ${request.eventId}`,
      afterState: {
        sport: request.sport,
        eventId: request.eventId,
        providerId: provider.providerId,
        requestedFeeds: request.feeds,
        syncRunIds: syncRuns.map((run) => run.id),
      },
    });

    this.logger?.info({
      sport: request.sport,
      eventId: request.eventId,
      providerId: provider.providerId,
      requestedFeeds: request.feeds,
      syncRunIds: syncRuns.map((run) => run.id),
    }, 'Submitted manual event sync');

    return {
      sport: request.sport,
      eventId: request.eventId,
      requestedFeeds: request.feeds,
      submittedAt,
      syncRuns,
    };
  }

  private async createManualSyncRunSubmissions(input: {
    sport: Sport;
    eventId: string | null;
    requestedFeeds: IngestionFeedType[];
    providerId: string;
    requestContext: Record<string, unknown>;
    submittedAt: Date;
  }): Promise<ProviderSyncRun[]> {
    const runs = await Promise.all(
      input.requestedFeeds.map(async (feed) => {
        const payloadJson = {
          runType: input.eventId ? 'MANUAL_EVENT_SYNC' : 'MANUAL_SPORT_SYNC',
          requestedFeeds: input.requestedFeeds,
          requestedFeed: feed,
          requestPayload: {
            sport: input.sport,
            eventId: input.eventId,
            ...input.requestContext,
          },
          responsePayload: null,
          detail: buildSubmittedSyncRunDetail(feed, input.sport, input.eventId),
          ...input.requestContext,
        };
        const row = await this.prisma.providerSyncRun.create({
          data: {
            providerId: input.providerId,
            sport: input.sport,
            eventId: input.eventId,
            status: 'SUBMITTED',
            startedAt: null,
            completedAt: null,
            payloadJson,
            createdAt: input.submittedAt,
          },
        });

        return {
          id: row.id,
          providerId: row.providerId,
          sport: row.sport as Sport,
          eventId: row.eventId,
          status: row.status as ProviderSyncRun['status'],
          startedAt: row.startedAt,
          completedAt: row.completedAt,
          createdAt: row.createdAt,
          payload: normalizeSyncRunPayload(row.payloadJson),
        };
      }),
    );

    return runs;
  }

  private async updateSyncRun(
    syncRunId: string,
    update: {
      status: ProviderSyncRun['status'];
      startedAt?: Date | null;
      completedAt?: Date | null;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.prisma.providerSyncRun.update({
      where: { id: syncRunId },
      data: {
        status: update.status,
        startedAt: update.startedAt,
        completedAt: update.completedAt,
        payloadJson: update.payload as Prisma.InputJsonValue,
      },
    });
  }

  private async executeSubmittedSportSync(input: {
    sport: Sport;
    request: SportSyncRequest;
    syncRuns: ProviderSyncRun[];
  }): Promise<void> {
    this.logger?.debug({
      sport: input.sport,
      requestedFeeds: input.request.feeds,
      syncRunIds: input.syncRuns.map((run) => run.id),
      from: input.request.from?.toISOString() ?? null,
      to: input.request.to?.toISOString() ?? null,
    }, 'Executing submitted manual sport sync');
    for (const syncRun of input.syncRuns) {
      const requestedFeed = syncRun.payload.requestedFeed;
      if (!isSportSyncFeedType(requestedFeed)) {
        await this.failSubmittedSyncRun(syncRun, new Error(`Unsupported sport sync feed: ${String(requestedFeed)}`));
        continue;
      }

      await this.executeSubmittedFeedRun(syncRun, () =>
        this.scheduler!.runSportSync({
          sport: input.sport,
          feeds: [requestedFeed],
          from: input.request.from,
          to: input.request.to,
        }),
      );
    }
  }

  private async executeSubmittedEventSync(input: {
    request: EventSyncRequest;
    syncRuns: ProviderSyncRun[];
  }): Promise<void> {
    this.logger?.debug({
      sport: input.request.sport,
      eventId: input.request.eventId,
      requestedFeeds: input.request.feeds,
      syncRunIds: input.syncRuns.map((run) => run.id),
    }, 'Executing submitted manual event sync');
    for (const syncRun of input.syncRuns) {
      const requestedFeed = syncRun.payload.requestedFeed;
      if (!isEventSyncFeedType(requestedFeed)) {
        await this.failSubmittedSyncRun(syncRun, new Error(`Unsupported event sync feed: ${String(requestedFeed)}`));
        continue;
      }

      await this.executeSubmittedFeedRun(syncRun, () =>
        this.scheduler!.runEventSync({
          sport: input.request.sport,
          eventId: input.request.eventId,
          feeds: [requestedFeed],
        }),
      );
    }
  }

  private async executeSubmittedFeedRun(
    syncRun: ProviderSyncRun,
    run: () => Promise<IngestionJobRecord[]>,
  ): Promise<void> {
    const startedAt = new Date();
    const requestedFeed = syncRun.payload.requestedFeed;
    const startedPayload = {
      ...syncRun.payload,
      detail: `Started ${formatFeedLabel(requestedFeed as IngestionFeedType)} sync.`,
      responsePayload: null,
    };

    await this.updateSyncRun(syncRun.id, {
      status: 'IN_PROGRESS',
      startedAt,
      completedAt: null,
      payload: startedPayload,
    });
    this.logger?.debug({
      syncRunId: syncRun.id,
      providerId: syncRun.providerId,
      sport: syncRun.sport,
      eventId: syncRun.eventId,
      requestedFeed,
      startedAt: startedAt.toISOString(),
    }, 'Manual sync feed run started');

    try {
      const [job] = await run();
      const completedAt = new Date();
      const status: ProviderSyncRun['status'] = job.status === 'FAILED' ? 'FAILED' : 'COMPLETED';
      const payload = {
        ...startedPayload,
        detail: buildManualSyncRunDetail(job, syncRun.eventId),
        responsePayload: toSerializableJob(job),
        recordsProcessed: job.recordsProcessed,
        errors: job.errors,
      };

      await this.updateSyncRun(syncRun.id, {
        status,
        startedAt,
        completedAt,
        payload,
      });

      if (status === 'FAILED') {
        this.logger?.error(
          {
            syncRunId: syncRun.id,
            providerId: syncRun.providerId,
            sport: syncRun.sport,
            eventId: syncRun.eventId,
            job: toSerializableJob(job),
          },
          'Manual sync feed run failed.',
        );
      } else {
        this.logger?.info(
          {
            syncRunId: syncRun.id,
            providerId: syncRun.providerId,
            sport: syncRun.sport,
            eventId: syncRun.eventId,
            job: toSerializableJob(job),
          },
          'Manual sync feed run completed.',
        );
      }
    } catch (error) {
      await this.failSubmittedSyncRun(syncRun, error, startedAt, startedPayload);
    }
  }

  private async failSubmittedSyncRun(
    syncRun: ProviderSyncRun,
    error: unknown,
    startedAt: Date | null = new Date(),
    payload: Record<string, unknown> = syncRun.payload,
  ): Promise<void> {
    const requestedFeed = syncRun.payload.requestedFeed;
    const completedAt = new Date();
    const updatedPayload = {
      ...payload,
      detail: `Failed ${formatFeedLabel(requestedFeed as IngestionFeedType)} sync.`,
      responsePayload: {
        error: toJsonSafeErrorPayload(error),
      },
      errors: 1,
    };

    await this.updateSyncRun(syncRun.id, {
      status: 'FAILED',
      startedAt,
      completedAt,
      payload: updatedPayload,
    });

    this.logger?.error(
      {
        syncRunId: syncRun.id,
        providerId: syncRun.providerId,
        sport: syncRun.sport,
        eventId: syncRun.eventId,
        error: toJsonSafeErrorPayload(error),
      },
      'Manual sync feed run failed unexpectedly.',
    );
  }

  async getIngestionDashboard(): Promise<IngestionDashboard> {
    const providers = this.registry.getAllProviders();
    const sportProviderStatus = (await Promise.all(
      providers.map(async (provider) => {
        const sports = await this.getConfiguredSportsForProvider(provider);
        return Promise.all(sports.map((sport) => this.buildIngestionStat(provider, sport)));
      }),
    ))
      .flat()
      .sort((a, b) => `${a.providerId}:${a.sport}`.localeCompare(`${b.providerId}:${b.sport}`));

    const activeJobsRows = await this.prisma.ingestionJob.findMany({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const completedJobsRows = await this.prisma.ingestionJob.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      take: 10,
    });

    const failedJobsRows = await this.prisma.ingestionJob.findMany({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const recentErrors = failedJobsRows.flatMap((row) => this.mapErrorFromJob(row));
    const activeJobs = activeJobsRows.map((row) => this.mapJob(row));
    const recentCompletedJobs = completedJobsRows.map((row) => this.mapJob(row));

    const now = new Date();
    const lastHour = new Date(now.getTime() - 60 * 60_000);
    const throughputRows = await this.prisma.ingestionJob.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: lastHour },
      },
      select: { recordsProcessed: true },
    });
    const throughputPerMinute = throughputRows.reduce((sum, row) => sum + row.recordsProcessed, 0) / 60;

    return {
      sportProviderStatus,
      recentErrors,
      activeJobs,
      recentCompletedJobs,
      throughputPerMinute,
    };
  }

  async reIngestEvent(
    providerId: string,
    eventId: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<IngestionJob> {
    this.logger?.debug({ providerId, eventId }, 'Starting manual provider event re-ingest');
    const provider = this.getProviderOrThrow(providerId);
    const sport = provider.sportsCovered[0];
    if (!sport) {
      this.logger?.warn({ providerId, eventId }, 'Provider has no declared sport coverage for re-ingest');
      throw new ProviderSportCoverageError(providerId);
    }
    const job = await this.prisma.ingestionJob.create({
      data: {
        jobType: 'MANUAL_REINGEST',
        providerId,
        sport,
        eventExternalId: eventId,
        status: 'RUNNING',
        startedAt: new Date(),
        recordsProcessed: 0,
        errors: 0,
        errorLog: [],
      },
    });

    const detail = await provider.getEventDetails(eventId);
    if (!detail) {
      this.logger?.warn({ providerId, eventId }, 'Provider did not return event detail for re-ingest');
      await this.prisma.ingestionJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errors: 1,
          errorLog: [{ errorType: 'NOT_FOUND', message: `Event ${eventId} was not returned by ${provider.providerName}` }],
        },
      });
      throw new ProviderEventNotFoundError(providerId, eventId);
    }

    await this.prisma.ingestionJob.update({
      where: { id: job.id },
      data: { sport: detail.sport },
    });

    await this.ingestionPersistence.persistEventDetail(detail);

    await this.prisma.ingestionJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        recordsProcessed: 1 + detail.participants.length,
        errors: 0,
      },
    });

    const completed = await this.prisma.ingestionJob.findUnique({
      where: { id: job.id },
    });
    if (!completed) {
      throw new Error(`Re-ingestion job ${job.id} was not persisted`);
    }

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'sportsdata.re_ingest',
      resourceType: 'PROVIDER',
      resourceId: providerId,
      description: `Triggered re-ingestion for event ${eventId} from ${provider.providerName}`,
      afterState: { jobId: completed.id, eventId },
    });

    this.logger?.info({
      providerId,
      eventId,
      recordsProcessed: completed.recordsProcessed,
      sport: completed.sport,
    }, 'Completed manual provider event re-ingest');
    return this.mapJob(completed);
  }

  async getUnmappedParticipants(): Promise<UnmappedParticipant[]> {
    const providers = this.registry.getAllProviders();
    const unmapped: UnmappedParticipant[] = [];

    for (const provider of providers) {
      unmapped.push(...await this.buildUnmappedParticipantsForProvider(provider));
    }

    return unmapped;
  }

  async mapParticipant(
    providerId: string,
    externalId: string,
    internalId: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<void> {
    const provider = this.getProviderOrThrow(providerId);
    const participant = await this.prisma.participant.findUnique({
      where: { id: internalId },
      select: { id: true },
    });
    if (!participant) {
      throw new Error(`Participant not found: ${internalId}`);
    }

    await this.prisma.participantProviderMapping.upsert({
      where: {
        providerId_externalId: {
          providerId,
          externalId,
        },
      },
      create: {
        participantId: participant.id,
        providerId,
        externalId,
        confidence: 'MANUAL',
      },
      update: {
        participantId: participant.id,
        confidence: 'MANUAL',
      },
    });

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'sportsdata.map_participant',
      resourceType: 'PARTICIPANT',
      resourceId: externalId,
      description: `Mapped provider participant ${externalId} from ${provider.providerName} to internal participant ${internalId}`,
      afterState: { providerId, externalId, internalId },
    });
  }
}
