import type { BudgetPricingValues } from '@poolmaster/shared/domain';
import { formatDollars } from '@/features/shared/ui';

/**
 * A set of budget pricing values (#93) in one line, as the Settings page lists a profile and the
 * Tiers page shows what an event was priced with: "$50,000 cap · $100 unit · best 24% · worst
 * 12% · steepness 4".
 */
export function describeBudgetPricing(values: BudgetPricingValues) {
  return [
    `${formatDollars(values.salaryCap)} cap`,
    `${formatDollars(values.unit)} unit`,
    `best ${values.topSharePercent}%`,
    `worst ${values.floorSharePercent}%`,
    `steepness ${values.steepness}`,
  ].join(' · ');
}
