import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  CreateContestManagementRequest,
  ListContestConfigTemplatesQuery,
  UpdateContestConfigurationRequest,
} from '@poolmaster/shared/dto';
import { createRequestContextLogger } from '../../core/logger';
import { sendError } from '../../core/error-handler';
import {
  ContestManagementError,
  ContestManagementService,
} from './service';

export function createContestManagementHandlers(
  contestManagementService: ContestManagementService,
) {
  return {
    createContest,
    listTemplates,
    getContest,
    updateContestConfiguration,
  };

  async function createContest(
    request: FastifyRequest<{
      Params: { id: string };
      Body: CreateContestManagementRequest;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    logger.debug({
      leagueId: request.params.id,
      sportEventId: request.body.sportEventId,
      contestType: request.body.contestType,
    }, 'contest management create route start');
    try {
      const contest = await contestManagementService.createContest(
        { leagueId: request.params.id },
        request.body,
      );
      logger.info({ contestId: contest.id, leagueId: request.params.id }, 'contest management create route completed');
      return reply.status(201).send({ contest });
    } catch (error) {
      if (error instanceof ContestManagementError) {
        logger.warn({ leagueId: request.params.id, error: error.message }, 'contest management create route rejected');
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      logger.error({ leagueId: request.params.id, err: error }, 'contest management create route failed');
      throw error;
    }
  }

  async function listTemplates(
    request: FastifyRequest<{
      Querystring: ListContestConfigTemplatesQuery;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    logger.debug(request.query, 'contest management list templates route start');
    const templates = await contestManagementService.listTemplates(request.query);
    logger.info({ templateCount: templates.length }, 'contest management list templates route completed');
    return reply.send({ templates });
  }

  async function getContest(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    logger.debug({ contestId: request.params.contestId }, 'contest management get route start');
    try {
      const contest = await contestManagementService.getContest(
        request.params.contestId,
      );
      logger.info({ contestId: request.params.contestId }, 'contest management get route completed');
      return reply.send({ contest });
    } catch (error) {
      if (error instanceof ContestManagementError) {
        logger.warn({ contestId: request.params.contestId, error: error.message }, 'contest management get route rejected');
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      logger.error({ contestId: request.params.contestId, err: error }, 'contest management get route failed');
      throw error;
    }
  }

  async function updateContestConfiguration(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: UpdateContestConfigurationRequest;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    logger.debug({ contestId: request.params.contestId, mode: request.body.mode }, 'contest management update route start');
    try {
      const contest = await contestManagementService.updateContestConfiguration(
        request.params.contestId,
        request.body,
      );
      logger.info({ contestId: request.params.contestId, mode: request.body.mode }, 'contest management update route completed');
      return reply.send({ contest });
    } catch (error) {
      if (error instanceof ContestManagementError) {
        logger.warn({
          contestId: request.params.contestId,
          error: error.message,
          code: error.code,
          statusCode: error.statusCode,
        }, 'contest management update route rejected');
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      logger.error({ contestId: request.params.contestId, err: error }, 'contest management update route failed');
      throw error;
    }
  }
}
