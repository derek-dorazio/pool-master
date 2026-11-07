/**
 * An in-memory ProviderSyncRunRepository (#1441) whose `createWithJob` writes the runs and their
 * job together into an in-memory job table, or neither when building the job throws. Each method
 * is a jest mock, so a test can also see that nothing was written. The Prisma adapter is tested
 * against Postgres in background-jobs.integration.
 */

import { randomUUID } from 'node:crypto';
import type { ProviderSyncRunRepository } from '@poolmaster/shared/db';
import type { ProviderSyncRun } from '@poolmaster/shared/domain';
import { mockFn } from './mock-fn';
import { inMemoryBackgroundJobs, type InMemoryBackgroundJobs } from './in-memory-background-jobs';

export type InMemorySyncRuns = jest.Mocked<ProviderSyncRunRepository> & {
  /** Every run, in the order written. */
  rows: ProviderSyncRun[];
  /** The job table `createWithJob` writes to. */
  jobs: InMemoryBackgroundJobs;
};

export function inMemorySyncRuns(jobs: InMemoryBackgroundJobs = inMemoryBackgroundJobs()): InMemorySyncRuns {
  const rows: ProviderSyncRun[] = [];
  const toRun = (input: Parameters<ProviderSyncRunRepository['create']>[0]): ProviderSyncRun => ({
    id: randomUUID(),
    ...input,
    createdAt: input.createdAt ?? new Date(),
  });
  return {
    rows,
    jobs,
    create: mockFn<ProviderSyncRunRepository['create']>((input) => {
      const run = toRun(input);
      rows.push(run);
      return Promise.resolve({ ...run });
    }),
    createWithJob: mockFn<ProviderSyncRunRepository['createWithJob']>(async (inputs, job) => {
      const runs = inputs.map(toRun);
      const request = job(runs.map((run) => ({ ...run })));
      rows.push(...runs);
      await jobs.enqueue(request);
      return runs.map((run) => ({ ...run }));
    }),
    update: mockFn<ProviderSyncRunRepository['update']>((id, update) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) return Promise.reject(new Error(`No sync run ${id}`));
      Object.assign(row, {
        status: update.status,
        payload: update.payload,
        ...(update.startedAt !== undefined && { startedAt: update.startedAt }),
        ...(update.completedAt !== undefined && { completedAt: update.completedAt }),
      });
      return Promise.resolve();
    }),
    findAll: mockFn<ProviderSyncRunRepository['findAll']>(() => Promise.resolve(rows.map((run) => ({ ...run })))),
    findById: mockFn<ProviderSyncRunRepository['findById']>((id) => {
      const row = rows.find((candidate) => candidate.id === id);
      return Promise.resolve(row ? { ...row, details: {} } : null);
    }),
    findManyByIds: mockFn<ProviderSyncRunRepository['findManyByIds']>((ids) =>
      Promise.resolve(rows.filter((row) => ids.includes(row.id)).map((run) => ({ ...run })))),
    clearDetailsBatchSubmittedBefore: mockFn<ProviderSyncRunRepository['clearDetailsBatchSubmittedBefore']>(() => Promise.resolve(0)),
    deleteBatchSubmittedBefore: mockFn<ProviderSyncRunRepository['deleteBatchSubmittedBefore']>(() => Promise.resolve(0)),
  };
}
