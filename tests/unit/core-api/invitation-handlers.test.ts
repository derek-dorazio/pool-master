/**
 * The league invitation route handlers (#1482), called with a stand-in invitation service: the
 * status each refusal is sent with (a resend or a revoke of a settled invitation is a conflict;
 * anything else invalid is a bad request), and that an error the handler does not own reaches
 * the global error handler unchanged.
 */
import { expect } from '@jest/globals';
import type { UserRepository } from '@poolmaster/shared/db';
import { createInvitationHandlers } from '../../../packages/core-api/src/modules/leagues/invitation-handler';
import {
  InvitationInvalidError,
  InvitationNotFoundError,
  type InvitationService,
} from '../../../packages/core-api/src/modules/leagues/invitation-service';
import { buildInvitation, buildMembership, buildUser } from '../../factories';
import { authUser, callHandler, stubRequest } from '../../support/handler-call';

const boom = new Error('database down');
const invitation = buildInvitation({ id: 'inv-1' });
const commish = authUser('commish');

function service(overrides: Record<string, unknown> = {}) {
  return {
    sendEmailInvitations: jest.fn((..._args: unknown[]) => Promise.resolve({
      sent: [{ invitation, emailState: null }], skippedMembers: ['member@example.test'], skippedDuplicates: [],
    })),
    listOutstandingInvitations: jest.fn((..._args: unknown[]) => Promise.resolve([{ invitation, emailState: null }])),
    resendEmailInvitation: jest.fn((..._args: unknown[]) => Promise.resolve({ invitation, emailState: null })),
    generateInviteLink: jest.fn((..._args: unknown[]) => Promise.resolve(invitation)),
    revokeInviteLink: jest.fn((..._args: unknown[]) => Promise.resolve()),
    acceptInvitation: jest.fn((..._args: unknown[]) => Promise.resolve(buildMembership({ leagueId: 'league-1', userId: 'user-2' }))),
    getInvitationPreview: jest.fn((..._args: unknown[]) => Promise.resolve({ league: { id: 'league-1' }, status: 'PENDING' })),
    ...overrides,
  };
}
const users = (found: boolean) => ({ findById: () => Promise.resolve(found ? buildUser({ id: 'user-2' }) : null) }) as unknown as UserRepository;
const handlersOver = (fake: ReturnType<typeof service>, found = true) => createInvitationHandlers(fake as unknown as InvitationService, users(found));

const requests = {
  sendInvitations: () => stubRequest({ params: { id: 'league-1' }, body: { emails: ['a@example.test'], message: ' Join ' }, authUser: commish }),
  resendInvitation: () => stubRequest({ params: { id: 'league-1', invitationId: 'inv-1' }, authUser: commish }),
  generateInviteLink: () => stubRequest({ params: { id: 'league-1' }, body: { expiresInDays: 7, maxUses: 10 }, authUser: commish }),
  revokeInviteLink: () => stubRequest({ params: { id: 'league-1', code: 'JOIN123' }, authUser: commish }),
  acceptInvitation: () => stubRequest({ body: { inviteCode: 'JOIN123' }, authUser: authUser('user-2') }),
  getInvitationPreview: () => stubRequest({ params: { inviteCode: 'JOIN123' } }),
};
const methodOf = {
  sendInvitations: 'sendEmailInvitations',
  resendInvitation: 'resendEmailInvitation',
  generateInviteLink: 'generateInviteLink',
  revokeInviteLink: 'revokeInviteLink',
  acceptInvitation: 'acceptInvitation',
  getInvitationPreview: 'getInvitationPreview',
} as const;

describe('league invitation handlers: success', () => {
  it('sends email invitations with 201, listing who was skipped as a member', async () => {
    const fake = service();

    const reply = await callHandler(handlersOver(fake).sendInvitations, requests.sendInvitations());

    expect(fake.sendEmailInvitations).toHaveBeenCalledWith({ leagueId: 'league-1', emails: ['a@example.test'], invitedBy: 'commish', message: ' Join ' });
    expect(reply).toMatchObject({ statusCode: 201, body: { sent: [{ id: 'inv-1' }], skippedMembers: ['member@example.test'], skippedDuplicates: [] } });
  });

  it('lists the outstanding invitations and resends one', async () => {
    const handlers = handlersOver(service());

    const listed = await callHandler(handlers.listInvitations, stubRequest({ params: { id: 'league-1' }, contextLogger: false }));
    const resent = await callHandler(handlers.resendInvitation, requests.resendInvitation());

    expect(listed.body).toMatchObject({ invitations: [{ id: 'inv-1' }] });
    expect(resent.body).toMatchObject({ invitation: { id: 'inv-1' } });
  });

  it('generates an invite link with 201, and one with no limits passes none on', async () => {
    const fake = service();
    const handlers = handlersOver(fake);

    const reply = await callHandler(handlers.generateInviteLink, requests.generateInviteLink());
    await callHandler(handlers.generateInviteLink, stubRequest({ params: { id: 'league-1' }, body: {}, authUser: commish, contextLogger: false }));

    expect(reply).toMatchObject({ statusCode: 201, body: { invitation: { id: 'inv-1', emailStatus: null } } });
    expect(fake.generateInviteLink).toHaveBeenLastCalledWith({ leagueId: 'league-1', invitedBy: 'commish', expiresInDays: undefined, maxUses: undefined });
  });

  it('revokes an invite link and previews an invitation', async () => {
    const handlers = handlersOver(service());

    const revoked = await callHandler(handlers.revokeInviteLink, stubRequest({ params: { id: 'league-1', code: 'JOIN123' }, contextLogger: false }));
    const preview = await callHandler(handlers.getInvitationPreview, stubRequest({ params: { inviteCode: 'JOIN123' }, contextLogger: false }));

    expect(revoked.body).toEqual({ success: true });
    expect(preview.body).toEqual({ invitation: { league: { id: 'league-1' }, status: 'PENDING' } });
  });

  it('accepts an invitation with 201 and the new membership with its member', async () => {
    const reply = await callHandler(handlersOver(service()).acceptInvitation, stubRequest({ body: { inviteCode: 'JOIN123' }, authUser: authUser('user-2'), contextLogger: false }));

    expect(reply).toMatchObject({ statusCode: 201, body: { membership: { leagueId: 'league-1', user: { id: 'user-2' } } } });
  });

  it('answers an acceptance whose account is gone with 404 USER_NOT_FOUND', async () => {
    const reply = await callHandler(handlersOver(service(), false).acceptInvitation, requests.acceptInvitation());

    expect(reply).toMatchObject({ statusCode: 404, body: { error: { code: 'USER_NOT_FOUND' } } });
  });

  it('refuses an acceptance with no session with 401 AUTH_SESSION_REQUIRED', async () => {
    const fake = service();

    const reply = await callHandler(handlersOver(fake).acceptInvitation, stubRequest({ body: { inviteCode: 'JOIN123' } }));

    expect(reply).toMatchObject({ statusCode: 401, body: { error: { code: 'AUTH_SESSION_REQUIRED' } } });
    expect(fake.acceptInvitation).not.toHaveBeenCalled();
  });
});

describe('league invitation handlers: refusals', () => {
  it.each([
    ['resendInvitation'], ['revokeInviteLink'], ['acceptInvitation'], ['getInvitationPreview'],
  ] as const)('%s answers a missing invitation with 404 LEAGUE_INVITATION_NOT_FOUND', async (handler) => {
    const handlers = handlersOver(service({ [methodOf[handler]]: () => Promise.reject(new InvitationNotFoundError('JOIN123')) }));

    expect(await callHandler(handlers[handler], requests[handler]())).toMatchObject({ statusCode: 404, body: { error: { code: 'LEAGUE_INVITATION_NOT_FOUND' } } });
  });

  it.each([
    ['sendInvitations', 400], ['generateInviteLink', 400], ['acceptInvitation', 400], ['getInvitationPreview', 400],
    ['resendInvitation', 409], ['revokeInviteLink', 409],
  ] as const)('%s answers an invalid invitation with %i and its own code', async (handler, status) => {
    const handlers = handlersOver(service({ [methodOf[handler]]: () => Promise.reject(new InvitationInvalidError('Expired', 'LEAGUE_INVITATION_EXPIRED')) }));

    expect(await callHandler(handlers[handler], requests[handler]())).toMatchObject({ statusCode: status, body: { error: { code: 'LEAGUE_INVITATION_EXPIRED' } } });
  });

  it.each(Object.keys(methodOf) as Array<keyof typeof methodOf>)('%s passes an unexpected failure on to the global error handler', async (handler) => {
    const handlers = handlersOver(service({ [methodOf[handler]]: () => Promise.reject(boom) }));

    await expect(callHandler(handlers[handler], requests[handler]())).rejects.toBe(boom);
  });
});
