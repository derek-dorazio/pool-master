/**
 * Member management route handlers — role changes, removal, ownership transfer.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MemberService } from './member-service';
import type { MemberDirectoryService } from './member-directory-service';
import { MemberNotFoundError, MemberOperationError } from './member-service';
import { mapLeagueMembershipToDto } from '../../mappers';

export function createMemberHandlers(
  memberService: MemberService,
  memberDirectoryService: MemberDirectoryService,
) {
  return {
    listMembers,
    changeRole,
    removeMember,
    leaveLeague,
    transferOwnership,
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
      Body: { role: string; permissions?: string[] };
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
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof MemberOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
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
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof MemberOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }

  async function leaveLeague(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.headers['x-user-id'] as string | undefined;
    if (!userId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
    }

    try {
      await memberService.removeMember(request.params.id, userId);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof MemberNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof MemberOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }

  async function transferOwnership(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { newOwnerId: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
    }
    try {
      const result = await memberService.transferOwnership(
        request.params.id,
        userId,
        request.body.newOwnerId,
      );
      return reply.send({
        previousOwner: mapLeagueMembershipToDto(result.previousOwner),
        newOwner: mapLeagueMembershipToDto(result.newOwner),
      });
    } catch (err) {
      if (err instanceof MemberNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof MemberOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }
}
