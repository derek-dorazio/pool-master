/**
 * History module (#837) — what happened in a league's past, under /api/v1/leagues/:id/history.
 * Members of the league read it (root admins bypass).
 */
import type { FastifyInstance } from 'fastify';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
// Registers the named components these routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaLeagueMembershipRepository } from '../../adapters';
import { leagueFromPath, requireMemberOfLeague } from '../leagues/permissions';
import { createHistoryHandlers } from './handler';
import { createHistoryService } from './wiring';

export function historyModule(fastify: FastifyInstance): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const membersOnly = requireMemberOfLeague(new PrismaLeagueMembershipRepository(prisma), leagueFromPath);
  const handlers = createHistoryHandlers(createHistoryService(prisma, fastify.log));

  fastify.get('/contests', {
    schema: {
      tags: ['History'],
      summary: 'List a year\'s final contests',
      description: 'Every contest of the league that went final in the championship year (US Eastern), newest first, with its winners and whether it counted. With squadId, only the counted contests that squad placed in; with squadId and place, only those it finished in that place, so each list matches the finish matrix. No paging: a league finishes a few hundred contests a year at most. Active members of the league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.',
      operationId: 'listContestResults',
      querystring: schemaRef('ListContestResultsQuery'),
      response: {
        200: schemaRef('ContestResultListResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: membersOnly,
    handler: handlers.listContestResults,
  });
}
