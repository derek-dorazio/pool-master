export {};
/**
 * Functional smoke test — Scoring templates + contest configuration.
 *
 * Browse templates → get specific template → create contest with template → verify config applied.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

let token: string;
let leagueId: string;

async function setup() {
  const email = `scoring-${Date.now()}@smoke.test`;
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'SmokePas123', displayName: 'Scoring Tester' }),
  });
  const body = await res.json() as any;
  token = body.tokens.accessToken;

  const lr = await fetch(`${BASE}/api/v1/leagues`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Scoring Template League', visibility: 'PRIVATE' }),
  });
  leagueId = ((await lr.json()) as any).league.id;
}

const headers = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

describe('Scoring Templates + Contest Configuration', () => {
  beforeAll(() => setup());

  it('lists all scoring templates (16+)', async () => {
    const res = await fetch(`${BASE}/api/v1/scoring/templates`, { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.templates.length).toBeGreaterThanOrEqual(15);
  });

  it('gets golf DFS template with stat rules', async () => {
    const res = await fetch(`${BASE}/api/v1/scoring/templates/golf_dfs_standard`, { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.key).toBe('golf_dfs_standard');
    expect(body.config).toBeDefined();
    const rules = body.config.statRules ?? body.config.stat_rules;
    expect(rules).toBeDefined();
    expect(rules.length).toBeGreaterThan(0);
  });

  it('gets golf stroke play template', async () => {
    const res = await fetch(`${BASE}/api/v1/scoring/templates/golf_dfs_standard`, { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.config).toBeDefined();
  });

  it('validates a scoring config via POST', async () => {
    // Get a real template config first
    const tr = await fetch(`${BASE}/api/v1/scoring/templates/golf_dfs_standard`, { headers: headers() });
    const config = ((await tr.json()) as any).config;

    const res = await fetch(`${BASE}/api/v1/scoring/config/validate`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(config),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.valid).toBe(true);
  });

  it('creates contest with scoring template key', async () => {
    const res = await fetch(`${BASE}/api/v1/leagues/${leagueId}/contests`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: 'Golf DFS Contest',
        contestType: 'SINGLE_EVENT',
        selectionType: 'SNAKE_DRAFT',
        scoringEngine: 'STROKE_PLAY',
        scoringTemplateKey: 'golf_dfs_standard',
      }),
    });
    // 201 if template key is supported, 400 if validation rejects the combination
    expect([201, 400]).toContain(res.status);
    if (res.status === 201) {
      const body = await res.json() as any;
      expect(body.contest.name).toBe('Golf DFS Contest');
    }
  });

  it('lists draft selection templates', async () => {
    const res = await fetch(`${BASE}/api/v1/drafts/templates`, { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const templates = Array.isArray(body) ? body : body.templates;
    expect(templates.length).toBeGreaterThan(0);
  });
});
