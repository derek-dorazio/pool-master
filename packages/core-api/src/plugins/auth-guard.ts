/**
 * Auth guard plugin — Fastify preHandler that validates JWT access tokens.
 *
 * Decodes the Bearer token from the Authorization header, verifies it,
 * and attaches user context to the request.
 * Public routes (auth module, health check) are skipped automatically.
 */

import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../core/error-handler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  userId: string;
  email: string;
}

// Extend Fastify request to carry auth context
declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

// ---------------------------------------------------------------------------
// Public route prefixes (these skip JWT validation)
// ---------------------------------------------------------------------------

const PUBLIC_PREFIXES = [
  '/health',
  '/api/v1/auth/',
];

function isPublicRoute(url: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => url.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

async function authGuardPlugin(fastify: FastifyInstance): Promise<void> {
  const jwtSecret = process.env.JWT_SECRET ?? 'poolmaster-dev-secret-change-in-production';

  fastify.decorateRequest('authUser', undefined);

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicRoute(request.url)) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Missing or malformed authorization header');
    }

    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, jwtSecret) as {
        sub: string;
        email: string;
      };

      request.authUser = {
        userId: payload.sub,
        email: payload.email,
      };

      // Also set x-user-id header for backward compatibility with existing handlers
      (request.headers as Record<string, string>)['x-user-id'] = payload.sub;
    } catch {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or expired access token');
    }
  });
}

export const authGuard = fp(authGuardPlugin, {
  name: 'auth-guard',
  fastify: '5.x',
});
