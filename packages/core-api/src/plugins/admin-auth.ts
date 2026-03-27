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
import type { PrismaClient } from '@prisma/client';
import type { AdminRole, AdminPermission } from '../core/admin-permissions';

// ---------------------------------------------------------------------------
// Admin context interface
// ---------------------------------------------------------------------------

export interface AdminContext {
  adminUser: {
    id: string;
    email: string;
    name: string;
    role: AdminRole;
    permissions: AdminPermission[];
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
      return reply
        .status(401)
        .send({ error: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header' });
    }

    const token = authHeader.slice(7);
    if (!token) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHORIZED', message: 'Empty bearer token' });
    }

    // --- Token validation placeholder ---
    // In production this will validate an SSO JWT (Okta / Google Workspace).
    // For now we decode the token as a base64-encoded JSON payload containing
    // { adminUserId: string } and look up the admin user in the database.
    let adminUserId: string;
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
      adminUserId = decoded.adminUserId;
      if (!adminUserId) {
        throw new Error('Missing adminUserId in token payload');
      }
    } catch {
      return reply
        .status(401)
        .send({ error: 'UNAUTHORIZED', message: 'Invalid admin token' });
    }

    // Look up admin user
    const prisma = (fastify as unknown as { prisma: PrismaClient }).prisma;
    const adminUser = await prisma.adminUser.findUnique({
      where: { id: adminUserId },
    });

    if (!adminUser) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHORIZED', message: 'Admin user not found' });
    }

    if (!adminUser.isActive) {
      return reply
        .status(403)
        .send({ error: 'FORBIDDEN', message: 'Admin account is inactive' });
    }

    // Attach admin context to request
    request.adminContext = {
      adminUser: {
        id: adminUser.id,
        email: adminUser.email,
        name: adminUser.name,
        role: adminUser.role as AdminRole,
        permissions: adminUser.permissions as AdminPermission[],
      },
    };
  });
}

export default fp(adminAuthPlugin, {
  name: 'admin-auth',
  fastify: '5.x',
});
