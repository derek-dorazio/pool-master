import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SquadOwnerInvitationService } from './owner-invitation-service';
import {
  SquadOwnerInvitationNotFoundError,
  SquadOwnerInvitationOperationError,
} from './owner-invitation-service';
import { sendError } from '../../core/error-handler';

export function createSquadOwnerInvitationHandlers(
  service: SquadOwnerInvitationService,
) {
  return {
    listOwnerInvitations,
    inviteOwner,
    replaceOwner,
    revokeOwnerInvitation,
    getInvitationPreview,
    acceptInvitation,
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
