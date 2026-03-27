/**
 * Poll interval configuration plugin for Fastify.
 *
 * Adds X-Poll-Interval and X-Poll-Interval-Unit headers to responses
 * from pollable endpoints. Clients use these to set their refetchInterval.
 *
 * Default intervals (milliseconds):
 * - Standings/leaderboard: 10000 (10s)
 * - Draft state: 10000 (10s)
 * - Contest status: 30000 (30s)
 * - Notifications unread count: 30000 (30s)
 * - Discovery/search: 0 (no polling, on-demand only)
 */

import fp from 'fastify-plugin';

export const POLL_INTERVALS: Record<string, number> = {
  '/api/v1/contests/*/standings': 10000,
  '/api/v1/contests/*/standings/summary': 10000,
  '/api/v1/contests/*/standings/my-entry': 10000,
  '/api/v1/drafts/*/state': 10000,
  '/api/v1/contests/*': 30000,
  '/api/v1/notifications/unread-count': 30000,
};

/**
 * Named poll intervals exposed via the config endpoint.
 */
export const POLL_INTERVAL_CONFIG = {
  standings: 10000,
  draft: 10000,
  contestStatus: 30000,
  notifications: 30000,
  default: 30000,
};

/**
 * Matches a request URL against the poll interval patterns.
 * Returns the interval in ms, or null if the URL is not pollable.
 *
 * Patterns use `*` as a single-segment wildcard (matches one path segment).
 * More specific patterns (more segments) are checked first.
 */
export function matchPollInterval(url: string): number | null {
  // Strip query string for matching
  const path = url.split('?')[0];

  // Sort patterns by specificity (most segments first)
  const sorted = Object.entries(POLL_INTERVALS).sort(
    (a, b) => b[0].split('/').length - a[0].split('/').length,
  );

  for (const [pattern, interval] of sorted) {
    if (matchPattern(pattern, path)) {
      return interval;
    }
  }

  return null;
}

function matchPattern(pattern: string, path: string): boolean {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) return false;

  return patternParts.every(
    (part, i) => part === '*' || part === pathParts[i],
  );
}

export const pollConfigPlugin = fp(async (app) => {
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.method !== 'GET') return payload;

    const interval = matchPollInterval(request.url);
    if (interval !== null) {
      reply.header('X-Poll-Interval', String(interval));
      reply.header('X-Poll-Interval-Unit', 'ms');
    }

    return payload;
  });
});
