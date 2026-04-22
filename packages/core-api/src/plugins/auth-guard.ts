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
  isRootAdmin: boolean;
  sessionId: string | null;
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
  'POST /api/v1/client-logs',
]);

const PUBLIC_ROUTE_PATTERNS = [
  /^GET \/api\/v1\/invitations\/[^/?#]+$/,
];

const PUBLIC_ROUTE_OPTIONAL_AUTH_PATTERNS = [
  /^POST \/api\/v1\/client-logs\/?$/,
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

  function tryAttachOptionalAuthUser(request: FastifyRequest) {
    const authHeader = request.headers.authorization;
    const accessToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : readAccessCookie(request.headers.cookie);

    if (!accessToken) {
      return;
    }

    try {
      const payload = jwt.verify(accessToken, jwtSecret) as {
        sub: string;
        email: string;
        isRootAdmin?: boolean;
        sid?: string;
      };

      request.authUser = {
        userId: payload.sub,
        email: payload.email,
        isRootAdmin: payload.isRootAdmin === true,
        sessionId: payload.sid ?? null,
      };
    } catch {
      // Optional auth binding should never block a public route.
    }
  }

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const signature = `${request.method.toUpperCase()} ${request.url.split('?')[0] ?? request.url}`;

    if (isPublicRoute(request.method, request.url)) {
      if (PUBLIC_ROUTE_OPTIONAL_AUTH_PATTERNS.some((pattern) => pattern.test(signature))) {
        tryAttachOptionalAuthUser(request);
      }
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
        isRootAdmin?: boolean;
        sid?: string;
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
        isRootAdmin: payload.isRootAdmin === true,
        sessionId: payload.sid ?? null,
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
