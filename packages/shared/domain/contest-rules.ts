import { z } from 'zod';
import { SelectionType } from './enums';
import { BUDGET_SALARY_CAP_MAX } from './budget-pricing';

/**
 * A contest's rules (#93): one shape per selection type, told apart by `selectionType`, which
 * always matches the contest's own. A new selection type adds its own arm here.
 *
 * - **Tiered:** the entry picks `picksPerTier` golfers from each of the event's tiers, so its
 *   roster is the event's tier count times that (see tiered-roster.ts).
 * - **Budget:** the entry picks `rosterSize` golfers whose prices fit under the salary cap. The
 *   cap is the event's (its field was priced against it), copied onto the contest when it is
 *   created or its rules change; the commissioner never sets it.
 *
 * In both, the best `countedScores` golfer scores count toward the entry's total.
 */

/** The most golfers a budget roster may hold. */
export const BUDGET_ROSTER_SIZE_MAX = 12;

const countedScoresSchema = z.number().int().min(1)
  .describe('How many golfer scores count toward the entry total, best first. At most the roster size.');

export const TieredContestRulesSchema = z.object({
  selectionType: z.literal(SelectionType.TIERED),
  picksPerTier: z.number().int().min(1)
    .describe("How many golfers an entry picks from each of the event's tiers. The entry's total picks is the event's tier count times this."),
  countedScores: countedScoresSchema,
}).describe('Tiered rules: pick the same number of golfers from every tier of the event.');
export type TieredContestRules = z.infer<typeof TieredContestRulesSchema>;

export const BudgetContestRulesSchema = z.object({
  selectionType: z.literal(SelectionType.BUDGET_PICK),
  rosterSize: z.number().int().min(1).max(BUDGET_ROSTER_SIZE_MAX)
    .describe('How many golfers an entry picks, from anywhere in the field.'),
  countedScores: countedScoresSchema,
}).describe("Budget rules: pick a roster of golfers whose prices fit under the event's salary cap.");
export type BudgetContestRules = z.infer<typeof BudgetContestRulesSchema>;

/** The rules a commissioner chooses, and a template presets. */
export const ContestRulesSchema = z.discriminatedUnion('selectionType', [
  TieredContestRulesSchema,
  BudgetContestRulesSchema,
]);
export type ContestRules = z.infer<typeof ContestRulesSchema>;

export const BudgetContestConfigSchema = BudgetContestRulesSchema.extend({
  salaryCap: z.number().int().min(1).max(BUDGET_SALARY_CAP_MAX)
    .describe("Whole dollars. The event's salary cap when the rules were saved; an entry's picks must cost no more."),
});
export type BudgetContestConfig = z.infer<typeof BudgetContestConfigSchema>;

/** The rules a contest stores: what the commissioner chose, plus a budget contest's cap. */
export const ContestSelectionConfigSchema = z.discriminatedUnion('selectionType', [
  TieredContestRulesSchema,
  BudgetContestConfigSchema,
]);
export type ContestSelectionConfig = z.infer<typeof ContestSelectionConfigSchema>;

const maxEntriesPerSquadSchema = z.number().int().min(1).nullable().optional()
  .describe('Maximum entries a Team may create. Null means unlimited.');

/**
 * Rules with an entries-per-team limit: what a template presets, and what a commissioner sends
 * when creating a contest or changing its rules.
 */
export const ContestRulesWithEntryLimitSchema = z.discriminatedUnion('selectionType', [
  TieredContestRulesSchema.extend({ maxEntriesPerSquad: maxEntriesPerSquadSchema }),
  BudgetContestRulesSchema.extend({ maxEntriesPerSquad: maxEntriesPerSquadSchema }),
]);
export type ContestRulesWithEntryLimit = z.infer<typeof ContestRulesWithEntryLimitSchema>;

/**
 * Whether a budget roster can be filled under a cap: the `rosterSize` cheapest prices summed in
 * cents, so prices like 33.33 add up exactly. False when there are fewer prices than places.
 */
export function canFillBudgetRoster(prices: readonly number[], rosterSize: number, salaryCap: number): boolean {
  if (prices.length < rosterSize) {
    return false;
  }
  const cheapestCents = prices
    .map(toCents)
    .sort((left, right) => left - right)
    .slice(0, rosterSize)
    .reduce((sum, cents) => sum + cents, 0);
  return cheapestCents <= toCents(salaryCap);
}

/** A dollar amount as whole cents. Money is summed in cents, never as floating dollars. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}
