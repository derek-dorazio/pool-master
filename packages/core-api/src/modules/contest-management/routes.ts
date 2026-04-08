import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { CommissionerPermission } from '@poolmaster/shared/domain';
import {
  ContestManagementResponseSchema,
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

const contestPrizeDefinitionRequestSchema = {
  type: 'object',
  required: ['prizeDefinitionId', 'displayName', 'sortOrder', 'ruleConfig', 'active'],
  properties: {
    prizeDefinitionId: { type: 'string', minLength: 1 },
    displayName: { type: 'string', minLength: 1, maxLength: 100 },
    sortOrder: { type: 'integer', minimum: 0 },
    ruleConfig: { type: 'object', additionalProperties: true, default: {} },
    payoutType: { type: 'string', enum: ['FIXED_AMOUNT', 'PERCENTAGE'] },
    amount: { type: 'number', minimum: 0 },
    percentage: { type: 'number', minimum: 0, maximum: 100 },
    active: { type: 'boolean', default: true },
  },
} as const;

const participantContestScoringRuleRequestSchema = {
  type: 'object',
  required: ['participantScoringDefinitionId', 'sortOrder', 'config', 'active'],
  properties: {
    participantScoringDefinitionId: { type: 'string', minLength: 1 },
    sortOrder: { type: 'integer', minimum: 0 },
    config: { type: 'object', additionalProperties: true, default: {} },
    active: { type: 'boolean', default: true },
  },
} as const;

const contestEntryAggregationRuleRequestSchema = {
  type: 'object',
  required: ['aggregationDefinitionId', 'config', 'active'],
  properties: {
    aggregationDefinitionId: { type: 'string', minLength: 1 },
    config: { type: 'object', additionalProperties: true, default: {} },
    active: { type: 'boolean', default: true },
  },
} as const;

const contestConfigurationRequestSchema = {
  type: 'object',
  required: [
    'selectionType',
    'participantScoringRules',
    'entryAggregationRule',
    'prizeDefinitions',
  ],
  properties: {
    selectionType: {
      type: 'string',
      enum: ['SNAKE_DRAFT', 'TIERED', 'BUDGET_PICK', 'OPEN_SELECTION'],
    },
    rounds: { type: 'integer', minimum: 1 },
    timePerPickSeconds: { type: 'integer', minimum: 10 },
    autoPickPolicy: { type: 'string', minLength: 1 },
    tierConfig: {
      type: 'array',
      items: {
        type: 'object',
        required: ['tierId', 'tierName', 'tierNumber', 'picksFromTier', 'participantIds'],
        properties: {
          tierId: { type: 'string', minLength: 1 },
          tierName: { type: 'string', minLength: 1 },
          tierNumber: { type: 'integer', minimum: 1 },
          picksFromTier: { type: 'integer', minimum: 1 },
          participantIds: { type: 'array', items: { type: 'string', minLength: 1 } },
        },
      },
    },
    budget: { type: 'number', minimum: 0 },
    pricingMethod: { type: 'string', minLength: 1 },
    pickCount: { type: 'integer', minimum: 1 },
    isExclusive: { type: 'boolean' },
    picksPerPeriod: { type: 'integer', minimum: 1 },
    roundValues: { type: 'array', items: { type: 'number' } },
    startRound: { type: 'string', minLength: 1 },
    locksAt: { type: 'string', format: 'date-time', nullable: true },
    minimumEntries: { type: 'integer', minimum: 0 },
    maxEntriesPerSquad: { type: 'integer', minimum: 1 },
    rosterSize: { type: 'integer', minimum: 1 },
    totalPrizePoolAmount: { type: 'number', minimum: 0, nullable: true },
    participantScoringRules: {
      type: 'array',
      items: participantContestScoringRuleRequestSchema,
    },
    entryAggregationRule: contestEntryAggregationRuleRequestSchema,
    prizeDefinitions: {
      type: 'array',
      items: contestPrizeDefinitionRequestSchema,
      default: [],
    },
  },
} as const;

const createContestManagementRequestBodySchema = {
  type: 'object',
  required: ['name', 'sportEventId', 'contestType', 'configuration'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    sportEventId: { type: 'string', format: 'uuid' },
    contestType: { type: 'string', enum: ['SINGLE_EVENT'] },
    configuration: contestConfigurationRequestSchema,
  },
} as const;

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
      body: createContestManagementRequestBodySchema,
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
      body: contestConfigurationRequestSchema,
      response: { 200: zodToJsonSchema(ContestManagementResponseSchema) },
    },
    preHandler: requirePermission(
      membershipRepo,
      CommissionerPermission.CONTEST_EDIT,
    ),
    handler: handlers.updateContestConfiguration,
  });
}
