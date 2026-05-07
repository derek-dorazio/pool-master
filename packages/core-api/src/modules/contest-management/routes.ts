import type { FastifyInstance } from 'fastify';
import {
  ContestConfigTemplateListResponseSchema,
  ContestConfigurationRequestSchema,
  ContestManagementResponseSchema,
  CreateContestManagementRequestSchema,
  ErrorEnvelopeSchema,
  ListContestConfigTemplatesQuerySchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import {
  PrismaContestConfigTemplateRepository,
  PrismaContestConfigurationRepository,
  PrismaContestCoreRepository,
  PrismaContestEntryAggregationRuleRepository,
  PrismaContestPrizeDefinitionRepository,
  PrismaLeagueMembershipRepository,
  PrismaParticipantContestScoringRuleRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventParticipantValuationRepository,
} from '../../adapters';
import { requireCommissioner } from '../leagues/permissions';
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
    new PrismaContestConfigTemplateRepository(prisma),
    new PrismaContestConfigurationRepository(prisma),
    new PrismaParticipantContestScoringRuleRepository(prisma),
    new PrismaContestEntryAggregationRuleRepository(prisma),
    new PrismaContestPrizeDefinitionRepository(prisma),
    new PrismaSportEventParticipantRepository(prisma),
    new PrismaSportEventParticipantValuationRepository(prisma),
    fastify.log,
    {
      findById: async (sportEventId) => {
        const row = await prisma.sportEvent.findUnique({
          where: { id: sportEventId },
          include: {
            _count: {
              select: {
                sportEventParticipants: true,
              },
            },
          },
        });

        if (!row) {
          return null;
        }

        return {
          id: row.id,
          releaseAt: row.releaseAt,
          fieldLocksAt: row.fieldLocksAt,
          fieldLocked: row.fieldLocked,
          participantCount: row.participantCount,
          loadedParticipantCount: row._count.sportEventParticipants,
        };
      },
    },
  );
  const handlers = createContestManagementHandlers(contestManagementService);

  fastify.get('/templates', {
    schema: {
      tags: ['Contest Management'],
      summary: 'List seeded contest templates for commissioner create flow',
      description:
        'Returns the seeded contest configuration templates available for a sport and contest type so commissioner create flows can default to smart presets before advanced editing.',
      operationId: 'listManagedContestTemplates',
      querystring: zodToJsonSchema(ListContestConfigTemplatesQuerySchema),
      response: {
        200: zodToJsonSchema(ContestConfigTemplateListResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: handlers.listTemplates,
  });

  fastify.post('/contests', {
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
    preHandler: requireCommissioner(membershipRepo),
    handler: handlers.createContest,
  });

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
    preHandler: requireCommissioner(membershipRepo),
    handler: handlers.updateContestConfiguration,
  });
}
