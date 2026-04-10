/**
 * Admin authentication plugin.
 *
 * Extracts and validates admin JWT from the Authorization header, looks up
 * the admin user in the database, and attaches the admin context to the
 * request. Returns 401 for missing/invalid tokens and 403 for inactive
 * admin users.
 *
 * This is registered as a Fastify plugin so it can be scoped to admin routes.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import { sendError } from '../core/error-handler';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';

// ---------------------------------------------------------------------------
// Admin context interface
// ---------------------------------------------------------------------------

export interface AdminContext {
  adminUser: {
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
    adminContext?: AdminContext;
  }
}

// ---------------------------------------------------------------------------
// Plugin implementation
// ---------------------------------------------------------------------------

async function adminAuthPlugin(fastify: FastifyInstance): Promise<void> {
  // Decorate request with adminContext (undefined by default)
  fastify.decorateRequest('adminContext', undefined);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Missing or malformed Authorization header');
    }

    const token = authHeader.slice(7);
    if (!token) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Empty bearer token');
    }

    let userId: string;
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string };
      userId = decoded.sub ?? '';
      if (!userId) {
        throw new Error('Missing user ID in token payload');
      }
    } catch {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or expired root-admin token');
    }

    const prisma = (fastify as unknown as { prisma: PrismaClient }).prisma;
    const adminUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        isRootAdmin: true,
      },
    });

    if (!adminUser) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'User not found');
    }

    if (!adminUser.isRootAdmin) {
      return sendError(reply, 403, 'FORBIDDEN', 'Root-admin access required');
    }

    request.adminContext = {
      adminUser: {
        id: adminUser.id,
        email: adminUser.email,
        name: adminUser.displayName,
        isRootAdmin: true,
      },
    };
  });
}

export default fp(adminAuthPlugin, {
  name: 'admin-auth',
  fastify: '5.x',
});
