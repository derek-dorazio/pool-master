/**
 * Prisma adapter for BackgroundJobRepository: the background job table (#1439).
 */

import type { BackgroundJob as BackgroundJobRow, Prisma, PrismaClient } from '@prisma/client';
import type { BackgroundJobClaim, BackgroundJobRepository } from '@poolmaster/shared/db';
import {
  BackgroundJobStatus,
  type BackgroundJob,
  type BackgroundJobRequest,
} from '@poolmaster/shared/domain';

/** The stored error is cut to this many characters: a stack or a provider body can be long. */
export const BACKGROUND_JOB_ERROR_MAX_LENGTH = 2000;

export class PrismaBackgroundJobRepository implements BackgroundJobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async enqueue(request: BackgroundJobRequest): Promise<boolean> {
    return (await insertBackgroundJobs(this.prisma, [request])) === 1;
  }

  enqueueAll(requests: readonly BackgroundJobRequest[]): Promise<number> {
    return insertBackgroundJobs(this.prisma, requests);
  }

  async claimDue(claim: { now: Date; limit: number; leaseUntil: Date }): Promise<BackgroundJob[]> {
    const { now, limit, leaseUntil } = claim;
    return this.prisma.$transaction(async (tx) => {
      // SKIP LOCKED: two tasks never claim the same job (a row lock; raw SQL only for it).
      const due = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "background_jobs"
        WHERE ("status" = 'QUEUED' AND "run_at" <= ${now})
           OR ("status" = 'RUNNING' AND "lease_until" <= ${now})
        ORDER BY "run_at", "created_at"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`;
      if (due.length === 0) return [];
      const ids = due.map((row) => row.id);
      // One write answering the claimed rows.
      const rows = await tx.backgroundJob.updateManyAndReturn({
        where: { id: { in: ids } },
        data: {
          status: BackgroundJobStatus.RUNNING,
          attempts: { increment: 1 },
          leaseUntil,
          dedupeKey: null,
        },
      });
      return rows
        .sort((a, b) => a.runAt.getTime() - b.runAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime())
        .map(toBackgroundJob);
    });
  }

  async markSucceeded(claim: BackgroundJobClaim, completedAt: Date): Promise<boolean> {
    return this.markClaimed(claim, { status: BackgroundJobStatus.SUCCEEDED, completedAt, leaseUntil: null });
  }

  async markRetry(claim: BackgroundJobClaim, retry: { runAt: Date; error: string }): Promise<boolean> {
    return this.markClaimed(claim, {
      status: BackgroundJobStatus.QUEUED,
      runAt: retry.runAt,
      leaseUntil: null,
      lastError: truncateError(retry.error),
    });
  }

  async markFailed(claim: BackgroundJobClaim, failed: { error: string; completedAt: Date }): Promise<boolean> {
    return this.markClaimed(claim, {
      status: BackgroundJobStatus.FAILED,
      completedAt: failed.completedAt,
      leaseUntil: null,
      lastError: truncateError(failed.error),
    });
  }

  /** Writes `data` only while the job is still RUNNING on the claim's attempt. */
  private async markClaimed(claim: BackgroundJobClaim, data: Prisma.BackgroundJobUpdateManyMutationInput): Promise<boolean> {
    const { count } = await this.prisma.backgroundJob.updateMany({
      where: { id: claim.id, status: BackgroundJobStatus.RUNNING, attempts: claim.attempts },
      data,
    });
    return count === 1;
  }

  async deleteBatchCompletedBefore(
    status: typeof BackgroundJobStatus.SUCCEEDED | typeof BackgroundJobStatus.FAILED,
    cutoff: Date,
    limit: number,
  ): Promise<number> {
    const batch = await this.prisma.backgroundJob.findMany({
      where: { status, completedAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { completedAt: 'asc' },
      take: limit,
    });
    if (batch.length === 0) return 0;
    const { count } = await this.prisma.backgroundJob.deleteMany({
      where: { id: { in: batch.map((row) => row.id) } },
    });
    return count;
  }
}

/**
 * Queues jobs on any client, so an adapter can write them in the transaction of the change that
 * caused them: they commit or roll back together. A dedupe key a job waiting for its first try holds writes nothing
 * (ON CONFLICT DO NOTHING, which raises nothing that would abort the caller's transaction).
 * Resolves to how many were written.
 */
export async function insertBackgroundJobs(
  db: PrismaClient | Prisma.TransactionClient,
  requests: readonly BackgroundJobRequest[],
): Promise<number> {
  if (requests.length === 0) return 0;
  const { count } = await db.backgroundJob.createMany({
    data: requests.map((request) => ({
      type: request.type,
      payload: request.payload as Prisma.InputJsonValue,
      ...(request.runAt && { runAt: request.runAt }),
      dedupeKey: request.dedupeKey ?? null,
    })),
    skipDuplicates: true,
  });
  return count;
}

function truncateError(error: string): string {
  return error.length <= BACKGROUND_JOB_ERROR_MAX_LENGTH ? error : `${error.slice(0, BACKGROUND_JOB_ERROR_MAX_LENGTH - 1)}…`;
}

function toBackgroundJob(row: BackgroundJobRow): BackgroundJob {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    runAt: row.runAt,
    attempts: row.attempts,
    leaseUntil: row.leaseUntil ?? undefined,
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt,
    completedAt: row.completedAt ?? undefined,
  };
}
