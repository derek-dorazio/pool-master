/**
 * Usernames and emails typed with a stray space or capital letters (#500).
 *
 * Someone pasting " Derek@Example.com " into a form should get the account, the invite or the
 * change they asked for, stored as "derek@example.com". Every route that takes a username, an
 * email or a sign-in identifier trims it, and every email is lowercased as well, before
 * validation decides whether the value is acceptable. Each case below drives the real route and
 * then checks what the database holds.
 */
import { randomUUID } from 'node:crypto';
import type {
  AuthResponse,
  LeagueContextResponse,
  SendLeagueInvitationsResponse,
  SquadListResponse,
  TeamOwnerInvitationResponse,
  UserResponse,
} from '@poolmaster/shared/dto';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import {
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const PASSWORD = 'CorrectHorse9';

/** A fresh lowercase identity inside the integration email domain cleanup removes. */
function newIdentity() {
  const tag = randomUUID().slice(0, 8);
  return { username: `space-${tag}`, email: `space-${tag}@integration.test` };
}

/** The same address as a careless typist would send it: padded and partly upper case. */
function padded(value: string): string {
  return `  ${value.charAt(0).toUpperCase()}${value.slice(1).replace('@integration', '@Integration')} `;
}

async function registerAccount(username: string, email: string) {
  return getApp().inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username, email, password: PASSWORD, firstName: 'Ada', lastName: 'Space' },
  });
}

async function createLeague() {
  const commissioner = await createTestUser();
  const league = await getApp().inject({
    method: 'POST',
    url: API_ROUTES.leagues.create,
    headers: commissioner.headers,
    payload: buildCreateLeaguePayload('Whitespace League'),
  });
  expect(league.statusCode).toBe(201);
  const leagueId = league.json<LeagueContextResponse>().league.id;
  const squads = await getApp().inject({
    method: 'GET',
    url: API_ROUTES.squads.list(leagueId),
    headers: commissioner.headers,
  });
  return { commissioner, leagueId, squadId: squads.json<SquadListResponse>().squads[0].id };
}

describe('registration and sign-in', () => {
  it('registers a padded, mixed-case username and email as the trimmed lowercase values', async () => {
    const identity = newIdentity();

    const response = await registerAccount(padded(identity.username), padded(identity.email));

    expect(response.statusCode).toBe(201);
    expect(response.json<AuthResponse>().user).toMatchObject(identity);
    const stored = await getPrisma().user.findUniqueOrThrow({ where: { email: identity.email } });
    expect(stored.username).toBe(identity.username);
  });

  it('refuses a padded, upper-case copy of an existing email with 409 EMAIL_EXISTS instead of making a near-duplicate account', async () => {
    const first = newIdentity();
    expect((await registerAccount(first.username, first.email)).statusCode).toBe(201);

    const second = await registerAccount(newIdentity().username, padded(first.email).toUpperCase());

    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('EMAIL_EXISTS');
  });

  it('signs in with a padded, mixed-case email', async () => {
    const identity = newIdentity();
    expect((await registerAccount(identity.username, identity.email)).statusCode).toBe(201);

    const response = await getApp().inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: padded(identity.email), password: PASSWORD },
    });

    expect(response.statusCode).toBe(200);
  });

  it('still refuses a username with a space in the middle with 400', async () => {
    const identity = newIdentity();

    const response = await registerAccount(`space ${identity.username}`, identity.email);

    expect(response.statusCode).toBe(400);
    expect(await getPrisma().user.count({ where: { email: identity.email } })).toBe(0);
  });
});

describe('changing your own account', () => {
  it('saves a padded, mixed-case profile email as the trimmed lowercase address', async () => {
    const user = await createTestUser();
    const next = newIdentity().email;

    const response = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/users/me/profile',
      headers: user.headers,
      payload: { email: padded(next), firstName: 'Grace', lastName: 'Hopper' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<UserResponse>().user.email).toBe(next);
  });

  it('saves a padded, mixed-case username as the trimmed lowercase username', async () => {
    const user = await createTestUser();
    const next = newIdentity().username;

    const response = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/users/me/username',
      headers: user.headers,
      payload: { username: padded(next) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<UserResponse>().user.username).toBe(next);
  });

  it('lets a root admin confirm a permanent delete with a padded, mixed-case copy of the email', async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const doomed = await createTestUser();
    await getPrisma().user.update({ where: { id: doomed.user.id }, data: { isActive: false } });

    const response = await getApp().inject({
      method: 'DELETE',
      url: `/api/v1/users/${doomed.user.id}`,
      headers: admin.headers,
      payload: { email: padded(doomed.user.email) },
    });

    expect(response.statusCode).toBe(200);
    expect(await getPrisma().user.findUnique({ where: { id: doomed.user.id } })).toBeNull();
  });
});

describe('inviting by email', () => {
  it('invites a padded, mixed-case league email and stores the invitation under the trimmed lowercase address', async () => {
    const { commissioner, leagueId } = await createLeague();
    const invitee = newIdentity().email;

    const response = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: commissioner.headers,
      payload: { emails: [padded(invitee)] },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<SendLeagueInvitationsResponse>().sent.map((sent) => sent.email)).toEqual([invitee]);
    expect(await getPrisma().leagueInvitation.count({ where: { leagueId, email: invitee } })).toBe(1);
  });

  it('invites a padded, mixed-case team co-owner email, and the invitee registers with a padded username', async () => {
    const { commissioner, leagueId, squadId } = await createLeague();
    const invitee = newIdentity();

    const invite = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.squads.createOwnerInvitation(leagueId, squadId),
      headers: commissioner.headers,
      payload: { email: padded(invitee.email) },
    });
    expect(invite.statusCode).toBe(201);
    const invitation = invite.json<TeamOwnerInvitationResponse>().invitation;
    expect(invitation.email).toBe(invitee.email);

    const registered = await getApp().inject({
      method: 'POST',
      url: '/api/v1/team-invitations/register',
      payload: {
        inviteCode: invitation.inviteCode,
        username: padded(invitee.username),
        password: PASSWORD,
        firstName: 'Co',
        lastName: 'Owner',
      },
    });

    expect(registered.statusCode).toBe(201);
    expect(registered.json<AuthResponse>().user).toMatchObject(invitee);
  });
});
