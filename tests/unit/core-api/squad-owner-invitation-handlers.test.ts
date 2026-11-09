/**
 * The team-owner invitation route handlers (#1482), called with a stand-in invitation service:
 * how each invitation outcome becomes an HTTP answer, and the order register-and-accept runs in,
 * which decides whether a bad invite code can leave an orphaned account behind. The invitation
 * rules themselves are the service's and are covered by its own use-case tests.
 */
import { expect } from '@jest/globals';
import { AuthError, type AuthService } from '../../../packages/core-api/src/modules/auth/auth-service';
import { createSquadOwnerInvitationHandlers } from '../../../packages/core-api/src/modules/squads/owner-invitation-handler';
import {
  SquadOwnerInvitationNotFoundError,
  SquadOwnerInvitationOperationError,
  type SquadOwnerInvitationService,
} from '../../../packages/core-api/src/modules/squads/owner-invitation-service';
import type { AuthUser } from '../../../packages/core-api/src/plugins/auth-guard';
import { buildUser } from '../../factories';
import { authUser, callHandler, stubRequest } from '../../support/handler-call';

const boom = new Error('database down');
const invitation = { id: 'invitation-1', status: 'PENDING' };
const invitedUser = buildUser({ id: 'user-new', email: 'invited@example.com', username: 'newbie' });
const tokens = { accessToken: 'access', refreshToken: 'refresh', csrfToken: 'csrf', expiresIn: 900, sessionId: 'session-1' };
const actor = authUser('actor-1');
const admin = authUser('admin', { isRootAdmin: true });

function invitationService(overrides: Record<string, unknown> = {}) {
  return {
    listInvitationsForViewer: jest.fn((..._args: unknown[]) => Promise.resolve([invitation])),
    inviteOwner: jest.fn((..._args: unknown[]) => Promise.resolve(invitation)),
    replaceOwner: jest.fn((..._args: unknown[]) => Promise.resolve(invitation)),
    revokeInvitation: jest.fn((..._args: unknown[]) => Promise.resolve(invitation)),
    getInvitationPreview: jest.fn((..._args: unknown[]) => Promise.resolve({ leagueName: 'Office Pool' })),
    acceptInvitation: jest.fn((..._args: unknown[]) => Promise.resolve(invitation)),
    requireInvitationForRegistration: jest.fn((..._args: unknown[]) => Promise.resolve({ email: 'invited@example.com' })),
    ...overrides,
  };
}
function authOver(register: (...args: unknown[]) => Promise<unknown> = () => Promise.resolve({ user: invitedUser, tokens })) {
  const fake = { register: jest.fn(register) };
  return { fake, service: fake as unknown as AuthService };
}
const handlersOver = (fake = invitationService(), auth?: AuthService) =>
  createSquadOwnerInvitationHandlers(fake as unknown as SquadOwnerInvitationService, auth);

const operations = {
  listOwnerInvitations: { method: 'listInvitationsForViewer', request: (user: AuthUser | null = actor) => stubRequest({ params: { id: 'league-1' }, authUser: user ?? undefined }) },
  inviteOwner: { method: 'inviteOwner', request: (user: AuthUser | null = actor) => stubRequest({ params: { id: 'league-1', squadId: 'squad-1' }, body: { email: 'a@example.test' }, authUser: user ?? undefined }) },
  replaceOwner: { method: 'replaceOwner', request: (user: AuthUser | null = actor) => stubRequest({ params: { id: 'league-1', squadId: 'squad-1', userId: 'user-2' }, body: { email: 'b@example.test' }, authUser: user ?? undefined }) },
  revokeOwnerInvitation: { method: 'revokeInvitation', request: (user: AuthUser | null = actor) => stubRequest({ params: { id: 'league-1', invitationId: 'invitation-1' }, authUser: user ?? undefined }) },
  acceptInvitation: { method: 'acceptInvitation', request: (user: AuthUser | null = actor) => stubRequest({ body: { inviteCode: 'owner-code' }, authUser: user ?? undefined }) },
  getInvitationPreview: { method: 'getInvitationPreview', request: () => stubRequest({ params: { inviteCode: 'owner-code' } }) },
} as const;
type Operation = keyof typeof operations;
const names = Object.keys(operations) as Operation[];
const signedIn = names.filter((name): name is Exclude<Operation, 'getInvitationPreview'> => name !== 'getInvitationPreview');

const registerBody = {
  inviteCode: 'owner-code', username: 'newbie', password: 'Sup3rSecret!', firstName: 'New', lastName: 'Owner', timezone: 'America/Phoenix', locale: 'en-US',
};

describe('team-owner invitation handlers: success', () => {
  it('answers each invitation action with its success status and the invitation', async () => {
    const handlers = handlersOver();

    const replies = await Promise.all(names.map((name) => callHandler(handlers[name], operations[name].request())));

    expect(replies.map((reply) => reply.statusCode)).toEqual([200, 201, 201, 200, 201, 200]);
    expect(replies[0]?.body).toEqual({ invitations: [invitation] });
    expect(replies[4]?.body).toEqual({ invitation });
    expect(replies[5]?.body).toEqual({ invitation: { leagueName: 'Office Pool' } });
  });

  it('passes the league, team, owner, address and whether the actor is a root admin on to the service', async () => {
    const fake = invitationService();
    const handlers = handlersOver(fake);

    await callHandler(handlers.listOwnerInvitations, operations.listOwnerInvitations.request(admin));
    await callHandler(handlers.inviteOwner, operations.inviteOwner.request());
    await callHandler(handlers.replaceOwner, operations.replaceOwner.request(admin));
    await callHandler(handlers.revokeOwnerInvitation, operations.revokeOwnerInvitation.request());
    await callHandler(handlers.acceptInvitation, operations.acceptInvitation.request());

    expect(fake.listInvitationsForViewer).toHaveBeenCalledWith('league-1', 'admin', true);
    expect(fake.inviteOwner).toHaveBeenCalledWith({ leagueId: 'league-1', squadId: 'squad-1', actorUserId: 'actor-1', actorIsRootAdmin: false, email: 'a@example.test' });
    expect(fake.replaceOwner).toHaveBeenCalledWith({
      leagueId: 'league-1', squadId: 'squad-1', targetUserId: 'user-2', actorUserId: 'admin', actorIsRootAdmin: true, email: 'b@example.test',
    });
    expect(fake.revokeInvitation).toHaveBeenCalledWith('league-1', 'invitation-1', 'actor-1', false);
    expect(fake.acceptInvitation).toHaveBeenCalledWith('owner-code', 'actor-1');
  });
});

describe('team-owner invitation handlers: refusals', () => {
  it.each(names)('%s answers an unknown invitation with 404 SQUAD_OWNER_INVITATION_NOT_FOUND', async (handler) => {
    const { method, request } = operations[handler];
    const handlers = handlersOver(invitationService({ [method]: () => Promise.reject(new SquadOwnerInvitationNotFoundError('nope')) }));

    expect(await callHandler(handlers[handler], request())).toMatchObject({ statusCode: 404, body: { error: { code: 'SQUAD_OWNER_INVITATION_NOT_FOUND' } } });
  });

  it.each(names)('%s answers a refused invitation with 400 and the service\'s code', async (handler) => {
    const { method, request } = operations[handler];
    const handlers = handlersOver(invitationService({ [method]: () => Promise.reject(new SquadOwnerInvitationOperationError('Expired', 'SQUAD_OWNER_INVITATION_EXPIRED')) }));

    expect(await callHandler(handlers[handler], request())).toMatchObject({ statusCode: 400, body: { error: { code: 'SQUAD_OWNER_INVITATION_EXPIRED' } } });
  });

  it.each(names)('%s passes an unexpected failure on to the global error handler', async (handler) => {
    const { method, request } = operations[handler];
    const handlers = handlersOver(invitationService({ [method]: () => Promise.reject(boom) }));

    await expect(callHandler(handlers[handler], request())).rejects.toBe(boom);
  });

  it.each(signedIn)('%s lets an unauthenticated request\'s 401 reach the global error handler, calling no service', async (handler) => {
    const fake = invitationService();
    const { method, request } = operations[handler];

    await expect(callHandler(handlersOver(fake)[handler], request(null))).rejects.toMatchObject({ statusCode: 401, code: 'AUTH_SESSION_REQUIRED' });
    expect(fake[method]).not.toHaveBeenCalled();
  });
});

describe('team-owner invitation handlers: register and accept', () => {
  it('registers the invitee under the INVITED email with the browser\'s time zone and locale, accepts the invitation, sets session cookies and answers 201', async () => {
    const fake = invitationService();
    const auth = authOver();

    const reply = await callHandler(handlersOver(fake, auth.service).registerAndAcceptInvitation, stubRequest({ body: registerBody, contextLogger: false }));

    expect(auth.fake.register).toHaveBeenCalledWith('newbie', 'invited@example.com', 'Sup3rSecret!', 'New', 'Owner', { timezone: 'America/Phoenix', locale: 'en-US' });
    expect(fake.acceptInvitation).toHaveBeenCalledWith('owner-code', 'user-new');
    expect(reply).toMatchObject({ statusCode: 201, body: { user: { id: 'user-new' }, tokens: { accessToken: 'access' } } });
    expect(reply.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('access')]));
  });

  it('creates no account when the invite code is invalid, answering 404', async () => {
    const auth = authOver();
    const fake = invitationService({ requireInvitationForRegistration: () => Promise.reject(new SquadOwnerInvitationNotFoundError('unknown code')) });

    const reply = await callHandler(handlersOver(fake, auth.service).registerAndAcceptInvitation, stubRequest({ body: registerBody }));

    expect(reply.statusCode).toBe(404);
    expect(auth.fake.register).not.toHaveBeenCalled();
  });

  it('answers a registration refusal with the auth error\'s own status and code, and accepts nothing', async () => {
    const fake = invitationService();
    const auth = authOver(() => Promise.reject(new AuthError('Username already taken', 'ACCOUNT_USERNAME_TAKEN', 409)));

    const reply = await callHandler(handlersOver(fake, auth.service).registerAndAcceptInvitation, stubRequest({ body: registerBody }));

    expect(reply).toMatchObject({ statusCode: 409, body: { error: { code: 'ACCOUNT_USERNAME_TAKEN' } } });
    expect(fake.acceptInvitation).not.toHaveBeenCalled();
  });

  it('logs and answers 400 when the account was created but joining the team then failed', async () => {
    const fake = invitationService({ acceptInvitation: () => Promise.reject(new SquadOwnerInvitationOperationError('Team is full', 'SQUAD_OWNER_INVITATION_SQUAD_CONFLICT')) });
    const request = stubRequest({ body: registerBody });

    const reply = await callHandler(handlersOver(fake, authOver().service).registerAndAcceptInvitation, request);

    expect(reply).toMatchObject({ statusCode: 400, body: { error: { code: 'SQUAD_OWNER_INVITATION_SQUAD_CONFLICT' } } });
    expect(request.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squadOwnerInvitationRoute.registerAndAccept.provisioningFailed' }),
      expect.any(String),
    );
  });

  it('answers 500 when the route is mounted without an auth service, rather than registering nobody silently', async () => {
    const fake = invitationService();

    const reply = await callHandler(handlersOver(fake).registerAndAcceptInvitation, stubRequest({ body: registerBody }));

    expect(reply).toMatchObject({ statusCode: 500, body: { error: { code: 'SQUAD_OWNER_INVITATION_REGISTRATION_UNAVAILABLE' } } });
    expect(fake.requireInvitationForRegistration).not.toHaveBeenCalled();
  });
});
