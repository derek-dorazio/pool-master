import { BASE_URL, smokeFetch, expectStatus } from '../setup';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
/**
 * Functional smoke test — Billing + Entitlements.
 *
 * Verify free tier allows league/contest creation.
 * If entitlement checks break, no one can create anything.
 */

let token: string;

async function setup() {
  const email = `billing-${Date.now()}@smoke.test`;
  const res = await smokeFetch(`${BASE_URL}${API_ROUTES.auth.register}`, {
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
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.billing.plan}`, { headers: headers() });
    await expectStatus(res, 200, 'get current plan');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    // Response is the plan object directly or { plan: {...} }
    const plan = body.plan ?? body;
    expect(plan.slug ?? plan.name).toBeDefined();
  });

  it('gets entitlements', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.billing.entitlements}`, { headers: headers() });
    await expectStatus(res, 200, 'get entitlements');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.entitlements).toBeDefined();
  });

  it('gets usage stats', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.billing.usage}`, { headers: headers() });
    await expectStatus(res, 200, 'get usage stats');
  });

  it('lists available plan tiers', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.billing.plans}`, { headers: headers() });
    await expectStatus(res, 200, 'list plan tiers');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.plans).toBeDefined();
    expect(body.plans.length).toBeGreaterThanOrEqual(1);
  });

  it('free tier allows league creation', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.list}`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ name: 'Free Tier League', visibility: 'PRIVATE' }),
    });
    // Should NOT be blocked by entitlement check
    await expectStatus(res, 201, 'free tier league creation');
  });

  it('free tier allows contest creation', async () => {
    const lr = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.list}`, { headers: headers() });
    const leagueId = ((await lr.json()) as any).leagues[0]?.id;
    if (!leagueId) return;

    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.contests(leagueId)}`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ name: 'Free Contest', contestType: 'SINGLE_EVENT', selectionType: 'SNAKE_DRAFT', scoringEngine: 'STROKE_PLAY' }),
    });
    await expectStatus(res, 201, 'free tier contest creation');
  });
});
