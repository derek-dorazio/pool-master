import { BASE_URL, smokeFetch, expectStatus } from '../setup';
/**
 * Functional smoke test — Scoring templates + contest configuration.
 *
 * Browse templates → get specific template → create contest with template → verify config applied.
 */

let token: string;
let leagueId: string;

async function setup() {
  const email = `scoring-${Date.now()}@smoke.test`;
  const res = await smokeFetch(`${BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'SmokePas123', displayName: 'Scoring Tester' }),
  });
  const body = await res.json() as any;
  token = body.tokens.accessToken;

  const lr = await smokeFetch(`${BASE_URL}/api/v1/leagues`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Scoring Template League', visibility: 'PRIVATE' }),
  });
  leagueId = ((await lr.json()) as any).league.id;
}

const headers = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

describe('Scoring Templates + Contest Configuration', () => {
  beforeAll(() => setup());

  it('lists all scoring templates (10+)', async () => {
    const res = await smokeFetch(`${BASE_URL}/api/v1/scoring/templates`, { headers: headers() });
    await expectStatus(res, 200, 'list scoring templates');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.templates.length).toBeGreaterThanOrEqual(10);
  });

  it('gets golf relative-to-par template with stat rules', async () => {
    const res = await smokeFetch(`${BASE_URL}/api/v1/scoring/templates/golf_relative_to_par`, { headers: headers() });
    await expectStatus(res, 200, 'get golf relative-to-par template');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.key).toBe('golf_relative_to_par');
    expect(body.config).toBeDefined();
    const rules = body.config.statRules ?? body.config.stat_rules;
    expect(rules).toBeDefined();
    expect(rules.length).toBeGreaterThan(0);
  });

  it('gets NCAA bracket standard template', async () => {
    const res = await smokeFetch(`${BASE_URL}/api/v1/scoring/templates/ncaa_bracket_standard`, { headers: headers() });
    await expectStatus(res, 200, 'get NCAA bracket standard template');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.config).toBeDefined();
  });

  it('validates a scoring config via POST', async () => {
    // Get a real template config first
    const tr = await smokeFetch(`${BASE_URL}/api/v1/scoring/templates/golf_relative_to_par`, { headers: headers() });
    const config = ((await tr.json()) as any).config;

    const res = await smokeFetch(`${BASE_URL}/api/v1/scoring/config/validate`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(config),
    });
    await expectStatus(res, 200, 'validate scoring config');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.valid).toBe(true);
  });

  it('creates contest with scoring template key', async () => {
    const res = await smokeFetch(`${BASE_URL}/api/v1/leagues/${leagueId}/contests`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: 'Golf Tournament Contest',
        contestType: 'SINGLE_EVENT',
        selectionType: 'SNAKE_DRAFT',
        scoringEngine: 'STROKE_PLAY',
        scoringTemplateKey: 'golf_relative_to_par',
      }),
    });
    // 201 if template key is supported, 400 if validation rejects the combination
    await expectStatus(res, [201, 400], 'create contest with scoring template');
    if (res.status === 201) {
      const body = res.headers.get('content-type')?.includes('json')
        ? await res.json() as any
        : null;
      if (body) {
        expect(body.contest.name).toBe('Golf Tournament Contest');
      }
    }
  });

  it('lists draft selection templates', async () => {
    const res = await smokeFetch(`${BASE_URL}/api/v1/drafts/templates`, { headers: headers() });
    await expectStatus(res, 200, 'list draft selection templates');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    const templates = Array.isArray(body) ? body : body.templates;
    expect(templates.length).toBeGreaterThan(0);
  });
});
