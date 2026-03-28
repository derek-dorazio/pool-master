/**
 * Ingestion Worker — smoke tests.
 */

const BASE = 'http://localhost:3003';

describe('Ingestion Worker Smoke Tests', () => {
  it('GET /health returns ok with provider list', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.providers).toBeDefined();
    expect(body.supportedSports).toBeDefined();
  });

  it('GET /providers returns registered adapters', async () => {
    const res = await fetch(`${BASE}/providers`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers).toBeDefined();
    expect(body.providers.length).toBeGreaterThan(0);
  });
});
