/**
 * Contest pool route handlers — pool CRUD, resolution, locking, and withdrawal handling.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ContestPoolService } from './pool-service';
import {
  PoolNotFoundError,
  PoolAlreadyExistsError,
  PoolLockedError,
  PoolAlreadyLockedError,
  PoolEmptyError,
  PoolEventMatchupsUnavailableError,
  PoolEventNotFoundError,
  PoolEventParticipantsUnavailableError,
  PoolEventRequiredError,
  ParticipantNotInPoolError,
} from './pool-service';
import type { PoolType, Sport } from '@poolmaster/shared/domain';

export function createPoolHandlers(poolService: ContestPoolService) {
  return {
    createPool,
    getPool,
    updatePool,
    resolvePool,
    refreshPool,
    lockPool,
    excludeParticipant,
    removeExclusion,
    markUnavailable,
    markAvailable,
  };

  async function createPool(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: {
        sport: string;
        poolType: string;
        eventId?: string;
        config?: Record<string, unknown>;
      };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const pool = await poolService.createPool({
        contestId: request.params.contestId,
        sport: request.body.sport as Sport,
        poolType: request.body.poolType as PoolType,
        eventId: request.body.eventId,
        config: request.body.config as Parameters<typeof poolService.createPool>[0]['config'],
      });
      return reply.status(201).send({ pool });
    } catch (err) {
      if (err instanceof PoolAlreadyExistsError) {
        return reply.status(409).send({ error: 'POOL_ALREADY_EXISTS', message: err.message });
      }
      throw err;
    }
  }

  async function getPool(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const result = await poolService.getPoolWithParticipants(request.params.contestId);
    if (!result) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Pool not found' });
    }
    return reply.send(result);
  }

  async function updatePool(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: Record<string, unknown>;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const pool = await poolService.updatePool(request.params.contestId, request.body);
      return reply.send({ pool });
    } catch (err) {
      return handlePoolError(err, reply);
    }
  }

  async function resolvePool(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const result = await poolService.resolvePool(request.params.contestId);
      return reply.send({ pool: result.pool, participantCount: result.count });
    } catch (err) {
      return handlePoolError(err, reply);
    }
  }

  async function refreshPool(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const result = await poolService.refreshPool(request.params.contestId);
      return reply.send({ pool: result.pool, participantCount: result.count });
    } catch (err) {
      return handlePoolError(err, reply);
    }
  }

  async function lockPool(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const pool = await poolService.lockPool(request.params.contestId);
      return reply.send({ pool });
    } catch (err) {
      return handlePoolError(err, reply);
    }
  }

  async function excludeParticipant(
    request: FastifyRequest<{ Params: { contestId: string; participantId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const pool = await poolService.excludeParticipant(
        request.params.contestId,
        request.params.participantId,
      );
      return reply.send({ pool });
    } catch (err) {
      return handlePoolError(err, reply);
    }
  }

  async function removeExclusion(
    request: FastifyRequest<{ Params: { contestId: string; participantId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const pool = await poolService.removeExclusion(
        request.params.contestId,
        request.params.participantId,
      );
      return reply.send({ pool });
    } catch (err) {
      return handlePoolError(err, reply);
    }
  }

  async function markUnavailable(
    request: FastifyRequest<{
      Params: { contestId: string; participantId: string };
      Body: { reason: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const entry = await poolService.markUnavailable(
        request.params.contestId,
        request.params.participantId,
        request.body.reason,
      );
      return reply.send({ participant: entry });
    } catch (err) {
      return handlePoolError(err, reply);
    }
  }

  async function markAvailable(
    request: FastifyRequest<{ Params: { contestId: string; participantId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const entry = await poolService.markAvailable(
        request.params.contestId,
        request.params.participantId,
      );
      return reply.send({ participant: entry });
    } catch (err) {
      return handlePoolError(err, reply);
    }
  }
}

function handlePoolError(err: unknown, reply: FastifyReply): void {
  if (err instanceof PoolNotFoundError) {
    reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
    return;
  }
  if (err instanceof PoolLockedError || err instanceof PoolAlreadyLockedError) {
    reply.status(409).send({ error: 'POOL_LOCKED', message: err.message });
    return;
  }
  if (err instanceof PoolEmptyError) {
    reply.status(422).send({ error: 'POOL_EMPTY', message: err.message });
    return;
  }
  if (err instanceof PoolEventRequiredError) {
    reply.status(422).send({ error: 'POOL_EVENT_REQUIRED', message: err.message });
    return;
  }
  if (err instanceof PoolEventNotFoundError) {
    reply.status(404).send({ error: 'POOL_EVENT_NOT_FOUND', message: err.message });
    return;
  }
  if (err instanceof PoolEventParticipantsUnavailableError) {
    reply.status(422).send({ error: 'POOL_EVENT_PARTICIPANTS_UNAVAILABLE', message: err.message });
    return;
  }
  if (err instanceof PoolEventMatchupsUnavailableError) {
    reply.status(422).send({ error: 'POOL_EVENT_MATCHUPS_UNAVAILABLE', message: err.message });
    return;
  }
  if (err instanceof ParticipantNotInPoolError) {
    reply.status(404).send({ error: 'PARTICIPANT_NOT_IN_POOL', message: err.message });
    return;
  }
  throw err;
}
