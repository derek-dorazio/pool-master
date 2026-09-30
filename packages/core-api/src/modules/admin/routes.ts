/**
 * Admin module — what remains under /api/v1/admin: the two contest configuration template
 * operations. #205 moved everything else to the domain it administers — `platform` for runtime
 * settings, `ingestion` for providers and syncs — and #245 moves these two to the contest
 * configuration templates they act on, after which this module has no routes and goes.
 *
 * Mounted at /api/v1/admin by the application root; every route requires a root-admin session.
 */

import type { FastifyInstance } from 'fastify';
import { ContestTemplateAdminService } from './contest-template-service';
import { createContestTemplateAdminHandlers } from './contest-template-handler';
import {
  AdminContestConfigTemplateResponseSchema,
  AdminListContestConfigTemplatesQuerySchema,
  AdminUpdateContestConfigTemplateRequestSchema,
  ContestConfigTemplateListResponseSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import adminAuth from '../../plugins/admin-auth';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaContestConfigTemplateRepository } from '../../adapters';

function withAdminErrorResponses(
  successResponses: Record<number, unknown>,
  extraErrorStatuses: number[] = [],
): Record<number, unknown> {
  return {
    ...successResponses,
    401: zodToJsonSchema(ErrorEnvelopeSchema),
    ...Object.fromEntries(
      extraErrorStatuses.map((status) => [status, zodToJsonSchema(ErrorEnvelopeSchema)]),
    ),
  };
}

export async function adminModule(fastify: FastifyInstance): Promise<void> {
  await fastify.register(adminAuth);

  const contestTemplates = createContestTemplateAdminHandlers(new ContestTemplateAdminService(
    new PrismaContestConfigTemplateRepository(getAppPrisma(fastify)),
    fastify.log,
  ));

  fastify.get('/contest-config-templates', {
    schema: {
      tags: ['Admin'],
      summary: 'List persisted contest configuration templates',
      description: 'Returns the persisted commissioner contest configuration templates that root-admins can manage from the /manage page.',
      operationId: 'adminListContestConfigTemplates',
      querystring: zodToJsonSchema(AdminListContestConfigTemplatesQuerySchema),
      response: withAdminErrorResponses({
        200: zodToJsonSchema(ContestConfigTemplateListResponseSchema),
      }),
    },
    handler: contestTemplates.listTemplates,
  });

  fastify.put('/contest-config-templates/:templateId', {
    schema: {
      tags: ['Admin'],
      summary: 'Update a persisted contest configuration template',
      description: 'Updates the persisted commissioner contest template used as a global default for future contest create flows.',
      operationId: 'adminUpdateContestConfigTemplate',
      body: zodToJsonSchema(AdminUpdateContestConfigTemplateRequestSchema),
      response: withAdminErrorResponses({
        200: zodToJsonSchema(AdminContestConfigTemplateResponseSchema),
      }, [400, 404]),
    },
    handler: contestTemplates.updateTemplate,
  });
}
