/**
 * Migration route handlers — request/response layer for the migration runner.
 *
 * Allows admins to list available migrations, start runs, check progress,
 * and cancel running migrations.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  toMigrationListResponse,
  toMigrationRunResponse,
} from '../../mappers/admin-migration.mapper';
import type { MigrationService, StartMigrationInput } from './migration-service';
import {
  AdminUserNotFoundError,
  MigrationNotFoundError,
  MigrationRunNotFoundError,
  MigrationAlreadyRunningError,
} from './migration-service';

// ---------------------------------------------------------------------------
// Admin context helper
// ---------------------------------------------------------------------------

interface AdminContext {
  adminUserId: string;
  adminUserEmail: string;
}

function extractAdminContext(request: FastifyRequest): AdminContext {
  const adminUserId = request.headers['x-admin-user-id'] as string ?? '';
  const adminUserEmail = request.headers['x-admin-user-email'] as string ?? '';
  return { adminUserId, adminUserEmail };
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createMigrationHandlers(service: MigrationService) {
  return {
    listMigrations,
    startRun,
    getRunDetail,
    cancelRun,
  };

  // --- List available migrations ---

  async function listMigrations(
    _request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const data = await service.listMigrations();
    return reply.send(toMigrationListResponse(data));
  }

  // --- Start a migration run ---

  async function startRun(
    request: FastifyRequest<{ Body: StartMigrationInput }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);

    try {
      const run = await service.startRun(request.body, adminUserId, adminUserEmail);
      return reply.status(201).send(toMigrationRunResponse(run));
    } catch (err) {
      if (err instanceof MigrationNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof MigrationAlreadyRunningError) {
        return reply.status(409).send({ error: 'ALREADY_RUNNING', message: err.message });
      }
      if (err instanceof AdminUserNotFoundError) {
        return reply.status(403).send({ error: 'FORBIDDEN', message: err.message });
      }
      throw err;
    }
  }

  // --- Get migration run detail ---

  async function getRunDetail(
    request: FastifyRequest<{ Params: { runId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const run = await service.getRunDetail(request.params.runId);
      return reply.send(toMigrationRunResponse(run));
    } catch (err) {
      if (err instanceof MigrationRunNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Cancel a migration run ---

  async function cancelRun(
    request: FastifyRequest<{ Params: { runId: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);

    try {
      const run = await service.cancelRun(
        request.params.runId,
        adminUserId,
        adminUserEmail,
      );
      return reply.send(toMigrationRunResponse(run));
    } catch (err) {
      if (err instanceof MigrationRunNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof AdminUserNotFoundError) {
        return reply.status(403).send({ error: 'FORBIDDEN', message: err.message });
      }
      throw err;
    }
  }
}
