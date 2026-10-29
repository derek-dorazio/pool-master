import { AsyncLocalStorage } from 'node:async_hooks';
import type { PrismaClient } from '@prisma/client';

/**
 * The most Prisma queries one request should make (#1244). A request over it is logged as a
 * warning, and the functional suite fails on one. Most of what the perf audit (#1158) found was
 * too many queries per request, not slow ones: a route that reads in a loop shows up here first.
 */
export const REQUEST_QUERY_BUDGET = 25;

/** The Prisma queries one request made, and the time spent waiting on them. */
export class RequestQueryUsage {
  private count = 0;
  private waitedMs = 0;

  get queryCount(): number {
    return this.count;
  }

  /** Total wait on the database, in whole milliseconds. Queries run in parallel each add theirs. */
  get dbMs(): number {
    return Math.round(this.waitedMs);
  }

  get overBudget(): boolean {
    return this.count > REQUEST_QUERY_BUDGET;
  }

  record(elapsedMs: number): void {
    this.count += 1;
    this.waitedMs += elapsedMs;
  }
}

const scope = new AsyncLocalStorage<RequestQueryUsage>();

/** Runs `work` counting its Prisma queries into `usage`: the request hook opens one per request. */
export function runWithQueryUsage<T>(usage: RequestQueryUsage, work: () => T): T {
  return scope.run(usage, work);
}

/**
 * Runs `work` uncounted, for work a request starts but does not wait for, such as a background
 * sync: its queries are not the request's.
 */
export function outsideQueryUsage<T>(work: () => T): T {
  return scope.exit(work);
}

/**
 * `client`, counting each query it makes inside a request into that request's usage. A query
 * answered from the request's read memo never reaches the client, so it is not counted. Each
 * statement of a `$transaction([...])` batch counts as one; an interactive transaction counts
 * the queries made through its client.
 *
 * The extension only wraps queries; it adds no model, result or client member, so every call
 * site keeps the `PrismaClient` it was written against. Prisma types an extended client apart
 * (and leaves `$on` off it, which core-api never calls), hence the one cast here.
 */
export function countingQueries(client: PrismaClient): PrismaClient {
  const counted = client.$extends({
    query: {
      async $allOperations({ args, query }): Promise<unknown> {
        const usage = scope.getStore();
        const startedAt = performance.now();
        try {
          const result: unknown = await query(args);
          return result;
        } finally {
          usage?.record(performance.now() - startedAt);
        }
      },
    },
  });
  return counted as PrismaClient;
}
