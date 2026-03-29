/**
 * Scoring module — smoke tests.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

describe('Scoring Smoke Tests', () => {
  it('GET /api/v1/scoring/templates is reachable (200 or 401)', async () => {
    const res = await fetch(`${BASE}/api/v1/scoring/templates`);
    // 200 locally (no auth guard in dev), 401 on QA (auth required)
    expect([200, 401]).toContain(res.status);
  });
});
