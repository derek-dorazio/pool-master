import type { FastifyInstance } from 'fastify';
import { CommissionerPermission } from '@poolmaster/shared/domain';
import {
  ContestConfigurationRequestSchema,
  ContestManagementResponseSchema,
  CreateContestManagementRequestSchema,
  ErrorEnvelopeSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import {
  PrismaContestConfigurationRepository,
  PrismaContestCoreRepository,
  PrismaContestEntryAggregationRuleRepository,
  PrismaContestPrizeDefinitionRepository,
  PrismaLeagueMembershipRepository,
  PrismaParticipantContestScoringRuleRepository,
} from '../../adapters';
import { requirePermission } from '../../core/require-permission';
import { createContestManagementHandlers } from './handler';
import { ContestManagementService } from './service';
import { getAppPrisma } from '../../core/prisma-context';

export async function contestManagementModule(
  fastify: FastifyInstance,
): Promise<void> {
  const prisma = getAppPrisma(fastify);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const contestManagementService = new ContestManagementService(
    new PrismaContestCoreRepository(prisma),
    new PrismaContestConfigurationRepository(prisma),
    new PrismaParticipantContestScoringRuleRepository(prisma),
    new PrismaContestEntryAggregationRuleRepository(prisma),
    new PrismaContestPrizeDefinitionRepository(prisma),
  );
  const handlers = createContestManagementHandlers(contestManagementService);

  fastify.post('/', {
    schema: {
      tags: ['Contest Management'],
      summary: 'Create a commissioner-managed contest with configuration',
      description:
        'Creates a contest together with its commissioner-managed configuration so league administration surfaces can launch a fully configured contest in one flow.',
      operationId: 'createManagedContest',
      body: zodToJsonSchema(CreateContestManagementRequestSchema),
      response: {
        201: zodToJsonSchema(ContestManagementResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        422: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requirePermission(
      membershipRepo,
      CommissionerPermission.CONTEST_CREATE,
    ),
    handler: handlers.createContest,
  });

  fastify.get('/:contestId', {
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
    preHandler: requirePermission(
      membershipRepo,
      CommissionerPermission.CONTEST_EDIT,
    ),
    handler: handlers.getContest,
  });

  fastify.put('/:contestId/configuration', {
    schema: {
      tags: ['Contest Management'],
      summary: 'Update commissioner contest configuration',
      description:
        'Updates the commissioner-managed configuration for an existing contest and returns the refreshed management detail payload.',
      operationId: 'updateManagedContestConfiguration',
      body: zodToJsonSchema(ContestConfigurationRequestSchema),
      response: {
        200: zodToJsonSchema(ContestManagementResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
        422: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requirePermission(
      membershipRepo,
      CommissionerPermission.CONTEST_EDIT,
    ),
    handler: handlers.updateContestConfiguration,
  });
}
