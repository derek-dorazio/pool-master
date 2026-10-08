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
import type { UserRepository } from '@poolmaster/shared/db';
import type { LeagueInvitation } from '@poolmaster/shared/domain';
import {
  mapLeagueInvitationToDto,
  mapLeagueMembershipToDto,
} from '../../mappers/leagues-extra.mapper';

export function createInvitationHandlers(
  invitationService: InvitationService,
  userRepo: UserRepository,
) {
  return {
    getInvitationPreview,
    listInvitations,
    resendInvitation,
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
      if (err instanceof InvitationInvalidError) {
        logger.warn({
          action: 'leagueInvitationRoute.sendEmail.invalid',
          data: { leagueId: request.params.id, userId, errorCode: err.code },
        }, 'Rejected send league invitations request');
        return sendError(reply, 400, err.code, err.message);
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

  async function listInvitations(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueInvitationRoute.list.enter',
      data: { leagueId: request.params.id, userId: request.authUser?.userId ?? null },
    }, 'Handling list league invitations request');
    const invitations = await invitationService.listOutstandingInvitations(request.params.id);
    logger.info({
      action: 'leagueInvitationRoute.list.success',
      data: { leagueId: request.params.id, invitationCount: invitations.length },
    }, 'Listed league invitations');
    return reply.send({ invitations: invitations.map(mapLeagueInvitationToDto) });
  }

  async function resendInvitation(
    request: FastifyRequest<{ Params: { id: string; invitationId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    const userId = request.authUser?.userId as string;
    logger.debug({
      action: 'leagueInvitationRoute.resend.enter',
      data: { leagueId: request.params.id, invitationId: request.params.invitationId, userId },
    }, 'Handling resend league invitation request');
    try {
      const invitation = await invitationService.resendEmailInvitation(
        request.params.id,
        request.params.invitationId,
        userId,
      );
      logger.info({
        action: 'leagueInvitationRoute.resend.success',
        data: { leagueId: request.params.id, invitationId: invitation.id },
      }, 'Resent league invitation');
      return reply.send({ invitation: mapLeagueInvitationToDto(invitation) });
    } catch (err) {
      if (err instanceof InvitationNotFoundError) {
        logger.warn({
          action: 'leagueInvitationRoute.resend.notFound',
          data: { leagueId: request.params.id, invitationId: request.params.invitationId },
        }, 'Cannot resend missing league invitation');
        return sendError(reply, 404, 'LEAGUE_INVITATION_NOT_FOUND', err.message);
      }
      if (err instanceof InvitationInvalidError) {
        logger.warn({
          action: 'leagueInvitationRoute.resend.invalid',
          data: { leagueId: request.params.id, errorCode: err.code },
        }, 'Rejected league invitation resend');
        return sendError(reply, 409, err.code, err.message);
      }
      if (err instanceof InvitationEmailDeliveryError) {
        logger.error({
          action: 'leagueInvitationRoute.resend.deliveryFailure',
          data: { leagueId: request.params.id, invitationId: err.invitationId },
        }, 'League invitation was renewed but email delivery failed');
        return sendError(
          reply,
          502,
          'LEAGUE_INVITATION_EMAIL_DELIVERY_FAILED',
          'Invitation email delivery failed. Please try again or use the join URL.',
        );
      }
      throw err;
    }
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
    let invitation: LeagueInvitation;
    try {
      invitation = await invitationService.generateInviteLink({
        leagueId: request.params.id,
        invitedBy: userId,
        expiresInDays: request.body.expiresInDays,
        maxUses: request.body.maxUses,
      });
    } catch (err) {
      if (err instanceof InvitationInvalidError) {
        logger.warn({
          action: 'leagueInvitationRoute.generateLink.invalid',
          data: { leagueId: request.params.id, userId, errorCode: err.code },
        }, 'Rejected generate league invite link request');
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
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
      if (err instanceof InvitationInvalidError) {
        logger.warn({
          action: 'leagueInvitationRoute.revoke.notCancellable',
          data: { leagueId: request.params.id, code: err.code },
        }, 'Cannot cancel a settled league invitation');
        return sendError(reply, 409, err.code, err.message);
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
      // #202 step 3.4 — mapped, not sent raw. This used to `send({ membership })` with the
      // domain object and let the serializer decide what came out, which is the
      // "contract enforced only at runtime" pattern: `LeagueMembershipResponse` was a
      // registered component with nothing type-checked against it.
      const member = await userRepo.findById(userId);
      if (!member) {
        return sendError(reply, 404, 'USER_NOT_FOUND', `User not found: ${userId}`);
      }
      return reply.status(201).send({ membership: mapLeagueMembershipToDto(membership, member) });
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
