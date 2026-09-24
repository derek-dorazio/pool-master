import type { FastifyInstance } from 'fastify';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Importing the DTO module for its registerSchema() side effect: the component must
// be in the registry before schemaRef() resolves it, and before swagger publishes it.
import '@poolmaster/shared/dto/version.dto';
import { createVersionHandlers } from './handler';
import { VersionService } from './service';

export interface VersionModuleOptions {
  readonly operationId?: string;
}

export function versionModule(
  fastify: FastifyInstance,
  options: VersionModuleOptions = {},
): void {
  // The route below $refs a named component, so the components must be registered
  // on this instance. Registering here keeps the module self-contained rather than
  // making it depend on the app bootstrap having done it first.
  void fastify.register(schemaComponentsPlugin);

  const versionService = new VersionService();
  const handler = createVersionHandlers(versionService);

  fastify.get('/', {
    schema: {
      tags: ['Version'],
      summary: 'Get service version metadata',
      description:
        'Returns non-secret deployment metadata for the core API service so QA and operators can diagnose stale releases, SHA mismatches, and build provenance.',
      operationId: options.operationId ?? 'getVersion',
      response: { 200: schemaRef('ServiceVersionResponse') },
    },
    handler: handler.getVersion,
  });
}
