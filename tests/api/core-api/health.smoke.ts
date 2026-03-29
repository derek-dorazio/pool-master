/**
 * Core API — smoke tests.
 * Verifies core endpoints are responding correctly.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

describe('Core API Smoke Tests', () => {
  it('GET /health returns ok', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('ok');
  });

  it('GET /api/v1/config returns config', async () => {
    const res = await fetch(`${BASE}/api/v1/config`);
    expect([200, 401]).toContain(res.status);
  });
});
