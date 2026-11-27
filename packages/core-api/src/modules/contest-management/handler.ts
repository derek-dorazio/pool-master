import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ContestConfigurationRequest, SetContestCoverageRequest, SetContestCupWeightRequest } from '@poolmaster/shared/dto';
import { createRequestContextLogger } from '../../core/logger';
import { sendError } from '../../core/error-handler';
import {
  ContestManagementError,
  type ContestManagementService,
} from './service';

export function createContestManagementHandlers(
  contestManagementService: ContestManagementService,
) {
  return {
    getContest,
    updateContestConfiguration,
    openContest,
    setContestCupWeight,
    setContestCoverage,
  };

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
      Body: ContestConfigurationRequest;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    logger.debug({ contestId: request.params.contestId }, 'contest management update route start');
    try {
      const contest = await contestManagementService.updateContestConfiguration(
        request.params.contestId,
        request.body,
      );
      logger.info({ contestId: request.params.contestId }, 'contest management update route completed');
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

  async function openContest(
    request: FastifyRequest<{ Params: { id: string; contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    logger.debug({ contestId: request.params.contestId }, 'contest management open route start');
    try {
      const contest = await contestManagementService.openContest(
        request.params.id,
        request.params.contestId,
      );
      logger.info({ contestId: request.params.contestId }, 'contest management open route completed');
      return reply.send({ contest });
    } catch (error) {
      if (error instanceof ContestManagementError) {
        logger.warn({
          contestId: request.params.contestId,
          error: error.message,
          code: error.code,
          statusCode: error.statusCode,
        }, 'contest management open route rejected');
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      logger.error({ contestId: request.params.contestId, err: error }, 'contest management open route failed');
      throw error;
    }
  }

  async function setContestCoverage(
    request: FastifyRequest<{
      Params: { id: string; contestId: string };
      Body: SetContestCoverageRequest;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    logger.debug({ contestId: request.params.contestId }, 'contest management set coverage route start');
    try {
      const contest = await contestManagementService.setContestCoverage(
        request.params.id,
        request.params.contestId,
        request.body,
      );
      logger.info({ contestId: request.params.contestId, sportEventCount: contest.sportEvents.length }, 'contest management set coverage route completed');
      return reply.send({ contest });
    } catch (error) {
      if (error instanceof ContestManagementError) {
        logger.warn({
          contestId: request.params.contestId,
          error: error.message,
          code: error.code,
          statusCode: error.statusCode,
        }, 'contest management set coverage route rejected');
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      logger.error({ contestId: request.params.contestId, err: error }, 'contest management set coverage route failed');
      throw error;
    }
  }

  async function setContestCupWeight(
    request: FastifyRequest<{
      Params: { id: string; contestId: string };
      Body: SetContestCupWeightRequest;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    logger.debug({ contestId: request.params.contestId, cupWeight: request.body.cupWeight }, 'contest management set cup weight route start');
    try {
      const contest = await contestManagementService.setContestCupWeight(
        request.params.id,
        request.params.contestId,
        request.body.cupWeight,
      );
      logger.info({ contestId: request.params.contestId }, 'contest management set cup weight route completed');
      return reply.send({ contest });
    } catch (error) {
      if (error instanceof ContestManagementError) {
        logger.warn({
          contestId: request.params.contestId,
          error: error.message,
          code: error.code,
          statusCode: error.statusCode,
        }, 'contest management set cup weight route rejected');
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      logger.error({ contestId: request.params.contestId, err: error }, 'contest management set cup weight route failed');
      throw error;
    }
  }
}
