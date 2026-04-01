export {};
/**
 * Functional smoke test — Billing + Entitlements.
 *
 * Verify free tier allows league/contest creation.
 * If entitlement checks break, no one can create anything.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

let token: string;

async function setup() {
  const email = `billing-${Date.now()}@smoke.test`;
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'SmokePas123', displayName: 'Billing Tester' }),
  });
  const body = await res.json() as any;
  token = body.tokens.accessToken;
}

const headers = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

describe('Billing + Entitlements', () => {
  beforeAll(() => setup());

  it('gets current plan (free tier)', async () => {
    const res = await fetch(`${BASE}/api/v1/billing/plan`, { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // Response is the plan object directly or { plan: {...} }
    const plan = body.plan ?? body;
    expect(plan.slug ?? plan.name).toBeDefined();
  });

  it('gets entitlements', async () => {
    const res = await fetch(`${BASE}/api/v1/billing/entitlements`, { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.entitlements).toBeDefined();
  });

  it('gets usage stats', async () => {
    const res = await fetch(`${BASE}/api/v1/billing/usage`, { headers: headers() });
    expect(res.status).toBe(200);
  });

  it('lists available plan tiers', async () => {
    const res = await fetch(`${BASE}/api/v1/billing/plans`, { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.plans).toBeDefined();
    expect(body.plans.length).toBeGreaterThanOrEqual(1);
  });

  it('free tier allows league creation', async () => {
    const res = await fetch(`${BASE}/api/v1/leagues`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ name: 'Free Tier League', visibility: 'PRIVATE' }),
    });
    // Should NOT be blocked by entitlement check
    expect(res.status).toBe(201);
  });

  it('free tier allows contest creation', async () => {
    const lr = await fetch(`${BASE}/api/v1/leagues`, { headers: headers() });
    const leagueId = ((await lr.json()) as any).leagues[0]?.id;
    if (!leagueId) return;

    const res = await fetch(`${BASE}/api/v1/leagues/${leagueId}/contests`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ name: 'Free Contest', contestType: 'SINGLE_EVENT', selectionType: 'SNAKE_DRAFT', scoringEngine: 'STROKE_PLAY' }),
    });
    expect(res.status).toBe(201);
  });
});
