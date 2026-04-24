import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
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
      const logger = request.contextLogger ?? request.log;
      logger.debug({
        action: 'squadRoute.list.enter',
        data: { leagueId: request.params.id, userId: request.authUser?.userId ?? null },
      }, 'Handling list squads request');
      try {
        const userId = request.authUser!.userId;
        const squads = await service.listSquads(
          request.params.id,
          userId,
          request.authUser?.isRootAdmin === true,
        );
        logger.info({
          action: 'squadRoute.list.success',
          data: { leagueId: request.params.id, userId, squadCount: squads.length },
        }, 'Listed squads');
        return reply.send({ squads });
      } catch (error) {
        logHandledSquadError(logger, 'squadRoute.list', request.params.id, error);
        return handleSquadError(reply, error);
      }
    },

    getSquad: async (
      request: FastifyRequest<{ Params: { id: string; squadId: string } }>,
      reply: FastifyReply,
    ) => {
      const logger = request.contextLogger ?? request.log;
      logger.debug({
        action: 'squadRoute.get.enter',
        data: { leagueId: request.params.id, squadId: request.params.squadId, userId: request.authUser?.userId ?? null },
      }, 'Handling get squad request');
      try {
        const userId = request.authUser!.userId;
        const squad = await service.getSquad(
          request.params.id,
          request.params.squadId,
          userId,
          request.authUser?.isRootAdmin === true,
        );
        logger.info({
          action: 'squadRoute.get.success',
          data: { leagueId: request.params.id, squadId: request.params.squadId, userId },
        }, 'Loaded squad');
        return reply.send({ squad });
      } catch (error) {
        logHandledSquadError(logger, 'squadRoute.get', request.params.id, error, {
          squadId: request.params.squadId,
        });
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
      const logger = request.contextLogger ?? request.log;
      logger.debug({
        action: 'squadRoute.create.enter',
        data: {
          leagueId: request.params.id,
          userId: request.authUser?.userId ?? null,
          hasName: Boolean(request.body?.name?.trim()),
          iconKey: request.body?.iconKey ?? null,
        },
      }, 'Handling create squad request');
      try {
        const userId = request.authUser!.userId;
        const squad = await service.createSquad(request.params.id, userId, {
          name: request.body?.name,
          iconKey: request.body?.iconKey as TeamIconKey | undefined,
        });
        logger.info({
          action: 'squadRoute.create.success',
          data: { leagueId: request.params.id, squadId: squad.id, userId },
        }, 'Created squad');
        return reply.code(201).send({ squad });
      } catch (error) {
        logHandledSquadError(logger, 'squadRoute.create', request.params.id, error);
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
      const logger = request.contextLogger ?? request.log;
      logger.debug({
        action: 'squadRoute.update.enter',
        data: {
          leagueId: request.params.id,
          squadId: request.params.squadId,
          userId: request.authUser?.userId ?? null,
          updates: {
            hasName: request.body?.name !== undefined,
            hasIconKey: request.body?.iconKey !== undefined,
          },
        },
      }, 'Handling update squad request');
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
          request.authUser?.isRootAdmin === true,
        );
        logger.info({
          action: 'squadRoute.update.success',
          data: { leagueId: request.params.id, squadId: request.params.squadId, userId },
        }, 'Updated squad');
        return reply.send({ squad });
      } catch (error) {
        logHandledSquadError(logger, 'squadRoute.update', request.params.id, error, {
          squadId: request.params.squadId,
        });
        return handleSquadError(reply, error);
      }
    },

    inactivateSquad: async (
      request: FastifyRequest<{
        Params: { id: string; squadId: string };
      }>,
      reply: FastifyReply,
    ) => {
      const logger = request.contextLogger ?? request.log;
      logger.debug({
        action: 'squadRoute.inactivate.enter',
        data: { leagueId: request.params.id, squadId: request.params.squadId, userId: request.authUser?.userId ?? null },
      }, 'Handling inactivate squad request');
      try {
        const userId = request.authUser!.userId;
        const squad = await service.inactivateSquad(
          request.params.id,
          request.params.squadId,
          userId,
          request.authUser?.isRootAdmin === true,
        );
        logger.info({
          action: 'squadRoute.inactivate.success',
          data: { leagueId: request.params.id, squadId: request.params.squadId, userId },
        }, 'Inactivated squad');
        return reply.send({ squad });
      } catch (error) {
        logHandledSquadError(logger, 'squadRoute.inactivate', request.params.id, error, {
          squadId: request.params.squadId,
        });
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
      const logger = request.contextLogger ?? request.log;
      logger.debug({
        action: 'squadRoute.addOwner.enter',
        data: {
          leagueId: request.params.id,
          squadId: request.params.squadId,
          actorUserId: request.authUser?.userId ?? null,
          targetUserId: request.body.userId,
        },
      }, 'Handling add squad owner request');
      try {
        const userId = request.authUser!.userId;
        const membership = await service.addOwner(
          request.params.id,
          request.params.squadId,
          userId,
          request.body.userId,
          request.authUser?.isRootAdmin === true,
        );
        logger.info({
          action: 'squadRoute.addOwner.success',
          data: { leagueId: request.params.id, squadId: request.params.squadId, actorUserId: userId, targetUserId: request.body.userId },
        }, 'Added squad owner');
        return reply.code(201).send({ membership });
      } catch (error) {
        logHandledSquadError(logger, 'squadRoute.addOwner', request.params.id, error, {
          squadId: request.params.squadId,
          targetUserId: request.body.userId,
        });
        return handleSquadError(reply, error);
      }
    },

    removeOwner: async (
      request: FastifyRequest<{
        Params: { id: string; squadId: string; userId: string };
      }>,
      reply: FastifyReply,
    ) => {
      const logger = request.contextLogger ?? request.log;
      logger.debug({
        action: 'squadRoute.removeOwner.enter',
        data: {
          leagueId: request.params.id,
          squadId: request.params.squadId,
          actorUserId: request.authUser?.userId ?? null,
          targetUserId: request.params.userId,
        },
      }, 'Handling remove squad owner request');
      try {
        const actorUserId = request.authUser!.userId;
        const membership = await service.removeOwner(
          request.params.id,
          request.params.squadId,
          actorUserId,
          request.params.userId,
          request.authUser?.isRootAdmin === true,
        );
        logger.info({
          action: 'squadRoute.removeOwner.success',
          data: { leagueId: request.params.id, squadId: request.params.squadId, actorUserId, targetUserId: request.params.userId },
        }, 'Removed squad owner');
        return reply.send({ membership });
      } catch (error) {
        logHandledSquadError(logger, 'squadRoute.removeOwner', request.params.id, error, {
          squadId: request.params.squadId,
          targetUserId: request.params.userId,
        });
        return handleSquadError(reply, error);
      }
    },
  };
}

function logHandledSquadError(
  logger: FastifyBaseLogger,
  action: string,
  leagueId: string,
  error: unknown,
  data: Record<string, unknown> = {},
) {
  if (error instanceof SquadNotFoundError) {
    logger.warn({
      action,
      data: { leagueId, ...data },
      errorName: error.name,
    }, 'Squad route resolved to not-found branch');
    return;
  }

  if (error instanceof SquadOperationError) {
    logger.warn({
      action,
      data: { leagueId, ...data, errorCode: error.code },
      errorName: error.name,
    }, 'Squad route resolved to expected invalid-operation branch');
  }
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
