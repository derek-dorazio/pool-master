import { z } from 'zod';
import { PickEmMode, SelectionType } from './enums';
import { BUDGET_SALARY_CAP_MAX } from './budget-pricing';
import { ContestScoringSettingsSchema, KNOCKOUT_ROUND_VALUES_MAX_ROUNDS } from './contest-scoring';

/**
 * A contest's rules (#93): one shape per selection type, told apart by `selectionType`, which
 * always matches the contest's own. A new selection type adds its own arm here.
 *
 * - **Tiered:** the entry picks `picksPerTier` golfers from each of the event's tiers, or only
 *   its first `tiersUsed` tiers, so its roster is that many tiers times `picksPerTier` (see
 *   tiered-roster.ts).
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
 * - **Survivor:** a prediction contest (#719). Each week the entry picks one team to win, never one
 *   it picked in an earlier week; a loss, a tie or a week left unsubmitted puts it out. With
 *   `reuseTeamsOnceAllUsed` (#787), an entry that has used every team starts again with all of them.
 * - **Squares:** a squares contest on one game (#711). The entry claims up to `maxSquaresPerEntry`
 *   boxes of a 10x10 grid; nothing is picked or scored by a definition.
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
  tiersUsed: z.number().int().min(1).optional()
    .describe("How many of the event's tiers an entry picks from, the first ones in tier order (tennis's \"Seeds only\": the first four). Left out, every tier. The event owns its tiers (#249), so this is the contest's rule, not a second tier layout."),
}).describe('Tiered rules: pick the same number of golfers from every tier of the event, or from its first tiersUsed tiers.');
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
  mode: z.enum(PickEmMode)
    .describe('STRAIGHT_UP: pick the winner of every game. CONFIDENCE: also give each game of a week a value from 1 to its number of games, each used once.'),
  againstTheSpread: z.boolean()
    .describe('Picks are scored against each game\'s spread (#720): a pick is right when its team covers, and a game that lands exactly on the spread (a push) scores nothing. Every game needs its spread before the week is released.'),
}).describe("Pick'em rules: pick the winner of every game of each event, or the team that covers when scored against the spread.");
export type PickEmContestRules = z.infer<typeof PickEmContestRulesSchema>;

export const BracketContestRulesSchema = z.object({
  selectionType: z.literal(SelectionType.BRACKET),
  startsAtRound: z.number().int().min(1).max(KNOCKOUT_ROUND_VALUES_MAX_ROUNDS)
    .describe('The round the bracket starts at: 1 for a full bracket; a later round (the Sweet 16) for a second-chance bracket, picked from that round on and closing at its first game. The event\'s round values score each round from it on.'),
}).describe('Bracket rules: pick the winner of every game of one knockout event, from the starting round to the final, before the starting round\'s first game.');
export type BracketContestRules = z.infer<typeof BracketContestRulesSchema>;

export const SurvivorContestRulesSchema = z.object({
  selectionType: z.literal(SelectionType.SURVIVOR),
  reuseTeamsOnceAllUsed: z.boolean().optional()
    .describe('Whether teams can be picked again once every team is used (#787). Each entry has its own cycle: once it has picked every team in the contest\'s weeks, each is usable once more. It matters only in a contest with more weeks than the league has teams. Left out, yes.'),
}).describe('Survivor rules: pick one team to win each week, each team once (a cycle, when teams can be picked again). A loss, a tie or a week left unsubmitted puts the entry out; the last entries standing win.');
export type SurvivorContestRules = z.infer<typeof SurvivorContestRulesSchema>;

/** The most boxes one squares entry may hold: the whole grid. */
export const SQUARES_GRID_SIZE = 10;
export const SQUARES_PER_ENTRY_MAX = SQUARES_GRID_SIZE * SQUARES_GRID_SIZE;

export const SquaresContestRulesSchema = z.object({
  selectionType: z.literal(SelectionType.SQUARES),
  maxSquaresPerEntry: z.number().int().min(1).max(SQUARES_PER_ENTRY_MAX)
    .describe('How many boxes one entry may claim. A squares contest takes one entry per squad, so this is the cap per squad. It can change until the digits are drawn; lowering it takes no box away.'),
}).describe('Squares rules: claim boxes of a 10x10 grid on one game; the digits are drawn along each side, and the box at each scoring moment\'s last digits wins it.');
export type SquaresContestRules = z.infer<typeof SquaresContestRulesSchema>;

/**
 * A selection type's rules with more fields, keeping the rules' own description. Zod's
 * `.extend()` builds a new schema, and a description set with `.describe()` stays on the old
 * one, so the API document would lose the text that says what each rules shape is.
 */
export function extendRules<RulesShape extends z.ZodRawShape, Shape extends z.ZodRawShape>(
  rules: z.ZodObject<RulesShape>,
  shape: Shape,
) {
  const extended = rules.extend(shape);
  return rules.description === undefined ? extended : extended.describe(rules.description);
}

/**
 * Every union of the selection types' rules lists survivor last. Survivor's rules require nothing
 * but `selectionType`, and the API validates a union as an `anyOf` with Fastify's
 * `removeAdditional`: a branch whose required fields all match goes on to strip every field it
 * does not know, so a survivor branch tried before another type removes that type's rules (a
 * squares contest's box limit) before its own branch is reached (#711).
 */
/** The rules a commissioner chooses, and a template presets. */
export const ContestRulesSchema = z.discriminatedUnion('selectionType', [
  TieredContestRulesSchema,
  BudgetContestRulesSchema,
  RandomDrawContestRulesSchema,
  PickEmContestRulesSchema,
  BracketContestRulesSchema,
  SquaresContestRulesSchema,
  // Last: see the note above.
  SurvivorContestRulesSchema,
]);
export type ContestRules = z.infer<typeof ContestRulesSchema>;

export const BudgetContestConfigSchema = extendRules(BudgetContestRulesSchema, {
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
  SquaresContestRulesSchema,
  // Last: see the note above `ContestRulesSchema`.
  SurvivorContestRulesSchema,
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
  extendRules(TieredContestRulesSchema, withEntryLimit),
  extendRules(BudgetContestRulesSchema, withEntryLimit),
  extendRules(RandomDrawContestRulesSchema, withEntryLimit),
  extendRules(PickEmContestRulesSchema, withEntryLimit),
  extendRules(BracketContestRulesSchema, withEntryLimit),
  extendRules(SquaresContestRulesSchema, withEntryLimit),
  // Last: see the note above `ContestRulesSchema`.
  extendRules(SurvivorContestRulesSchema, withEntryLimit),
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
