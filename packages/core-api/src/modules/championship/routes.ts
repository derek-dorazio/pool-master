/**
 * Championship module (#863) — a league's championship across every sport, under
 * /api/v1/leagues/:id/championship. Members of the league read it (root admins bypass).
 */
import type { FastifyInstance } from 'fastify';
import { PlanFeature } from '@poolmaster/shared/domain';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
// Registers the named components these routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaLeagueMembershipRepository } from '../../adapters';
import { leagueFromPath, requireMemberOfLeague } from '../leagues/permissions';
import { describePlanFeatureGate, requirePlanFeatures } from '../plans/plan-feature-gate';
import type { PlanModuleOptions } from '../plans/routes';
import { createChampionshipHandlers } from './handler';
import { createChampionshipService } from './wiring';

const MEMBERS_ONLY = 'Active members of the league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.';

const YEAR_PARAMS = {
  type: 'object',
  required: ['id', 'year'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    year: { type: 'integer', minimum: 2000, maximum: 9999, description: 'The championship year, such as 2026.' },
  },
} as const;

export function championshipModule(fastify: FastifyInstance, opts: PlanModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const membersOnly = requireMemberOfLeague(new PrismaLeagueMembershipRepository(prisma), leagueFromPath);
  const handlers = createChampionshipHandlers(createChampionshipService(prisma, fastify.log));

  fastify.get('/', {
    schema: {
      tags: ['Championship'],
      summary: 'List championship years',
      description: `Every year the league has a counted contest in, newest first, with the squads in 1st: the champions of a year that is over, the leaders of the current one. Years with no counted contest are left out. ${MEMBERS_ONLY} ${describePlanFeatureGate([PlanFeature.CHAMPIONSHIP, PlanFeature.PAST_YEARS])}`,
      operationId: 'listChampionshipYears',
      response: {
        200: schemaRef('ChampionshipYearListResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: [membersOnly, requirePlanFeatures(opts.planEntitlements, [PlanFeature.CHAMPIONSHIP, PlanFeature.PAST_YEARS])],
    handler: handlers.listChampionshipYears,
  });

  fastify.get('/:year', {
    schema: {
      tags: ['Championship'],
      summary: 'Get a championship year',
      description: `One year of the league championship: every counted contest of every sport that went final in the calendar year (US Eastern), each squad scoring from its best entry with the points it earned at settlement. Standings with the finish matrix, and the medal tiles. A year with no counted contest answers every active squad at 0. ${MEMBERS_ONLY} ${describePlanFeatureGate([PlanFeature.CHAMPIONSHIP], true)}`,
      operationId: 'getChampionship',
      params: YEAR_PARAMS,
      response: {
        200: schemaRef('ChampionshipResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: [membersOnly, requirePlanFeatures(opts.planEntitlements, [PlanFeature.CHAMPIONSHIP], {
      yearOf: (request) => (request.params as { year: number }).year,
    })],
    handler: handlers.getChampionship,
  });
}
