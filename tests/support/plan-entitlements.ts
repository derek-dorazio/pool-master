import type { LeagueRepository } from '@poolmaster/shared/db';
import type { PlanConfig } from '@poolmaster/shared/dto';
import { PlanEntitlementsService } from '../../packages/core-api/src/modules/plans/plan-entitlements-service';
import { PLAN_SETTINGS } from '../../packages/core-api/src/modules/plans/plan-settings';
import { buildLeague } from '../factories';

/**
 * The real plan entitlements service over a test's leagues and a PLAN_CONFIG it can change: the
 * shipped defaults unless the test sets its own (#947).
 */
export function planEntitlementsOver(leagues: Pick<LeagueRepository, 'findById'>, config?: () => PlanConfig): PlanEntitlementsService {
  const defaults = PLAN_SETTINGS.defaults({});
  return new PlanEntitlementsService({ leagues, readConfig: config ?? (() => defaults) });
}

/** For a test whose leagues exist only by id: every league is on Platinum, the default plan. */
export function platinumEntitlements(): PlanEntitlementsService {
  return planEntitlementsOver({ findById: async (id) => buildLeague({ id }) });
}
