/**
 * Cups module (#841) — a league's sports league cups, under /api/v1/leagues/:id/cups. Members of
 * the league read them and its commissioner crowns them (root admins bypass).
 */
import type { FastifyInstance } from 'fastify';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
// Registers the named components these routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaLeagueMembershipRepository } from '../../adapters';
import { leagueFromPath, requireCommissioner, requireMemberOfLeague } from '../leagues/permissions';
import { createCupHandlers } from './handler';
import { createCupService } from './wiring';

const MEMBERS_ONLY = 'Active members of the league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.';

export function cupsModule(fastify: FastifyInstance): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const membersOnly = requireMemberOfLeague(membershipRepo, leagueFromPath);
  const handlers = createCupHandlers(createCupService(prisma, fastify.log));

  fastify.get('/', {
    schema: {
      tags: ['Cups'],
      summary: 'List a season\'s cups',
      description:
        `The league's sports league cups of one season, oldest first: one per sports league the league has a contest of that season in, each with its standings and its contests. Standings are worked out from the contests' frozen places: a squad scores from its best entry on the league's points table, times each contest's weight. ${MEMBERS_ONLY}`,
      operationId: 'listCups',
      querystring: schemaRef('ListCupsQuery'),
      response: {
        200: schemaRef('CupListResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: membersOnly,
    handler: handlers.listCups,
  });

  fastify.get('/:cupId', {
    schema: {
      tags: ['Cups'],
      summary: 'Get a cup',
      description: `One cup with its standings and contests: the Points race. 404 CUP_NOT_FOUND for a cup that is not the league's. ${MEMBERS_ONLY}`,
      operationId: 'getCup',
      response: {
        200: schemaRef('CupResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: membersOnly,
    handler: handlers.getCup,
  });

  fastify.get('/:cupId/squads/:squadId', {
    schema: {
      tags: ['Cups'],
      summary: 'Get a squad\'s cup points',
      description: `One squad's points in a cup, counted contest by counted contest, in the order they went final. 404 CUP_NOT_FOUND for a cup that is not the league's, SQUAD_NOT_FOUND for a squad that is not. ${MEMBERS_ONLY}`,
      operationId: 'getCupSquadPoints',
      response: {
        200: schemaRef('CupSquadPointsResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: membersOnly,
    handler: handlers.getCupSquadPoints,
  });

  fastify.get('/:cupId/projection', {
    schema: {
      tags: ['Cups'],
      summary: 'Project a cup from its live contests',
      description: `An open cup's standings if every live contest it counts ended now: each scores from its leaderboard's places as they stand, at its own weight, on top of the contests already counted. A live contest whose picks are not revealed yet, or a squares contest, ranks nobody. Nothing is stored. 409 CUP_CROWNED for a crowned cup, whose standings are final; 404 CUP_NOT_FOUND for a cup that is not the league's. ${MEMBERS_ONLY}`,
      operationId: 'getCupProjection',
      response: {
        200: schemaRef('CupProjectionResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
        409: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: membersOnly,
    handler: handlers.getCupProjection,
  });

  fastify.post('/:cupId/crown', {
    schema: {
      tags: ['Cups'],
      summary: 'Crown a cup',
      description:
        'Allows a commissioner to crown a cup once its season is done: every squad\'s place is frozen with the points table it was scored on, and the squads 1st, 2nd and 3rd with points take its trophies, ties sharing. A contest that goes final later is listed AFTER_CROWNING and changes nothing. 409 CUP_HAS_UNFINISHED_CONTESTS while a counted contest is open or live, its `details.contests` listing each (`contestId`, `name`, `status`); 409 CUP_NOTHING_COUNTED before any contest has counted toward it; 409 CUP_CROWNED for a cup already crowned; 404 CUP_NOT_FOUND for a cup that is not the league\'s. Active commissioners only (root admins bypass).',
      operationId: 'crownCup',
      response: {
        200: schemaRef('CupResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
        409: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: handlers.crownCup,
  });
}
