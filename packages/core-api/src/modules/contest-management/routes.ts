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
      summary: 'Get a contest\'s configuration',
      description:
        'Returns a contest with its configuration and the tiers it inherits from its event: what the configuration editor reads. Commissioner only. Named for the object it returns, not the role that reads it (#248; was getManagedContest).',
      operationId: 'getContestConfiguration',
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
      summary: 'Update a contest\'s configuration',
      description:
        'Updates an existing contest\'s configuration and returns it as getContestConfiguration does. Commissioner only. Refused with 409 CONTEST_CONFIGURATION_SETTLED while the contest is COMPLETED: its result is frozen against the configuration it settled under, and reopening the contest is the path back.',
      operationId: 'updateContestConfiguration',
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
