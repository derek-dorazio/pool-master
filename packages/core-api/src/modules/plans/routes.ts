/**
 * Plans module (#945) — what each league plan allows, under /api/v1/plans, for the public Plans
 * page (#971) and the plan comparison commissioners choose from. A league's own plan is changed
 * on its league route (`updateLeaguePlan`); PLAN_CONFIG itself is a root admin settings group.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LEAGUE_PLANS } from '@poolmaster/shared/domain';
import type { LeaguePlanListResponse } from '@poolmaster/shared/dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
// Registers the named components these routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { toPlanEntitlementsDto } from '../../mappers/plans.mapper';
import type { PlanEntitlementsService } from './plan-entitlements-service';

/** What a route module that reports or checks a league's plan is registered with. */
export interface PlanModuleOptions {
  planEntitlements: PlanEntitlementsService;
}

export function plansModule(fastify: FastifyInstance, opts: PlanModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  fastify.get('/', {
    schema: {
      tags: ['Plans'],
      summary: 'List what each league plan allows',
      description:
        'Every league plan, lowest first (FREE, PRO, PREMIUM, PLATINUM), with its caps and features under the current plan settings, for the public Plans page and the comparison a commissioner picks a plan from. Public: no session is needed, and it holds nothing about any league or user.',
      operationId: 'listLeaguePlans',
      response: {
        200: schemaRef('LeaguePlanListResponse'),
      },
    },
    handler: async (request: FastifyRequest, _reply: FastifyReply): Promise<LeaguePlanListResponse> => {
      const logger = request.contextLogger ?? request.log;
      logger.debug({ action: 'plansRoute.list.enter' }, 'Listing league plans');
      return { plans: LEAGUE_PLANS.map((plan) => toPlanEntitlementsDto(opts.planEntitlements.forPlan(plan))) };
    },
  });
}
