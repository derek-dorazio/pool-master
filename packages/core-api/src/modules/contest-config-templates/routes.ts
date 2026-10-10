/**
 * ContestConfigTemplate's operations. Templates are global under A11 — platform-seeded, no owner,
 * identical for every viewer — so any signed-in user reads them, through the one list (#245) that
 * the commissioner's create flow and the root-admin screens both call; the write is root-admin
 * only, guarded like every other global-object write. The write lived at
 * /api/v1/admin/contest-config-templates as `adminUpdateContestConfigTemplate` until #248, the
 * last route under /admin: the permission, not the place, is what makes it an admin operation.
 */
import type { FastifyInstance } from 'fastify';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaContestConfigTemplateRepository } from '../../adapters';
import { createContestConfigTemplateHandlers } from './handler';
import { ContestConfigTemplateService } from './service';

export function contestConfigTemplatesModule(fastify: FastifyInstance): void {
  void fastify.register(schemaComponentsPlugin);

  const handlers = createContestConfigTemplateHandlers(new ContestConfigTemplateService(
    new PrismaContestConfigTemplateRepository(getAppPrisma(fastify)),
    fastify.log,
  ));

  fastify.get('/', {
    schema: {
      tags: ['Contest Config Templates'],
      summary: 'List contest configuration templates',
      description:
        'The seeded configurations a contest can be created from. Any signed-in user may read them. Every filter is optional; the create flow asks for active templates of one sport and contest format.',
      operationId: 'listContestConfigTemplates',
      querystring: schemaRef('ListContestConfigTemplatesQuery'),
      response: {
        200: schemaRef('ContestConfigTemplateListResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
      },
    },
    handler: handlers.listTemplates,
  });

  fastify.put('/:templateId', {
    schema: {
      tags: ['Contest Config Templates'],
      summary: 'Update a contest configuration template',
      description:
        'Updates a seeded template that future contests are created from. Root admin only (403 ROOT_ADMIN_ACCESS_REQUIRED otherwise); contests already created from it keep their own configuration. A configuration must be the template\'s own selection type\'s rules (422 CONTEST_CONFIG_TEMPLATE_RULES_MISMATCH otherwise).',
      operationId: 'updateContestConfigTemplate',
      body: schemaRef('UpdateContestConfigTemplateRequest'),
      response: {
        200: schemaRef('ContestConfigTemplateResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
        422: schemaRef('ErrorEnvelope'),
      },
    },
    onRequest: requireRootAdmin,
    handler: handlers.updateTemplate,
  });
}
