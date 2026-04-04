import { BASE_URL, smokeFetch, expectStatus } from '../setup';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { LeagueVisibility } from '@poolmaster/shared/domain';

/**
 * MVP smoke baseline — deployed black-box validation for the current product spine.
 *
 * This suite intentionally creates its own live data and only covers:
 * auth -> league create -> invite link -> invite acceptance -> members read
 */

let ownerToken: string;
let memberToken: string;
let leagueId: string;
let inviteCode: string;

async function register(displayName: string) {
  const email = `smoke-${displayName.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now()}@mvp.test`;
  const res = await smokeFetch(`${BASE_URL}${API_ROUTES.auth.register}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'SmokePass123',
      displayName,
    }),
  });
  await expectStatus(res, 201, `register ${displayName}`);
  const body = await res.json() as {
    tokens: { accessToken: string };
    user: { id: string; email: string; displayName: string };
  };
  return body;
}

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

function bodylessAuthHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
  };
}

describe('MVP API Smoke Baseline', () => {
  it('registers two users and verifies authenticated profile', async () => {
    const owner = await register('Smoke Owner');
    const member = await register('Smoke Member');
    ownerToken = owner.tokens.accessToken;
    memberToken = member.tokens.accessToken;

    const meRes = await smokeFetch(`${BASE_URL}${API_ROUTES.auth.me}`, {
      headers: bodylessAuthHeaders(ownerToken),
    });
    await expectStatus(meRes, 200, 'fetch authenticated profile');
    const meBody = await meRes.json() as { user: { displayName: string } };
    expect(meBody.user.displayName).toBe('Smoke Owner');
  });

  it('creates a league and generates an invite link', async () => {
    const createRes = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.create}`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        name: 'Smoke MVP League',
        visibility: LeagueVisibility.PRIVATE,
        maxMembers: 12,
      }),
    });
    await expectStatus(createRes, 201, 'create league');
    const createBody = await createRes.json() as { league: { id: string; name: string } };
    leagueId = createBody.league.id;
    expect(createBody.league.name).toBe('Smoke MVP League');

    const inviteRes = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.inviteLink(leagueId)}`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        expiresInDays: 7,
        maxUses: 1,
      }),
    });
    await expectStatus(inviteRes, [200, 201], 'generate invite link');
    const inviteBody = await inviteRes.json() as { invitation?: { inviteCode?: string }; inviteCode?: string };
    inviteCode = inviteBody.invitation?.inviteCode ?? inviteBody.inviteCode ?? '';
    expect(inviteCode).toBeTruthy();
  });

  it('accepts the invite and verifies league membership visibility', async () => {
    const acceptRes = await smokeFetch(`${BASE_URL}${API_ROUTES.invitations.accept}`, {
      method: 'POST',
      headers: authHeaders(memberToken),
      body: JSON.stringify({
        inviteCode,
      }),
    });
    await expectStatus(acceptRes, [200, 201], 'accept invite');

    const membersRes = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.members(leagueId)}`, {
      headers: bodylessAuthHeaders(ownerToken),
    });
    await expectStatus(membersRes, 200, 'list league members');
    const membersBody = await membersRes.json() as { members: Array<{ displayName: string }> };
    expect(membersBody.members.map((member) => member.displayName)).toEqual(
      expect.arrayContaining(['Smoke Owner', 'Smoke Member']),
    );
  });
});
