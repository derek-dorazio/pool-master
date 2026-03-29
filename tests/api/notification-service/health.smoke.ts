export {};
/**
 * Notifications module — smoke tests.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

describe('Notifications Smoke Tests', () => {
  it('GET /api/v1/notifications is reachable (200 or 401)', async () => {
    const res = await fetch(`${BASE}/api/v1/notifications`, {
      headers: { 'x-user-id': '00000000-0000-0000-0000-000000000099' },
    });
    expect([200, 401]).toContain(res.status);
  });

  it('GET /api/v1/notifications/preferences is reachable (200 or 401)', async () => {
    const res = await fetch(`${BASE}/api/v1/notifications/preferences`, {
      headers: { 'x-user-id': '00000000-0000-0000-0000-000000000099' },
    });
    expect([200, 401]).toContain(res.status);
  });
});
