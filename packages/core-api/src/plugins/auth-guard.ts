/**
 * Auth guard plugin — Fastify preHandler that validates JWT access tokens.
 *
 * Decodes the Bearer token from the Authorization header, verifies it,
 * and attaches user context to the request.
 * Public routes (auth module, health check) are skipped automatically.
 */

import fp from 'fastify-plugin';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readJwtSecret } from '../core/config';
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

/**
 * The signed-in user of a request the auth guard admitted (#153). Throws a 401
 * `AUTH_SESSION_REQUIRED` when there is none, which the global error handler sends.
 *
 * `authUser` is optional on every request because public routes have none, so an authenticated
 * handler must say it needs one. This is that statement, made once: if a route is ever added to
 * the public set, or made optional-auth, its handlers answer 401 instead of crashing with a
 * `TypeError` on `undefined` — and never pass `undefined` on as a user id.
 */
export function requireAuthUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) {
    throw Object.assign(new Error('Authenticated session required'), {
      statusCode: 401,
      code: 'AUTH_SESSION_REQUIRED',
    });
  }
  return request.authUser;
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
  // #217 — registering against a squad-owner invitation. Public by necessity: the caller has no
  // account yet, which is the entire reason this route exists alongside
  // `POST /api/v1/team-invitations/accept`, which requires a session. It is not an open
  // registration hole — it needs a valid PENDING invite code, and it creates the account with the
  // email the commissioner invited rather than one the caller supplies.
  'POST /api/v1/team-invitations/register',
]);

const PUBLIC_ROUTE_PATTERNS = [
  /^GET \/api\/v1\/invitations\/[^/?#]+$/,
  // #217 — the team-owner invitation preview. Its own route description called it "the public
  // team-owner invitation flow before or after authentication", but it was never actually
  // exempted, so an invited stranger could not read it. Found while making the register route
  // public; the league invitation preview one line above was already handled this way.
  /^GET \/api\/v1\/team-invitations\/[^/?#]+$/,
];

const PUBLIC_ROUTE_OPTIONAL_AUTH_PATTERNS = [
  /^POST \/api\/v1\/client-logs\/?$/,
];

/**
 * `METHOD /path`, with a trailing slash normalised away (#212).
 *
 * Fastify's `prefixTrailingSlash: 'both'` default serves a route registered at a prefix root
 * under two spellings — `/api/v1/client-logs` and `/api/v1/client-logs/` — and the generated
 * OpenAPI spec documents the second, so the SDK calls it. Matching the literal spelling exempted
 * only one of them, which meant the **documented** path of a deliberately public route answered
 * 401 to the unauthenticated callers it exists for.
 *
 * Normalising here fixes the class rather than the instance. The `/version` checks below used to
 * spell both forms out by hand, which is the same bug caught once and patched narrowly.
 */
function routeSignature(method: string, url: string): string {
  const path = url.split('?')[0] ?? url;
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return `${method.toUpperCase()} ${normalized}`;
}

function isPublicRoute(method: string, url: string): boolean {
  const signature = routeSignature(method, url);
  const path = signature.slice(signature.indexOf(' ') + 1);
  return path.startsWith('/health')
    || path === '/version'
    || path === '/api/v1/version'
    || PUBLIC_ROUTES.has(signature)
    || PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(signature));
}

// ---------------------------------------------------------------------------
// Token reading, shared with route-level guards that must decide before validation
// ---------------------------------------------------------------------------

/** The access token a request carries: the Bearer header, else the session cookie. */
export function readRequestAccessToken(request: FastifyRequest): string | undefined {
  const authHeader = request.headers.authorization;
  return authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : readAccessCookie(request.headers.cookie);
}

/**
 * Verifies an access token and returns the user it names. Throws when it is invalid or expired,
 * or when it does not name a user (#153).
 *
 * `jwt.verify` returns `string | JwtPayload`, whose `sub` and `email` are optional. A
 * signature-valid token without them used to become an authenticated request with an `undefined`
 * user id, which Prisma reads as "omit this filter" — a widened query rather than an error. Every
 * caller turns the throw into a 401.
 */
export function verifyAccessToken(accessToken: string, jwtSecret: string): AuthUser {
  const payload = jwt.verify(accessToken, jwtSecret);
  if (typeof payload === 'string') {
    throw new Error('Access token payload is not an object');
  }
  const { sub, email, isRootAdmin, sid } = payload as JwtPayload & {
    email?: unknown;
    isRootAdmin?: unknown;
    sid?: unknown;
  };
  if (typeof sub !== 'string' || sub === '') {
    throw new Error('Missing user ID in token payload');
  }
  if (typeof email !== 'string') {
    throw new Error('Missing email in token payload');
  }
  return {
    userId: sub,
    email,
    isRootAdmin: isRootAdmin === true,
    sessionId: typeof sid === 'string' ? sid : null,
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

function authGuardPlugin(fastify: FastifyInstance): void {
  // pool-master-rop.76.1 — single bootstrap source, throws if unset.
  const jwtSecret = readJwtSecret();

  fastify.decorateRequest('authUser', undefined);

  function tryAttachOptionalAuthUser(request: FastifyRequest) {
    const accessToken = readRequestAccessToken(request);
    if (!accessToken) {
      return;
    }

    try {
      request.authUser = verifyAccessToken(accessToken, jwtSecret);
    } catch {
      // Optional auth binding should never block a public route.
    }
  }

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const signature = routeSignature(request.method, request.url);

    if (isPublicRoute(request.method, request.url)) {
      if (PUBLIC_ROUTE_OPTIONAL_AUTH_PATTERNS.some((pattern) => pattern.test(signature))) {
        tryAttachOptionalAuthUser(request);
      }
      return;
    }

    const authHeader = request.headers.authorization;
    const accessToken = readRequestAccessToken(request);
    if (!accessToken) {
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }

    try {
      const authUser = verifyAccessToken(accessToken, jwtSecret);

      const usingCookieSession = !authHeader?.startsWith('Bearer ');
      if (usingCookieSession && isStateChangingMethod(request.method)) {
        const csrfCookie = readCsrfCookie(request.headers.cookie);
        const csrfHeader = request.headers['x-csrf-token'];
        if (!csrfCookie || csrfHeader !== csrfCookie) {
          return sendError(reply, 403, 'AUTH_CSRF_INVALID', 'Missing or invalid CSRF token');
        }
      }

      request.authUser = authUser;
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
