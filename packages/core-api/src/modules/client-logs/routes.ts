import type { FastifyInstance } from 'fastify';
import { zodToJsonSchema } from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/client-logs.dto';
import { createClientLogHandlers } from './handler';
import { ClientLogService } from './service';

export function clientLogsModule(fastify: FastifyInstance): void {
  void fastify.register(schemaComponentsPlugin);

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
        body: schemaRef('ClientLogBatch'),
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
