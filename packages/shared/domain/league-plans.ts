import { CAPPED_LEAGUE_PLANS, type CappedLeaguePlan } from './enums';

/**
 * League plans (#943): what a plan allows is PLAN_CONFIG, and what one league may do is core-api's
 * plan entitlements service. This holds the one rule both the settings save and the Plans page
 * check, so the page can show the problem before saving.
 */

/** One cap's limit on each plan but Platinum (always unlimited): a whole number, or null for unlimited. */
export type PlanCapLimits = Readonly<Record<CappedLeaguePlan, number | null>>;

/**
 * The first plan whose limit is below the plan beneath it, or null when none is. A limit must
 * never fall as the plan rises, so moving up a plan never loses anything. Unlimited is above
 * every number, and Platinum, always unlimited, is above every plan.
 */
export function findFallingPlanLimit(limits: PlanCapLimits): CappedLeaguePlan | null {
  for (let index = 1; index < CAPPED_LEAGUE_PLANS.length; index += 1) {
    const lower = limits[CAPPED_LEAGUE_PLANS[index - 1]];
    const higher = limits[CAPPED_LEAGUE_PLANS[index]];
    if (lower === null ? higher !== null : higher !== null && higher < lower) {
      return CAPPED_LEAGUE_PLANS[index];
    }
  }
  return null;
}
