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
