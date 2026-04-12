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
import {
  isStateChangingMethod,
  readAccessCookie,
  readCsrfCookie,
} from '../core/session-cookies';

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

const PUBLIC_ROUTES = new Set([
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/forgot-password',
  'POST /api/v1/auth/callback',
]);

const PUBLIC_ROUTE_PATTERNS = [
  /^GET \/api\/v1\/invitations\/[^/?#]+$/,
];

function isPublicRoute(method: string, url: string): boolean {
  const path = url.split('?')[0] ?? url;
  const signature = `${method.toUpperCase()} ${path}`;
  return path.startsWith('/health')
    || PUBLIC_ROUTES.has(signature)
    || PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(signature));
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

async function authGuardPlugin(fastify: FastifyInstance): Promise<void> {
  const jwtSecret = process.env.JWT_SECRET ?? 'poolmaster-dev-secret-change-in-production';

  fastify.decorateRequest('authUser', undefined);

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicRoute(request.method, request.url)) {
      return;
    }

    const authHeader = request.headers.authorization;
    const accessToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : readAccessCookie(request.headers.cookie);
    if (!accessToken) {
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }

    try {
      const payload = jwt.verify(accessToken, jwtSecret) as {
        sub: string;
        email: string;
      };

      const usingCookieSession = !authHeader?.startsWith('Bearer ');
      if (usingCookieSession && isStateChangingMethod(request.method)) {
        const csrfCookie = readCsrfCookie(request.headers.cookie);
        const csrfHeader = request.headers['x-csrf-token'];
        if (!csrfCookie || csrfHeader !== csrfCookie) {
          return sendError(reply, 403, 'AUTH_CSRF_INVALID', 'Missing or invalid CSRF token');
        }
      }

      request.authUser = {
        userId: payload.sub,
        email: payload.email,
      };

    } catch {
      return sendError(
        reply,
        401,
        'AUTH_ACCESS_TOKEN_INVALID',
        'Invalid or expired access token',
      );
    }
  });
}

export const authGuard = fp(authGuardPlugin, {
  name: 'auth-guard',
  fastify: '5.x',
});
