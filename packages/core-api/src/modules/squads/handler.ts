import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TeamIconKey } from '@poolmaster/shared/domain';
import {
  SquadNotFoundError,
  SquadOperationError,
  SquadService,
} from './service';
import { sendError } from '../../core/error-handler';

export function createSquadHandlers(service: SquadService) {
  return {
    listSquads: async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const userId = request.authUser!.userId;
        const squads = await service.listSquads(request.params.id, userId);
        return reply.send({ squads });
      } catch (error) {
        return handleSquadError(reply, error);
      }
    },

    getSquad: async (
      request: FastifyRequest<{ Params: { id: string; squadId: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const userId = request.authUser!.userId;
        const squad = await service.getSquad(request.params.id, request.params.squadId, userId);
        return reply.send({ squad });
      } catch (error) {
        return handleSquadError(reply, error);
      }
    },

    createSquad: async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { name?: string; iconKey?: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const userId = request.authUser!.userId;
        const squad = await service.createSquad(request.params.id, userId, {
          name: request.body?.name,
          iconKey: request.body?.iconKey as TeamIconKey | undefined,
        });
        return reply.code(201).send({ squad });
      } catch (error) {
        return handleSquadError(reply, error);
      }
    },

    updateSquad: async (
      request: FastifyRequest<{
        Params: { id: string; squadId: string };
        Body: { name?: string; iconKey?: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const userId = request.authUser!.userId;
        const squad = await service.updateSquad(
          request.params.id,
          request.params.squadId,
          userId,
          {
            name: request.body?.name,
            iconKey: request.body?.iconKey as TeamIconKey | undefined,
          },
        );
        return reply.send({ squad });
      } catch (error) {
        return handleSquadError(reply, error);
      }
    },

    addOwner: async (
      request: FastifyRequest<{
        Params: { id: string; squadId: string };
        Body: { userId: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const userId = request.authUser!.userId;
        const membership = await service.addOwner(
          request.params.id,
          request.params.squadId,
          userId,
          request.body.userId,
        );
        return reply.code(201).send({ membership });
      } catch (error) {
        return handleSquadError(reply, error);
      }
    },

    removeOwner: async (
      request: FastifyRequest<{
        Params: { id: string; squadId: string; userId: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const actorUserId = request.authUser!.userId;
        const membership = await service.removeOwner(
          request.params.id,
          request.params.squadId,
          actorUserId,
          request.params.userId,
        );
        return reply.send({ membership });
      } catch (error) {
        return handleSquadError(reply, error);
      }
    },
  };
}

function handleSquadError(reply: FastifyReply, error: unknown) {
  if (error instanceof SquadNotFoundError) {
    return sendError(reply, 404, 'SQUAD_NOT_FOUND', error.message);
  }
  if (error instanceof SquadOperationError) {
    return sendError(reply, 400, error.code, error.message);
  }
  throw error;
}
