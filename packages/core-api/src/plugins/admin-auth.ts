/**
 * Root-admin authorization plugin.
 *
 * Resolves the unified authenticated user from either a Bearer token or the
 * backend-owned access cookie, then verifies root-admin capability before
 * attaching root-admin context to the request.
 *
 * This is registered as a Fastify plugin so it can be scoped to admin routes.
 *
 * **Root-admin authority is read from the access-token claim (#213/#195, access rule A10).**
 * This used to re-read the `User` row on every admin request, while `/api/v1/users/*` trusted
 * the claim — two answers to one question, which surfaced as a functional test that promoted a
 * user in the database and then got a 403 from one surface and a 200 from the other. The claim
 * wins, and the reason it is safe is that `setUserRootAdmin` already revokes the subject's
 * sessions on demotion: removed authority cannot be used until they log in again, whichever
 * surface they call. Only promotion is slower, by at most the access token's lifetime, and
 * nobody is harmed by gaining authority a few minutes late.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import { sendError } from '../core/error-handler';
import { readJwtSecret } from '../core/config';
import { readAccessCookie } from '../core/session-cookies';

// ---------------------------------------------------------------------------
// Admin context interface
// ---------------------------------------------------------------------------

export interface RootAdminContext {
  rootAdminUser: {
    id: string;
    email: string;
    isRootAdmin: true;
  };
}

// ---------------------------------------------------------------------------
// Augment Fastify types
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    rootAdminContext?: RootAdminContext;
  }
}

// ---------------------------------------------------------------------------
// Plugin implementation
// ---------------------------------------------------------------------------

function adminAuthPlugin(fastify: FastifyInstance): void {
  // pool-master-rop.76.1 — read JWT_SECRET at plugin registration time
  // (not at module import). Bootstrap throws if unset; tests inject the
  // env var before registering the plugin.
  const jwtSecret = readJwtSecret();

  // Decorate request with rootAdminContext (undefined by default)
  fastify.decorateRequest('rootAdminContext', undefined);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : readAccessCookie(request.headers.cookie);
    if (!token) {
      return sendError(
        reply,
        401,
        'ROOT_ADMIN_SESSION_REQUIRED',
        'Authenticated root-admin session required',
      );
    }

    let claims: { sub: string; email: string; isRootAdmin: boolean };
    try {
      const decoded = jwt.verify(token, jwtSecret) as {
        sub?: string;
        email?: string;
        isRootAdmin?: boolean;
      };
      if (!decoded.sub) {
        throw new Error('Missing user ID in token payload');
      }
      claims = {
        sub: decoded.sub,
        email: decoded.email ?? '',
        isRootAdmin: decoded.isRootAdmin === true,
      };
    } catch {
      return sendError(
        reply,
        401,
        'ROOT_ADMIN_SESSION_INVALID',
        'Invalid or expired root-admin session',
      );
    }

    // No user row is read. `auth-service` mints `{ sub, email, isRootAdmin, sid }`, so both
    // fields the context carries are signed claims. The `ROOT_ADMIN_USER_NOT_FOUND` 401 went
    // with the lookup: a signed token for a deleted user now reads as a plain 403, which is
    // the same answer for the caller and one fewer code to distinguish.
    if (!claims.isRootAdmin) {
      return sendError(reply, 403, 'ROOT_ADMIN_ACCESS_REQUIRED', 'Root-admin access required');
    }

    request.rootAdminContext = {
      rootAdminUser: {
        id: claims.sub,
        email: claims.email,
        isRootAdmin: true,
      },
    };
  });
}

export default fp(adminAuthPlugin, {
  name: 'admin-auth',
  fastify: '5.x',
});
