/**
 * Member management route handlers — role changes and member lifecycle.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ChangeLeagueMemberRoleRequest } from '@poolmaster/shared/dto';
import type { MemberService } from './member-service';
import type { MemberDirectoryService } from './member-directory-service';
import { MemberNotFoundError, MemberOperationError } from './member-service';
import { mapLeagueMembershipToDto } from '../../mappers';
import { sendError } from '../../core/error-handler';

export function createMemberHandlers(
  memberService: MemberService,
  memberDirectoryService: MemberDirectoryService,
) {
  return {
    listMembers,
    changeRole,
    removeMember,
    leaveLeague,
  };

  async function listMembers(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueMemberRoute.list.enter',
      data: { leagueId: request.params.id },
    }, 'Handling list league members request');
    const members = await memberDirectoryService.listMembers(request.params.id);
    logger.info({
      action: 'leagueMemberRoute.list.success',
      data: { leagueId: request.params.id, memberCount: members.length },
    }, 'Listed league members');
    return reply.send({ members });
  }

  async function changeRole(
    request: FastifyRequest<{
      Params: { id: string; uid: string };
      Body: ChangeLeagueMemberRoleRequest;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueMemberRoute.changeRole.enter',
      data: { leagueId: request.params.id, targetUserId: request.params.uid, newRole: request.body.role },
    }, 'Handling change league member role request');
    try {
      const membership = await memberService.changeRole({
        leagueId: request.params.id,
        targetUserId: request.params.uid,
        newRole: request.body.role as Parameters<MemberService['changeRole']>[0]['newRole'],
      });
      logger.info({
        action: 'leagueMemberRoute.changeRole.success',
        data: { leagueId: request.params.id, targetUserId: request.params.uid, newRole: request.body.role },
      }, 'Changed league member role');
      return reply.send({ membership: mapLeagueMembershipToDto(membership) });
    } catch (err) {
      if (err instanceof MemberNotFoundError) {
        logger.warn({
          action: 'leagueMemberRoute.changeRole.notFound',
          data: { leagueId: request.params.id, targetUserId: request.params.uid },
        }, 'Cannot change role for missing league member');
        return sendError(reply, 404, 'LEAGUE_MEMBER_NOT_FOUND', err.message);
      }
      if (err instanceof MemberOperationError) {
        logger.warn({
          action: 'leagueMemberRoute.changeRole.invalid',
          data: { leagueId: request.params.id, targetUserId: request.params.uid, errorCode: err.code },
        }, 'Rejected league member role change');
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
  }

  async function removeMember(
    request: FastifyRequest<{ Params: { id: string; uid: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueMemberRoute.remove.enter',
      data: { leagueId: request.params.id, targetUserId: request.params.uid },
    }, 'Handling remove league member request');
    try {
      await memberService.removeMember(request.params.id, request.params.uid);
      logger.info({
        action: 'leagueMemberRoute.remove.success',
        data: { leagueId: request.params.id, targetUserId: request.params.uid },
      }, 'Removed league member');
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof MemberNotFoundError) {
        logger.warn({
          action: 'leagueMemberRoute.remove.notFound',
          data: { leagueId: request.params.id, targetUserId: request.params.uid },
        }, 'Cannot remove missing league member');
        return sendError(reply, 404, 'LEAGUE_MEMBER_NOT_FOUND', err.message);
      }
      if (err instanceof MemberOperationError) {
        logger.warn({
          action: 'leagueMemberRoute.remove.invalid',
          data: { leagueId: request.params.id, targetUserId: request.params.uid, errorCode: err.code },
        }, 'Rejected league member removal');
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
  }

  async function leaveLeague(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueMemberRoute.leave.enter',
      data: { leagueId: request.params.id, userId: request.authUser?.userId ?? null },
    }, 'Handling leave league request');
    const userId = request.authUser?.userId;
    if (!userId) {
      logger.warn({
        action: 'leagueMemberRoute.leave.unauthenticated',
      }, 'Rejected leave league request without authenticated session');
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }

    try {
      await memberService.removeMember(request.params.id, userId);
      logger.info({
        action: 'leagueMemberRoute.leave.success',
        data: { leagueId: request.params.id, userId },
      }, 'Left league');
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof MemberNotFoundError) {
        logger.warn({
          action: 'leagueMemberRoute.leave.notFound',
          data: { leagueId: request.params.id, userId },
        }, 'Cannot leave missing league membership');
        return sendError(reply, 404, 'LEAGUE_MEMBER_NOT_FOUND', err.message);
      }
      if (err instanceof MemberOperationError) {
        logger.warn({
          action: 'leagueMemberRoute.leave.invalid',
          data: { leagueId: request.params.id, userId, errorCode: err.code },
        }, 'Rejected leave league request');
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
  }
}
