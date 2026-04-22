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
      });

      return reply.status(204).send();
    },
  };
}
