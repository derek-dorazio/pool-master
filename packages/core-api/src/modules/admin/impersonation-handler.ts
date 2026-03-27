/**
 * Impersonation route handlers — request/response layer for admin impersonation.
 *
 * Allows admins to start, end, and query impersonation sessions.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ImpersonationService } from './impersonation-service';
import { NoActiveSessionError } from './impersonation-service';

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

export function createImpersonationHandlers(service: ImpersonationService) {
  return {
    startSession,
    endSession,
    getActiveSession,
  };

  // --- Start impersonation ---

  async function startSession(
    request: FastifyRequest<{ Body: { tenantId: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { tenantId } = request.body;

    const session = await service.startSession(tenantId, adminUserId, adminUserEmail);
    return reply.status(201).send(session);
  }

  // --- End impersonation ---

  async function endSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);

    try {
      await service.endSession(adminUserId, adminUserEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof NoActiveSessionError) {
        return reply.status(404).send({ error: 'NO_ACTIVE_SESSION', message: err.message });
      }
      throw err;
    }
  }

  // --- Get active session ---

  async function getActiveSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const { adminUserId } = extractAdminContext(request);
    const session = await service.getActiveSession(adminUserId);

    if (!session) {
      return reply.send({ active: false, session: null });
    }

    return reply.send({ active: true, session });
  }
}
