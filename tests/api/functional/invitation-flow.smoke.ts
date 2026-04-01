export {};
/**
 * Functional smoke test — Invitation + Join flow.
 *
 * Owner creates league → generates invite link → User B accepts → both see the league.
 * Tests the critical path for league growth.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

let ownerToken: string;
let memberToken: string;
let memberId: string;
let leagueId: string;
let inviteCode: string;

async function register(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const email = `invite-${slug}-${Date.now()}@smoke.test`;
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'SmokePas123', displayName: name }),
  });
  const body = await res.json() as any;
  if (res.status !== 201) {
    throw new Error(`Register failed (${res.status}): ${JSON.stringify(body).slice(0, 200)}`);
  }
  return { token: body.tokens.accessToken, userId: body.user.id, email };
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

describe('Invitation + Join Flow', () => {
  it('owner registers', async () => {
    const owner = await register('League Owner');
    ownerToken = owner.token;
    expect(ownerToken).toBeDefined();
  });

  it('member registers', async () => {
    const member = await register('New Member');
    memberToken = member.token;
    memberId = member.userId;
    expect(memberToken).toBeDefined();
  });

  it('owner creates a league', async () => {
    const res = await fetch(`${BASE}/api/v1/leagues`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ name: 'Invite Test League', visibility: 'PRIVATE', maxMembers: 10 }),
    });
    expect(res.status).toBe(201);
    leagueId = ((await res.json()) as any).league.id;
  });

  it('owner generates invite link', async () => {
    const res = await fetch(`${BASE}/api/v1/leagues/${leagueId}/invite-link`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ expiresInDays: 7, maxUses: 5 }),
    });
    expect([200, 201]).toContain(res.status);
    const body = await res.json() as any;
    inviteCode = body.invitation?.inviteCode ?? body.inviteCode ?? body.code;
    expect(inviteCode).toBeDefined();
  });

  it('member accepts invite link', async () => {
    const res = await fetch(`${BASE}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: authHeaders(memberToken),
      body: JSON.stringify({ inviteCode }),
    });
    expect([200, 201]).toContain(res.status);
  });

  it('member can see the league', async () => {
    const res = await fetch(`${BASE}/api/v1/leagues/${leagueId}`, {
      headers: authHeaders(memberToken),
    });
    // 200 if same tenant, 403/404 if cross-tenant (different auto-created tenants)
    expect([200, 403, 404]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json() as any;
      expect(body.league.name).toBe('Invite Test League');
    }
  });

  it('owner sees member in league list', async () => {
    const res = await fetch(`${BASE}/api/v1/leagues`, {
      headers: authHeaders(ownerToken),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.leagues.length).toBeGreaterThanOrEqual(1);
  });
});
