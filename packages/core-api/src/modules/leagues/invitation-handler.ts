/**
 * Invitation route handlers — email invites, invite links, and acceptance.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { InvitationService, SendInvitationsResult } from './invitation-service';
import {
  InvitationEmailDeliveryError,
  InvitationInvalidError,
  InvitationNotFoundError,
} from './invitation-service';
import { sendError } from '../../core/error-handler';

export function createInvitationHandlers(invitationService: InvitationService) {
  return {
    getInvitationPreview,
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
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueInvitationRoute.sendEmail.enter',
      data: {
        leagueId: request.params.id,
        userId: request.authUser?.userId ?? null,
        emailCount: request.body.emails.length,
        hasMessage: Boolean(request.body.message?.trim()),
      },
    }, 'Handling send league invitations request');
    const userId = request.authUser?.userId as string;
    let result: SendInvitationsResult;
    try {
      result = await invitationService.sendEmailInvitations({
        leagueId: request.params.id,
        emails: request.body.emails,
        invitedBy: userId,
        message: request.body.message,
      });
    } catch (err) {
      if (err instanceof InvitationEmailDeliveryError) {
        logger.error({
          action: 'leagueInvitationRoute.sendEmail.deliveryFailure',
          data: {
            leagueId: request.params.id,
            userId,
            invitationId: err.invitationId,
          },
        }, 'League invitation record was created but email delivery failed');
        return sendError(
          reply,
          502,
          'LEAGUE_INVITATION_EMAIL_DELIVERY_FAILED',
          'Invitation email delivery failed. Please try again or use the join URL.',
        );
      }
      throw err;
    }
    logger.info({
      action: 'leagueInvitationRoute.sendEmail.success',
      data: {
        leagueId: request.params.id,
        userId,
        sentCount: result.sent.length,
        skippedDuplicateCount: result.skippedDuplicates.length,
        skippedMemberCount: result.skippedMembers.length,
      },
    }, 'Sent league invitations');
    return reply.status(201).send(result);
  }

  async function generateInviteLink(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { expiresInDays?: number; maxUses?: number };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueInvitationRoute.generateLink.enter',
      data: {
        leagueId: request.params.id,
        userId: request.authUser?.userId ?? null,
        expiresInDays: request.body.expiresInDays ?? null,
        maxUses: request.body.maxUses ?? 0,
      },
    }, 'Handling generate league invite link request');
    const userId = request.authUser?.userId as string;
    const invitation = await invitationService.generateInviteLink({
      leagueId: request.params.id,
      invitedBy: userId,
      expiresInDays: request.body.expiresInDays,
      maxUses: request.body.maxUses,
    });
    logger.info({
      action: 'leagueInvitationRoute.generateLink.success',
      data: {
        leagueId: request.params.id,
        invitationId: invitation.id,
        maxUses: invitation.maxUses,
      },
    }, 'Generated league invite link');
    return reply.status(201).send({ invitation });
  }

  async function revokeInviteLink(
    request: FastifyRequest<{ Params: { id: string; code: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueInvitationRoute.revoke.enter',
      data: { leagueId: request.params.id, inviteCodeLength: request.params.code.length },
    }, 'Handling revoke league invite link request');
    try {
      await invitationService.revokeInviteLink(request.params.id, request.params.code);
      logger.info({
        action: 'leagueInvitationRoute.revoke.success',
        data: { leagueId: request.params.id },
      }, 'Revoked league invite link');
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof InvitationNotFoundError) {
        logger.warn({
          action: 'leagueInvitationRoute.revoke.notFound',
          data: { leagueId: request.params.id, inviteCodeLength: request.params.code.length },
        }, 'Cannot revoke missing league invitation');
        return sendError(reply, 404, 'LEAGUE_INVITATION_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  async function acceptInvitation(
    request: FastifyRequest<{ Body: { inviteCode: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueInvitationRoute.accept.enter',
      data: { userId: request.authUser?.userId ?? null, inviteCodeLength: request.body.inviteCode.length },
    }, 'Handling accept invitation request');
    const userId = request.authUser?.userId;
    if (!userId) {
      logger.warn({
        action: 'leagueInvitationRoute.accept.unauthenticated',
      }, 'Rejected accept invitation request without authenticated session');
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }
    try {
      const membership = await invitationService.acceptInvitation(
        request.body.inviteCode,
        userId,
      );
      logger.info({
        action: 'leagueInvitationRoute.accept.success',
        data: { userId, leagueId: membership.leagueId },
      }, 'Accepted league invitation');
      return reply.status(201).send({ membership });
    } catch (err) {
      if (err instanceof InvitationNotFoundError) {
        logger.warn({
          action: 'leagueInvitationRoute.accept.notFound',
          data: { userId, inviteCodeLength: request.body.inviteCode.length },
        }, 'Cannot accept missing invitation');
        return sendError(reply, 404, 'LEAGUE_INVITATION_NOT_FOUND', err.message);
      }
      if (err instanceof InvitationInvalidError) {
        logger.warn({
          action: 'leagueInvitationRoute.accept.invalid',
          data: { userId, errorCode: err.code },
        }, 'Rejected league invitation acceptance');
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
  }

  async function getInvitationPreview(
    request: FastifyRequest<{ Params: { inviteCode: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueInvitationRoute.preview.enter',
      data: { inviteCodeLength: request.params.inviteCode.length },
    }, 'Handling invitation preview request');
    try {
      const invitation = await invitationService.getInvitationPreview(request.params.inviteCode);
      logger.info({
        action: 'leagueInvitationRoute.preview.success',
        data: { leagueId: invitation.league.id, status: invitation.status },
      }, 'Loaded invitation preview');
      return reply.send({ invitation });
    } catch (err) {
      if (err instanceof InvitationNotFoundError) {
        logger.warn({
          action: 'leagueInvitationRoute.preview.notFound',
          data: { inviteCodeLength: request.params.inviteCode.length },
        }, 'Cannot preview missing invitation');
        return sendError(reply, 404, 'LEAGUE_INVITATION_NOT_FOUND', err.message);
      }
      if (err instanceof InvitationInvalidError) {
        logger.warn({
          action: 'leagueInvitationRoute.preview.invalid',
          data: { errorCode: err.code },
        }, 'Rejected invitation preview');
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
  }
}
