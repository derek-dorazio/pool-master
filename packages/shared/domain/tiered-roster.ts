/**
 * A tiered contest's roster arithmetic (#479). The event owns the tiers; the contest owns how
 * many picks each tier takes. Every tier takes the same number, so the roster is never stored:
 * it is the event's tier count times the contest's picks per tier, whatever the tiers are now.
 * An entry picks from every tier of the event.
 */

/** How many golfers a full tiered entry holds. */
export function getTieredRosterSize(tierCount: number, picksPerTier: number): number {
  return tierCount * picksPerTier;
}

/**
 * The "picks that count" a new tiered contest starts with: all but two tiers' worth, so 4 of 6
 * with one pick per tier and 8 of 12 with two. Never below one, and never above the roster,
 * which is what an event with two tiers or fewer would otherwise give.
 */
function getDefaultCountedScores(tierCount: number, picksPerTier: number): number {
  const rosterSize = getTieredRosterSize(tierCount, picksPerTier);
  return Math.min(rosterSize, Math.max(1, (tierCount - 2) * picksPerTier));
}

/** One picks-per-tier value a tiered contest may take, with what it makes (#2107). */
type TieredRosterChoice = {
  picksPerTier: number;
  /** The entry's roster: the tier count times the picks per tier. */
  rosterSize: number;
  /** The scores that count a contest starts with at this picks per tier. */
  countedScoresDefault: number;
};

/**
 * The picks per tier a tiered contest may take on tiers of these sizes (#2107): 1 up to the
 * smallest tier's size, since a tier cannot give an entry more of it than it holds. None while
 * the event has no tiers, or a tier is still empty.
 */
export function tieredRosterChoices(tierSizes: readonly number[]): TieredRosterChoice[] {
  const picksPerTierMax = tierSizes.length === 0 ? 0 : Math.min(...tierSizes);
  return Array.from({ length: picksPerTierMax }, (_, index) => ({
    picksPerTier: index + 1,
    rosterSize: getTieredRosterSize(tierSizes.length, index + 1),
    countedScoresDefault: getDefaultCountedScores(tierSizes.length, index + 1),
  }));
}
