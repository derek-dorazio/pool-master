import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export function getAppPrisma(fastify: FastifyInstance): PrismaClient {
  if (fastify.hasDecorator('prisma')) {
    return fastify.prisma;
  }

  const prisma = new PrismaClient();
  fastify.decorate('prisma', prisma);
  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
  return prisma;
}
