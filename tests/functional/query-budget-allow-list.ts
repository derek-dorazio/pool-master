import type { QueryBudgetAllowList } from '../support/query-budget';

/**
 * Routes the functional suite saw over the per-request query budget when it was introduced
 * (#1244), each with the open ticket whose fix brings it under. A fix PR removes its entry; a
 * new route is never added here without a ticket.
 */
export const QUERY_BUDGET_ALLOW_LIST: QueryBudgetAllowList = {
  // Root-admin event tools that write one row per participant.
  'PATCH /api/v1/events/:eventId/participants': { ticket: 1252 },
  'POST /api/v1/events/:eventId/prices/auto-assign': { ticket: 1252 },
  'POST /api/v1/events/:eventId/tiers/auto-assign': { ticket: 1252 },
  'PUT /api/v1/events/:eventId/tiers/assignments': { ticket: 1252 },
  'POST /api/v1/events/:eventId/rounds/:roundNumber/golf-scores': { ticket: 1252 },
  'PUT /api/v1/events/:eventId/race-results': { ticket: 1252 },
  'PUT /api/v1/events/:eventId/bracket/matches/:matchNumber/result': { ticket: 1252 },
  'POST /api/v1/sport-leagues/:sportLeagueId/affiliations/upload': { ticket: 1252 },
  // A status change or release fans out to every contest on the event, re-reading the event for each.
  'POST /api/v1/events/:eventId/transition': { ticket: 1199 },
  'POST /api/v1/events/:eventId/release': { ticket: 1199 },
  // Email costs four round trips per recipient.
  'POST /api/v1/invitations/accept': { ticket: 1173 },
  'POST /api/v1/team-invitations/register': { ticket: 1173 },
  'POST /api/v1/leagues/:id/squads/:squadId/owner-invitations': { ticket: 1173 },
  'POST /api/v1/leagues/:id/contest-management/contests/:contestId/open': { ticket: 1173 },
  'PUT /api/v1/events/:eventId/bracket/matches/:matchNumber/periods/:periodNumber': { ticket: 1173 },
  // A draw sends every entry's receipt inside the request.
  'POST /api/v1/selections/:contestId/draw': { ticket: 1171 },
  'POST /api/v1/selections/:contestId/squares/draw': { ticket: 1171 },
};
