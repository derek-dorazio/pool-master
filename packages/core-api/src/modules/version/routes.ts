import type { FastifyInstance } from 'fastify';
import {
  ServiceVersionResponseSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { createVersionHandlers } from './handler';
import { VersionService } from './service';

export interface VersionModuleOptions {
  readonly operationId?: string;
}

export async function versionModule(
  fastify: FastifyInstance,
  options: VersionModuleOptions = {},
): Promise<void> {
  const versionService = new VersionService();
  const handler = createVersionHandlers(versionService);

  fastify.get('/', {
    schema: {
      tags: ['Version'],
      summary: 'Get service version metadata',
      description:
        'Returns non-secret deployment metadata for the core API service so QA and operators can diagnose stale releases, SHA mismatches, and build provenance.',
      operationId: options.operationId ?? 'getVersion',
      response: { 200: zodToJsonSchema(ServiceVersionResponseSchema) },
    },
    handler: handler.getVersion,
  });
}
