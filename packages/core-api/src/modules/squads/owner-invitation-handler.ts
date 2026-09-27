import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SquadOwnerInvitationService } from './owner-invitation-service';
import {
  SquadOwnerInvitationNotFoundError,
  SquadOwnerInvitationOperationError,
} from './owner-invitation-service';
import type { AuthService } from '../auth/auth-service';
import { AuthError } from '../auth/auth-service';
import { toAuthResponse } from '../../mappers/auth.mapper';
import { createSessionCookieHeaders } from '../../core/session-cookies';
import { sendError } from '../../core/error-handler';

export function createSquadOwnerInvitationHandlers(
  service: SquadOwnerInvitationService,
  /**
   * #217 — only the register-and-accept route needs this, so it is optional: the squads module
   * mounts these handlers without it and never exposes that route.
   */
  authService?: AuthService,
) {
  return {
    listOwnerInvitations,
    inviteOwner,
    replaceOwner,
    revokeOwnerInvitation,
    getInvitationPreview,
    acceptInvitation,
    registerAndAcceptInvitation,
  };

  async function listOwnerInvitations(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const userId = request.authUser?.userId;
      if (!userId) {
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }
      const invitations = await service.listInvitationsForViewer(
        request.params.id,
        userId,
        request.authUser?.isRootAdmin === true,
      );
      return reply.send({ invitations });
    } catch (error) {
      return handleOwnerInvitationError(reply, error);
    }
  }

  async function inviteOwner(
    request: FastifyRequest<{
      Params: { id: string; squadId: string };
      Body: { email: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const userId = request.authUser?.userId;
      if (!userId) {
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }
      const invitation = await service.inviteOwner({
        leagueId: request.params.id,
        squadId: request.params.squadId,
        actorUserId: userId,
        actorIsRootAdmin: request.authUser?.isRootAdmin === true,
        email: request.body.email,
      });
      return reply.code(201).send({ invitation });
    } catch (error) {
      return handleOwnerInvitationError(reply, error);
    }
  }

  async function replaceOwner(
    request: FastifyRequest<{
      Params: { id: string; squadId: string; userId: string };
      Body: { email: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const actorUserId = request.authUser?.userId;
      if (!actorUserId) {
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }
      const invitation = await service.replaceOwner({
        leagueId: request.params.id,
        squadId: request.params.squadId,
        targetUserId: request.params.userId,
        actorUserId,
        actorIsRootAdmin: request.authUser?.isRootAdmin === true,
        email: request.body.email,
      });
      return reply.code(201).send({ invitation });
    } catch (error) {
      return handleOwnerInvitationError(reply, error);
    }
  }

  async function revokeOwnerInvitation(
    request: FastifyRequest<{ Params: { id: string; invitationId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const actorUserId = request.authUser?.userId;
      if (!actorUserId) {
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }
      const invitation = await service.revokeInvitation(
        request.params.id,
        request.params.invitationId,
        actorUserId,
        request.authUser?.isRootAdmin === true,
      );
      return reply.send({ invitation });
    } catch (error) {
      return handleOwnerInvitationError(reply, error);
    }
  }

  async function getInvitationPreview(
    request: FastifyRequest<{ Params: { inviteCode: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const invitation = await service.getInvitationPreview(request.params.inviteCode);
      return reply.send({ invitation });
    } catch (error) {
      return handleOwnerInvitationError(reply, error);
    }
  }

  /**
   * Register against a pending invitation and accept it, in one request (#217).
   *
   * The orchestration lives in the handler because it spans two services: the invitation rules are
   * the invitation service's, and creating an account is `AuthService`'s. Neither should know about
   * the other.
   *
   * Order matters. The invitation is validated **first**, so a bad or expired code cannot leave a
   * stranded account behind. Then the account is created with the INVITED email — never one the
   * caller supplies — and only then is the invitation accepted with the new user's id.
   *
   * Known limit, stated rather than hidden: the account creation and the membership writes are not
   * one transaction, because the repositories hold their own Prisma client and take no transaction
   * client. If provisioning failed after registration the invitee would hold an account with no
   * league — a legitimate state that logs in fine and can be re-invited, not a corrupt one, and it
   * does not break the league/squad membership invariant. Making it atomic needs the repository
   * refactor in #211.
   */
  async function registerAndAcceptInvitation(
    request: FastifyRequest<{
      Body: {
        inviteCode: string;
        username: string;
        password: string;
        firstName: string;
        lastName: string;
      };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    if (!authService) {
      logger.error({
        action: 'squadOwnerInvitationRoute.registerAndAccept.unavailable',
      }, 'Register-and-accept route reached without an auth service');
      return sendError(
        reply,
        500,
        'SQUAD_OWNER_INVITATION_REGISTRATION_UNAVAILABLE',
        'Registration is not configured for this route',
      );
    }

    const { inviteCode, username, password, firstName, lastName } = request.body;
    try {
      const { email } = await service.requireInvitationForRegistration(inviteCode);

      const registered = await authService.register(username, email, password, firstName, lastName);
      try {
        await service.acceptInvitation(inviteCode, registered.user.id);
      } catch (error) {
        logger.error({
          action: 'squadOwnerInvitationRoute.registerAndAccept.provisioningFailed',
          data: { userId: registered.user.id, inviteCode },
          err: error instanceof Error ? error : undefined,
        }, 'Registered the invitee but could not join them to the league and squad');
        throw error;
      }

      logger.info({
        action: 'squadOwnerInvitationRoute.registerAndAccept.success',
        data: { userId: registered.user.id },
      }, 'Registered an invited co-owner and joined them to the league and squad');
      reply.header('Set-Cookie', createSessionCookieHeaders(registered.tokens));
      return reply.status(201).send(toAuthResponse(registered.user, registered.tokens));
    } catch (error) {
      if (error instanceof AuthError) {
        return sendError(reply, error.statusCode ?? 400, error.code, error.message);
      }
      return handleOwnerInvitationError(reply, error);
    }
  }

  async function acceptInvitation(
    request: FastifyRequest<{ Body: { inviteCode: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const userId = request.authUser?.userId;
      if (!userId) {
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }
      const invitation = await service.acceptInvitation(request.body.inviteCode, userId);
      return reply.code(201).send({ invitation });
    } catch (error) {
      return handleOwnerInvitationError(reply, error);
    }
  }
}

function handleOwnerInvitationError(reply: FastifyReply, error: unknown) {
  if (error instanceof SquadOwnerInvitationNotFoundError) {
    return sendError(reply, 404, 'SQUAD_OWNER_INVITATION_NOT_FOUND', error.message);
  }
  if (error instanceof SquadOwnerInvitationOperationError) {
    return sendError(reply, 400, error.code, error.message);
  }
  throw error;
}
