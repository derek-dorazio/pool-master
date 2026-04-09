/**
 * Override route handlers — commissioner safety-valve operations.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OverrideService } from './override-service';
import { OverrideError } from './override-service';
import { toContestResponse } from '../../mappers/contests.mapper';

export function createOverrideHandlers(overrideService: OverrideService) {
  return {
    undoPick,
    pauseDraft,
    resumeDraft,
    extendPickClock,
    adjustScore,
    recalculateStandings,
    reopenContest,
    closeContest,
    extendDeadline,
    updateLockTime,
  };

  function handleOverrideError(err: unknown, reply: FastifyReply): void {
    if (err instanceof OverrideError) {
      reply.status(400).send({ error: 'BAD_REQUEST', message: (err as Error).message });
      return;
    }
    throw err;
  }

  async function undoPick(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: { pickId: string; reason: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      await overrideService.undoPick(
        request.params.contestId,
        request.body.pickId,
        request.body.reason,
      );
      return reply.status(204).send();
    } catch (err) {
      handleOverrideError(err, reply);
    }
  }

  async function pauseDraft(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: { reason: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      await overrideService.pauseDraft(request.params.contestId, request.body.reason);
      return reply.status(204).send();
    } catch (err) {
      handleOverrideError(err, reply);
    }
  }

  async function resumeDraft(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      await overrideService.resumeDraft(request.params.contestId);
      return reply.status(204).send();
    } catch (err) {
      handleOverrideError(err, reply);
    }
  }

  async function extendPickClock(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: { additionalSeconds: number };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      await overrideService.extendPickClock(
        request.params.contestId,
        request.body.additionalSeconds,
      );
      return reply.status(204).send();
    } catch (err) {
      handleOverrideError(err, reply);
    }
  }

  async function adjustScore(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: { entryId: string; adjustment: number; reason: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      await overrideService.adjustScore(
        request.params.contestId,
        request.body.entryId,
        request.body.adjustment,
        request.body.reason,
      );
      return reply.status(204).send();
    } catch (err) {
      handleOverrideError(err, reply);
    }
  }

  async function recalculateStandings(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const result = await overrideService.recalculateStandings(
        request.params.contestId,
        '',
      );
      return reply.send(result);
    } catch (err) {
      handleOverrideError(err, reply);
    }
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
        '',
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
        '',
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
        '',
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
        '',
        new Date(request.body.newLock),
        request.body.reason,
      );
      return reply.send(toContestResponse(contest, null));
    } catch (err) {
      handleOverrideError(err, reply);
    }
  }

}
