/**
 * Override route handlers — commissioner safety-valve operations.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OverrideService } from './override-service';
import { OverrideError } from './override-service';
import { toContestResponse } from '../../mappers/contests.mapper';
import { sendError } from '../../core/error-handler';

export function createOverrideHandlers(overrideService: OverrideService) {
  return {
    reopenContest,
    closeContest,
    extendDeadline,
    updateLockTime,
  };

  function handleOverrideError(err: unknown, reply: FastifyReply): void {
    if (err instanceof OverrideError) {
      const statusCode = err.code.endsWith('_NOT_FOUND') ? 404 : 400;
      sendError(reply, statusCode, err.code, err.message);
      return;
    }
    throw err;
  }

  async function reopenContest(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: { reason: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const contest = await overrideService.reopenContest(
        request.params.contestId,
        request.body.reason,
      );
      return reply.send(toContestResponse(contest, null));
    } catch (err) {
      handleOverrideError(err, reply);
    }
  }

  async function closeContest(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: { reason: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const contest = await overrideService.closeContest(
        request.params.contestId,
        request.body.reason,
      );
      return reply.send(toContestResponse(contest, null));
    } catch (err) {
      handleOverrideError(err, reply);
    }
  }

  async function extendDeadline(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: { newEnd: string; reason: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const contest = await overrideService.extendDeadline(
        request.params.contestId,
        new Date(request.body.newEnd),
        request.body.reason,
      );
      return reply.send(toContestResponse(contest, null));
    } catch (err) {
      handleOverrideError(err, reply);
    }
  }

  async function updateLockTime(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: { newLock: string; reason: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const contest = await overrideService.updateLockTime(
        request.params.contestId,
        new Date(request.body.newLock),
        request.body.reason,
      );
      return reply.send(toContestResponse(contest, null));
    } catch (err) {
      handleOverrideError(err, reply);
    }
  }

}
