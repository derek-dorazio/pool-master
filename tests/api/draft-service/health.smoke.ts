/**
 * Draft Service — smoke tests.
 */

const BASE = 'http://localhost:3001';

describe('Draft Service Smoke Tests', () => {
  it('GET /health returns ok', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
