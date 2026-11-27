import type { QueryBudgetAllowList } from '../support/query-budget';

/**
 * Routes the functional suite saw over the per-request query budget when it was introduced
 * (#1244), each with the open ticket whose fix brings it under. A fix PR removes its entry; a
 * new route is never added here without a ticket.
 */
export const QUERY_BUDGET_ALLOW_LIST: QueryBudgetAllowList = {
  // The field grid save: a whole field of new rankings or odds is one update per row without raw SQL.
  'PATCH /api/v1/events/:eventId/participants': { ticket: 1308 },
  // A field read now finds the event's FIELD matches first (a race, 10b part 3a), one statement over
  // the budget on the golf round save; part 3b moves golf rounds onto Games and rewrites this route.
  'POST /api/v1/events/:eventId/rounds/:roundNumber/golf-scores': { ticket: 2008 },
};
