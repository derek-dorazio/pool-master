/**
 * ProviderService — business logic for admin sports data provider management.
 *
 * The service is backed by the live provider registry plus persisted Prisma
 * tables for health logs, sport events, ingestion jobs, and participant
 * mappings. It no longer synthesizes provider state from static mock data.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { Sport } from '@poolmaster/shared/domain';
import { logAdminAction } from './admin-audit-service';
import { ProviderRegistry } from '../ingestion/core/provider-registry';
import { EspnAdapter, OpenF1Adapter, OddsApiAdapter, PgaTourAdapter } from '../ingestion/adapters';
import type {
  SportDataProvider,
  ProviderHealthStatus as AdapterHealthStatus,
} from '../ingestion/core/provider-interface';
import { IngestionPersistence } from '../ingestion/persistence/ingestion-persistence';

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
  sportsCovered: string[];
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
  sport: string;
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
  sport: string;
  eventId: string | null;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt: Date | null;
  completedAt: Date | null;
  recordsProcessed: number;
  errors: number;
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
  sport: string;
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

function buildProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(Sport.GOLF, new PgaTourAdapter(), 'PRIMARY');
  registry.register(Sport.F1, new OpenF1Adapter(), 'PRIMARY');
  registry.register(Sport.NFL, new EspnAdapter(), 'PRIMARY');
  registry.register(Sport.NBA, new EspnAdapter(), 'PRIMARY');
  registry.register(Sport.MLB, new EspnAdapter(), 'PRIMARY');
  registry.register(Sport.NHL, new EspnAdapter(), 'PRIMARY');
  registry.register(Sport.NCAA_BASKETBALL, new EspnAdapter(), 'PRIMARY');
  registry.register(Sport.SOCCER, new OddsApiAdapter(), 'PRIMARY');
  return registry;
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

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ProviderService {
  private readonly ingestionPersistence: IngestionPersistence;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: ProviderRegistry = buildProviderRegistry(),
  ) {
    this.ingestionPersistence = new IngestionPersistence(prisma);
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
      sportsCovered: provider.sportsCovered.map(String),
      activeEventCount: activeEvents,
    };
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

    const contestMatchups = activeEventRows.length > 0
      ? await this.prisma.contestMatchup.count({
          where: {
            eventId: { in: activeEventRows.map((row) => row.id) },
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
      contestsDepending: contestMatchups,
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
      sport: row.sport,
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

    for (const sport of provider.sportsCovered) {
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
      provider.sportsCovered.map((sport) => this.buildIngestionStat(provider, sport)),
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

  async updateProviderConfig(
    providerId: string,
    _updates: Record<string, unknown>,
    _adminUserId: string,
    _adminUserEmail: string,
  ): Promise<never> {
    this.getProviderOrThrow(providerId);
    throw new ProviderConfigUnsupportedError(providerId);
  }

  async triggerHealthCheck(
    providerId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<ProviderHealthCheck> {
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
      adminUserId,
      adminUserEmail,
      action: 'sportsdata.health_check',
      resourceType: 'PROVIDER',
      resourceId: providerId,
      description: `Manual health check for ${provider.providerName} — status: ${result.status}`,
      afterState: result as unknown as Record<string, unknown>,
    });

    return result;
  }

  async getIngestionDashboard(): Promise<IngestionDashboard> {
    const providers = this.registry.getAllProviders();
    const sportProviderStatus = (await Promise.all(
      providers.flatMap((provider) => provider.sportsCovered.map((sport) => this.buildIngestionStat(provider, sport))),
    )).sort((a, b) => `${a.providerId}:${a.sport}`.localeCompare(`${b.providerId}:${b.sport}`));

    const activeJobsRows = await this.prisma.ingestionJob.findMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
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
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<IngestionJob> {
    const provider = this.getProviderOrThrow(providerId);
    const job = await this.prisma.ingestionJob.create({
      data: {
        jobType: 'MANUAL_REINGEST',
        providerId,
        sport: provider.sportsCovered[0] ?? 'UNKNOWN',
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
      adminUserId,
      adminUserEmail,
      action: 'sportsdata.re_ingest',
      resourceType: 'PROVIDER',
      resourceId: providerId,
      description: `Triggered re-ingestion for event ${eventId} from ${provider.providerName}`,
      afterState: { jobId: completed.id, eventId },
    });

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
    adminUserId: string,
    adminUserEmail: string,
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
      adminUserId,
      adminUserEmail,
      action: 'sportsdata.map_participant',
      resourceType: 'PARTICIPANT',
      resourceId: externalId,
      description: `Mapped provider participant ${externalId} from ${provider.providerName} to internal participant ${internalId}`,
      afterState: { providerId, externalId, internalId },
    });
  }
}
