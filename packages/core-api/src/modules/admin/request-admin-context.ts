import type { FastifyRequest } from 'fastify';

interface RootAdminContext {
  rootAdminUserId: string;
  rootAdminEmail: string;
}

export function extractRootAdminContext(request: FastifyRequest): RootAdminContext {
  const rootAdminUser = request.rootAdminContext?.rootAdminUser;
  if (!rootAdminUser) {
    throw new Error('Root admin context is required before admin handlers execute');
  }

  return {
    rootAdminUserId: rootAdminUser.id,
    rootAdminEmail: rootAdminUser.email,
  };
}
