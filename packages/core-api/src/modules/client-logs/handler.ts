import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ClientLogBatch } from '@poolmaster/shared/dto';
import { ClientLogService } from './service';

export function createClientLogHandlers(service: ClientLogService) {
  return {
    ingest: async (
      request: FastifyRequest<{ Body: ClientLogBatch }>,
      reply: FastifyReply,
    ) => {
      const logger = request.contextLogger ?? request.log;

      logger.debug({
        action: 'clientLogs.route.ingest.request',
        data: {
          clientTraceId: request.body.clientTraceId,
          entryCount: request.body.entries.length,
        },
      }, 'Handling client log batch request');

      service.ingestBatch({
        batch: request.body,
        ip: request.ip ?? null,
        requestLogger: logger,
        // #206 — identity comes from the verified JWT on THIS request, never from the
        // batch. This route is public so pre-login failures can still be reported, but
        // it is registered in PUBLIC_ROUTE_OPTIONAL_AUTH_PATTERNS, so `authUser` is
        // populated from the access cookie whenever the caller has a session. An
        // anonymous caller leaves both null rather than being able to claim an identity.
        sessionId: request.authUser?.sessionId ?? null,
        userId: request.authUser?.userId ?? null,
      });

      return reply.status(204).send();
    },
  };
}
