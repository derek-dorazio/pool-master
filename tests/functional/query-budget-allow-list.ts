import type { QueryBudgetAllowList } from '../support/query-budget';

/**
 * Routes the functional suite saw over the per-request query budget when it was introduced
 * (#1244), each with the open ticket whose fix brings it under. A fix PR removes its entry; a
 * new route is never added here without a ticket.
 */
export const QUERY_BUDGET_ALLOW_LIST: QueryBudgetAllowList = {
  // The field grid save: a whole field of new rankings or odds is one update per row without raw SQL.
  'PATCH /api/v1/events/:eventId/participants': { ticket: 1308 },
  // A status change settles each of the event's contests in the request, about 15 queries a contest.
  'POST /api/v1/events/:eventId/transition': { ticket: 1448 },
  // A release adds the edition to each template contest in its own write.
  'POST /api/v1/events/:eventId/release': { ticket: 1318 },
};
