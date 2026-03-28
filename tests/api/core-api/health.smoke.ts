/**
 * Core API — smoke tests.
 * Verifies core endpoints are responding correctly with seeded data.
 */

const BASE = 'http://localhost:3000';

describe('Core API Smoke Tests', () => {
  it('GET /health returns ok', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('GET /api/v1/leagues returns seeded leagues', async () => {
    const res = await fetch(`${BASE}/api/v1/leagues`, {
      headers: {
        'x-tenant-id': '00000000-0000-0000-0000-000000000000',
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leagues).toBeDefined();
    expect(Array.isArray(body.leagues)).toBe(true);
  });

  it('GET /api/v1/participants returns participant list', async () => {
    const res = await fetch(`${BASE}/api/v1/participants`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.participants).toBeDefined();
    expect(body.total).toBeDefined();
  });

  it('GET /api/v1/search/participants searches with query', async () => {
    const res = await fetch(`${BASE}/api/v1/search/participants?q=tiger`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.participants).toBeDefined();
    expect(body.facets).toBeDefined();
  });

  it('GET /api/v1/search/discover/leagues returns discovery results', async () => {
    const res = await fetch(`${BASE}/api/v1/search/discover/leagues`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leagues).toBeDefined();
  });

  it('POST /api/v1/account/verify-age validates age', async () => {
    const res = await fetch(`${BASE}/api/v1/account/verify-age`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ birthYear: 2000 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);
    expect(body.age).toBeGreaterThanOrEqual(26);
  });

  it('POST /api/v1/account/verify-age rejects underage', async () => {
    const res = await fetch(`${BASE}/api/v1/account/verify-age`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ birthYear: 2020 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(false);
  });
});
