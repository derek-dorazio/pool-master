/**
 * LeaguePlanService (#945): moves a league to another plan. Any commissioner of the league, or a
 * root admin, may pick any plan at any time, free; it applies at once, and every change is logged
 * with who made it. Moving to the plan the league is already on changes and logs nothing.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { LeagueRepository } from '@poolmaster/shared/db';
import type { League, LeaguePlan } from '@poolmaster/shared/domain';
import { LeagueNotFoundError, LeagueOperationError } from '../leagues/service';

export interface LeaguePlanServiceDeps {
  leagues: Pick<LeagueRepository, 'findById' | 'changePlan'>;
  logger?: FastifyBaseLogger;
}

export class LeaguePlanService {
  constructor(private readonly deps: LeaguePlanServiceDeps) {}

  async changePlan(leagueId: string, plan: LeaguePlan, changedById: string): Promise<League> {
    const { leagues, logger } = this.deps;
    logger?.debug({ action: 'leaguePlan.change.enter', data: { leagueId, plan } }, 'Changing league plan');
    const league = await leagues.findById(leagueId);
    if (!league) {
      logger?.warn({ action: 'leaguePlan.change.notFound', data: { leagueId } }, 'Cannot change the plan of a missing league');
      throw new LeagueNotFoundError(leagueId);
    }
    if (!league.isActive) {
      logger?.warn({ action: 'leaguePlan.change.readOnlyInactive', data: { leagueId } }, 'Rejected plan change for inactive league');
      throw new LeagueOperationError(
        'Inactive leagues are read-only outside lifecycle actions',
        'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE',
      );
    }
    if (league.plan === plan) {
      logger?.debug({ action: 'leaguePlan.change.unchanged', data: { leagueId, plan } }, 'League is already on that plan');
      return league;
    }
    const updated = await leagues.changePlan(leagueId, { fromPlan: league.plan, toPlan: plan, changedById });
    logger?.info({
      action: 'leaguePlan.change.success',
      data: { leagueId, fromPlan: league.plan, toPlan: plan, changedById },
    }, 'Changed league plan');
    return updated;
  }
}
