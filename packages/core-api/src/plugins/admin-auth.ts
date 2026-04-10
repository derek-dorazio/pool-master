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
import { readAccessCookie } from '../core/session-cookies';

const JWT_SECRET = process.env.JWT_SECRET ?? 'poolmaster-dev-secret-change-in-production';

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
  // Decorate request with rootAdminContext (undefined by default)
  fastify.decorateRequest('rootAdminContext', undefined);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : readAccessCookie(request.headers.cookie);
    if (!token) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Missing authenticated root-admin session');
    }

    let userId: string;
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string };
      userId = decoded.sub ?? '';
      if (!userId) {
        throw new Error('Missing user ID in token payload');
      }
    } catch {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or expired root-admin session');
    }

    const prisma = (fastify as unknown as { prisma: PrismaClient }).prisma;
    const rootAdminUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        isRootAdmin: true,
      },
    });

    if (!rootAdminUser) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'User not found');
    }

    if (!rootAdminUser.isRootAdmin) {
      return sendError(reply, 403, 'FORBIDDEN', 'Root-admin access required');
    }

    request.rootAdminContext = {
      rootAdminUser: {
        id: rootAdminUser.id,
        email: rootAdminUser.email,
        name: rootAdminUser.displayName,
        isRootAdmin: true,
      },
    };
  });
}

export default fp(adminAuthPlugin, {
  name: 'admin-auth',
  fastify: '5.x',
});
