import { z } from 'zod';

/**
 * Budget pricing (#93): how an event's field is priced for budget contests.
 *
 * Every golfer gets a price on a curve over the field's seed order, as a share of a salary cap:
 *
 *   x     = position / (fieldSize - 1)          0 for the best seed, 1 for the worst
 *   share = floor + (top - floor) * (1 - x) ^ steepness
 *   price = round(salaryCap * share / unit) * unit
 *
 * A steepness of 1 is a straight line; higher keeps the top few expensive and drops the middle
 * of the field towards the floor, so the cap always binds and every pick is a trade-off.
 *
 * The values are kept as named profiles in the "Budget pricing" app settings, and the values an
 * event was actually priced with are stored on the event and lock with its prices at release. A
 * budget contest's salary cap is its event's.
 */

export const BUDGET_SALARY_CAP_MAX = 10_000_000;
export const BUDGET_STEEPNESS_MAX = 10;

/** The five values a field is priced with. */
export const BudgetPricingValuesSchema = z.object({
  salaryCap: z.number().int().min(1).max(BUDGET_SALARY_CAP_MAX)
    .describe('Whole dollars. The salary cap the prices are a share of, and the cap of every budget contest on the event.'),
  unit: z.number().int().min(1).max(BUDGET_SALARY_CAP_MAX)
    .describe('Whole dollars. Every price is rounded to a multiple of it.'),
  topSharePercent: z.number().min(0.1).max(100)
    .describe('The best seed\'s price, as a percentage of the salary cap.'),
  floorSharePercent: z.number().min(0.1).max(100)
    .describe('The worst seed\'s price, as a percentage of the salary cap. At most `topSharePercent`.'),
  steepness: z.number().min(0.1).max(BUDGET_STEEPNESS_MAX)
    .describe('How fast prices fall from the top: 1 is a straight line; higher keeps the top few expensive and drops the middle of the field towards the floor.'),
}).describe('The values a field is priced with for budget contests.');
export type BudgetPricingValues = z.infer<typeof BudgetPricingValuesSchema>;

/** A named set of pricing values, kept in the Budget pricing app settings. */
export const BudgetPricingProfileSchema = BudgetPricingValuesSchema.extend({
  name: z.string().trim().min(1).max(50).describe('The profile\'s name, such as "Standard".'),
}).describe('A named set of budget pricing values.');
export type BudgetPricingProfile = z.infer<typeof BudgetPricingProfileSchema>;

/**
 * The values an event's field was priced with, and the profile they started from. Stored on the
 * event by every price assignment and locked at release.
 */
export const EventPricingConfigSchema = BudgetPricingValuesSchema.extend({
  profileName: z.string().trim().min(1).max(50)
    .describe('The profile the values started from. The admin may have changed any value before assigning.'),
}).describe('The values an event\'s field was priced with for budget contests.');
export type EventPricingConfig = z.infer<typeof EventPricingConfigSchema>;

/** The two profiles the app starts with (Derek 2026-10-09): the same curve at two scales. */
export const DEFAULT_BUDGET_PRICING_PROFILES: readonly BudgetPricingProfile[] = [
  { name: 'Standard', salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 },
  { name: 'Small', salaryCap: 5_000, unit: 10, topSharePercent: 24, floorSharePercent: 12, steepness: 4 },
];

/** Why a set of pricing values can't price a field, or null when it can. */
export function findBudgetPricingProblem(values: BudgetPricingValues): string | null {
  if (values.floorSharePercent > values.topSharePercent) {
    return 'The worst seed\'s share can\'t be above the best seed\'s.';
  }
  if (values.unit > values.salaryCap) {
    return 'The rounding unit can\'t be larger than the salary cap.';
  }
  return null;
}

/**
 * The price of the golfer at `position` (0 for the best seed) in a field of `fieldSize`, in whole
 * dollars. A field of one is priced at the top share.
 */
export function priceOnBudgetCurve(values: BudgetPricingValues, position: number, fieldSize: number): number {
  const x = fieldSize > 1 ? position / (fieldSize - 1) : 0;
  const sharePercent = values.floorSharePercent
    + (values.topSharePercent - values.floorSharePercent) * (1 - x) ** values.steepness;
  return Math.round((values.salaryCap * sharePercent) / 100 / values.unit) * values.unit;
}
