import type { FastifyRequest } from 'fastify';

interface RootAdminContext {
  adminUserId: string;
  adminUserEmail: string;
}

export function extractAdminContext(request: FastifyRequest): RootAdminContext {
  const adminUser = request.adminContext?.adminUser;
  if (!adminUser) {
    throw new Error('Root admin context is required before admin handlers execute');
  }

  return {
    adminUserId: adminUser.id,
    adminUserEmail: adminUser.email,
  };
}
