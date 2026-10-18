import {
  BUDGET_ROSTER_SIZE_MAX,
  PickEmMode,
  RANDOM_DRAW_PICKS_PER_ENTRY_MAX,
  SelectionType,
  getDefaultCountedScores,
  getTieredRosterSize,
  type SportNoun,
} from '@poolmaster/shared/domain';
import type { ContestConfigurationRequest } from '@poolmaster/shared/dto';
import { countParticipants } from './contest-rules';

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
  pickEmMode: PickEmMode;
  picksPerEntry: string;
  picksPerTier: string;
  rosterSize: string;
  unlimitedEntries: boolean;
};

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
 * The tiered rules. An event with no tiers yet has no roster to check "Scores that count"
 * against; the server skips that check too.
 */
function parseTieredRules(values: ContestRulesValues, tierCount: number, participant: SportNoun): RulesResult {
  const picksPerTier = parseWholeNumber(values.picksPerTier);
  if (picksPerTier === null) {
    return { configuration: null, error: 'Picks per tier must be a positive whole number.' };
  }

  const rosterSize = getTieredRosterSize(tierCount, picksPerTier);
  const countedScores = parseWholeNumber(values.countedScores);
  if (countedScores === null || (tierCount > 0 && countedScores > rosterSize)) {
    return {
      configuration: null,
      error: tierCount > 0
        ? `Scores that count must be between 1 and the ${countParticipants(rosterSize, participant)} picked.`
        : 'Scores that count must be a positive whole number.',
    };
  }
  return withEntryLimit(values, { selectionType: SelectionType.TIERED, picksPerTier, countedScores });
}

/** The budget rules (#93). The salary cap is the event's, so it is not part of them. */
function parseBudgetRules(values: ContestRulesValues, participant: SportNoun): RulesResult {
  const rosterSize = parseWholeNumber(values.rosterSize);
  if (rosterSize === null || rosterSize > BUDGET_ROSTER_SIZE_MAX) {
    return { configuration: null, error: `${perEntryLabel(participant)} must be between 1 and ${BUDGET_ROSTER_SIZE_MAX}.` };
  }
  const countedScores = parseWholeNumber(values.countedScores);
  if (countedScores === null || countedScores > rosterSize) {
    return { configuration: null, error: `Scores that count must be between 1 and the ${countParticipants(rosterSize, participant)} picked.` };
  }
  return withEntryLimit(values, { selectionType: SelectionType.BUDGET_PICK, rosterSize, countedScores });
}

/** The random-draw rules: how many participants the draw deals each entry, and the scores that count. */
function parseRandomDrawRules(values: ContestRulesValues, participant: SportNoun): RulesResult {
  const picksPerEntry = parseWholeNumber(values.picksPerEntry);
  if (picksPerEntry === null || picksPerEntry > RANDOM_DRAW_PICKS_PER_ENTRY_MAX) {
    return { configuration: null, error: `${perEntryLabel(participant)} must be between 1 and ${RANDOM_DRAW_PICKS_PER_ENTRY_MAX}.` };
  }
  const countedScores = parseWholeNumber(values.countedScores);
  if (countedScores === null || countedScores > picksPerEntry) {
    return { configuration: null, error: `Scores that count must be between 1 and the ${countParticipants(picksPerEntry, participant)} dealt.` };
  }
  return withEntryLimit(values, { selectionType: SelectionType.RANDOM_DRAW, picksPerEntry, countedScores });
}

/** The pick'em rules (#716): only the mode, straight up or confidence. */
function parsePickEmRules(values: ContestRulesValues): RulesResult {
  return withEntryLimit(values, { selectionType: SelectionType.PICK_EM, mode: values.pickEmMode });
}

/**
 * The configuration the rules fields describe for a format, or the first thing wrong with them
 * in the words the form shows.
 */
export function parseContestRules(
  values: ContestRulesValues,
  selectionType: EditableSelectionType,
  tierCount: number,
  participant: SportNoun,
): RulesResult {
  switch (selectionType) {
    case SelectionType.TIERED:
      return parseTieredRules(values, tierCount, participant);
    case SelectionType.BUDGET_PICK:
      return parseBudgetRules(values, participant);
    case SelectionType.RANDOM_DRAW:
      return parseRandomDrawRules(values, participant);
    case SelectionType.PICK_EM:
      return parsePickEmRules(values);
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
    pickEmMode: current.pickEmMode,
    picksPerEntry: current.picksPerEntry,
    picksPerTier: current.picksPerTier,
    rosterSize: current.rosterSize,
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
      return { ...rules, ...entryLimit, pickEmMode: configuration.mode };
  }
}

/** Where the rules fields start before a preset or a saved contest fills them. */
export const DEFAULT_CONTEST_RULES: ContestRulesValues = {
  countedScores: '4',
  maxEntriesPerTeam: '1',
  pickEmMode: PickEmMode.STRAIGHT_UP,
  picksPerEntry: '4',
  picksPerTier: '1',
  rosterSize: '6',
  unlimitedEntries: false,
};

/**
 * "Scores that count" follows picks per tier: a new picks-per-tier value resets it to the default
 * for the event's tiers. Returns null when there is nothing to reset to.
 */
export function defaultCountedScoresFor(picksPerTier: string, tierCount: number) {
  const parsed = parseWholeNumber(picksPerTier);
  return tierCount > 0 && parsed !== null ? String(getDefaultCountedScores(tierCount, parsed)) : null;
}
