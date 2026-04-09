/**
 * Invitation route handlers — email invites, invite links, and acceptance.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { InvitationService } from './invitation-service';
import { InvitationInvalidError, InvitationNotFoundError } from './invitation-service';
import { sendError } from '../../core/error-handler';

export function createInvitationHandlers(invitationService: InvitationService) {
  return {
    sendInvitations,
    generateInviteLink,
    revokeInviteLink,
    acceptInvitation,
  };

  async function sendInvitations(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { emails: string[]; message?: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.headers['x-user-id'] as string;
    const result = await invitationService.sendEmailInvitations({
      leagueId: request.params.id,
      emails: request.body.emails,
      invitedBy: userId,
      message: request.body.message,
    });
    return reply.status(201).send(result);
  }

  async function generateInviteLink(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { expiresInDays?: number; maxUses?: number };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.headers['x-user-id'] as string;
    const invitation = await invitationService.generateInviteLink({
      leagueId: request.params.id,
      invitedBy: userId,
      expiresInDays: request.body.expiresInDays,
      maxUses: request.body.maxUses,
    });
    return reply.status(201).send({ invitation });
  }

  async function revokeInviteLink(
    request: FastifyRequest<{ Params: { id: string; code: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      await invitationService.revokeInviteLink(request.params.id, request.params.code);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof InvitationNotFoundError) {
        return sendError(reply, 404, 'NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  async function acceptInvitation(
    request: FastifyRequest<{ Body: { inviteCode: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Missing user identity');
    }
    try {
      const membership = await invitationService.acceptInvitation(
        request.body.inviteCode,
        userId,
      );
      return reply.status(201).send({ membership });
    } catch (err) {
      if (err instanceof InvitationNotFoundError) {
        return sendError(reply, 404, 'NOT_FOUND', err.message);
      }
      if (err instanceof InvitationInvalidError) {
        return sendError(reply, 400, 'BAD_REQUEST', err.message);
      }
      throw err;
    }
  }
}
