import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  CreateContestManagementRequest,
  UpdateContestConfigurationRequest,
} from '@poolmaster/shared/dto';
import {
  ContestManagementError,
  ContestManagementService,
} from './service';

export function createContestManagementHandlers(
  contestManagementService: ContestManagementService,
) {
  return {
    createContest,
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
        return reply.status(422).send({
          error: 'CONTEST_CONFIGURATION_INVALID',
          message: error.message,
        });
      }
      throw error;
    }
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
        return reply.status(404).send({
          error: 'CONTEST_NOT_FOUND',
          message: error.message,
        });
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
        return reply.status(isNotFound ? 404 : 422).send({
          error: isNotFound
            ? 'CONTEST_NOT_FOUND'
            : 'CONTEST_CONFIGURATION_INVALID',
          message: error.message,
        });
      }
      throw error;
    }
  }
}
