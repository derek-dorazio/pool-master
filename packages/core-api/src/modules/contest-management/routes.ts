import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { CommissionerPermission } from '@poolmaster/shared/domain';
import {
  ContestConfigurationRequestSchema,
  ContestManagementResponseSchema,
  CreateContestManagementRequestSchema,
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

export async function contestManagementModule(
  fastify: FastifyInstance,
): Promise<void> {
  const prisma = new PrismaClient();
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
      operationId: 'createManagedContest',
      body: zodToJsonSchema(CreateContestManagementRequestSchema),
      response: { 201: zodToJsonSchema(ContestManagementResponseSchema) },
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
      operationId: 'getManagedContest',
      response: { 200: zodToJsonSchema(ContestManagementResponseSchema) },
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
      operationId: 'updateManagedContestConfiguration',
      body: zodToJsonSchema(ContestConfigurationRequestSchema),
      response: { 200: zodToJsonSchema(ContestManagementResponseSchema) },
    },
    preHandler: requirePermission(
      membershipRepo,
      CommissionerPermission.CONTEST_EDIT,
    ),
    handler: handlers.updateContestConfiguration,
  });
}
