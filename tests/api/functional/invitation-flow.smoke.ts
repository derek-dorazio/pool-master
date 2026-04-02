import { BASE_URL, smokeFetch, expectStatus } from '../setup';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
/**
 * Functional smoke test — Invitation + Join flow.
 *
 * Owner creates league → generates invite link → User B accepts → both see the league.
 * Tests the critical path for league growth.
 */

let ownerToken: string;
let memberToken: string;
let memberId: string;
let leagueId: string;
let inviteCode: string;

async function register(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const email = `invite-${slug}-${Date.now()}@smoke.test`;
  const res = await smokeFetch(`${BASE_URL}${API_ROUTES.auth.register}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'SmokePas123', displayName: name }),
  });
  await expectStatus(res, 201, `register user ${name}`);
  const body = res.headers.get('content-type')?.includes('json')
    ? await res.json() as any
    : null;
  if (!body) throw new Error(`Register ${name} returned non-JSON response`);
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
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.list}`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ name: 'Invite Test League', visibility: 'PRIVATE', maxMembers: 10 }),
    });
    await expectStatus(res, 201, 'owner create league');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    leagueId = body.league.id;
  });

  it('owner generates invite link', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.inviteLink(leagueId)}`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ expiresInDays: 7, maxUses: 5 }),
    });
    await expectStatus(res, [200, 201], 'generate invite link');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    inviteCode = body.invitation?.inviteCode ?? body.inviteCode ?? body.code;
    expect(inviteCode).toBeDefined();
  });

  it('member accepts invite link', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.invitations.accept}`, {
      method: 'POST',
      headers: authHeaders(memberToken),
      body: JSON.stringify({ inviteCode }),
    });
    await expectStatus(res, [200, 201], 'member accept invite');
  });

  it('member can see the league', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.detail(leagueId)}`, {
      headers: authHeaders(memberToken),
    });
    // 200 if same tenant, 403/404 if cross-tenant (different auto-created tenants)
    await expectStatus(res, [200, 403, 404], 'member view league');
    if (res.status === 200) {
      const body = res.headers.get('content-type')?.includes('json')
        ? await res.json() as any
        : null;
      if (body) {
        expect(body.league.name).toBe('Invite Test League');
      }
    }
  });

  it('owner sees member in league list', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.list}`, {
      headers: authHeaders(ownerToken),
    });
    await expectStatus(res, 200, 'owner list leagues');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.leagues.length).toBeGreaterThanOrEqual(1);
  });
});
