import type { FastifyInstance } from 'fastify';
import type { ClientLogBatch } from '@poolmaster/shared/dto';
// Registers ErrorEnvelope, which this module's error responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
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

  fastify.post<{ Body: ClientLogBatch }>(
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
          400: schemaRef('ErrorEnvelope'),
          413: schemaRef('ErrorEnvelope'),
          429: schemaRef('ErrorEnvelope'),
        },
      },
    },
    handler.ingest,
  );
}
