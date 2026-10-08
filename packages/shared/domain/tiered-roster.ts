/**
 * A tiered contest's roster arithmetic (#479). The event owns the tiers; the contest owns how
 * many picks each tier takes. Every tier takes the same number, so the roster is never stored:
 * it is the event's tier count times the contest's picks per tier, whatever the tiers are now.
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
export function getDefaultCountedScores(tierCount: number, picksPerTier: number): number {
  const rosterSize = getTieredRosterSize(tierCount, picksPerTier);
  return Math.min(rosterSize, Math.max(1, (tierCount - 2) * picksPerTier));
}
