/**
 * The event sync jobs (#2009): SYNC_EVENT_FIELD and SYNC_EVENT_SCORES, one event's field or its
 * scores from the provider its league selects. The sync tick queues them on its schedule, a
 * provider's webhook queues the scores job (#1498), and a root admin's Sync now queues either
 * (#1441), so an event's feed runs one way whoever asks.
 *
 * A job carries only our own ids: the event, and the run a Sync now submitted. The event's id at
 * its provider is read when the job runs (`eventFeedRef`), so a payload or dedupe key never holds a
 * provider's id and no job parses one. The Provider row it reads is the job's own column (#2040).
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ProviderSyncRunRepository, SportEventRepository } from '@poolmaster/shared/db';
import {
  eventFeedRef,
  JobTrigger,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  type BackgroundJobOutcome,
  type ProviderSyncRun,
  type Sport,
} from '@poolmaster/shared/domain';
import type { IngestionScheduleConfig } from '@poolmaster/shared/dto/config.dto';
import { PermanentBackgroundJobError, type BackgroundJobContext } from '../background-jobs/background-job-runner';
import { jobDeferredUntilOf } from '../background-jobs/job-error-type';
import type { EventFeedSync, IngestionJobRecord } from './core/event-feed-sync';
import type { ProviderRegistry } from './core/provider-registry';
import { SyncOrchestrator, type EventSyncKind, type NormalizedSyncRequest } from './core/sync-orchestrator';
import { syncChangedRows } from './core/sync-write-diagnostics';
import type { EventSyncJobPayload } from './event-sync-job-requests';
import { SyncRunOutcomeUnrecordedError, type ProviderSyncRunLedger } from './persistence/provider-sync-run-ledger';

export interface EventSyncJobsDependencies {
  sportEvents: Pick<SportEventRepository, 'findById'>;
  feeds: Pick<EventFeedSync, 'runEventSync'>;
  syncRuns: Pick<ProviderSyncRunRepository, 'findManyByIds' | 'findByBackgroundJobIds' | 'update'>;
  syncRunLedger: Pick<ProviderSyncRunLedger, 'createSubmissions' | 'executeFeedRun' | 'failSubmittedRun'>;
  registry: Pick<ProviderRegistry, 'bySourceId'>;
  /** The ingestion schedule: a webhook's or the tick's scores job runs only while live scores are on. */
  schedule: { getConfig(): Promise<IngestionScheduleConfig> };
  syncOrchestrator?: Pick<SyncOrchestrator, 'normalizeRequest'>;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

const NOTHING_CHANGED: BackgroundJobOutcome = { changedCount: 0 };

export class EventSyncJobs {
  private readonly syncOrchestrator: Pick<SyncOrchestrator, 'normalizeRequest'>;
  private readonly now: () => Date;

  constructor(private readonly deps: EventSyncJobsDependencies) {
    this.now = deps.now ?? (() => new Date());
    this.syncOrchestrator = deps.syncOrchestrator ?? new SyncOrchestrator({ now: this.now });
  }

  /**
   * One event sync job: the event's feed of `kind`, recorded as a sync run. A Sync now's job runs
   * the run its admin submitted; any other records a run of its own, as the schedule's or the
   * webhook's, and runs only while its provider runs here (and, for scores, while live scores are
   * on). An event gone, or with no id at its league's provider any more, fails the job for good.
   */
  async run(kind: EventSyncKind, payload: EventSyncJobPayload, context: Pick<BackgroundJobContext, 'jobId' | 'attempt' | 'trigger'>): Promise<BackgroundJobOutcome> {
    const event = await this.deps.sportEvents.findById(payload.sportEventId);
    if (!event) throw new PermanentBackgroundJobError(`Sport event ${payload.sportEventId} no longer exists`);
    const feedRef = eventFeedRef(event);
    if (feedRef === undefined) throw new PermanentBackgroundJobError(`Sport event ${event.id} has no id at its league's provider any more`);
    const scope = { sport: event.sport, providerId: feedRef.providerId, eventId: feedRef.externalId };
    const feed = () => this.deps.feeds.runEventSync({ ...scope, kinds: [kind] });

    if (payload.syncRunId !== undefined) {
      return this.runSubmitted(payload.syncRunId, feed, context, { ...scope, kind, sportEventId: event.id });
    }
    if (this.deps.registry.bySourceId(feedRef.providerId) === null) {
      this.deps.logger?.info({ ...scope, kind, sportEventId: event.id }, 'Skipped an event sync because its provider is not running here');
      return NOTHING_CHANGED;
    }
    if (kind === ProviderSyncKind.SCORES && !(await this.deps.schedule.getConfig()).SCORES.enabled) {
      this.deps.logger?.info({ ...scope, kind, sportEventId: event.id }, 'Skipped an event scores sync because live score syncs are off');
      return NOTHING_CHANGED;
    }
    if (context.attempt > 1) await this.failInterruptedRuns(context.jobId);

    const normalizedRequest = this.normalized(context.trigger, { ...scope, kind });
    const syncRun = (await this.deps.syncRunLedger.createSubmissions({
      normalizedRequest,
      providerId: feedRef.providerId,
      submittedAt: this.now(),
      trigger: context.trigger,
      backgroundJobId: context.jobId,
      sportEventId: event.id,
      sportLeagueId: event.sportLeagueId,
    })).at(0);
    if (syncRun === undefined) throw new Error('The sync-run ledger created no run for an event sync');
    const record = await this.deps.syncRunLedger.executeFeedRun(syncRun, feed, { backgroundJobId: context.jobId });
    return { changedCount: syncChangedRows(record.writeDiagnostics) };
  }

  /**
   * The run a root admin's Sync now submitted (#1441). A run no longer SUBMITTED was started by an
   * earlier try of this job, so a retry skips it: the sync-run ledger makes the job idempotent. On
   * a retry, a run still IN_PROGRESS was left so by an earlier try that stopped mid-feed, or whose
   * failure could not be written (#1445): it is marked FAILED as interrupted, and not run again. A
   * feed that fails is recorded on its run; only a failure the ledger could not record fails the job.
   */
  private async runSubmitted(
    syncRunId: string,
    feed: () => Promise<IngestionJobRecord[]>,
    context: Pick<BackgroundJobContext, 'jobId' | 'attempt'>,
    scope: Record<string, string>,
  ): Promise<BackgroundJobOutcome> {
    const syncRun = (await this.deps.syncRuns.findManyByIds([syncRunId])).at(0);
    if (syncRun?.status === ProviderSyncRunStatus.IN_PROGRESS && context.attempt > 1) {
      await this.deps.syncRunLedger.failSubmittedRun(
        syncRun,
        new Error('Interrupted: an earlier try of this sync stopped before the feed finished'),
        syncRun.startedAt,
      );
      return NOTHING_CHANGED;
    }
    if (syncRun?.status !== ProviderSyncRunStatus.SUBMITTED) {
      this.deps.logger?.info({ ...scope, syncRunId, status: syncRun?.status ?? null }, 'Skipped a Sync now run that is no longer submitted');
      return NOTHING_CHANGED;
    }
    try {
      const record = await this.deps.syncRunLedger.executeFeedRun(syncRun, feed, { backgroundJobId: context.jobId });
      return { changedCount: syncChangedRows(record.writeDiagnostics) };
    } catch (error) {
      // The provider turned the feed away for now (league model 1c): the run is marked FAILED as
      // rate limited, and the job is queued again for when the provider will answer.
      if (jobDeferredUntilOf(error) !== null) throw error;
      if (error instanceof SyncRunOutcomeUnrecordedError) throw error;
      this.deps.logger?.error({ ...scope, syncRunId, error }, 'A Sync now feed failed; its run is marked FAILED');
      return NOTHING_CHANGED;
    }
  }

  /** The run an earlier try of a scheduled or webhook job left IN_PROGRESS: marked FAILED as interrupted. */
  private async failInterruptedRuns(jobId: string): Promise<void> {
    const interrupted = (await this.deps.syncRuns.findByBackgroundJobIds([jobId]))
      .filter((run: ProviderSyncRun) => run.status === ProviderSyncRunStatus.IN_PROGRESS);
    for (const run of interrupted) {
      // poolmaster-allow-query-in-loop: at most one interrupted run per earlier try, four tries at most
      await this.deps.syncRuns.update(run.id, {
        status: ProviderSyncRunStatus.FAILED,
        completedAt: this.now(),
        summary: 'Interrupted: an earlier try of this sync stopped before it finished.',
        stats: run.stats,
        changedCount: null,
        errorCount: 1,
      });
    }
  }

  /** The sync request a scheduled or webhook job records: the schedule's or the webhook's, by its trigger. */
  private normalized(trigger: JobTrigger, scope: { sport: Sport; providerId: string; eventId: string; kind: EventSyncKind }): NormalizedSyncRequest {
    const webhook = trigger === JobTrigger.WEBHOOK;
    return this.syncOrchestrator.normalizeRequest({
      source: webhook ? 'WEBHOOK' : 'SCHEDULED',
      actor: { type: 'SYSTEM', name: webhook ? 'webhook' : 'scheduler' },
      scope: { type: 'EVENT', sport: scope.sport, providerId: scope.providerId, eventId: scope.eventId, kinds: [scope.kind] },
    });
  }
}
