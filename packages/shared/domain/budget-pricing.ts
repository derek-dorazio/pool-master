import { z } from 'zod';
import type { DomainEntity } from './types';
import type { FieldOrderBasis } from './enums';

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
 * The values are kept as named pricing profiles, defined once for the platform; each sport league
 * names one, which prices its events' fields after a sync (#1844). The values an event slot's set
 * was actually priced with are stored on the slot and lock with its prices (#2044). A budget
 * contest's salary cap is that of the slot its picks are valued in.
 */

const BUDGET_SALARY_CAP_MAX = 10_000_000;
export const BUDGET_STEEPNESS_MAX = 10;

/** The five values a field is priced with. */
const BudgetPricingValuesSchema = z.object({
  salaryCap: z.number().int().min(1).max(BUDGET_SALARY_CAP_MAX)
    .describe('Whole dollars. The salary cap the prices are a share of, and the cap of every budget contest on the event.'),
  unit: z.number().int().min(1).max(BUDGET_SALARY_CAP_MAX)
    .describe('Whole dollars. Every price is rounded to a multiple of it. At most the worst golfer\'s price.'),
  topSharePercent: z.number().min(0.1).max(100)
    .describe('The best seed\'s price, as a percentage of the salary cap.'),
  floorSharePercent: z.number().min(0.1).max(100)
    .describe('The worst seed\'s price, as a percentage of the salary cap. At most `topSharePercent`.'),
  steepness: z.number().min(0.1).max(BUDGET_STEEPNESS_MAX)
    .describe('How fast prices fall from the top: 1 is a straight line; higher keeps the top few expensive and drops the middle of the field towards the floor.'),
}).describe('The values a field is priced with for budget contests.');
export type BudgetPricingValues = z.infer<typeof BudgetPricingValuesSchema>;

/** A named set of pricing values: a pricing profile's name and values. */
export const BudgetPricingProfileSchema = BudgetPricingValuesSchema.extend({
  name: z.string().trim().min(1).max(50).describe('The profile\'s name, such as "Standard".'),
}).describe('A named set of budget pricing values.');
export type BudgetPricingProfile = z.infer<typeof BudgetPricingProfileSchema>;

/**
 * The values an event slot's set was priced with, and the profile they started from (#2044).
 * Stored on the slot by every price assignment and locked with the set.
 */
export const SlotPricingSchema = BudgetPricingValuesSchema.extend({
  platformPricingProfileId: z.uuid()
    .describe('The pricing profile the values started from. The admin may have changed any value before assigning.'),
}).describe('The values an event slot\'s set was priced with for budget contests, and the profile they started from.');
export type SlotPricing = z.infer<typeof SlotPricingSchema>;


/** A pricing profile, defined once for the platform; each sport league names one (`SportLeague.platformPricingProfileId`). */
export interface PlatformPricingProfile extends DomainEntity, BudgetPricingProfile {
  /** The profile's key: what migrations, seed scripts and test data find it by, never its name. */
  code: string;
  /** Plain English for agents and root admins: what the profile is and why it exists (#2194). Not shown to commissioners or members, who read the display strings keyed by `code`. */
  description: string;
  /** The values the field is ordered by before it is priced, first deciding (#2160). */
  sources: FieldOrderBasis[];
}

/** A profile's values as an event slot is priced with them, unchanged. */
export function slotPricingOf(profile: PlatformPricingProfile): SlotPricing {
  return {
    platformPricingProfileId: profile.id,
    salaryCap: profile.salaryCap,
    unit: profile.unit,
    topSharePercent: profile.topSharePercent,
    floorSharePercent: profile.floorSharePercent,
    steepness: profile.steepness,
  };
}

/** Why a set of pricing values can't price a field, or null when it can. */
export function findBudgetPricingProblem(values: BudgetPricingValues): string | null {
  if (values.floorSharePercent > values.topSharePercent) {
    return 'The worst seed\'s share can\'t be above the best seed\'s.';
  }
  // Rounding to a unit above the worst seed's price could take that price to $0.
  const worstPrice = (values.salaryCap * values.floorSharePercent) / 100;
  if (values.unit > worstPrice) {
    return `The rounding unit can't be larger than the worst golfer's price, $${worstPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}.`;
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

/**
 * Prices a field already in its one order, best first (#1807, `orderField`), on the profile's
 * budget curve. Each id's place in that order puts it on the curve, so a withdrawal leaves no gap,
 * and a price is explainable from the order alone.
 */
export function priceFieldOnBudgetCurve<Id>(values: BudgetPricingValues, orderedField: readonly Id[]): Array<{ id: Id; price: number }> {
  return orderedField.map((id, position) => ({ id, price: priceOnBudgetCurve(values, position, orderedField.length) }));
}
