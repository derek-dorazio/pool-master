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
    const members = await memberDirectoryService.listMembers(request.params.id);
    return reply.send({ members });
  }

  async function changeRole(
    request: FastifyRequest<{
      Params: { id: string; uid: string };
      Body: ChangeLeagueMemberRoleRequest;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const membership = await memberService.changeRole({
        leagueId: request.params.id,
        targetUserId: request.params.uid,
        newRole: request.body.role as Parameters<MemberService['changeRole']>[0]['newRole'],
        permissions: request.body.permissions as Parameters<MemberService['changeRole']>[0]['permissions'],
      });
      return reply.send({ membership: mapLeagueMembershipToDto(membership) });
    } catch (err) {
      if (err instanceof MemberNotFoundError) {
        return sendError(reply, 404, 'LEAGUE_MEMBER_NOT_FOUND', err.message);
      }
      if (err instanceof MemberOperationError) {
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
  }

  async function removeMember(
    request: FastifyRequest<{ Params: { id: string; uid: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      await memberService.removeMember(request.params.id, request.params.uid);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof MemberNotFoundError) {
        return sendError(reply, 404, 'LEAGUE_MEMBER_NOT_FOUND', err.message);
      }
      if (err instanceof MemberOperationError) {
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
  }

  async function leaveLeague(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.authUser?.userId;
    if (!userId) {
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }

    try {
      await memberService.removeMember(request.params.id, userId);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof MemberNotFoundError) {
        return sendError(reply, 404, 'LEAGUE_MEMBER_NOT_FOUND', err.message);
      }
      if (err instanceof MemberOperationError) {
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
  }
}
