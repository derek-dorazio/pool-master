import { getDefaultCountedScores, getTieredRosterSize } from '@poolmaster/shared/domain';
import type { ContestConfigurationRequest } from '@poolmaster/shared/dto';

/** The rules fields as the form holds them: text from the inputs, and the No limit box. */
export type ContestRulesValues = {
  countedScores: string;
  maxEntriesPerTeam: string;
  picksPerTier: string;
  unlimitedEntries: boolean;
};

function parseWholeNumber(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

/**
 * The configuration the rules fields describe, or the first thing wrong with them in the words
 * the form shows. An event with no tiers yet has no roster to check "Scores that count" against;
 * the server skips that check too.
 */
export function parseContestRules(
  values: ContestRulesValues,
  tierCount: number,
): { configuration: ContestConfigurationRequest; error: null } | { configuration: null; error: string } {
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
        ? `Scores that count must be between 1 and the ${rosterSize} golfers picked.`
        : 'Scores that count must be a positive whole number.',
    };
  }

  if (values.unlimitedEntries) {
    return { configuration: { picksPerTier, countedScores }, error: null };
  }
  const maxEntriesPerSquad = parseWholeNumber(values.maxEntriesPerTeam);
  if (maxEntriesPerSquad === null) {
    return { configuration: null, error: 'Entries per team must be a positive whole number.' };
  }
  return { configuration: { picksPerTier, countedScores, maxEntriesPerSquad }, error: null };
}

/** The form's starting values for a saved configuration. */
export function toContestRulesValues(configuration: ContestConfigurationRequest): ContestRulesValues {
  return {
    countedScores: String(configuration.countedScores),
    maxEntriesPerTeam: configuration.maxEntriesPerSquad == null ? '1' : String(configuration.maxEntriesPerSquad),
    picksPerTier: String(configuration.picksPerTier),
    unlimitedEntries: configuration.maxEntriesPerSquad == null,
  };
}

/**
 * "Scores that count" follows picks per tier: a new picks-per-tier value resets it to the default
 * for the event's tiers. Returns null when there is nothing to reset to.
 */
export function defaultCountedScoresFor(picksPerTier: string, tierCount: number) {
  const parsed = parseWholeNumber(picksPerTier);
  return tierCount > 0 && parsed !== null ? String(getDefaultCountedScores(tierCount, parsed)) : null;
}
