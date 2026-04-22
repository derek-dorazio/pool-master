import type { FastifyInstance } from 'fastify';
import {
  ClientLogBatchSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { createClientLogHandlers } from './handler';
import { ClientLogService } from './service';

export async function clientLogsModule(fastify: FastifyInstance): Promise<void> {
  const service = new ClientLogService({
    logger: fastify.log,
  });
  const handler = createClientLogHandlers(service);

  fastify.post<{ Body: import('@poolmaster/shared/dto').ClientLogBatch }>(
    '/',
    {
      schema: {
        tags: ['Observability'],
        summary: 'Ingest browser log batches for operational diagnostics',
        description:
          'Accepts browser-produced structured log batches so webapp runtime events can be correlated with backend request logs in operational tooling.',
        operationId: 'ingestClientLogs',
        body: zodToJsonSchema(ClientLogBatchSchema),
        response: {
          204: { type: 'null' },
          400: zodToJsonSchema(ErrorEnvelopeSchema),
          413: zodToJsonSchema(ErrorEnvelopeSchema),
          429: zodToJsonSchema(ErrorEnvelopeSchema),
        },
      },
    },
    handler.ingest,
  );
}
