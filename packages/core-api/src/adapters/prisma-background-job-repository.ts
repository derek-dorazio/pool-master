/**
 * Prisma adapter for BackgroundJobRepository: the background job table (#1439).
 */

import type { BackgroundJob as BackgroundJobRow, Prisma, PrismaClient, User } from '@prisma/client';
import type { BackgroundJobClaim, BackgroundJobRepository, BackgroundJobScopeCount } from '@poolmaster/shared/db';
import {
  BackgroundJobStatus,
  type BackgroundJob,
  type BackgroundJobActivityFilter,
  type BackgroundJobOutcome,
  type BackgroundJobRequest,
  type BackgroundJobResult,
  type JobErrorType,
} from '@poolmaster/shared/domain';

/** The starter's columns a job is read with: what screens name a person by. */
const STARTED_BY_SELECT = { id: true, firstName: true, lastName: true, username: true, email: true } as const;
type StartedByRow = Pick<User, keyof typeof STARTED_BY_SELECT>;

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

  async enqueueReturning(request: BackgroundJobRequest): Promise<BackgroundJob> {
    // A dedupe key a waiting job holds writes no row and answers that job. A worker may claim
    // it, which frees the key, between the insert and the read: then the key is free, and a
    // second insert writes this request's own job.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // poolmaster-allow-query-in-loop: at most two tries, the second only when a claim freed the key
      const written = await this.prisma.backgroundJob.createManyAndReturn({
        data: [toCreateData(request)],
        skipDuplicates: true,
        include: { startedBy: { select: STARTED_BY_SELECT } },
      });
      if (written.length > 0) return toBackgroundJob(written[0], written[0].startedBy);
      const waiting = request.dedupeKey === undefined
        ? null
        // poolmaster-allow-query-in-loop: at most two tries, as above
        : await this.prisma.backgroundJob.findUnique({ where: { dedupeKey: request.dedupeKey }, include: { startedBy: { select: STARTED_BY_SELECT } } });
      if (waiting) return toBackgroundJob(waiting, waiting.startedBy);
    }
    throw new Error(`A ${request.type} job was neither written nor found waiting`);
  }

  async findActivity(filter: BackgroundJobActivityFilter): Promise<BackgroundJob[]> {
    // A league's activity is its own jobs and its events' jobs: its events' ids in one read, then
    // the jobs on the (sport_league_id, created_at) and (sport_event_id, created_at) indexes.
    const leagueEventIds = filter.sportLeagueId === undefined
      ? undefined
      : (await this.prisma.sportEvent.findMany({
        where: { sportLeagueSeason: { sportLeagueId: filter.sportLeagueId } },
        select: { id: true },
      })).map((event) => event.id);
    const rows = await this.prisma.backgroundJob.findMany({
      where: {
        ...(filter.types !== undefined && { type: { in: [...filter.types] } }),
        ...(filter.status !== undefined && { status: filter.status }),
        ...(filter.sportEventId !== undefined && { sportEventId: filter.sportEventId }),
        ...(filter.sportLeagueId !== undefined && {
          OR: [
            { sportLeagueId: filter.sportLeagueId },
            ...(leagueEventIds && leagueEventIds.length > 0 ? [{ sportEventId: { in: leagueEventIds } }] : []),
          ],
        }),
        createdAt: { gte: filter.createdFrom, lte: filter.createdTo },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // The person who started each ADMIN or COMMISSIONER job (#1861), in one more read for them all: never one per row.
      include: { startedBy: { select: STARTED_BY_SELECT } },
    });
    return rows.map((row) => toBackgroundJob(row, row.startedBy));
  }

  async countByScope(filter: { errorType: JobErrorType; since: Date }): Promise<BackgroundJobScopeCount[]> {
    const groups = await this.prisma.backgroundJob.groupBy({
      by: ['sportLeagueId', 'sportEventId'],
      where: {
        errorType: filter.errorType,
        OR: [
          { status: BackgroundJobStatus.FAILED, completedAt: { gte: filter.since } },
          { status: BackgroundJobStatus.QUEUED, startedAt: { gte: filter.since } },
        ],
      },
      _count: { _all: true },
    });
    return groups.map((group) => ({
      sportLeagueId: group.sportLeagueId,
      sportEventId: group.sportEventId,
      count: group._count._all,
    }));
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
          startedAt: now,
          leaseUntil,
          dedupeKey: null,
        },
      });
      return rows
        .sort((a, b) => a.runAt.getTime() - b.runAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime())
        .map((row) => toBackgroundJob(row));
    });
  }

  async markSucceeded(claim: BackgroundJobClaim, completedAt: Date, outcome: BackgroundJobOutcome): Promise<boolean> {
    return this.markClaimed(claim, {
      status: BackgroundJobStatus.SUCCEEDED,
      completedAt,
      leaseUntil: null,
      changedCount: outcome.changedCount,
      errorType: outcome.heldBack ?? null,
      ...(outcome.result !== undefined && { result: outcome.result as Prisma.InputJsonObject }),
    });
  }

  async renewLease(claim: BackgroundJobClaim, leaseUntil: Date): Promise<boolean> {
    return this.markClaimed(claim, { leaseUntil });
  }

  async markRetry(claim: BackgroundJobClaim, retry: { runAt: Date; error: string; errorType: JobErrorType }): Promise<boolean> {
    return this.markClaimed(claim, {
      status: BackgroundJobStatus.QUEUED,
      runAt: retry.runAt,
      leaseUntil: null,
      lastError: truncateError(retry.error),
      errorType: retry.errorType,
    });
  }

  async markDeferred(claim: BackgroundJobClaim, deferred: { runAt: Date; error: string; errorType: JobErrorType }): Promise<boolean> {
    return this.markClaimed(claim, {
      status: BackgroundJobStatus.QUEUED,
      runAt: deferred.runAt,
      leaseUntil: null,
      attempts: { decrement: 1 },
      lastError: truncateError(deferred.error),
      errorType: deferred.errorType,
    });
  }

  async deleteClaimed(claim: BackgroundJobClaim): Promise<boolean> {
    const { count } = await this.prisma.backgroundJob.deleteMany({
      where: { id: claim.id, status: BackgroundJobStatus.RUNNING, attempts: claim.attempts },
    });
    return count === 1;
  }

  async markFailed(claim: BackgroundJobClaim, failed: { error: string; errorType: JobErrorType; completedAt: Date }): Promise<boolean> {
    return this.markClaimed(claim, {
      status: BackgroundJobStatus.FAILED,
      completedAt: failed.completedAt,
      leaseUntil: null,
      lastError: truncateError(failed.error),
      errorType: failed.errorType,
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
  const { count } = await backgroundJobsInsert(db, requests);
  return count;
}

/**
 * The insert `insertBackgroundJobs` makes, unsent, for an adapter writing its change as a batch
 * transaction (`$transaction([...])`): appended to the batch, the jobs commit with the change.
 * Only for a non-empty `requests`.
 */
export function backgroundJobsInsert(db: PrismaClient | Prisma.TransactionClient, requests: readonly BackgroundJobRequest[]) {
  return db.backgroundJob.createMany({ data: requests.map(toCreateData), skipDuplicates: true });
}

function toCreateData(request: BackgroundJobRequest): Prisma.BackgroundJobCreateManyInput {
  return {
    type: request.type,
    payload: request.payload as Prisma.InputJsonValue,
    ...(request.runAt && { runAt: request.runAt }),
    dedupeKey: request.dedupeKey ?? null,
    sportLeagueId: request.sportLeagueId ?? null,
    sportEventId: request.sportEventId ?? null,
    providerId: request.providerId ?? null,
    trigger: request.start.trigger,
    startedByUserId: 'startedByUserId' in request.start ? request.start.startedByUserId : null,
  };
}

function truncateError(error: string): string {
  return error.length <= BACKGROUND_JOB_ERROR_MAX_LENGTH ? error : `${error.slice(0, BACKGROUND_JOB_ERROR_MAX_LENGTH - 1)}…`;
}

/**
 * The job a row holds. Its starter is read only where it is shown (Activity); elsewhere the job
 * names none.
 */
function toBackgroundJob(row: BackgroundJobRow, startedBy?: StartedByRow | null): BackgroundJob {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    runAt: row.runAt,
    attempts: row.attempts,
    leaseUntil: row.leaseUntil ?? undefined,
    lastError: row.lastError ?? undefined,
    sportLeagueId: row.sportLeagueId ?? undefined,
    sportEventId: row.sportEventId ?? undefined,
    result: (row.result ?? undefined) as BackgroundJobResult | undefined,
    trigger: row.trigger,
    startedBy: startedBy ?? undefined,
    startedAt: row.startedAt ?? undefined,
    changedCount: row.changedCount ?? undefined,
    errorType: row.errorType ?? undefined,
    createdAt: row.createdAt,
    completedAt: row.completedAt ?? undefined,
  };
}
