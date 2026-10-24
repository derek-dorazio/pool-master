import { LeaguePlan, PlanCap } from '@poolmaster/shared/domain';

/** What each league plan is called on screen (#943). Always "plan", never "tier". */
export const LEAGUE_PLAN_LABEL: Readonly<Record<LeaguePlan, string>> = {
  [LeaguePlan.FREE]: 'Free',
  [LeaguePlan.PRO]: 'Pro',
  [LeaguePlan.PREMIUM]: 'Premium',
  [LeaguePlan.PLATINUM]: 'Platinum',
};

/** What each plan cap is called on screen (#944). */
export const PLAN_CAP_LABEL: Readonly<Record<PlanCap, string>> = {
  [PlanCap.ENTRIES_PER_CONTEST]: 'Entries per contest',
  [PlanCap.SPORTS_LEAGUES_PER_YEAR]: 'Sports leagues a year',
};

/** A cap's limit on screen: the number, or "Unlimited". */
export function formatPlanLimit(limit: number | null): string {
  return limit === null ? 'Unlimited' : limit.toLocaleString('en-US');
}
