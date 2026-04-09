import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  SquadNotFoundError,
  SquadOperationError,
  SquadService,
} from './service';

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
        Body: { name?: string; iconUrl?: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const userId = request.authUser!.userId;
        const squad = await service.createSquad(request.params.id, userId, request.body ?? {});
        return reply.code(201).send({ squad });
      } catch (error) {
        return handleSquadError(reply, error);
      }
    },

    updateSquad: async (
      request: FastifyRequest<{
        Params: { id: string; squadId: string };
        Body: { name?: string; iconUrl?: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const userId = request.authUser!.userId;
        const squad = await service.updateSquad(
          request.params.id,
          request.params.squadId,
          userId,
          request.body ?? {},
        );
        return reply.send({ squad });
      } catch (error) {
        return handleSquadError(reply, error);
      }
    },

    addCoManager: async (
      request: FastifyRequest<{
        Params: { id: string; squadId: string };
        Body: { userId: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const userId = request.authUser!.userId;
        const membership = await service.addCoManager(
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

    removeCoManager: async (
      request: FastifyRequest<{
        Params: { id: string; squadId: string; userId: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const actorUserId = request.authUser!.userId;
        const membership = await service.removeCoManager(
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
    return reply.code(404).send({ error: error.message });
  }
  if (error instanceof SquadOperationError) {
    return reply.code(400).send({ error: error.message });
  }
  throw error;
}
