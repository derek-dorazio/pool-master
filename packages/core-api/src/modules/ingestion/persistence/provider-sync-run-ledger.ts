import type { FastifyBaseLogger } from 'fastify';
import { enumLabel } from '@poolmaster/shared/display-strings';
import type { ProviderSyncRunCreate, ProviderSyncRunRepository, ProviderSyncRunUpdate, SportEventRepository } from '@poolmaster/shared/db';
import {
  IngestionJobStatus,
  ProviderSyncFindingKind,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  type JobTrigger,
  type BackgroundJobRequest,
  type ProviderSyncRun,
  requireProviderCodeOfSourceId,
} from '@poolmaster/shared/domain';
import type { IngestionFeedType, IngestionJobRecord } from '../core/ingestion-scheduler';
import type { NormalizedSyncRequest } from '../core/sync-orchestrator';
import { syncChangedRows, type SyncWriteDiagnostics } from '../core/sync-write-diagnostics';
import type { ProviderSyncFindingService } from '../findings/provider-sync-finding-service';

/** Detailed diagnostics already written for a run; a failure keeps their provider payload. */
interface DetailsToRewrite {
  providerPayload?: unknown;
}

/**
 * A feed's run whose outcome could not be written, so it is still IN_PROGRESS (#1445): unlike a
 * feed failure the ledger recorded, this one the run's job must fail on, so its retry marks the
 * run interrupted.
 */
export class SyncRunOutcomeUnrecordedError extends Error {
  constructor(readonly syncRunId: string, cause: unknown) {
    super(`The outcome of sync run ${syncRunId} could not be recorded`, { cause });
    this.name = 'SyncRunOutcomeUnrecordedError';
  }
}

export class ProviderSyncRunLedger {
  /**
   * `linkedEvents` finds the event of ours a provider event is linked to, so a run whose caller
   * did not name its event and sport league still records them (#1847): the Sports page reads
   * each sport league's runs by them. `findings` takes each completed run's check of its event
   * (#1999): a field with no participants, or a scores sync with no updates.
   */
  constructor(
    private readonly syncRuns: ProviderSyncRunRepository,
    private readonly logger?: FastifyBaseLogger,
    private readonly linkedEvents?: Pick<SportEventRepository, 'findByProviderRef'>,
    private readonly findings?: Pick<ProviderSyncFindingService, 'checkEvent'>,
  ) {}

  async createSubmissions(input: SubmissionInput): Promise<ProviderSyncRun[]> {
    const runs = submissionRuns(await this.withLinkedEvent(input));
    return Promise.all(
      // poolmaster-allow-query-in-loop: one run per requested feed, a handful per sync request
      runs.map((run) => this.syncRuns.create(run)),
    );
  }

  /**
   * `createSubmissions`, with the job that will run them written in the same transaction
   * (#1441): neither is written without the other. `job` names the runs as written.
   */
  async createSubmissionsWithJob(
    input: SubmissionInput & { job: (runs: ProviderSyncRun[]) => BackgroundJobRequest },
  ): Promise<ProviderSyncRun[]> {
    return this.syncRuns.createWithJob(submissionRuns(await this.withLinkedEvent(input)), input.job);
  }

  /** The input with the linked event and its sport league filled in, when the caller left the league out and one is linked. */
  private async withLinkedEvent(input: SubmissionInput): Promise<SubmissionInput> {
    if (input.sportLeagueId !== undefined || this.linkedEvents === undefined) return input;
    const event = await this.linkedEvents.findByProviderRef(input.providerId, input.normalizedRequest.scope.eventId);
    if (event === null) return input;
    return { ...input, sportEventId: event.id, sportLeagueId: event.sportLeagueId };
  }

  /**
   * Runs one submitted run's feed and records its outcome. `backgroundJobId` names the job that
   * picked up a run submitted before it (an admin's sync, #1819), so Activity opens its runs.
   */
  async executeFeedRun(
    syncRun: ProviderSyncRun,
    run: () => Promise<IngestionJobRecord | IngestionJobRecord[]>,
    options: { backgroundJobId?: string } = {},
  ): Promise<IngestionJobRecord> {
    const startedAt = new Date();
    const label = syncLabel(syncRun.kind);
    const startedDetails = { providerPayload: uncapturedProviderPayload(feedOfSyncKind(syncRun.kind)) };

    await this.syncRuns.update(syncRun.id, {
      status: ProviderSyncRunStatus.IN_PROGRESS,
      startedAt,
      completedAt: null,
      summary: `Started ${label} sync.`,
      stats: {},
      changedCount: null,
      errorCount: 0,
      details: startedDetails,
      ...(options.backgroundJobId !== undefined && { backgroundJobId: options.backgroundJobId }),
    });
    this.logger?.debug({
      syncRunId: syncRun.id,
      providerId: syncRun.providerId,
      sport: syncRun.sport,
      kind: syncRun.kind,
      startedAt: startedAt.toISOString(),
    }, 'Provider sync feed run started');

    let job: IngestionJobRecord;
    try {
      const result = await run();
      const first = Array.isArray(result) ? result.at(0) : result;
      if (!first) {
        throw new Error('Sync execution completed without an ingestion job result.');
      }
      job = first;
      await this.syncRuns.update(syncRun.id, {
        ...completedOutcome(job, syncRun),
        startedAt,
        completedAt: new Date(),
        details: {
          providerPayload: job.providerPayload ?? startedDetails.providerPayload,
          jobPayload: toSerializableJob(job),
          writeDiagnostics: keepChangedRows(job.writeDiagnostics),
        },
      });
    } catch (error) {
      // Failed executions do not have a trustworthy completed write set. Keep
      // writeDiagnostics reserved for normalized rows that were actually
      // compared and returned by a completed persistence callback.
      try {
        await this.failSubmittedRun(syncRun, error, startedAt, startedDetails);
      } catch (recordError) {
        // The run is left IN_PROGRESS: the caller must know, so a retry can mark it (#1445).
        throw new SyncRunOutcomeUnrecordedError(syncRun.id, recordError);
      }
      throw error;
    }

    const logEntry = { syncRunId: syncRun.id, providerId: syncRun.providerId, sport: syncRun.sport, kind: syncRun.kind, job: toSerializableJob(job) };
    if (job.status === IngestionJobStatus.FAILED) {
      this.logger?.error(logEntry, 'Provider sync feed run failed.');
    } else {
      this.logger?.info(logEntry, 'Provider sync feed run completed.');
      await this.checkEvent(syncRun, job);
    }
    return job;
  }

  /**
   * A completed run's check of its event (#1999): the problem its kind looks for (a field with
   * no participants, a scores sync with no updates) is raised as a finding when the run warned of
   * it, and resolved when it did not. A run with no event or league of ours checks nothing.
   */
  private async checkEvent(syncRun: ProviderSyncRun, job: IngestionJobRecord): Promise<void> {
    const kind = EVENT_CHECK_OF_SYNC_KIND[syncRun.kind];
    if (this.findings === undefined || kind === undefined || syncRun.sportLeagueId === null || syncRun.sportEventId === null) return;
    // The run's outcome is already recorded: a findings write that fails is logged, never thrown,
    // so it cannot fail a run that succeeded (as the score publisher's, #2068).
    try {
      await this.findings.checkEvent({
        kind,
        sportLeagueId: syncRun.sportLeagueId,
        sportEventId: syncRun.sportEventId,
        providerId: syncRun.providerId,
        found: (job.warnings ?? []).some((warning) => warning.code === kind),
      });
    } catch (error) {
      this.logger?.error(
        { action: 'ingestion.syncFinding.checkFailed', data: { syncRunId: syncRun.id, kind, sportEventId: syncRun.sportEventId }, err: error },
        'Could not check the sync run\'s event for findings',
      );
    }
  }

  async failSubmittedRun(
    syncRun: ProviderSyncRun,
    error: unknown,
    startedAt: Date | null = new Date(),
    details: DetailsToRewrite = {},
  ): Promise<void> {
    await this.syncRuns.update(syncRun.id, {
      status: ProviderSyncRunStatus.FAILED,
      startedAt,
      completedAt: new Date(),
      summary: `Failed ${syncLabel(syncRun.kind)} sync: ${errorMessageOf(error)}`,
      stats: syncRun.stats,
      changedCount: null,
      errorCount: 1,
      details: {
        providerPayload: details.providerPayload ?? uncapturedProviderPayload(feedOfSyncKind(syncRun.kind)),
        failurePayload: {
          error: toJsonSafeErrorPayload(error),
        },
      },
    });

    this.logger?.error(
      {
        syncRunId: syncRun.id,
        providerId: syncRun.providerId,
        sport: syncRun.sport,
        kind: syncRun.kind,
        error: toJsonSafeErrorPayload(error),
      },
      'Provider sync feed run failed unexpectedly.',
    );
  }
}

/** The outcome of a run whose feed answered: COMPLETED with what it changed, or FAILED as the feed's job failed. */
function completedOutcome(job: IngestionJobRecord, syncRun: ProviderSyncRun): ProviderSyncRunUpdate {
  const failed = job.status === IngestionJobStatus.FAILED;
  const label = syncLabel(syncRun.kind);
  const target = syncRun.sportEventId ?? job.eventExternalId;
  return {
    status: failed ? ProviderSyncRunStatus.FAILED : ProviderSyncRunStatus.COMPLETED,
    summary: failed
      ? `Failed ${label} sync for ${target}: ${job.errorLog[0]?.error ?? 'Unknown ingestion failure'}`
      : `Completed ${label} sync for ${target} (${String(job.recordsProcessed)} records).`,
    stats: job.stats ?? {},
    changedCount: failed ? null : syncChangedRows(job.writeDiagnostics),
    errorCount: failed ? Math.max(job.errors, 1) : job.errors,
  };
}

/** The provider payload a run records until the provider call captures the raw one. */
function uncapturedProviderPayload(feed: IngestionFeedType | null): Record<string, unknown> | undefined {
  if (feed === null) return undefined;
  return {
    operation: feed,
    rawCaptured: false,
    rawTruncated: false,
  };
}

/**
 * The write diagnostics a run stores (#1174): the summary still counts every row, but only the
 * rows a sync created, updated or deleted are kept. A live tick over an unchanged field would
 * otherwise store one row per golfer every few minutes.
 */
function keepChangedRows(diagnostics: SyncWriteDiagnostics | undefined): SyncWriteDiagnostics | undefined {
  if (!diagnostics) return undefined;
  return {
    summary: diagnostics.summary,
    rows: diagnostics.rows.filter((row) => row.disposition !== 'UNCHANGED'),
  };
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
    eventExternalId: job.eventExternalId,
    status: job.status,
    startedAt: job.startedAt.toISOString(),
    completedAt: job.completedAt.toISOString(),
    recordsProcessed: job.recordsProcessed,
    errors: job.errors,
    errorLog: job.errorLog.map((entry) => ({ error: entry.error, at: entry.at.toISOString() })),
  };
}

/** A run's sync, as its summary line names it: the kind's display label. */
function syncLabel(kind: ProviderSyncKind): string {
  return enumLabel('ProviderSyncKind', kind);
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const FEED_KINDS: Readonly<Record<IngestionFeedType, ProviderSyncKind>> = {
  EVENTPARTICIPANTS: ProviderSyncKind.FIELD,
  EVENTLIVESCORES: ProviderSyncKind.SCORES,
};

/** The provider feed an event sync run of this kind reads; null for a kind no event feed runs (EVENTS). */
export function feedOfSyncKind(kind: ProviderSyncKind): IngestionFeedType | null {
  switch (kind) {
    case ProviderSyncKind.FIELD:
      return 'EVENTPARTICIPANTS';
    case ProviderSyncKind.SCORES:
      return 'EVENTLIVESCORES';
    case ProviderSyncKind.EVENTS:
      return null;
  }
}

/** The finding each event sync's run checks its event for (#1999). */
const EVENT_CHECK_OF_SYNC_KIND: Readonly<Partial<Record<ProviderSyncKind, ProviderSyncFindingKind>>> = {
  [ProviderSyncKind.FIELD]: ProviderSyncFindingKind.NO_PROVIDER_PARTICIPANTS,
  [ProviderSyncKind.SCORES]: ProviderSyncFindingKind.NO_PROVIDER_LIVE_SCORES,
};

interface SubmissionInput {
  normalizedRequest: NormalizedSyncRequest;
  providerId: string;
  submittedAt: Date;
  /** What started the runs (#1861): the job's trigger when a job runs them, else the request's or the schedule's. */
  trigger: JobTrigger;
  /** The job the runs are created in, when one is (a webhook's sync, #1819). */
  backgroundJobId?: string;
  /** PoolMaster's event the provider event is linked to, when the caller knows it. */
  sportEventId?: string;
  sportLeagueId?: string;
}

/** One SUBMITTED run per requested feed, as the sync history shows it before it starts. */
function submissionRuns(input: SubmissionInput): ProviderSyncRunCreate[] {
  const { sport, eventId, feeds } = input.normalizedRequest.scope;
  return feeds.map((feed) => {
    const kind = FEED_KINDS[feed];
    return {
      providerCode: requireProviderCodeOfSourceId(input.providerId),
      sport,
      kind,
      trigger: input.trigger,
      sportLeagueId: input.sportLeagueId ?? null,
      sportEventId: input.sportEventId ?? null,
      backgroundJobId: input.backgroundJobId ?? null,
      status: ProviderSyncRunStatus.SUBMITTED,
      startedAt: null,
      completedAt: null,
      summary: `Submitted ${syncLabel(kind)} sync for ${eventId}.`,
      stats: {},
      changedCount: null,
      errorCount: 0,
      createdAt: input.submittedAt,
    };
  });
}
