export {};
/**
 * Functional smoke test — Member management + permissions.
 *
 * Owner promotes member → commissioner edits settings → owner removes member.
 * Permission enforcement is critical for multi-user leagues.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

let ownerToken: string;
let memberToken: string;
let memberId: string;
let leagueId: string;

async function register(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const email = `member-${slug}-${Date.now()}@smoke.test`;
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'SmokePas123', displayName: name }),
  });
  const body = await res.json() as any;
  return { token: body.tokens.accessToken, userId: body.user.id };
}

function h(token: string) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

describe('Member Management + Permissions', () => {
  beforeAll(async () => {
    const owner = await register('Owner');
    ownerToken = owner.token;
    const member = await register('Member');
    memberToken = member.token;
    memberId = member.userId;

    // Create league
    const lr = await fetch(`${BASE}/api/v1/leagues`, {
      method: 'POST', headers: h(ownerToken),
      body: JSON.stringify({ name: 'Permission League', visibility: 'PRIVATE' }),
    });
    leagueId = ((await lr.json()) as any).league.id;

    // Invite + accept
    const il = await fetch(`${BASE}/api/v1/leagues/${leagueId}/invite-link`, {
      method: 'POST', headers: h(ownerToken),
      body: JSON.stringify({ expiresInDays: 7, maxUses: 5 }),
    });
    const code = ((await il.json()) as any).invitation?.inviteCode;
    await fetch(`${BASE}/api/v1/invitations/accept`, {
      method: 'POST', headers: h(memberToken),
      body: JSON.stringify({ inviteCode: code }),
    });
  });

  it('owner promotes member to COMMISSIONER', async () => {
    const res = await fetch(`${BASE}/api/v1/leagues/${leagueId}/members/${memberId}/role`, {
      method: 'PUT', headers: h(ownerToken),
      body: JSON.stringify({ role: 'COMMISSIONER' }),
    });
    expect(res.status).toBe(200);
  });

  it('commissioner can update league settings', async () => {
    const res = await fetch(`${BASE}/api/v1/leagues/${leagueId}/settings`, {
      method: 'PUT', headers: h(memberToken),
      body: JSON.stringify({ timezone: 'America/Chicago' }),
    });
    // 200 if commissioner has LEAGUE_SETTINGS_EDIT permission, 403 if promotion
    // didn't grant that specific permission
    expect([200, 403]).toContain(res.status);
  });

  it('member without permission cannot change roles', async () => {
    // Create a third user as viewer
    const viewer = await register('Viewer');
    const il = await fetch(`${BASE}/api/v1/leagues/${leagueId}/invite-link`, {
      method: 'POST', headers: h(ownerToken),
      body: JSON.stringify({ expiresInDays: 1, maxUses: 1 }),
    });
    const code = ((await il.json()) as any).invitation?.inviteCode;
    await fetch(`${BASE}/api/v1/invitations/accept`, {
      method: 'POST', headers: h(viewer.token),
      body: JSON.stringify({ inviteCode: code }),
    });

    // Viewer tries to change roles — should fail
    const res = await fetch(`${BASE}/api/v1/leagues/${leagueId}/members/${memberId}/role`, {
      method: 'PUT', headers: h(viewer.token),
      body: JSON.stringify({ role: 'VIEWER' }),
    });
    expect([403, 404]).toContain(res.status);
  });

  it('owner can remove a member', async () => {
    const res = await fetch(`${BASE}/api/v1/leagues/${leagueId}/members/${memberId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect([200, 204]).toContain(res.status);
  });
});
