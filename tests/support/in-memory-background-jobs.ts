/**
 * An in-memory BackgroundJobRepository (#1439), for runner and queue tests that assert what the
 * job table holds rather than which repository calls were made. The Prisma adapter behind the
 * same port is tested against Postgres in background-jobs.integration.
 */

import type { BackgroundJobClaim, BackgroundJobRepository } from '@poolmaster/shared/db';
import { BackgroundJobStatus, BackgroundJobType, JobTrigger, type BackgroundJob, type BackgroundJobRequest, type JobStart } from '@poolmaster/shared/domain';
import { currentJobStart, JobStartMissingError } from '../../packages/core-api/src/core/job-start';
import type { BackgroundJobHandlers } from '../../packages/core-api/src/modules/background-jobs';

export interface InMemoryBackgroundJobs extends BackgroundJobRepository {
  /** Every job, in the order queued, with the starter's id as queued (the adapter reads the person). */
  rows: (BackgroundJob & { dedupeKey?: string; startedByUserId?: string })[];
  /** The `limit` of every claim, in order. */
  claimLimits: number[];
}

export function inMemoryBackgroundJobs(now: () => Date = () => new Date()): InMemoryBackgroundJobs {
  const rows: InMemoryBackgroundJobs['rows'] = [];
  const claimLimits: number[] = [];
  let nextId = 1;

  /** Writes only while the job is still RUNNING on the claim's attempt, as the adapter does. */
  function markClaimed(claim: BackgroundJobClaim, changes: Partial<InMemoryBackgroundJobs['rows'][number]>): boolean {
    const row = rows.find((candidate) => candidate.id === claim.id);
    if (!row) throw new Error(`No background job ${claim.id}`);
    if (row.status !== BackgroundJobStatus.RUNNING || row.attempts !== claim.attempts) return false;
    Object.assign(row, changes);
    return true;
  }

  function enqueueOne(request: BackgroundJobRequest): boolean {
    return enqueueReturningOne(request).written;
  }

  function enqueueReturningOne(request: BackgroundJobRequest): { written: boolean; job: InMemoryBackgroundJobs['rows'][number] } {
    const waiting = request.dedupeKey === undefined ? undefined : rows.find((row) => row.dedupeKey === request.dedupeKey);
    if (waiting) return { written: false, job: waiting };
    const createdAt = now();
    const job: InMemoryBackgroundJobs['rows'][number] = {
      id: `job-${String(nextId++)}`,
      type: request.type,
      payload: structuredClone(request.payload),
      status: BackgroundJobStatus.QUEUED,
      runAt: request.runAt ?? createdAt,
      attempts: 0,
      dedupeKey: request.dedupeKey,
      trigger: request.start.trigger,
      ...('startedByUserId' in request.start && { startedByUserId: request.start.startedByUserId }),
      ...(request.sportLeagueId !== undefined && { sportLeagueId: request.sportLeagueId }),
      ...(request.sportEventId !== undefined && { sportEventId: request.sportEventId }),
      createdAt,
    };
    rows.push(job);
    return { written: true, job };
  }

  return {
    rows,
    claimLimits,
    enqueue: (request) => Promise.resolve(enqueueOne(request)),
    enqueueAll: (requests) => Promise.resolve(requests.filter((request) => enqueueOne(request)).length),
    enqueueReturning: (request) => Promise.resolve({ ...enqueueReturningOne(request).job }),
    claimDue: ({ now: at, limit, leaseUntil }) => {
      claimLimits.push(limit);
      const due = rows
        .filter((row) => (row.status === BackgroundJobStatus.QUEUED && row.runAt <= at)
          || (row.status === BackgroundJobStatus.RUNNING && row.leaseUntil !== undefined && row.leaseUntil <= at))
        .sort((a, b) => a.runAt.getTime() - b.runAt.getTime())
        .slice(0, limit);
      for (const row of due) {
        Object.assign(row, { status: BackgroundJobStatus.RUNNING, attempts: row.attempts + 1, startedAt: at, leaseUntil: leaseUntil, dedupeKey: undefined });
      }
      return Promise.resolve(due.map((row) => ({ ...row })));
    },
    markSucceeded: (claim, completedAt, { changedCount, heldBack, result }) =>
      Promise.resolve(markClaimed(claim, {
        status: BackgroundJobStatus.SUCCEEDED,
        completedAt,
        leaseUntil: undefined,
        changedCount,
        errorType: heldBack,
        ...(result !== undefined && { result }),
      })),
    renewLease: (claim, leaseUntil) => Promise.resolve(markClaimed(claim, { leaseUntil })),
    markRetry: (claim, { runAt, error, errorType }) =>
      Promise.resolve(markClaimed(claim, { status: BackgroundJobStatus.QUEUED, runAt, lastError: error, errorType, leaseUntil: undefined })),
    markFailed: (claim, { error, errorType, completedAt }) =>
      Promise.resolve(markClaimed(claim, { status: BackgroundJobStatus.FAILED, lastError: error, errorType, completedAt, leaseUntil: undefined })),
    deleteBatchCompletedBefore: (status, cutoff, limit) => {
      const batch = rows
        .filter((row) => row.status === status && row.completedAt !== undefined && row.completedAt < cutoff)
        .slice(0, limit);
      for (const row of batch) rows.splice(rows.indexOf(row), 1);
      return Promise.resolve(batch.length);
    },
    findActivity: () => Promise.reject(new Error('Activity reads are tested against Postgres in background-jobs.integration')),
  };
}

/**
 * A handler for every job type: the ones given, and for the rest one that throws, so a test whose
 * code queues a job it did not expect sees that job fail rather than pass unnoticed.
 */
export function jobHandlers(handlers: Partial<BackgroundJobHandlers>): BackgroundJobHandlers {
  const unexpected = (type: BackgroundJobType) => () => Promise.reject(new Error(`No ${type} job was expected in this test`));
  return Object.fromEntries(Object.values(BackgroundJobType)
    .map((type) => [type, handlers[type] ?? unexpected(type)])) as BackgroundJobHandlers;
}

/** What a test's directly written job says started it, where the test is not about that. */
export const TEST_JOB_START: JobStart = { trigger: JobTrigger.SCHEDULE };

/**
 * A test queue's `currentStart` (#1861): what the entry point under way says, as in the app (a
 * request through the test app, a sweep, the runner's handler), or else `TEST_JOB_START`, so a
 * test that calls a service directly may queue a job.
 */
export function testCurrentJobStart(): JobStart {
  try {
    return currentJobStart();
  } catch (error) {
    if (error instanceof JobStartMissingError) return TEST_JOB_START;
    throw error;
  }
}
