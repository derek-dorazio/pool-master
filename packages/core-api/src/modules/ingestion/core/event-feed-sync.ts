/**
 * EventFeedSync: runs one event's feed from the provider its league selects (#2009). Its field
 * reads the event's detail and writes the field; its scores read the event's live scores and write
 * them through the event's scoring family. It decides nothing about when: the sync tick, a
 * provider's webhook and a root admin's Sync now each queue an event sync job, and the job runs
 * the feed here, recorded as a sync run by the job (`EventSyncJobs`).
 */

import { ProviderSyncFindingKind, ProviderSyncKind, type IngestionJobStatus, type Sport } from '@poolmaster/shared/domain';
import type { FastifyBaseLogger } from 'fastify';
import type { ProviderRegistry } from './provider-registry';
import type { SyncWriteDiagnostics } from './sync-write-diagnostics';
import { syncWriteStats } from './sync-write-diagnostics';
import type { EventSyncKind } from './sync-orchestrator';
import type {
  ProviderPayloadCapture,
  ProviderPayloadCaptureSession,
  SportDataProvider,
  SportEventDetail,
} from './provider-interface';
import { supportsProviderPayloadDiagnostics } from './provider-interface';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type { LiveScorePersistenceResult } from './score-publisher';
import { countLiveScoreUpdates } from './live-score-count';
import { jobDeferredUntilOf } from '../../background-jobs/job-error-type';

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
  eventExternalId: string;
  status: IngestionJobStatus;
  startedAt: Date;
  completedAt: Date;
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
  rawCaptured: boolean;
  rawTruncated: boolean;
  raw?: ProviderPayloadCapture[];
}

interface IngestionJobWorkResult {
  recordsProcessed: number;
  stats: Record<string, number>;
  warnings: IngestionJobWarning[];
  writeDiagnostics: SyncWriteDiagnostics;
}

export interface EventSyncRequest {
  sport: Sport;
  /** The provider the event is linked to (#1495). */
  providerId: string;
  eventId: string;
  kinds: EventSyncKind[];
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

export class EventFeedSync {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly callbacks: IngestionCallbacks,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /** Runs the event's feeds of the requested sync kinds, one after another. */
  async runEventSync(request: EventSyncRequest): Promise<IngestionJobRecord[]> {
    const jobs: IngestionJobRecord[] = [];
    this.logger?.info({
      sport: request.sport,
      eventId: request.eventId,
      kinds: request.kinds,
    }, 'Event sync requested');

    for (const kind of dedupe(request.kinds)) {
      if (kind === ProviderSyncKind.FIELD) {
        jobs.push(await this.runEventFieldSync(request.sport, request.providerId, request.eventId));
        continue;
      }

      jobs.push(await this.pollLiveScores(request.sport, request.providerId, request.eventId));
    }

    this.logger?.info({
      sport: request.sport,
      eventId: request.eventId,
      kinds: request.kinds,
      jobs: jobs.map(toJobLogPayload),
    }, 'Event sync completed');

    return jobs;
  }

  /** Polls live scores for a specific event from the provider it is linked to. */
  async pollLiveScores(
    sport: Sport,
    providerId: string,
    eventId: string,
  ): Promise<IngestionJobRecord> {
    this.logger?.debug({ sport, providerId, eventId }, 'Polling live scores for event');
    const provider = this.providerServing(providerId);
    if (!provider) {
      this.logger?.warn({ sport, providerId, eventId }, 'No provider registered for live score polling');
      return createFailedJob('EVENT_LIVE_SCORES_SYNC', providerId, sport, 'No provider registered', eventId);
    }

    return this.runJob('EVENT_LIVE_SCORES_SYNC', provider.providerId, sport, provider, async () => {
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

  async runEventFieldSync(
    sport: Sport,
    providerId: string,
    eventId: string,
  ): Promise<IngestionJobRecord> {
    this.logger?.debug({ sport, providerId, eventId }, 'Running participant sync for event');
    const provider = this.providerServing(providerId);
    if (!provider) {
      this.logger?.warn({ sport, providerId, eventId }, 'No provider registered for event participant sync');
      return createFailedJob('EVENT_PARTICIPANTS_SYNC', providerId, sport, 'No provider registered', eventId);
    }

    return this.runJob('EVENT_PARTICIPANTS_SYNC', provider.providerId, sport, provider, async () => {
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
    provider: SportDataProvider,
    work: () => Promise<IngestionJobWorkResult>,
    eventExternalId: string,
  ): Promise<IngestionJobRecord> {
    const startedAt = new Date();
    // The record as it runs: it gets its completedAt when the work ends, either way.
    const job: Omit<IngestionJobRecord, 'completedAt'> = {
      jobType,
      providerId,
      sport,
      eventExternalId,
      status: 'RUNNING',
      startedAt,
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
        eventExternalId,
        startedAt: startedAt.toISOString(),
      }, 'Ingestion job started');
      if (supportsProviderPayloadDiagnostics(provider) && !payloadCaptureSession) {
        provider.clearProviderPayloads();
      }
      const result = payloadCaptureSession
        ? await payloadCaptureSession.run(work)
        : await work();
      job.recordsProcessed = result.recordsProcessed;
      job.stats = result.stats;
      job.warnings = result.warnings;
      job.writeDiagnostics = result.writeDiagnostics;
      job.providerPayload = buildProviderPayload(provider, payloadCaptureSession);
      job.status = 'COMPLETED';
    } catch (err) {
      // The provider turned the call away for now (league model 1c): the caller's job is queued
      // again for when it will answer, so the failure is thrown, not kept as this run's outcome.
      if (jobDeferredUntilOf(err) !== null) throw err;
      job.providerPayload = buildProviderPayload(provider, payloadCaptureSession);
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
    }
    const finished: IngestionJobRecord = { ...job, completedAt: new Date() };

    this.logger?.info({
      ...toJobLogPayload(finished),
      durationMs: finished.completedAt.getTime() - startedAt.getTime(),
    }, 'Ingestion job completed');
    return finished;
  }

  /**
   * The running provider with this id. The events it is asked about come from leagues whose
   * selected mapping names it (#2073), so the sport plays no part in finding it.
   */
  private providerServing(providerId: string): SportDataProvider | null {
    return this.registry.bySourceId(providerId);
  }
}

function createFailedJob(
  jobType: JobType,
  providerId: string,
  sport: Sport,
  error: string,
  eventExternalId: string,
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

function buildProviderPayload(
  provider: SportDataProvider,
  captureSession?: ProviderPayloadCaptureSession | null,
): IngestionJobProviderPayload {
  // A capture session's payloads first; else the provider's own, when it keeps any.
  const source = captureSession ?? (supportsProviderPayloadDiagnostics(provider) ? provider : null);
  if (!source) {
    return {
      rawCaptured: false,
      rawTruncated: false,
    };
  }

  const raw = source.consumeProviderPayloads();
  const payload: IngestionJobProviderPayload = {
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
    eventExternalId: job.eventExternalId,
    status: job.status,
    recordsProcessed: job.recordsProcessed,
    errors: job.errors,
    stats: job.stats ?? null,
    warnings: job.warnings ?? [],
    startedAt: job.startedAt.toISOString(),
    completedAt: job.completedAt.toISOString(),
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
