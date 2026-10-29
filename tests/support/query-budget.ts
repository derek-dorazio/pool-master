import { createServer } from 'node:http';
import { REQUEST_QUERY_BUDGET } from '../../packages/core-api/src/core/request-query-usage';

/** A request the functional suite fails on (#1244): its route ran more queries than the budget. */
export interface QueryBudgetViolation {
  /** Method and route pattern, such as `GET /api/v1/leagues/:id`. */
  route: string;
  queryCount: number;
}

/** Routes known to be over budget, each naming the open ticket whose fix removes it. */
export type QueryBudgetAllowList = Readonly<Record<string, { ticket: number }>>;

/** The violation `route` makes with `queryCount` queries, or null when it is in budget or allowed. */
export function queryBudgetViolation(
  route: string,
  queryCount: number,
  allowList: QueryBudgetAllowList,
): QueryBudgetViolation | null {
  if (queryCount <= REQUEST_QUERY_BUDGET || route in allowList) {
    return null;
  }
  return { route, queryCount };
}

/** The failure message for `violations`, one route per line. */
export function describeQueryBudgetViolations(violations: readonly QueryBudgetViolation[]): string {
  const lines = violations.map(({ route, queryCount }) => `  ${route} ran ${queryCount} queries`);
  return [
    `Over the per-request query budget of ${REQUEST_QUERY_BUDGET} (rules/testing-rules.md, the query budget):`,
    ...lines,
    'Batch the reads, or add the route to tests/functional/query-budget-allow-list.ts with the ticket that fixes it.',
  ].join('\n');
}

/** An allow-list entry the run never saw over budget: its fix has landed, or its route is gone. */
export interface StaleAllowListEntry {
  route: string;
  ticket: number;
  /** The most queries the route ran in the run, or null when no test called it. */
  mostQueries: number | null;
}

/** The allow-list entries whose route never went over budget in a run, given the most each ran. */
export function staleAllowListEntries(
  allowList: QueryBudgetAllowList,
  mostQueriesSeen: ReadonlyMap<string, number>,
): StaleAllowListEntry[] {
  return Object.entries(allowList)
    .map(([route, { ticket }]) => ({ route, ticket, mostQueries: mostQueriesSeen.get(route) ?? null }))
    .filter(({ mostQueries }) => mostQueries === null || mostQueries <= REQUEST_QUERY_BUDGET);
}

/** The failure message for `stale` entries, one route per line. */
export function describeStaleAllowListEntries(stale: readonly StaleAllowListEntry[]): string {
  const lines = stale.map(({ route, ticket, mostQueries }) => (mostQueries === null
    ? `  ${route} (#${ticket}) was not called`
    : `  ${route} (#${ticket}) ran at most ${mostQueries} queries`));
  return [
    `Query budget allow-list entries no route went over ${REQUEST_QUERY_BUDGET} for in this run:`,
    ...lines,
    'Remove them from tests/functional/query-budget-allow-list.ts.',
  ].join('\n');
}

/** What a functional server saw of the query budget, served for the suite to read. */
export interface QueryBudgetRecorder {
  url: string;
  /** Notes one request: a violation when it is over budget and not allowed. */
  observe(route: string, queryCount: number): void;
  close(): Promise<void>;
}

/**
 * Holds what the server saw in memory, the way the mail inbox serves captured mail (#442).
 * `POST /take` hands over the violations recorded since the last take and clears them;
 * `GET /stale` lists the allow-list entries no request has gone over budget for, with the
 * message the suite's teardown fails with.
 */
export async function startQueryBudgetRecorder(allowList: QueryBudgetAllowList): Promise<QueryBudgetRecorder> {
  let recorded: QueryBudgetViolation[] = [];
  const mostQueriesSeen = new Map<string, number>();
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/take') {
      const taken = recorded;
      recorded = [];
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(taken));
      return;
    }
    if (request.method === 'GET' && request.url === '/stale') {
      const stale = staleAllowListEntries(allowList, mostQueriesSeen);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ stale, message: describeStaleAllowListEntries(stale) }));
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Query budget recorder did not bind to a TCP port.');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    observe: (route, queryCount) => {
      if (route in allowList) {
        mostQueriesSeen.set(route, Math.max(queryCount, mostQueriesSeen.get(route) ?? 0));
        return;
      }
      const violation = queryBudgetViolation(route, queryCount, allowList);
      if (violation !== null) {
        recorded.push(violation);
      }
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    }),
  };
}
