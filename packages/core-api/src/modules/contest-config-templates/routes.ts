/**
 * The ContestConfigTemplate read (#245). Templates are global under A11 — platform-seeded, no
 * owner, identical for every viewer — so any signed-in user reads them, through this one
 * operation; the commissioner's create flow and the root-admin screens both call it. The write
 * stays root-admin only and lives with the other root-admin writes (`adminUpdateContestConfigTemplate`).
 */
import type { FastifyInstance } from 'fastify';
import {
  ContestConfigTemplateListResponseSchema,
  ErrorEnvelopeSchema,
  ListContestConfigTemplatesQuerySchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaContestConfigTemplateRepository } from '../../adapters';
import { createContestConfigTemplateHandlers } from './handler';
import { ContestConfigTemplateService } from './service';

export function contestConfigTemplatesModule(fastify: FastifyInstance): void {
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
      querystring: zodToJsonSchema(ListContestConfigTemplatesQuerySchema),
      response: {
        200: zodToJsonSchema(ContestConfigTemplateListResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.listTemplates,
  });
}
