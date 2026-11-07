/**
 * An in-memory BackgroundJobRepository (#1439), for runner and queue tests that assert what the
 * job table holds rather than which repository calls were made. The Prisma adapter behind the
 * same port is tested against Postgres in background-jobs.integration.
 */

import type { BackgroundJobRepository } from '@poolmaster/shared/db';
import { BackgroundJobStatus, type BackgroundJob, type BackgroundJobRequest } from '@poolmaster/shared/domain';

export interface InMemoryBackgroundJobs extends BackgroundJobRepository {
  /** Every job, in the order queued. */
  rows: (BackgroundJob & { dedupeKey?: string })[];
  /** The `limit` of every claim, in order. */
  claimLimits: number[];
}

export function inMemoryBackgroundJobs(now: () => Date = () => new Date()): InMemoryBackgroundJobs {
  const rows: InMemoryBackgroundJobs['rows'] = [];
  const claimLimits: number[] = [];
  let nextId = 1;

  function update(id: string, changes: Partial<InMemoryBackgroundJobs['rows'][number]>): void {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`No background job ${id}`);
    Object.assign(row, changes);
  }

  function enqueueOne(request: BackgroundJobRequest): boolean {
    if (request.dedupeKey !== undefined && rows.some((row) => row.dedupeKey === request.dedupeKey)) return false;
    const createdAt = now();
    rows.push({
      id: `job-${String(nextId++)}`,
      type: request.type,
      payload: structuredClone(request.payload),
      status: BackgroundJobStatus.QUEUED,
      runAt: request.runAt ?? createdAt,
      attempts: 0,
      dedupeKey: request.dedupeKey,
      createdAt,
    });
    return true;
  }

  return {
    rows,
    claimLimits,
    enqueue: (request) => Promise.resolve(enqueueOne(request)),
    claimDue: ({ now: at, limit, leaseUntil }) => {
      claimLimits.push(limit);
      const due = rows
        .filter((row) => (row.status === BackgroundJobStatus.QUEUED && row.runAt <= at)
          || (row.status === BackgroundJobStatus.RUNNING && row.leaseUntil !== undefined && row.leaseUntil <= at))
        .sort((a, b) => a.runAt.getTime() - b.runAt.getTime())
        .slice(0, limit);
      for (const row of due) {
        Object.assign(row, { status: BackgroundJobStatus.RUNNING, attempts: row.attempts + 1, leaseUntil: leaseUntil, dedupeKey: undefined });
      }
      return Promise.resolve(due.map((row) => ({ ...row })));
    },
    markSucceeded: (id, completedAt) => {
      update(id, { status: BackgroundJobStatus.SUCCEEDED, completedAt, leaseUntil: undefined });
      return Promise.resolve();
    },
    markRetry: (id, { runAt, error }) => {
      update(id, { status: BackgroundJobStatus.QUEUED, runAt, lastError: error, leaseUntil: undefined });
      return Promise.resolve();
    },
    markFailed: (id, { error, completedAt }) => {
      update(id, { status: BackgroundJobStatus.FAILED, lastError: error, completedAt, leaseUntil: undefined });
      return Promise.resolve();
    },
    deleteBatchCompletedBefore: (status, cutoff, limit) => {
      const batch = rows
        .filter((row) => row.status === status && row.completedAt !== undefined && row.completedAt < cutoff)
        .slice(0, limit);
      for (const row of batch) rows.splice(rows.indexOf(row), 1);
      return Promise.resolve(batch.length);
    },
  };
}
