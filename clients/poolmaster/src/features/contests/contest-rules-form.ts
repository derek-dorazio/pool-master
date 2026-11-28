import { PickEmMode, SelectionType, type SportNoun, pluralize } from '@poolmaster/shared/domain';
import type { ContestConfigurationRequest } from '@poolmaster/shared/dto';
import { z } from 'zod';
import type { ContestRulesLimitsDto, TieredRosterChoiceDto } from '@/lib/api';

/**
 * What the API bounds the rules by (#2107): the template's or contest's limits, null until a
 * template is chosen, and the event's picks-per-tier choices, empty until its tiers are filled.
 * The form holds no bound of its own; without one it checks only for a whole number, and the
 * API checks the rest.
 */
export type ContestRulesBounds = {
  limits: ContestRulesLimitsDto | null;
  tieredRosterChoices: readonly TieredRosterChoiceDto[];
};

/** "golfer", "6 golfers": a count in the sport's words. */
function countOf(count: number, participant: SportNoun) {
  return pluralize(count, participant.one, participant.many);
}

/** The error for a count above its bound, or one that is no whole number. */
function outOfRange(label: string, max: number | undefined) {
  return max === undefined ? `${label} must be a positive whole number.` : `${label} must be between 1 and ${String(max)}.`;
}

/** The selection types the rules fields can edit: one arm each of the configuration request. */
export type EditableSelectionType = ContestConfigurationRequest['selectionType'];

/**
 * The rules fields as the form holds them: text from the inputs, and the No limit box. Every
 * format's fields live here so switching format keeps what was typed; only the chosen format's
 * are read.
 */
export type ContestRulesValues = {
  countedScores: string;
  maxEntriesPerTeam: string;
  /** A pick'em contest scored against each game's spread (#720). */
  pickEmAgainstTheSpread: boolean;
  pickEmMode: PickEmMode;
  picksPerEntry: string;
  picksPerTier: string;
  rosterSize: string;
  /** How many boxes a squares entry may claim (#711). */
  maxSquaresPerEntry: string;
  /** How many weeks a survivor entry can lose before it is out (#1754); null keeps the API's default. */
  survivorLives: number | null;
  /** Whether a survivor entry may pick its teams again once it has used every team (#787). */
  survivorReuseTeams: boolean;
  unlimitedEntries: boolean;
};

/** The rules fields' checks, which the create and edit forms extend with their own fields. */
export const CONTEST_RULES_FORM_SHAPE = {
  countedScores: z.string(),
  maxEntriesPerTeam: z.string(),
  maxSquaresPerEntry: z.string(),
  pickEmAgainstTheSpread: z.boolean(),
  pickEmMode: z.enum(PickEmMode),
  picksPerEntry: z.string(),
  picksPerTier: z.string(),
  rosterSize: z.string(),
  survivorLives: z.number().int().min(1).nullable(),
  survivorReuseTeams: z.boolean(),
  unlimitedEntries: z.boolean(),
} satisfies { [Field in keyof ContestRulesValues]: z.ZodType<ContestRulesValues[Field]> };

function parseWholeNumber(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

type RulesResult =
  | { configuration: ContestConfigurationRequest; error: null }
  | { configuration: null; error: string };

/** Entries per member, the part of the rules every format shares. */
function withEntryLimit<T extends object>(values: ContestRulesValues, rules: T):
  | { configuration: T & { maxEntriesPerSquad?: number }; error: null }
  | { configuration: null; error: string } {
  if (values.unlimitedEntries) {
    return { configuration: rules, error: null };
  }
  const maxEntriesPerSquad = parseWholeNumber(values.maxEntriesPerTeam);
  if (maxEntriesPerSquad === null) {
    return { configuration: null, error: 'Entries per member must be a positive whole number.' };
  }
  return { configuration: { ...rules, maxEntriesPerSquad }, error: null };
}

/**
 * The tiered rules, against the event's picks-per-tier choices. An event whose tiers are not all
 * filled offers none, so there is no roster to check "Scores that count" against; the API checks
 * the tiers it has.
 */
function parseTieredRules(values: ContestRulesValues, choices: readonly TieredRosterChoiceDto[], participant: SportNoun): RulesResult {
  const picksPerTier = parseWholeNumber(values.picksPerTier);
  const choice = choices.find((candidate) => candidate.picksPerTier === picksPerTier);
  if (picksPerTier === null || (choices.length > 0 && choice === undefined)) {
    return { configuration: null, error: outOfRange('Picks per tier', choices.at(-1)?.picksPerTier) };
  }
  const countedScores = parseWholeNumber(values.countedScores);
  if (countedScores === null || (choice !== undefined && countedScores > choice.rosterSize)) {
    return {
      configuration: null,
      error: choice === undefined
        ? 'Scores that count must be a positive whole number.'
        : `Scores that count must be between 1 and the ${countOf(choice.rosterSize, participant)} picked.`,
    };
  }
  return withEntryLimit(values, { selectionType: SelectionType.TIERED, picksPerTier, countedScores });
}

/** The budget rules (#93). The salary cap is the event's, so it is not part of them. */
function parseBudgetRules(values: ContestRulesValues, limits: ContestRulesLimitsDto | null, participant: SportNoun): RulesResult {
  const rosterSize = parseWholeNumber(values.rosterSize);
  if (rosterSize === null || (limits !== null && rosterSize > limits.rosterSizeMax)) {
    return { configuration: null, error: outOfRange(perEntryLabel(participant), limits?.rosterSizeMax) };
  }
  const countedScores = parseWholeNumber(values.countedScores);
  if (countedScores === null || countedScores > rosterSize) {
    return { configuration: null, error: `Scores that count must be between 1 and the ${countOf(rosterSize, participant)} picked.` };
  }
  return withEntryLimit(values, { selectionType: SelectionType.BUDGET_PICK, rosterSize, countedScores });
}

/** The random-draw rules: how many participants the draw deals each entry, and the scores that count. */
function parseRandomDrawRules(values: ContestRulesValues, limits: ContestRulesLimitsDto | null, participant: SportNoun): RulesResult {
  const picksPerEntry = parseWholeNumber(values.picksPerEntry);
  if (picksPerEntry === null || (limits !== null && picksPerEntry > limits.picksPerEntryMax)) {
    return { configuration: null, error: outOfRange(perEntryLabel(participant), limits?.picksPerEntryMax) };
  }
  const countedScores = parseWholeNumber(values.countedScores);
  if (countedScores === null || countedScores > picksPerEntry) {
    return { configuration: null, error: `Scores that count must be between 1 and the ${countOf(picksPerEntry, participant)} dealt.` };
  }
  return withEntryLimit(values, { selectionType: SelectionType.RANDOM_DRAW, picksPerEntry, countedScores });
}

/** The pick'em rules (#716): the mode, straight up or confidence, and whether against the spread (#720). */
function parsePickEmRules(values: ContestRulesValues): RulesResult {
  return withEntryLimit(values, {
    selectionType: SelectionType.PICK_EM,
    mode: values.pickEmMode,
    againstTheSpread: values.pickEmAgainstTheSpread,
  });
}

/** The bracket rules (#721): the entry limit; the scoring is set apart. */
function parseBracketRules(values: ContestRulesValues): RulesResult {
  return withEntryLimit(values, { selectionType: SelectionType.BRACKET });
}

/** The survivor rules (#719): whether teams can be picked again once all are used (#787), the lives (#1754), and the entry limit. */
function parseSurvivorRules(values: ContestRulesValues): RulesResult {
  return withEntryLimit(values, {
    selectionType: SelectionType.SURVIVOR,
    reuseTeamsOnceAllUsed: values.survivorReuseTeams,
    ...(values.survivorLives === null ? {} : { lives: values.survivorLives }),
  });
}

/**
 * The squares rules (#711): how many boxes an entry may claim. A squares contest takes one entry
 * per member, whatever the entry limit fields hold, since the box limit is per entry.
 */
function parseSquaresRules(values: ContestRulesValues, limits: ContestRulesLimitsDto | null): RulesResult {
  const maxSquaresPerEntry = parseWholeNumber(values.maxSquaresPerEntry);
  if (maxSquaresPerEntry === null || (limits !== null && maxSquaresPerEntry > limits.maxSquaresPerEntryMax)) {
    return { configuration: null, error: outOfRange('Boxes per entry', limits?.maxSquaresPerEntryMax) };
  }
  return { configuration: { selectionType: SelectionType.SQUARES, maxSquaresPerEntry, maxEntriesPerSquad: 1 }, error: null };
}

/**
 * The configuration the rules fields describe for a format, or the first thing wrong with them
 * in the words the form shows.
 */
export function parseContestRules(
  values: ContestRulesValues,
  selectionType: EditableSelectionType,
  bounds: ContestRulesBounds,
  participant: SportNoun,
): RulesResult {
  switch (selectionType) {
    case SelectionType.TIERED:
      return parseTieredRules(values, bounds.tieredRosterChoices, participant);
    case SelectionType.BUDGET_PICK:
      return parseBudgetRules(values, bounds.limits, participant);
    case SelectionType.RANDOM_DRAW:
      return parseRandomDrawRules(values, bounds.limits, participant);
    case SelectionType.PICK_EM:
      return parsePickEmRules(values);
    case SelectionType.BRACKET:
      return parseBracketRules(values);
    case SelectionType.SURVIVOR:
      return parseSurvivorRules(values);
    case SelectionType.SQUARES:
      return parseSquaresRules(values, bounds.limits);
  }
}

/** "Golfers per entry", "Horses per entry": the roster-size field's label, in the sport's words. */
export function perEntryLabel(participant: SportNoun) {
  return `${participant.many.charAt(0).toUpperCase()}${participant.many.slice(1)} per entry`;
}

/**
 * The form's values for a saved configuration or a preset. Only its own format's fields change;
 * the other formats' keep what `current` holds.
 */
export function toContestRulesValues(
  configuration: ContestConfigurationRequest,
  current: ContestRulesValues = DEFAULT_CONTEST_RULES,
): ContestRulesValues {
  // Only the rules fields: `current` may be a whole form's values.
  const rules: ContestRulesValues = {
    countedScores: current.countedScores,
    maxEntriesPerTeam: current.maxEntriesPerTeam,
    pickEmAgainstTheSpread: current.pickEmAgainstTheSpread,
    pickEmMode: current.pickEmMode,
    picksPerEntry: current.picksPerEntry,
    picksPerTier: current.picksPerTier,
    rosterSize: current.rosterSize,
    maxSquaresPerEntry: current.maxSquaresPerEntry,
    survivorLives: current.survivorLives,
    survivorReuseTeams: current.survivorReuseTeams,
    unlimitedEntries: current.unlimitedEntries,
  };
  const entryLimit = {
    maxEntriesPerTeam: configuration.maxEntriesPerSquad == null ? '1' : String(configuration.maxEntriesPerSquad),
    unlimitedEntries: configuration.maxEntriesPerSquad == null,
  };
  switch (configuration.selectionType) {
    case SelectionType.TIERED:
      return { ...rules, ...entryLimit, countedScores: String(configuration.countedScores), picksPerTier: String(configuration.picksPerTier) };
    case SelectionType.BUDGET_PICK:
      return { ...rules, ...entryLimit, countedScores: String(configuration.countedScores), rosterSize: String(configuration.rosterSize) };
    case SelectionType.RANDOM_DRAW:
      return { ...rules, ...entryLimit, countedScores: String(configuration.countedScores), picksPerEntry: String(configuration.picksPerEntry) };
    case SelectionType.PICK_EM:
      return { ...rules, ...entryLimit, pickEmMode: configuration.mode, pickEmAgainstTheSpread: configuration.againstTheSpread };
    case SelectionType.BRACKET:
      return { ...rules, ...entryLimit };
    case SelectionType.SURVIVOR:
      return { ...rules, ...entryLimit, survivorReuseTeams: configuration.reuseTeamsOnceAllUsed ?? true, survivorLives: configuration.lives ?? null };
    case SelectionType.SQUARES:
      return { ...rules, ...entryLimit, maxSquaresPerEntry: String(configuration.maxSquaresPerEntry) };
  }
}

/** Where the rules fields start before a preset or a saved contest fills them. */
export const DEFAULT_CONTEST_RULES: ContestRulesValues = {
  countedScores: '4',
  maxEntriesPerTeam: '1',
  pickEmAgainstTheSpread: false,
  pickEmMode: PickEmMode.STRAIGHT_UP,
  picksPerEntry: '4',
  picksPerTier: '1',
  rosterSize: '6',
  // A squares contest's preset holds 10 boxes per entry (design Q3.3).
  maxSquaresPerEntry: '10',
  // A survivor entry has the API's default lives until the commissioner chooses (#1754).
  survivorLives: null,
  // Teams can be picked again once all are used, in every sport (#787).
  survivorReuseTeams: true,
  unlimitedEntries: false,
};

/**
 * "Scores that count" follows picks per tier: a new picks-per-tier value resets it to the API's
 * default for the event's tiers. Returns null when there is nothing to reset to.
 */
export function defaultCountedScoresFor(picksPerTier: string, choices: readonly TieredRosterChoiceDto[]) {
  const parsed = parseWholeNumber(picksPerTier);
  const choice = choices.find((candidate) => candidate.picksPerTier === parsed);
  return choice === undefined ? null : String(choice.countedScoresDefault);
}

/** The roster a picks-per-tier value makes on the event's tiers, or null when it offers none. */
export function tieredRosterSizeFor(picksPerTier: string, choices: readonly TieredRosterChoiceDto[]) {
  const parsed = parseWholeNumber(picksPerTier);
  return choices.find((candidate) => candidate.picksPerTier === parsed)?.rosterSize ?? null;
}
