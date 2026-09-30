/**
 * The `User` operation set (#202 step 3.4).
 *
 * One route per operation, mounted at `/api/v1/users`. `:userId` accepts `me`, which resolves
 * to the authenticated caller, so a user editing their own profile and a root admin editing
 * somebody's are the same endpoint with a different subject — which is what
 * `docs/DOMAIN-OPERATIONS.md` means by "scope is a parameter of the operation".
 *
 * This replaces `/api/v1/account/*` (seven routes), `/api/v1/admin/users/*` (eight routes) and
 * `/api/v1/auth/me`. Sixteen routes over two DTO families become eleven over one.
 *
 * None of these responses carries viewer context — who is asking is not a property of the user
 * being read (access rule A8).
 */
import type { FastifyInstance } from 'fastify';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components these routes $ref (#192).
import '@poolmaster/shared/dto/users.dto';
import { SuccessSchema, zodToJsonSchema } from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaUserRepository } from '../../adapters';
import { createUserHandlers } from './handler';
import { UserService } from './user-service';
import { AuthService } from '../auth/auth-service';

/** Every user route can 401, 403 and 404; the rest are per-operation. */
function withUserErrorResponses(
  success: Record<number, unknown>,
  extra: number[] = [],
): Record<number, unknown> {
  const envelope = zodToJsonSchema(ErrorEnvelopeSchema);
  return {
    ...success,
    401: envelope,
    403: envelope,
    404: envelope,
    ...Object.fromEntries(extra.map((status) => [status, envelope])),
  };
}

export function usersModule(fastify: FastifyInstance): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const users = new PrismaUserRepository(prisma);
  const service = new UserService(users, prisma, fastify.log);
  const authService = new AuthService(users, prisma, fastify.log);
  const handlers = createUserHandlers(service, authService);

  fastify.get('/', {
    schema: {
      tags: ['Users'],
      summary: 'List users',
      description:
        'Returns every user, optionally filtered. This is the unscoped read: access rule A1 permits it to root admins only. Not paged — filters narrow the result, nothing slices it.',
      operationId: 'listUsers',
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          isActive: { type: 'boolean' },
        },
      },
      response: withUserErrorResponses({ 200: schemaRef('UserListResponse') }),
    },
    handler: handlers.listUsers,
  });

  fastify.get('/:userId', {
    schema: {
      tags: ['Users'],
      summary: 'Read one user',
      description:
        'Returns one user as the canonical UserDto. `me` resolves to the authenticated caller. Access rule A6: the subject themselves, or a root admin. Carries no viewer context (A8).',
      operationId: 'getUser',
      response: withUserErrorResponses({ 200: schemaRef('UserResponse') }),
    },
    handler: handlers.readUser,
  });

  fastify.put('/:userId/profile', {
    schema: {
      tags: ['Users'],
      summary: 'Update a user profile',
      description:
        'Updates email, first name and last name. One operation for either caller — the subject themselves or a root admin (A6). The email must be unique across account emails and usernames.',
      operationId: 'updateUserProfile',
      body: schemaRef('UserProfileUpdateRequest'),
      response: withUserErrorResponses({ 200: schemaRef('UserResponse') }, [400, 409]),
    },
    handler: handlers.updateProfile,
  });

  fastify.put('/:userId/username', {
    schema: {
      tags: ['Users'],
      summary: 'Update a user login username',
      description:
        'Updates the login username after confirming it is unique across usernames AND emails, because login accepts either.',
      operationId: 'updateUserUsername',
      body: schemaRef('UserUsernameUpdateRequest'),
      response: withUserErrorResponses({ 200: schemaRef('UserResponse') }, [400, 409]),
    },
    handler: handlers.updateUsername,
  });

  fastify.put('/:userId/preferences', {
    schema: {
      tags: ['Users'],
      summary: 'Update user preferences',
      description:
        'Updates locale, timezone and date/time formatting. An omitted field is left unchanged; an explicit null clears it.',
      operationId: 'updateUserPreferences',
      body: schemaRef('UserPreferencesUpdateRequest'),
      response: withUserErrorResponses({ 200: schemaRef('UserResponse') }, [409]),
    },
    handler: handlers.updatePreferences,
  });

  fastify.post('/:userId/password', {
    schema: {
      tags: ['Users'],
      summary: 'Change your own password',
      description:
        'Changes the password after validating the current one. Self only (A6): a root admin resetting somebody else uses the reset operation, which has a different subject rather than merely a different precondition. Other sessions are revoked while the caller stays signed in.',
      operationId: 'changeUserPassword',
      body: schemaRef('UserPasswordChangeRequest'),
      response: withUserErrorResponses({ 200: zodToJsonSchema(SuccessSchema) }, [400, 409]),
    },
    handler: handlers.changePassword,
  });

  fastify.post('/:userId/reset-password', {
    schema: {
      tags: ['Users'],
      summary: "Reset another user's password",
      description:
        'Generates a temporary password for the target user, revokes their live sessions, and returns the credential for the root admin to relay. Root admin only (A6).',
      operationId: 'resetUserPassword',
      response: withUserErrorResponses({ 200: schemaRef('UserResetPasswordResponse') }),
    },
    handler: handlers.resetPassword,
  });

  fastify.post('/:userId/disable', {
    schema: {
      tags: ['Users'],
      summary: 'Disable a user',
      description:
        'Sets isActive = false and revokes every live session, atomically. Self-inactivation and admin-disable are ONE operation (A6). Idempotent: already inactive succeeds unchanged. Rejected for the last remaining root admin. Disabling yourself clears your session cookies.',
      operationId: 'disableUser',
      response: withUserErrorResponses({ 200: schemaRef('UserResponse') }, [409]),
    },
    handler: handlers.disableUser,
  });

  fastify.post('/:userId/enable', {
    schema: {
      tags: ['Users'],
      summary: 'Enable a user',
      description:
        'Sets isActive = true. Self-reactivation and admin-enable are ONE operation (A6). Idempotent. Re-enabling yourself rotates a fresh session so the account is immediately usable.',
      operationId: 'enableUser',
      response: withUserErrorResponses({ 200: schemaRef('UserResponse') }, [409]),
    },
    handler: handlers.enableUser,
  });

  fastify.post('/:userId/revoke-sessions', {
    schema: {
      tags: ['Users'],
      summary: 'Revoke every live session for a user',
      description:
        'Revokes all refresh tokens, forcing re-authentication. Self sign-out-everywhere and admin force-logout are ONE operation (A6).',
      operationId: 'revokeUserSessions',
      response: withUserErrorResponses({ 200: schemaRef('RevokeUserSessionsResponse') }),
    },
    handler: handlers.revokeSessions,
  });

  fastify.delete('/:userId', {
    schema: {
      tags: ['Users'],
      summary: 'Permanently delete an inactive user',
      description:
        'Removes the user row and the user-owned data that references it, in one transaction. Self-delete and admin-delete are ONE operation (A6). Gated: the account must already be inactive — the one place isActive is a write precondition rather than a read filter (A9) — the exact email must be confirmed, no league-scoped data may remain, and the last root admin cannot be removed.',
      operationId: 'deleteUser',
      body: schemaRef('UserDeleteRequest'),
      response: withUserErrorResponses({ 200: zodToJsonSchema(SuccessSchema) }, [400, 409]),
    },
    handler: handlers.deleteUser,
  });

  fastify.post('/:userId/root-admin', {
    schema: {
      tags: ['Users'],
      summary: 'Grant or revoke the root-admin role',
      description:
        'Root admin only (A6). Self-demotion is permitted: the only rule is that the platform keeps an administrator, which the last-root-admin guard enforces for every caller. A demotion also revokes the subject\'s sessions so the removed authority cannot be used until re-login.',
      operationId: 'setUserRootAdmin',
      body: schemaRef('SetUserRootAdminRequest'),
      response: withUserErrorResponses({ 200: zodToJsonSchema(SuccessSchema) }, [409]),
    },
    handler: handlers.setRootAdmin,
  });
}
