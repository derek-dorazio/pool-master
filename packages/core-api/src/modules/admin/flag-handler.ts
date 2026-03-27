/**
 * Feature flag admin route handlers — request/response layer for feature
 * flag management.
 *
 * Each handler extracts params, query, and body from the request, delegates
 * to FlagService for business logic, and returns the appropriate response.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FlagService } from './flag-service';
import { FlagNotFoundError, FlagAlreadyExistsError } from './flag-service';

// ---------------------------------------------------------------------------
// Admin context helper
// ---------------------------------------------------------------------------

interface AdminContext {
  adminUserId: string;
  adminUserEmail: string;
}

function extractAdminContext(request: FastifyRequest): AdminContext {
  // TODO: Extract from verified admin JWT / session
  const adminUserId = request.headers['x-admin-user-id'] as string ?? '';
  const adminUserEmail = request.headers['x-admin-user-email'] as string ?? '';
  return { adminUserId, adminUserEmail };
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createFlagHandlers(flagService: FlagService) {
  return {
    listFlags,
    createFlag,
    getFlagDetail,
    updateFlag,
    deleteFlag,
    addOverride,
    removeOverride,
    resolveFlag,
  };

  // --- List flags ---

  async function listFlags(
    _request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const flags = await flagService.listFlags();
    return flags;
  }

  // --- Create flag ---

  async function createFlag(
    request: FastifyRequest<{
      Body: {
        key: string;
        name: string;
        description: string;
        flagType: 'BOOLEAN' | 'PERCENTAGE' | 'TENANT_LIST';
        enabledGlobally: boolean;
        rolloutPercentage?: number;
        owner: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);

    try {
      const flag = await flagService.createFlag(
        request.body,
        adminUserId,
        adminUserEmail,
      );
      return reply.status(201).send(flag);
    } catch (err) {
      if (err instanceof FlagAlreadyExistsError) {
        return reply.status(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  }

  // --- Flag detail ---

  async function getFlagDetail(
    request: FastifyRequest<{ Params: { flagKey: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const flag = await flagService.getFlagDetail(request.params.flagKey);
      return reply.send(flag);
    } catch (err) {
      if (err instanceof FlagNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Update flag ---

  async function updateFlag(
    request: FastifyRequest<{
      Params: { flagKey: string };
      Body: {
        name?: string;
        description?: string;
        enabledGlobally?: boolean;
        rolloutPercentage?: number;
        owner?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { flagKey } = request.params;

    try {
      const flag = await flagService.updateFlag(
        flagKey,
        request.body,
        adminUserId,
        adminUserEmail,
      );
      return reply.send(flag);
    } catch (err) {
      if (err instanceof FlagNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Delete flag ---

  async function deleteFlag(
    request: FastifyRequest<{ Params: { flagKey: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { flagKey } = request.params;

    try {
      await flagService.deleteFlag(flagKey, adminUserId, adminUserEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof FlagNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Add tenant override ---

  async function addOverride(
    request: FastifyRequest<{
      Params: { flagKey: string };
      Body: {
        tenantId: string;
        tenantName: string;
        enabled: boolean;
        reason: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { flagKey } = request.params;
    const { tenantId, tenantName, enabled, reason } = request.body;

    try {
      const flag = await flagService.addOverride(
        flagKey,
        tenantId,
        tenantName,
        enabled,
        reason,
        adminUserId,
        adminUserEmail,
      );
      return reply.send(flag);
    } catch (err) {
      if (err instanceof FlagNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Remove tenant override ---

  async function removeOverride(
    request: FastifyRequest<{
      Params: { flagKey: string; tenantId: string };
    }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { flagKey, tenantId } = request.params;

    try {
      const flag = await flagService.removeOverride(
        flagKey,
        tenantId,
        adminUserId,
        adminUserEmail,
      );
      return reply.send(flag);
    } catch (err) {
      if (err instanceof FlagNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Resolve flag for tenant ---

  async function resolveFlag(
    request: FastifyRequest<{
      Params: { flagKey: string; tenantId: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const resolution = await flagService.resolveFlag(
        request.params.flagKey,
        request.params.tenantId,
      );
      return reply.send(resolution);
    } catch (err) {
      if (err instanceof FlagNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }
}
