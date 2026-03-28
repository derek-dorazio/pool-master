/**
 * Rate limit config admin route handlers — request/response layer for
 * notification rate limit configuration management.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RateLimitConfigService } from './rate-limit-config-service';

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

export function createRateLimitConfigHandlers(service: RateLimitConfigService) {
  return {
    getConfig,
    updateConfig,
    resetConfig,
  };

  async function getConfig(
    _request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    return service.getConfig();
  }

  async function updateConfig(
    request: FastifyRequest<{
      Body: {
        pushPerHour?: number;
        emailPerDay?: number;
        smsPerDay?: number;
        collapseRules?: Array<{
          eventType: string;
          maxPerHour: number;
          windowMinutes: number;
        }>;
        dedupWindowSeconds?: number;
      };
    }>,
    _reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    return service.updateConfig(request.body, adminUserId, adminUserEmail);
  }

  async function resetConfig(
    request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    return service.resetConfig(adminUserId, adminUserEmail);
  }
}
