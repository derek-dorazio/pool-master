import type { QueryBudgetAllowList } from '../support/query-budget';

/**
 * Routes the functional suite saw over the per-request query budget when it was introduced
 * (#1244), each with the open ticket whose fix brings it under. A fix PR removes its entry; a
 * new route is never added here without a ticket.
 */
export const QUERY_BUDGET_ALLOW_LIST: QueryBudgetAllowList = {
  // The field grid save: a whole field of new rankings or odds is one update per row without raw SQL.
  'PATCH /api/v1/events/:eventId/participants': { ticket: 1308 },
  // A status change starts, settles and emails its contests: two email batches each read the league's members.
  'POST /api/v1/events/:eventId/transition': { ticket: 1387 },
  // A release adds the edition to each template contest in its own write.
  'POST /api/v1/events/:eventId/release': { ticket: 1318 },
  // A match result that ends a game settles its contests, writing standings and finishes and emailing the league.
  'PUT /api/v1/events/:eventId/bracket/matches/:matchNumber/result': { ticket: 1387 },
};
