export {};
/**
 * Drafts module — smoke tests.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

describe('Drafts Smoke Tests', () => {
  it('GET /api/v1/drafts/templates is reachable (200 or 401)', async () => {
    const res = await fetch(`${BASE}/api/v1/drafts/templates`);
    expect([200, 401]).toContain(res.status);
  });
});
