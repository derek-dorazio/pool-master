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

/** The over-budget requests a functional server has recorded, served for the suite to take. */
export interface QueryBudgetRecorder {
  url: string;
  record(violation: QueryBudgetViolation): void;
  close(): Promise<void>;
}

/**
 * Holds recorded violations in memory and hands them over on `POST /take`, which clears them,
 * the way the mail inbox serves captured mail (#442).
 */
export async function startQueryBudgetRecorder(): Promise<QueryBudgetRecorder> {
  let recorded: QueryBudgetViolation[] = [];
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/take') {
      const taken = recorded;
      recorded = [];
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(taken));
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
    record: (violation) => {
      recorded.push(violation);
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    }),
  };
}
