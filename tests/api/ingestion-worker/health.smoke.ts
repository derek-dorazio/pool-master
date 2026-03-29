export {};
/**
 * Ingestion module — smoke tests.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

describe('Ingestion Smoke Tests', () => {
  it('GET /api/v1/ingestion/providers is reachable (200 or 401)', async () => {
    const res = await fetch(`${BASE}/api/v1/ingestion/providers`);
    expect([200, 401]).toContain(res.status);
  });
});
