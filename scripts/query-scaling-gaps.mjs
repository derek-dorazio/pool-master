/**
 * #1242 — the list routes no query-scaling test reads yet. Read by `scripts/check-query-scaling.mjs`;
 * the rule and its reasoning are in that file's header.
 *
 * Every entry is a route that shipped before the check existed, with the ticket that will add its
 * test: #1198 for the event reads whose guard that ticket replaces, #1315 and #1316 for the reads
 * that query once per row and land their test with the fix. The list only shrinks: add an
 * `expectConstantQueries` case (or `expectFixedQueries`, for a list whose length code fixes) and
 * delete the entry, which also lowers `GAP_CEILING` in the scanner by one. The scanner fails if a
 * listed route has a test now, or if an entry names no list route, so the list cannot drift from
 * the tests.
 *
 * A new list route never goes on this list; `rules/testing-rules.md` §9B *Query Scaling Tests* says
 * its scaling test lands with it.
 */
export const QUERY_SCALING_GAPS = [
  // --- Cups ---
  { route: 'GET /api/v1/leagues/{id}/cups/{cupId}/projection', ticket: 1315 },

  // --- Events and event pages ---
  { route: 'GET /api/v1/events/', ticket: 1198 },
  { route: 'GET /api/v1/events/{eventId}', ticket: 1198 },
  { route: 'GET /api/v1/events/{eventId}/rounds', ticket: 1198 },
  { route: 'GET /api/v1/events/{eventId}/tiers', ticket: 1198 },
  { route: 'GET /api/v1/events/{eventId}/bracket', ticket: 1198 },
  { route: 'GET /api/v1/event-pages/', ticket: 1316 },
  { route: 'GET /api/v1/event-pages/{sport}/{pageSlug}', ticket: 1316 },
];
