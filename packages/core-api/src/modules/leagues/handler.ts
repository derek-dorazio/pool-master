import type { FastifyReply, FastifyRequest } from 'fastify';

export async function listLeaguesHandler(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<{ leagues: unknown[] }> {
  // TODO: Inject league service, query by tenant
  return { leagues: [] };
}
