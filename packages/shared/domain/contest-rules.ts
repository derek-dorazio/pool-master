import { z } from 'zod';
import { PickEmMode, SelectionType } from './enums';
import { BUDGET_SALARY_CAP_MAX } from './budget-pricing';
import { ContestScoringSettingsSchema } from './contest-scoring';

/**
 * A contest's rules (#93): one shape per selection type, told apart by `selectionType`, which
 * always matches the contest's own. A new selection type adds its own arm here.
 *
 * - **Tiered:** the entry picks `picksPerTier` golfers from each of the event's tiers, so its
 *   roster is the event's tier count times that (see tiered-roster.ts).
 * - **Budget:** the entry picks `rosterSize` golfers whose prices fit under the salary cap. The
 *   cap is the event's (its field was priced against it), copied onto the contest when it is
 *   created or its rules change; the commissioner never sets it.
 * - **Random draw:** nobody picks. The commissioner's draw deals each entry `picksPerEntry`
 *   members of the field at random (#601).
 *
 * - **Pick'em:** a prediction contest (#716). The entry picks the winner of every game of each
 *   of the contest's events; `mode` says whether it also ranks them by confidence.
 * - **Bracket:** a prediction contest on one knockout event (#721). The entry picks the winner of
 *   every game before the event starts, and a correct pick scores its round's value.
 *
 * In each roster type, the best `countedScores` golfer scores count toward the entry's total.
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

/** The most field members a draw deals one entry: the budget roster's ceiling. */
export const RANDOM_DRAW_PICKS_PER_ENTRY_MAX = BUDGET_ROSTER_SIZE_MAX;

export const RandomDrawContestRulesSchema = z.object({
  selectionType: z.literal(SelectionType.RANDOM_DRAW),
  picksPerEntry: z.number().int().min(1).max(RANDOM_DRAW_PICKS_PER_ENTRY_MAX)
    .describe('How many members of the field the draw deals each entry.'),
  countedScores: countedScoresSchema,
}).describe("Random-draw rules: the commissioner's draw deals every entry the same number of the field at random.");
export type RandomDrawContestRules = z.infer<typeof RandomDrawContestRulesSchema>;

export const PickEmContestRulesSchema = z.object({
  selectionType: z.literal(SelectionType.PICK_EM),
  mode: z.nativeEnum(PickEmMode)
    .describe('STRAIGHT_UP: pick the winner of every game. CONFIDENCE: also give each game of a week a value from 1 to its number of games, each used once.'),
}).describe("Pick'em rules: pick the winner of every game of each event.");
export type PickEmContestRules = z.infer<typeof PickEmContestRulesSchema>;

export const BracketContestRulesSchema = z.object({
  selectionType: z.literal(SelectionType.BRACKET),
}).describe('Bracket rules: pick the winner of every game of one knockout event before it starts, all the way to the final.');
export type BracketContestRules = z.infer<typeof BracketContestRulesSchema>;

/** The rules a commissioner chooses, and a template presets. */
export const ContestRulesSchema = z.discriminatedUnion('selectionType', [
  TieredContestRulesSchema,
  BudgetContestRulesSchema,
  RandomDrawContestRulesSchema,
  PickEmContestRulesSchema,
  BracketContestRulesSchema,
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
  RandomDrawContestRulesSchema,
  PickEmContestRulesSchema,
  BracketContestRulesSchema,
]);
export type ContestSelectionConfig = z.infer<typeof ContestSelectionConfigSchema>;

const maxEntriesPerSquadSchema = z.number().int().min(1).nullable().optional()
  .describe('Maximum entries a Team may create. Null means unlimited.');

const scoringSchema = ContestScoringSettingsSchema.optional()
  .describe("The contest's scoring definition and its settings (a finish-position contest's points table). Omitted on create, the template's preset applies, else the sport's default definition with its default settings; a definition whose settings have no default (finish-position points) must then be sent. Omitted on a rules change, the contest keeps its scoring.");

const withEntryLimit = { maxEntriesPerSquad: maxEntriesPerSquadSchema, scoring: scoringSchema };

/**
 * Rules with an entries-per-team limit and, optionally, scoring settings: what a template
 * presets, and what a commissioner sends when creating a contest or changing its rules. The
 * scoring settings are stored as the contest's participant scoring rule, not in its rules.
 */
export const ContestRulesWithEntryLimitSchema = z.discriminatedUnion('selectionType', [
  TieredContestRulesSchema.extend(withEntryLimit),
  BudgetContestRulesSchema.extend(withEntryLimit),
  RandomDrawContestRulesSchema.extend(withEntryLimit),
  PickEmContestRulesSchema.extend(withEntryLimit),
  BracketContestRulesSchema.extend(withEntryLimit),
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
