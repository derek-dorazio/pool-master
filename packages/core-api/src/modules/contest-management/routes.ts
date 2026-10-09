import type { FastifyInstance } from 'fastify';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { PrismaLeagueMembershipRepository } from '../../adapters';
import { requireCommissioner } from '../leagues/permissions';
import { createContestManagementHandlers } from './handler';
import { createContestManagementService } from './wiring';
import { getAppPrisma } from '../../core/prisma-context';

export function contestManagementModule(
  fastify: FastifyInstance,
): void {
  void fastify.register(schemaComponentsPlugin);

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
        200: schemaRef('ContestManagementResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
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
        'Updates a draft contest\'s configuration and returns it as getContestConfiguration does. Commissioner only. Refused with 409 CONTEST_CONFIGURATION_LOCKED once the contest is no longer DRAFT: opening it to the league locks its settings for good.',
      operationId: 'updateContestConfiguration',
      body: schemaRef('ContestConfigurationRequest'),
      response: {
        200: schemaRef('ContestManagementResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
        409: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_CONFIGURATION_LOCKED — the contest has been opened to the league (it is not DRAFT), so its configuration can no longer change.',
        },
        422: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: handlers.updateContestConfiguration,
  });

  fastify.post('/contests/:contestId/open', {
    schema: {
      tags: ['Contest Management'],
      summary: 'Open a draft contest to the league',
      description:
        'Moves a DRAFT contest to OPEN so league members can see and enter it, and returns it as getContestConfiguration does. Commissioner only. There is no undo: from here its name, configuration and existence are locked. The event\'s field need not be ready; entries wait on it.',
      operationId: 'openContest',
      response: {
        200: schemaRef('ContestManagementResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_NOT_FOUND, or SPORT_EVENT_NOT_FOUND when the contest\'s event is gone.',
        },
        409: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_NOT_DRAFT — the contest is already open, or past it. CONTEST_EVENT_ALREADY_STARTED — the event\'s start time has passed or it is IN_PROGRESS, COMPLETED or CANCELLED; the draft stays a draft.',
        },
        422: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_TIER_FIELD_OUT_OF_RANGE — the stored configuration no longer fits the event\'s tiers; edit the draft first.',
        },
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: handlers.openContest,
  });
}
