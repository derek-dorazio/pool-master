/**
 * Admin module — what remains under /api/v1/admin: the contest configuration template write.
 *
 * #205 moved everything else to the domain it administers — `platform` for runtime settings,
 * `ingestion` for providers and syncs — and #245 moved the template read to
 * /api/v1/contest-config-templates. The write is the contest cluster's to move; when it does,
 * this module, the `admin-auth` plugin and `request.rootAdminContext` have nothing left to
 * serve.
 *
 * Mounted at /api/v1/admin by the application root; every route requires a root-admin session.
 */

import type { FastifyInstance } from 'fastify';
import { ContestConfigTemplateService } from '../contest-config-templates/service';
import { createContestConfigTemplateHandlers } from '../contest-config-templates/handler';
import {
  AdminContestConfigTemplateResponseSchema,
  AdminUpdateContestConfigTemplateRequestSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import adminAuth from '../../plugins/admin-auth';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaContestConfigTemplateRepository } from '../../adapters';

export async function adminModule(fastify: FastifyInstance): Promise<void> {
  await fastify.register(adminAuth);

  const contestTemplates = createContestConfigTemplateHandlers(new ContestConfigTemplateService(
    new PrismaContestConfigTemplateRepository(getAppPrisma(fastify)),
    fastify.log,
  ));
  const envelope = zodToJsonSchema(ErrorEnvelopeSchema);

  // #245 — the template read is `listContestConfigTemplates` at /api/v1/contest-config-templates:
  // one read for the commissioner and the root admin, `authenticated` under A11. The write stays here.
  fastify.put('/contest-config-templates/:templateId', {
    schema: {
      tags: ['Admin'],
      summary: 'Update a persisted contest configuration template',
      description: 'Updates the persisted commissioner contest template used as a global default for future contest create flows.',
      operationId: 'adminUpdateContestConfigTemplate',
      body: zodToJsonSchema(AdminUpdateContestConfigTemplateRequestSchema),
      response: {
        200: zodToJsonSchema(AdminContestConfigTemplateResponseSchema),
        400: envelope,
        401: envelope,
        404: envelope,
      },
    },
    handler: contestTemplates.updateTemplate,
  });
}
