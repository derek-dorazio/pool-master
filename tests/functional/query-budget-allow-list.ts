import type { QueryBudgetAllowList } from '../support/query-budget';

/**
 * Routes the functional suite saw over the per-request query budget when it was introduced
 * (#1244), each with the open ticket whose fix brings it under. A fix PR removes its entry; a
 * new route is never added here without a ticket.
 */
export const QUERY_BUDGET_ALLOW_LIST: QueryBudgetAllowList = {
  // The field grid save: a whole field of new rankings or odds is one update per row without raw SQL.
  'PATCH /api/v1/events/:eventId/participants': { ticket: 1308 },
  // A status change settles every contest on the event, writing its standings one row at a time.
  'POST /api/v1/events/:eventId/transition': { ticket: 1172 },
  // A release adds the edition to each template contest in its own write.
  'POST /api/v1/events/:eventId/release': { ticket: 1318 },
  // Email costs four round trips per recipient.
  'POST /api/v1/invitations/accept': { ticket: 1173 },
  'POST /api/v1/team-invitations/register': { ticket: 1173 },
  'POST /api/v1/leagues/:id/squads/:squadId/owner-invitations': { ticket: 1173 },
  'POST /api/v1/leagues/:id/contest-management/contests/:contestId/open': { ticket: 1173 },
  'PUT /api/v1/events/:eventId/bracket/matches/:matchNumber/periods/:periodNumber': { ticket: 1173 },
  // A match result that ends the event settles its contests and emails every entrant.
  'PUT /api/v1/events/:eventId/bracket/matches/:matchNumber/result': { ticket: 1173 },
  // A draw sends every entry's receipt inside the request.
  'POST /api/v1/selections/:contestId/draw': { ticket: 1171 },
  'POST /api/v1/selections/:contestId/squares/draw': { ticket: 1171 },
};
