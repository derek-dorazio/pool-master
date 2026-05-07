/**
 * Defect-proof structural assertions for pool-master-rop.78.13 — mock-feed
 * provider SDK consolidation per plans/117 §10.5.
 *
 * Pre-fix state on origin/main:
 *   - The mock-contest-feed-provider exposed three URL surfaces for the
 *     same data: canonical `/v1/scenarios/.../events/.../{detail,field,
 *     odds,rankings,results}` plus duplicate `/v1/pre-event/...` and
 *     `/v1/live/...` aliases that were not in the OpenAPI spec, so the
 *     generated SDK could never reach them.
 *   - `mock-contest-feed-adapter.ts` consumed those legacy aliases via
 *     raw `fetchJson<HandRolledType>(...)` against hand-rolled response
 *     interfaces (~110 lines of duplicate type definitions).
 *
 * On this branch:
 *   - Legacy `/v1/pre-event/...` and `/v1/live/...` route handlers are
 *     gone from the mock-feed server.
 *   - A canonical `/v1/scenarios/.../events/.../scores` endpoint replaces
 *     the legacy `/v1/live/.../scores` so the SDK covers live scoring.
 *   - The adapter's response types are aliases of generated SDK types
 *     imported from `@poolmaster/mock-contest-feed-provider/generated/hey-api/types`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const adapterSrc = readFileSync(
  resolve(__dirname, '../../../packages/core-api/src/modules/ingestion/adapters/mock-contest-feed-adapter.ts'),
  'utf8',
);
const routesSrc = readFileSync(
  resolve(__dirname, '../../../packages/mock-contest-feed-provider/src/routes.ts'),
  'utf8',
);
const sdkTypesSrc = readFileSync(
  resolve(__dirname, '../../../packages/mock-contest-feed-provider/generated/hey-api/types.gen.ts'),
  'utf8',
);

describe('pool-master-rop.78.13 — mock-feed SDK consolidation', () => {
  describe('server route surface', () => {
    // Route registration strings are wrapped in single quotes:
    // `fastify.get<...>('/v1/...')`. Comments may reference legacy paths
    // in backticks for documentation; the assertion only flags actual
    // route definitions, not historical comments.
    it('mock-feed server no longer registers legacy /v1/pre-event/... routes', () => {
      expect(routesSrc).not.toMatch(/'\/v1\/pre-event\//);
    });

    it('mock-feed server no longer registers legacy /v1/live/... routes', () => {
      expect(routesSrc).not.toMatch(/'\/v1\/live\//);
    });

    it('mock-feed server registers a canonical scores endpoint', () => {
      expect(routesSrc).toMatch(/'\/v1\/scenarios\/:scenarioId\/events\/:eventId\/scores'/);
      expect(routesSrc).toMatch(/getMockContestFeedScoresSnapshot/);
    });
  });

  describe('generated SDK reflects canonical surface', () => {
    it('exposes GetMockContestFeedScoresSnapshotResponse', () => {
      expect(sdkTypesSrc).toMatch(/GetMockContestFeedScoresSnapshotResponse/);
    });

    it('does not expose legacy LiveScores / LiveResults / PreEvent operation types', () => {
      expect(sdkTypesSrc).not.toMatch(/MockContestFeedLiveScores/);
      expect(sdkTypesSrc).not.toMatch(/MockContestFeedLiveResults/);
      expect(sdkTypesSrc).not.toMatch(/MockContestFeedPreEvent/);
    });
  });

  describe('adapter consumes the generated SDK', () => {
    it('imports response types from the mock-feed-provider package, not local hand-rolled interfaces', () => {
      expect(adapterSrc).toMatch(
        /from\s+['"]@poolmaster\/mock-contest-feed-provider\/generated\/hey-api\/types['"]/,
      );
    });

    it('does not redefine ScenarioSummaryResponse / EventListResponse / EventDetailResponse as local interfaces', () => {
      // Pre-fix state had `interface ScenarioSummaryResponse { ... }`
      // (etc.) as hand-rolled local definitions. After consolidation
      // they are type aliases pointing at the generated SDK.
      expect(adapterSrc).not.toMatch(/^interface\s+ScenarioSummaryResponse\s*\{/m);
      expect(adapterSrc).not.toMatch(/^interface\s+EventListResponse\s*\{/m);
      expect(adapterSrc).not.toMatch(/^interface\s+EventDetailResponse\s*\{/m);
    });

    it('hits canonical URLs only — no /v1/pre-event/... or /v1/live/... fetches', () => {
      // Match only template-string fetch URLs, not narrative comments.
      expect(adapterSrc).not.toMatch(/`\/v1\/pre-event\//);
      expect(adapterSrc).not.toMatch(/`\/v1\/live\//);
    });
  });
});
