/**
 * `User` route handlers — one set, for both callers (#202 step 3.4).
 *
 * Replaces `account/handler.ts` and `admin/user-handler.ts`. Each handler does three things:
 * resolve the actor from the authenticated request, resolve the subject from `:userId` (where
 * `me` means the caller), and map the result. The authority rule lives in the service, not
 * here, so the two callers cannot drift apart again.
 *
 * `UserOperationError` carries the wire contract — a stable `code` and `statusCode` — so there
 * is one error arm rather than one `instanceof` per failure.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  UserPasswordChangeRequest,
  UserPreferencesUpdateRequest,
  UserProfileUpdateRequest,
} from '@poolmaster/shared/dto';
import { toUserDto } from '../../mappers/users.mapper';
import { sendError } from '../../core/error-handler';
import {
  createClearedSessionCookieHeaders,
  createSessionCookieHeaders,
  readRefreshCookie,
} from '../../core/session-cookies';
import type { AuthService } from '../auth/auth-service';
import { AuthError } from '../auth/auth-service';
import { UserOperationError } from './user-errors';
import type { UserService, UserWriteActor } from './user-service';

/** `me` is the caller. Every other value is a user id the authority rules then check. */
const SELF = 'me';

export function createUserHandlers(userService: UserService, authService: AuthService) {
  return {
    listUsers,
    readUser,
    updateProfile,
    updateUsername,
    updatePreferences,
    changePassword,
    resetPassword,
    disableUser,
    enableUser,
    revokeSessions,
    deleteUser,
    setRootAdmin,
  };

  function actorOf(request: FastifyRequest): UserWriteActor | null {
    const authUser = request.authUser;
    if (!authUser) {
      return null;
    }
    return {
      userId: authUser.userId,
      isRootAdmin: authUser.isRootAdmin === true,
    };
  }

  function subjectOf(actor: UserWriteActor, userId: string): string {
    return userId === SELF ? actor.userId : userId;
  }

  /**
   * One error arm for every user operation. `UserOperationError` and `AuthError` both carry
   * `code` and `statusCode`; anything else is a bug and propagates to the error handler.
   */
  async function run(
    request: FastifyRequest,
    reply: FastifyReply,
    action: string,
    work: (actor: UserWriteActor) => Promise<unknown>,
  ): Promise<unknown> {
    const logger = request.contextLogger ?? request.log;
    const actor = actorOf(request);
    if (!actor) {
      logger.warn({ action: `${action}.unauthenticated` }, 'Rejected user operation without a session');
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }
    try {
      return await work(actor);
    } catch (error) {
      if (error instanceof UserOperationError || error instanceof AuthError) {
        logger.warn({
          action: `${action}.rejected`,
          errorCode: error.code,
          statusCode: error.statusCode,
          data: { actorUserId: actor.userId },
        }, 'Rejected user operation');
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }

  // --- Reads ------------------------------------------------------------------

  async function listUsers(
    request: FastifyRequest<{ Querystring: { search?: string; isActive?: boolean } }>,
    reply: FastifyReply,
  ) {
    return run(request, reply, 'user.list', async (actor) => {
      // No paging (§16). `search` and `isActive` narrow the result; nothing slices it.
      const users = await userService.listUsers(actor, {
        search: request.query.search,
        isActive: request.query.isActive,
      });
      return reply.send({ users: users.map(toUserDto) });
    });
  }

  async function readUser(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) {
    return run(request, reply, 'user.read', async (actor) => {
      const user = await userService.readUser(actor, subjectOf(actor, request.params.userId));
      return reply.send({ user: toUserDto(user) });
    });
  }

  // --- Profile writes ---------------------------------------------------------

  async function updateProfile(
    request: FastifyRequest<{ Params: { userId: string }; Body: UserProfileUpdateRequest }>,
    reply: FastifyReply,
  ) {
    return run(request, reply, 'user.updateProfile', async (actor) => {
      const user = await userService.updateProfile(
        actor,
        subjectOf(actor, request.params.userId),
        request.body,
      );
      return reply.send({ user: toUserDto(user) });
    });
  }

  async function updateUsername(
    request: FastifyRequest<{ Params: { userId: string }; Body: { username: string } }>,
    reply: FastifyReply,
  ) {
    return run(request, reply, 'user.updateUsername', async (actor) => {
      const user = await userService.updateUsername(
        actor,
        subjectOf(actor, request.params.userId),
        request.body.username,
      );
      return reply.send({ user: toUserDto(user) });
    });
  }

  async function updatePreferences(
    request: FastifyRequest<{ Params: { userId: string }; Body: UserPreferencesUpdateRequest }>,
    reply: FastifyReply,
  ) {
    return run(request, reply, 'user.updatePreferences', async (actor) => {
      const user = await userService.updatePreferences(
        actor,
        subjectOf(actor, request.params.userId),
        request.body,
      );
      return reply.send({ user: toUserDto(user) });
    });
  }

  // --- Credentials ------------------------------------------------------------

  async function changePassword(
    request: FastifyRequest<{ Params: { userId: string }; Body: UserPasswordChangeRequest }>,
    reply: FastifyReply,
  ) {
    return run(request, reply, 'user.changePassword', async (actor) => {
      await userService.changeOwnPassword(actor, subjectOf(actor, request.params.userId), {
        ...request.body,
        // The caller's own session survives the change; every other one is revoked.
        currentRefreshToken: readRefreshCookie(request.headers.cookie),
      });
      return reply.send({ success: true });
    });
  }

  async function resetPassword(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) {
    return run(request, reply, 'user.resetPassword', async (actor) => {
      const result = await userService.resetPassword(
        actor,
        subjectOf(actor, request.params.userId),
      );
      return reply.send(result);
    });
  }

  // --- Lifecycle --------------------------------------------------------------

  async function disableUser(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) {
    return run(request, reply, 'user.disable', async (actor) => {
      const subjectId = subjectOf(actor, request.params.userId);
      const user = await userService.disableUser(actor, subjectId);
      // Disabling yourself revokes your own sessions, so the browser's cookies are cleared
      // rather than left pointing at tokens that no longer work.
      if (subjectId === actor.userId) {
        reply.header('Set-Cookie', createClearedSessionCookieHeaders());
      }
      return reply.send({ user: toUserDto(user) });
    });
  }

  async function enableUser(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) {
    return run(request, reply, 'user.enable', async (actor) => {
      const subjectId = subjectOf(actor, request.params.userId);
      const user = await userService.enableUser(actor, subjectId);
      // Re-enabling YOURSELF rotates a fresh session, so the account is immediately usable
      // again; re-enabling somebody else does not hand the admin their session.
      if (subjectId === actor.userId) {
        const tokens = await authService.issueSessionForUser(user.id);
        reply.header('Set-Cookie', createSessionCookieHeaders(tokens));
      }
      return reply.send({ user: toUserDto(user) });
    });
  }

  async function revokeSessions(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) {
    return run(request, reply, 'user.revokeSessions', async (actor) => {
      const subjectId = subjectOf(actor, request.params.userId);
      const revokedCount = await userService.revokeSessions(actor, subjectId);
      if (subjectId === actor.userId) {
        reply.header('Set-Cookie', createClearedSessionCookieHeaders());
      }
      return reply.send({ revokedCount });
    });
  }

  async function deleteUser(
    request: FastifyRequest<{
      Params: { userId: string };
      Body: { email: string };
    }>,
    reply: FastifyReply,
  ) {
    return run(request, reply, 'user.delete', async (actor) => {
      const subjectId = subjectOf(actor, request.params.userId);
      await userService.deleteUser(actor, subjectId, request.body.email);
      if (subjectId === actor.userId) {
        reply.header('Set-Cookie', createClearedSessionCookieHeaders());
      }
      return reply.send({ success: true });
    });
  }

  async function setRootAdmin(
    request: FastifyRequest<{
      Params: { userId: string };
      Body: { isRootAdmin: boolean };
    }>,
    reply: FastifyReply,
  ) {
    return run(request, reply, 'user.setRootAdmin', async (actor) => {
      await userService.setRootAdmin(
        actor,
        subjectOf(actor, request.params.userId),
        request.body.isRootAdmin,
      );
      return reply.send({ success: true });
    });
  }
}
