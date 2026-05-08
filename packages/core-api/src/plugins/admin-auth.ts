/**
 * Root-admin authorization plugin.
 *
 * Resolves the unified authenticated user from either a Bearer token or the
 * backend-owned access cookie, then verifies root-admin capability before
 * attaching root-admin context to the request.
 *
 * This is registered as a Fastify plugin so it can be scoped to admin routes.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import { sendError } from '../core/error-handler';
import { readJwtSecret } from '../core/config';
import { readAccessCookie } from '../core/session-cookies';
import { formatUserFullName } from '../core/user-name';

// ---------------------------------------------------------------------------
// Admin context interface
// ---------------------------------------------------------------------------

export interface RootAdminContext {
  rootAdminUser: {
    id: string;
    email: string;
    name: string;
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

async function adminAuthPlugin(fastify: FastifyInstance): Promise<void> {
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

    let userId: string;
    try {
      const decoded = jwt.verify(token, jwtSecret) as { sub?: string };
      userId = decoded.sub ?? '';
      if (!userId) {
        throw new Error('Missing user ID in token payload');
      }
    } catch {
      return sendError(
        reply,
        401,
        'ROOT_ADMIN_SESSION_INVALID',
        'Invalid or expired root-admin session',
      );
    }

    const prisma = (fastify as unknown as { prisma: PrismaClient }).prisma;
    const rootAdminUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isRootAdmin: true,
      },
    });

    if (!rootAdminUser) {
      return sendError(reply, 401, 'ROOT_ADMIN_USER_NOT_FOUND', 'Root-admin user not found');
    }

    if (!rootAdminUser.isRootAdmin) {
      return sendError(reply, 403, 'ROOT_ADMIN_ACCESS_REQUIRED', 'Root-admin access required');
    }

    request.rootAdminContext = {
      rootAdminUser: {
        id: rootAdminUser.id,
        email: rootAdminUser.email,
        name: formatUserFullName(rootAdminUser.firstName, rootAdminUser.lastName),
        isRootAdmin: true,
      },
    };
  });
}

export default fp(adminAuthPlugin, {
  name: 'admin-auth',
  fastify: '5.x',
});
