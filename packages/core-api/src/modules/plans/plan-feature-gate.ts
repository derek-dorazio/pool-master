/**
 * The plan feature gate (#948): the `preHandler` that refuses a route whose plan features the
 * league's plan lacks, with 403 PLAN_FEATURE_NOT_INCLUDED and the missing feature in `details`.
 * It asks the plan entitlements service about features, never about a plan.
 *
 * A lower plan hides a view; it never deletes what is behind it, so moving back up shows it again
 * (plans/monetization-strategy.md, *Moving to a lower plan*). Root admins do not bypass it: the
 * plan belongs to the league, not to who is looking, so a root admin testing a lower plan sees
 * what its members see. It runs after the route's membership gate, which settles who may ask.
 */

import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { LeagueChampionshipYearRepository } from '@poolmaster/shared/db';
import { PlanFeature } from '@poolmaster/shared/domain';
import { sendError } from '../../core/error-handler';
import { LeagueNotFoundError } from '../leagues/service';
import { leagueFromPath } from '../leagues/permissions';
import type { PlanEntitlementsService } from './plan-entitlements-service';
import { PlanFeatureNotIncludedError } from './plan-feature-error';

/** Sends 403 PLAN_FEATURE_NOT_INCLUDED with the missing feature in `details`, never naming a plan. */
export function sendPlanFeatureNotIncluded(reply: FastifyReply, error: PlanFeatureNotIncludedError) {
  return sendError(reply, 403, error.code, error.message, { feature: error.feature });
}

/**
 * The championship year a request reads, when it reads one: a closed year (#2021), one the
 * league has finished, also needs PAST_YEARS. Undefined reads the current year.
 */
export interface PlanFeatureYearGate {
  yearOf: (request: FastifyRequest) => number | undefined;
  closedYears: Pick<LeagueChampionshipYearRepository, 'isClosed'>;
}

export interface PlanFeatureGateOptions {
  year?: PlanFeatureYearGate;
}

/** How a route's OpenAPI description says what the gate refuses, for the features it needs. */
export function describePlanFeatureGate(features: readonly PlanFeature[], pastYears = false): string {
  const needed = [...features, ...(pastYears ? ['PAST_YEARS for a championship year the league has closed'] : [])].join(', ');
  return `403 PLAN_FEATURE_NOT_INCLUDED, its \`details.feature\` naming what is missing, unless the league's plan has ${needed} (root admins too).`;
}

/** The features a request needs: the route's own, and PAST_YEARS for a closed year. */
export function featuresNeeded(features: readonly PlanFeature[], readsClosedYear: boolean): PlanFeature[] {
  return readsClosedYear ? [...features, PlanFeature.PAST_YEARS] : [...features];
}

/**
 * Refuses the request unless the plan of the league named by `:id` has every one of `features`.
 * A league that does not exist answers 404 LEAGUE_NOT_FOUND.
 */
export function requirePlanFeatures(
  planEntitlements: Pick<PlanEntitlementsService, 'forLeague'>,
  features: readonly PlanFeature[],
  options: PlanFeatureGateOptions = {},
): preHandlerAsyncHookHandler {
  return async function checkPlanFeatures(request, reply): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    const leagueId = await leagueFromPath(request, reply);
    if (leagueId === null) {
      return;
    }
    let has: ReadonlySet<PlanFeature>;
    try {
      has = (await planEntitlements.forLeague(leagueId)).features;
    } catch (error) {
      if (error instanceof LeagueNotFoundError) {
        await sendError(reply, 404, 'LEAGUE_NOT_FOUND', error.message);
        return;
      }
      throw error;
    }
    const year = options.year?.yearOf(request);
    const readsClosedYear = year !== undefined && options.year !== undefined && await options.year.closedYears.isClosed({ leagueId, championshipYear: year });
    const missing = featuresNeeded(features, readsClosedYear).find((feature) => !has.has(feature));
    if (missing === undefined) {
      return;
    }
    logger.info({
      action: 'planFeature.gate.denied',
      data: { leagueId, feature: missing, userId: request.authUser?.userId ?? null },
    }, 'Refused a feature the league\'s plan does not include');
    await sendPlanFeatureNotIncluded(reply, new PlanFeatureNotIncludedError(missing));
  };
}
