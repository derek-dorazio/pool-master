import { expect } from '@jest/globals';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@poolmaster/shared/domain';
import type { TeamOwnerInvitationDto } from '@poolmaster/shared/dto';
import { AuthError, AuthService } from '../../../packages/core-api/src/modules/auth/auth-service';
import { createSquadOwnerInvitationHandlers } from '../../../packages/core-api/src/modules/squads/owner-invitation-handler';
import {
  SquadOwnerInvitationNotFoundError,
  SquadOwnerInvitationOperationError,
  SquadOwnerInvitationService,
} from '../../../packages/core-api/src/modules/squads/owner-invitation-service';
import { asFastifyReply, asFastifyRequest } from '../../support/fastify-doubles';
import { fakeLogger } from '../../support/fake-logger';
import { mockFn } from '../../support/mock-fn';
import { stubInstance } from '../../support/stub-instance';

/**
 * The team-owner invitation route handlers: how each invitation outcome becomes an HTTP answer,
 * and the order register-and-accept runs in, which decides whether a bad invite code can leave
 * an orphaned account behind. The invitation rules themselves are the service's and are covered
 * by its own use-case tests, so the service here is a stub.
 */

const invitation = { id: 'invitation-1', status: 'PENDING' } as unknown as TeamOwnerInvitationDto;

const invitedUser: User = {
  id: 'user-new',
  email: 'invited@example.com',
  username: 'newbie',
  firstName: 'New',
  lastName: 'Owner',
  isActive: true,
  isRootAdmin: false,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

const tokens = {
  accessToken: 'access',
  refreshToken: 'refresh',
  csrfToken: 'csrf',
  expiresIn: 900,
  sessionId: 'session-1',
};

function replyDouble() {
  const reply = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, unknown>,
    code: jest.fn(function code(this: { statusCode: number }, status: number) {
      this.statusCode = status;
      return this;
    }),
    status: jest.fn(function status(this: { statusCode: number }, status: number) {
      this.statusCode = status;
      return this;
    }),
    header: jest.fn(function header(this: { headers: Record<string, unknown> }, name: string, value: unknown) {
      this.headers[name] = value;
      return this;
    }),
    send: jest.fn(function send(this: { body: unknown }, body: unknown) {
      this.body = body;
      return this;
    }),
  };
  return reply;
}

function request<R extends FastifyRequest>(fields: Partial<R>, signedIn = true): R {
  return asFastifyRequest<R>({
    ...fields,
    authUser: signedIn ? { userId: 'actor-1', email: 'actor@example.com', isRootAdmin: false } : undefined,
    log: fakeLogger(),
  } as Partial<R>);
}

async function call(handler: (request: never, reply: FastifyReply) => Promise<unknown>, req: FastifyRequest) {
  const reply = replyDouble();
  await handler(req as never, asFastifyReply(reply as unknown as Partial<FastifyReply>));
  return reply;
}

const registerBody = {
  inviteCode: 'owner-code',
  username: 'newbie',
  password: 'Sup3rSecret!',
  firstName: 'New',
  lastName: 'Owner',
};

describe('Team-owner invitation route handlers', () => {
  it('answers each signed-in invitation action with its success status and the invitation', async () => {
    const service = stubInstance(SquadOwnerInvitationService, {
      listInvitationsForViewer: mockFn<SquadOwnerInvitationService['listInvitationsForViewer']>(async () => [invitation]),
      inviteOwner: mockFn<SquadOwnerInvitationService['inviteOwner']>(async () => invitation),
      replaceOwner: mockFn<SquadOwnerInvitationService['replaceOwner']>(async () => invitation),
      revokeInvitation: mockFn<SquadOwnerInvitationService['revokeInvitation']>(async () => invitation),
      acceptInvitation: mockFn<SquadOwnerInvitationService['acceptInvitation']>(async () => invitation),
      getInvitationPreview: mockFn<SquadOwnerInvitationService['getInvitationPreview']>(
        async () => ({ leagueName: 'Office Pool' }) as never,
      ),
    });
    const handlers = createSquadOwnerInvitationHandlers(service);

    const listed = await call(handlers.listOwnerInvitations, request({ params: { id: 'league-1' } }));
    const invited = await call(handlers.inviteOwner, request({ params: { id: 'league-1', squadId: 'squad-1' }, body: { email: 'a@example.com' } }));
    const replaced = await call(handlers.replaceOwner, request({ params: { id: 'league-1', squadId: 'squad-1', userId: 'user-2' }, body: { email: 'b@example.com' } }));
    const revoked = await call(handlers.revokeOwnerInvitation, request({ params: { id: 'league-1', invitationId: 'invitation-1' } }));
    const accepted = await call(handlers.acceptInvitation, request({ body: { inviteCode: 'owner-code' } }));
    const previewed = await call(handlers.getInvitationPreview, request({ params: { inviteCode: 'owner-code' } }, false));

    expect([listed, invited, replaced, revoked, accepted, previewed].map((reply) => reply.statusCode)).toEqual([200, 201, 201, 200, 201, 200]);
    expect(listed.body).toEqual({ invitations: [invitation] });
    expect(accepted.body).toEqual({ invitation });
    expect(previewed.body).toEqual({ invitation: { leagueName: 'Office Pool' } });
  });

  it('answers 404 SQUAD_OWNER_INVITATION_NOT_FOUND for an unknown invitation and 400 with the service\'s code for a refused one', async () => {
    const service = stubInstance(SquadOwnerInvitationService, {
      getInvitationPreview: mockFn<SquadOwnerInvitationService['getInvitationPreview']>(async () => {
        throw new SquadOwnerInvitationNotFoundError('nope');
      }),
      acceptInvitation: mockFn<SquadOwnerInvitationService['acceptInvitation']>(async () => {
        throw new SquadOwnerInvitationOperationError('Invitation has expired', 'SQUAD_OWNER_INVITATION_EXPIRED');
      }),
    });
    const handlers = createSquadOwnerInvitationHandlers(service);

    const missing = await call(handlers.getInvitationPreview, request({ params: { inviteCode: 'gone' } }, false));
    const expired = await call(handlers.acceptInvitation, request({ body: { inviteCode: 'old' } }));

    expect(missing.statusCode).toBe(404);
    expect(missing.body).toMatchObject({ error: { code: 'SQUAD_OWNER_INVITATION_NOT_FOUND' } });
    expect(expired.statusCode).toBe(400);
    expect(expired.body).toMatchObject({ error: { code: 'SQUAD_OWNER_INVITATION_EXPIRED' } });
  });

  it('lets an unexpected failure reach the global error handler rather than answering it as an invitation error', async () => {
    const service = stubInstance(SquadOwnerInvitationService, {
      revokeInvitation: mockFn<SquadOwnerInvitationService['revokeInvitation']>(async () => {
        throw new Error('database down');
      }),
    });
    const handlers = createSquadOwnerInvitationHandlers(service);

    await expect(
      call(handlers.revokeOwnerInvitation, request({ params: { id: 'league-1', invitationId: 'invitation-1' } })),
    ).rejects.toThrow('database down');
  });

  describe('register and accept', () => {
    it('registers the invitee under the INVITED email, accepts the invitation, sets session cookies and answers 201', async () => {
      const accept = mockFn<SquadOwnerInvitationService['acceptInvitation']>(async () => invitation);
      const service = stubInstance(SquadOwnerInvitationService, {
        requireInvitationForRegistration: mockFn<SquadOwnerInvitationService['requireInvitationForRegistration']>(
          async () => ({ email: 'invited@example.com' }) as never,
        ),
        acceptInvitation: accept,
      });
      const register = mockFn<AuthService['register']>(async () => ({ user: invitedUser, tokens }));
      const handlers = createSquadOwnerInvitationHandlers(service, stubInstance(AuthService, { register }));

      const reply = await call(handlers.registerAndAcceptInvitation, request({ body: registerBody }, false));

      expect(reply.statusCode).toBe(201);
      expect(register).toHaveBeenCalledWith('newbie', 'invited@example.com', 'Sup3rSecret!', 'New', 'Owner');
      expect(accept).toHaveBeenCalledWith('owner-code', 'user-new');
      expect(reply.headers['Set-Cookie']).toEqual(expect.arrayContaining([expect.stringContaining('access')]));
      expect(reply.body).toMatchObject({ user: { id: 'user-new' }, tokens: { accessToken: 'access' } });
    });

    it('creates no account when the invite code is invalid, answering 404', async () => {
      const service = stubInstance(SquadOwnerInvitationService, {
        requireInvitationForRegistration: mockFn<SquadOwnerInvitationService['requireInvitationForRegistration']>(async () => {
          throw new SquadOwnerInvitationNotFoundError('unknown code');
        }),
      });
      const register = mockFn<AuthService['register']>(async () => ({ user: invitedUser, tokens }));
      const handlers = createSquadOwnerInvitationHandlers(service, stubInstance(AuthService, { register }));

      const reply = await call(handlers.registerAndAcceptInvitation, request({ body: registerBody }, false));

      expect(reply.statusCode).toBe(404);
      expect(register).not.toHaveBeenCalled();
    });

    it('answers a registration refusal with the auth error\'s own status and code, and accepts nothing', async () => {
      const accept = mockFn<SquadOwnerInvitationService['acceptInvitation']>(async () => invitation);
      const service = stubInstance(SquadOwnerInvitationService, {
        requireInvitationForRegistration: mockFn<SquadOwnerInvitationService['requireInvitationForRegistration']>(
          async () => ({ email: 'invited@example.com' }) as never,
        ),
        acceptInvitation: accept,
      });
      const register = mockFn<AuthService['register']>(async () => {
        throw new AuthError('Username already taken', 'USERNAME_TAKEN', 409);
      });
      const handlers = createSquadOwnerInvitationHandlers(service, stubInstance(AuthService, { register }));

      const reply = await call(handlers.registerAndAcceptInvitation, request({ body: registerBody }, false));

      expect(reply.statusCode).toBe(409);
      expect(reply.body).toMatchObject({ error: { code: 'USERNAME_TAKEN' } });
      expect(accept).not.toHaveBeenCalled();
    });

    it('logs and answers 400 when the account was created but joining the team then failed', async () => {
      const service = stubInstance(SquadOwnerInvitationService, {
        requireInvitationForRegistration: mockFn<SquadOwnerInvitationService['requireInvitationForRegistration']>(
          async () => ({ email: 'invited@example.com' }) as never,
        ),
        acceptInvitation: mockFn<SquadOwnerInvitationService['acceptInvitation']>(async () => {
          throw new SquadOwnerInvitationOperationError('Team is full', 'SQUAD_OWNER_INVITATION_SQUAD_CONFLICT');
        }),
      });
      const register = mockFn<AuthService['register']>(async () => ({ user: invitedUser, tokens }));
      const handlers = createSquadOwnerInvitationHandlers(service, stubInstance(AuthService, { register }));
      const req = request<FastifyRequest>({ body: registerBody }, false);

      const reply = await call(handlers.registerAndAcceptInvitation, req);

      expect(reply.statusCode).toBe(400);
      expect(reply.body).toMatchObject({ error: { code: 'SQUAD_OWNER_INVITATION_SQUAD_CONFLICT' } });
      expect(req.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'squadOwnerInvitationRoute.registerAndAccept.provisioningFailed' }),
        expect.any(String),
      );
    });

    it('answers 500 when the route is mounted without an auth service, rather than registering nobody silently', async () => {
      const handlers = createSquadOwnerInvitationHandlers(stubInstance(SquadOwnerInvitationService, {}));

      const reply = await call(handlers.registerAndAcceptInvitation, request({ body: registerBody }, false));

      expect(reply.statusCode).toBe(500);
      expect(reply.body).toMatchObject({ error: { code: 'SQUAD_OWNER_INVITATION_REGISTRATION_UNAVAILABLE' } });
    });
  });
});
