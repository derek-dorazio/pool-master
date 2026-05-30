import { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Sport } from '@poolmaster/shared/domain';
import type { IngestionFeedType, SportSyncRequest, EventSyncRequest, IngestionJobRecord } from '../core/ingestion-scheduler';
import type { NormalizedSyncRequest } from '../core/sync-orchestrator';

export interface ProviderSyncRunRecord {
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

interface ProviderSyncRunClient {
  providerSyncRun: {
    create(args: Prisma.ProviderSyncRunCreateArgs): PromiseLike<{
      id: string;
      providerId: string;
      sport: string;
      eventId: string | null;
      status: string;
      startedAt: Date | null;
      completedAt: Date | null;
      createdAt: Date;
      payloadJson: Prisma.JsonValue;
    }>;
    update(args: Prisma.ProviderSyncRunUpdateArgs): PromiseLike<unknown>;
  };
}

type SyncOutcomePayload = Prisma.InputJsonObject & {
  severity: 'SUCCESS' | 'WARNING' | 'ERROR';
  summary: string;
  warnings: Prisma.InputJsonArray;
  errors: number;
};

export class ProviderSyncRunLedger {
  constructor(
    private readonly prisma: ProviderSyncRunClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async createSubmissions(input: {
    normalizedRequest: NormalizedSyncRequest;
    providerId: string;
    submittedAt: Date;
    runType: string;
  }): Promise<ProviderSyncRunRecord[]> {
    const { sport, eventId, feeds } = getNormalizedTarget(input.normalizedRequest);
    const requestContext = buildNormalizedSyncRequestContext(input.normalizedRequest);
    const runs = await Promise.all(
      feeds.map(async (feed) => {
        const payloadJson = {
          runType: input.runType,
          requestedFeeds: feeds,
          requestedFeed: feed,
          requestPayload: {
            sport,
            eventId,
            ...requestContext,
          },
          providerPayload: {
            operation: feed,
            rawCaptured: false,
            rawTruncated: false,
          },
          stats: {},
          outcome: buildSyncOutcome({
            status: 'SUBMITTED',
            summary: buildSubmittedSyncRunDetail(feed, sport, eventId),
          }),
          detail: buildSubmittedSyncRunDetail(feed, sport, eventId),
        };
        const row = await this.prisma.providerSyncRun.create({
          data: {
            providerId: input.providerId,
            sport,
            eventId,
            status: 'SUBMITTED',
            startedAt: null,
            completedAt: null,
            payloadJson,
            createdAt: input.submittedAt,
          },
        });

        return mapProviderSyncRunRow(row);
      }),
    );

    return runs;
  }

  async executeFeedRun(
    syncRun: ProviderSyncRunRecord,
    run: () => Promise<IngestionJobRecord | IngestionJobRecord[]>,
  ): Promise<IngestionJobRecord> {
    const startedAt = new Date();
    const requestedFeed = syncRun.payload.requestedFeed;
    const startedPayload = {
      ...syncRun.payload,
      detail: `Started ${formatFeedLabel(requestedFeed as IngestionFeedType)} sync.`,
      providerPayload: {
        operation: requestedFeed,
        rawCaptured: false,
        rawTruncated: false,
      },
      outcome: buildSyncOutcome({
        status: 'IN_PROGRESS',
        summary: `Started ${formatFeedLabel(requestedFeed as IngestionFeedType)} sync.`,
      }),
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
    }, 'Provider sync feed run started');

    try {
      const result = await run();
      const job = Array.isArray(result) ? result[0] : result;
      if (!job) {
        throw new Error('Sync execution completed without an ingestion job result.');
      }
      const completedAt = new Date();
      const status: ProviderSyncRunRecord['status'] = job.status === 'FAILED' ? 'FAILED' : 'COMPLETED';
      const detail = buildSyncRunDetail(job, syncRun.eventId);
      const payload = {
        ...startedPayload,
        detail,
        jobPayload: toSerializableJob(job),
        providerPayload: job.providerPayload ?? startedPayload.providerPayload,
        outcome: buildSyncOutcome({
          status,
          summary: detail,
          warnings: job.warnings,
          errors: job.errors,
        }),
        stats: job.stats ?? {},
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
          'Provider sync feed run failed.',
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
          'Provider sync feed run completed.',
        );
      }

      return job;
    } catch (error) {
      await this.failSubmittedRun(syncRun, error, startedAt, startedPayload);
      throw error;
    }
  }

  async failSubmittedRun(
    syncRun: ProviderSyncRunRecord,
    error: unknown,
    startedAt: Date | null = new Date(),
    payload: Record<string, unknown> = syncRun.payload,
  ): Promise<void> {
    const requestedFeed = syncRun.payload.requestedFeed;
    const completedAt = new Date();
    const updatedPayload = {
      ...payload,
      detail: `Failed ${formatFeedLabel(requestedFeed as IngestionFeedType)} sync.`,
      providerPayload: payload.providerPayload ?? {
        operation: requestedFeed,
        rawCaptured: false,
        rawTruncated: false,
      },
      outcome: buildSyncOutcome({
        status: 'FAILED',
        summary: `Failed ${formatFeedLabel(requestedFeed as IngestionFeedType)} sync.`,
        errors: 1,
      }),
      errors: 1,
      failurePayload: {
        error: toJsonSafeErrorPayload(error),
      },
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
      'Provider sync feed run failed unexpectedly.',
    );
  }

  private async updateSyncRun(
    syncRunId: string,
    update: {
      status: ProviderSyncRunRecord['status'];
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
}

export function normalizeSyncRunPayload(payload: Prisma.JsonValue): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  return payload as Record<string, unknown>;
}

export function mapProviderSyncRunRow(row: {
  id: string;
  providerId: string;
  sport: string;
  eventId: string | null;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  payloadJson: Prisma.JsonValue;
}): ProviderSyncRunRecord {
  return {
    id: row.id,
    providerId: row.providerId,
    sport: row.sport as Sport,
    eventId: row.eventId,
    status: row.status as ProviderSyncRunRecord['status'],
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    payload: normalizeSyncRunPayload(row.payloadJson),
  };
}

function getNormalizedTarget(normalized: NormalizedSyncRequest): {
  sport: Sport;
  eventId: string | null;
  feeds: IngestionFeedType[];
} {
  if (normalized.scope.type === 'SPORT') {
    return {
      sport: normalized.scope.sport,
      eventId: null,
      feeds: normalized.scope.feeds,
    };
  }

  return {
    sport: normalized.scope.sport,
    eventId: normalized.scope.eventId,
    feeds: normalized.scope.feeds,
  };
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
    ...(job.eventExternalId ? { eventExternalId: job.eventExternalId } : {}),
    status: job.status,
    ...(job.startedAt ? { startedAt: job.startedAt.toISOString() } : {}),
    ...(job.completedAt ? { completedAt: job.completedAt.toISOString() } : {}),
    recordsProcessed: job.recordsProcessed,
    errors: job.errors,
    errorLog: job.errorLog,
  };
}

function buildSyncOutcome(input: {
  status: ProviderSyncRunRecord['status'];
  summary: string;
  warnings?: IngestionJobRecord['warnings'];
  errors?: number;
}): SyncOutcomePayload {
  const warnings = input.warnings ?? [];
  const errorCount = input.errors ?? 0;
  const severity = input.status === 'FAILED' || errorCount > 0
    ? 'ERROR'
    : warnings.length > 0
      ? 'WARNING'
      : 'SUCCESS';

  return {
    severity,
    summary: input.summary,
    warnings: warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
    })),
    errors: errorCount,
  };
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

function buildSyncRunDetail(
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

function serializeDate(value: Date | undefined): string | null {
  return value?.toISOString() ?? null;
}

export function buildNormalizedSyncRequestContext(normalized: NormalizedSyncRequest): Record<string, unknown> {
  if (normalized.scope.type === 'SPORT') {
    return {
      source: normalized.source,
      actor: normalized.actor,
      workflowContext: normalized.workflowContext,
      from: serializeDate(normalized.scope.requestedWindow.from),
      to: serializeDate(normalized.scope.requestedWindow.to),
      requestedWindow: {
        from: serializeDate(normalized.scope.requestedWindow.from),
        to: serializeDate(normalized.scope.requestedWindow.to),
      },
      effectiveWindow: {
        from: normalized.scope.effectiveWindow.from.toISOString(),
        to: normalized.scope.effectiveWindow.to.toISOString(),
        defaultedFrom: normalized.scope.effectiveWindow.defaultedFrom,
        defaultedTo: normalized.scope.effectiveWindow.defaultedTo,
      },
      normalizedAt: normalized.normalizedAt.toISOString(),
    };
  }

  return {
    source: normalized.source,
    actor: normalized.actor,
    workflowContext: normalized.workflowContext,
    mockEventState: normalized.scope.mockEventState ?? null,
    normalizedAt: normalized.normalizedAt.toISOString(),
  };
}

export function isSportSyncFeedType(
  feed: unknown,
): feed is SportSyncRequest['feeds'][number] {
  return feed === 'EVENTSCHEDULE'
    || feed === 'PARTICIPANTRANKINGS';
}

export function isEventSyncFeedType(
  feed: unknown,
): feed is EventSyncRequest['feeds'][number] {
  return feed === 'EVENTPARTICIPANTS'
    || feed === 'EVENTLIVESCORES'
    || feed === 'EVENTRESULTS';
}
