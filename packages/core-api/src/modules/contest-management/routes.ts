import type { FastifyInstance } from 'fastify';
import {
  ContestConfigurationRequestSchema,
  ContestManagementResponseSchema,
  ErrorEnvelopeSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { PrismaLeagueMembershipRepository } from '../../adapters';
import { requireCommissioner } from '../leagues/permissions';
import { createContestManagementHandlers } from './handler';
import { createContestManagementService } from './wiring';
import { getAppPrisma } from '../../core/prisma-context';

export function contestManagementModule(
  fastify: FastifyInstance,
): void {
  const prisma = getAppPrisma(fastify);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const contestManagementService = createContestManagementService(prisma, fastify.log);
  const handlers = createContestManagementHandlers(contestManagementService);

  fastify.get('/contests/:contestId', {
    schema: {
      tags: ['Contest Management'],
      summary: 'Get commissioner contest-management detail',
      description:
        'Returns the commissioner-focused management detail for a contest, including the configuration needed by administration editors.',
      operationId: 'getManagedContest',
      response: {
        200: zodToJsonSchema(ContestManagementResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: handlers.getContest,
  });

  fastify.put('/contests/:contestId/configuration', {
    schema: {
      tags: ['Contest Management'],
      summary: 'Update commissioner contest configuration',
      description:
        'Updates the commissioner-managed configuration for an existing contest and returns the refreshed management detail payload. Refused with 409 CONTEST_CONFIGURATION_SETTLED while the contest is COMPLETED: its result is frozen against the configuration it settled under, and reopening the contest is the path back.',
      operationId: 'updateManagedContestConfiguration',
      body: zodToJsonSchema(ContestConfigurationRequestSchema),
      response: {
        200: zodToJsonSchema(ContestManagementResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
        409: {
          ...zodToJsonSchema(ErrorEnvelopeSchema),
          description: 'CONTEST_CONFIGURATION_SETTLED — the contest is COMPLETED; reopen it before changing its configuration.',
        },
        422: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: handlers.updateContestConfiguration,
  });
}
