import { type Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { ProviderSyncRunRepository } from '@poolmaster/shared/db';
import { IngestionJobStatus, ProviderSyncRunStatus, type ProviderSyncRun } from '@poolmaster/shared/domain';
import type { ProviderSyncRunPayloadDto } from '@poolmaster/shared/dto';
import type { IngestionFeedType, EventSyncRequest, IngestionJobRecord } from '../core/ingestion-scheduler';
import type { NormalizedSyncRequest } from '../core/sync-orchestrator';

/** A stored payload the ledger rewrites: every key carries over, and it keeps `providerPayload` when one exists. */
interface PayloadToRewrite {
  providerPayload?: unknown;
  [key: string]: unknown;
}

type SyncOutcomePayload = Prisma.InputJsonObject & {
  severity: 'SUCCESS' | 'WARNING' | 'ERROR';
  summary: string;
  warnings: Prisma.InputJsonArray;
  errors: number;
};

export class ProviderSyncRunLedger {
  constructor(
    private readonly syncRuns: ProviderSyncRunRepository,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async createSubmissions(input: {
    normalizedRequest: NormalizedSyncRequest;
    providerId: string;
    submittedAt: Date;
    runType: string;
  }): Promise<ProviderSyncRun[]> {
    const { sport, eventId, feeds } = input.normalizedRequest.scope;
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
            summary: buildSubmittedSyncRunDetail(feed, eventId),
          }),
          detail: buildSubmittedSyncRunDetail(feed, eventId),
        };
        return this.syncRuns.create({
          providerId: input.providerId,
          sport,
          eventId,
          status: 'SUBMITTED',
          startedAt: null,
          completedAt: null,
          payload: payloadJson,
          createdAt: input.submittedAt,
        });
      }),
    );

    return runs;
  }

  async executeFeedRun(
    syncRun: ProviderSyncRun,
    run: () => Promise<IngestionJobRecord | IngestionJobRecord[]>,
  ): Promise<IngestionJobRecord> {
    const startedAt = new Date();
    // Every run the ledger creates names its feed; the caller has already checked it.
    const requestedFeed = readPayload(syncRun).requestedFeed as IngestionFeedType;
    const startedPayload = {
      ...syncRun.payload,
      detail: `Started ${formatFeedLabel(requestedFeed)} sync.`,
      providerPayload: {
        operation: requestedFeed,
        rawCaptured: false,
        rawTruncated: false,
      },
      outcome: buildSyncOutcome({
        status: 'IN_PROGRESS',
        summary: `Started ${formatFeedLabel(requestedFeed)} sync.`,
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
      const status: ProviderSyncRun['status'] = job.status === IngestionJobStatus.FAILED ? ProviderSyncRunStatus.FAILED : ProviderSyncRunStatus.COMPLETED;
      const detail = buildSyncRunDetail(job, syncRun.eventId);
      const payload = {
        ...startedPayload,
        detail,
        jobPayload: toSerializableJob(job),
        providerPayload: job.providerPayload ?? startedPayload.providerPayload,
        writeDiagnostics: job.writeDiagnostics,
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
      // Failed executions do not have a trustworthy completed write set. Keep
      // writeDiagnostics reserved for normalized rows that were actually
      // compared and returned by a completed persistence callback.
      await this.failSubmittedRun(syncRun, error, startedAt, startedPayload);
      throw error;
    }
  }

  async failSubmittedRun(
    syncRun: ProviderSyncRun,
    error: unknown,
    startedAt: Date | null = new Date(),
    payload: PayloadToRewrite = syncRun.payload,
  ): Promise<void> {
    const { requestedFeed } = readPayload(syncRun);
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
      status: ProviderSyncRun['status'];
      startedAt?: Date | null;
      completedAt?: Date | null;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.syncRuns.update(syncRunId, update);
  }
}

function mapJobTypeToFeed(jobType: IngestionJobRecord['jobType']): IngestionFeedType {
  switch (jobType) {
    case 'EVENT_PARTICIPANTS_SYNC':
      return 'EVENTPARTICIPANTS';
    case 'EVENT_LIVE_SCORES_SYNC':
      return 'EVENTLIVESCORES';
  }
}

function buildSubmittedSyncRunDetail(feed: IngestionFeedType, eventId: string): string {
  return `Submitted ${formatFeedLabel(feed)} sync for ${eventId}.`;
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
    errorLog: job.errorLog.map((entry) => ({ error: entry.error, at: entry.at.toISOString() })),
  };
}

function buildSyncOutcome(input: {
  status: ProviderSyncRun['status'];
  summary: string;
  warnings?: IngestionJobRecord['warnings'];
  errors?: number;
}): SyncOutcomePayload {
  const warnings = input.warnings ?? [];
  const errorCount = input.errors ?? 0;
  const severity = input.status === ProviderSyncRunStatus.FAILED || errorCount > 0
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
    case 'EVENTPARTICIPANTS':
      return 'event participants';
    case 'EVENTLIVESCORES':
      return 'event live scores';
  }
}

function buildSyncRunDetail(
  job: IngestionJobRecord,
  eventId: string | null,
): string {
  const target = eventId ?? job.eventExternalId ?? job.sport;
  const feed = formatFeedLabel(mapJobTypeToFeed(job.jobType));
  if (job.status === IngestionJobStatus.FAILED) {
    const error = job.errorLog[0]?.error ?? 'Unknown ingestion failure';
    return `Failed ${feed} sync for ${target}: ${error}`;
  }

  return `Completed ${feed} sync for ${target} (${job.recordsProcessed} records).`;
}

/** Who asked for a sync run and how, as stored under the run's `requestPayload`. */
export interface SyncRequestContext {
  source: NormalizedSyncRequest['source'];
  actor: NormalizedSyncRequest['actor'];
  workflowContext: NormalizedSyncRequest['workflowContext'];
  mockEventState: NormalizedSyncRequest['scope']['mockEventState'] | null;
  /** ISO-8601. */
  normalizedAt: string;
}

export function buildNormalizedSyncRequestContext(normalized: NormalizedSyncRequest): SyncRequestContext {
  return {
    source: normalized.source,
    actor: normalized.actor,
    workflowContext: normalized.workflowContext,
    mockEventState: normalized.scope.mockEventState ?? null,
    normalizedAt: normalized.normalizedAt.toISOString(),
  };
}

/**
 * The run's payload in the shape the ledger writes it (the payload DTO's keys). The
 * stored JSON is not re-validated on read, so a reader still checks a value before it
 * relies on it, as `isEventSyncFeedType` does for the feed.
 */
export function readPayload(syncRun: Pick<ProviderSyncRun, 'payload'>): ProviderSyncRunPayloadDto {
  return syncRun.payload;
}

export function isEventSyncFeedType(
  feed: unknown,
): feed is EventSyncRequest['feeds'][number] {
  return feed === 'EVENTPARTICIPANTS'
    || feed === 'EVENTLIVESCORES';
}
