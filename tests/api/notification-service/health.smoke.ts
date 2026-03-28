/**
 * Notification Service — smoke tests.
 */

const BASE = 'http://localhost:3004';

describe('Notification Service Smoke Tests', () => {
  it('GET /health returns ok with email provider', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.emailProvider).toBeDefined();
  });

  it('GET /api/v1/notifications returns empty list for unknown user', async () => {
    const res = await fetch(`${BASE}/api/v1/notifications`, {
      headers: { 'x-user-id': '00000000-0000-0000-0000-000000000099' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications).toBeDefined();
    expect(body.total).toBe(0);
  });

  it('GET /api/v1/notifications/preferences returns defaults for new user', async () => {
    const res = await fetch(`${BASE}/api/v1/notifications/preferences`, {
      headers: { 'x-user-id': '00000000-0000-0000-0000-000000000099' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preferences).toBeDefined();
    expect(body.preferences.categories).toBeDefined();
  });
});
