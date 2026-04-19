import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  CreateContestManagementRequest,
  ListContestConfigTemplatesQuery,
  UpdateContestConfigurationRequest,
} from '@poolmaster/shared/dto';
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
    try {
      const contest = await contestManagementService.createContest(
        { leagueId: request.params.id },
        request.body,
      );
      return reply.status(201).send({ contest });
    } catch (error) {
      if (error instanceof ContestManagementError) {
        return sendError(reply, 422, 'CONTEST_CONFIGURATION_INVALID', error.message);
      }
      throw error;
    }
  }

  async function listTemplates(
    request: FastifyRequest<{
      Querystring: ListContestConfigTemplatesQuery;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const templates = await contestManagementService.listTemplates(request.query);
    return reply.send({ templates });
  }

  async function getContest(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const contest = await contestManagementService.getContest(
        request.params.contestId,
      );
      return reply.send({ contest });
    } catch (error) {
      if (error instanceof ContestManagementError) {
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', error.message);
      }
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
    try {
      const contest = await contestManagementService.updateContestConfiguration(
        request.params.contestId,
        request.body,
      );
      return reply.send({ contest });
    } catch (error) {
      if (error instanceof ContestManagementError) {
        const isNotFound = error.message.includes('not found');
        return sendError(
          reply,
          isNotFound ? 404 : 422,
          isNotFound ? 'CONTEST_NOT_FOUND' : 'CONTEST_CONFIGURATION_INVALID',
          error.message,
        );
      }
      throw error;
    }
  }
}
