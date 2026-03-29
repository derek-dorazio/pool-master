/**
 * Rotisserie Scoring Engine — category-based rankings.
 *
 * Each stat category is ranked across all entries in the league.
 * An entry's total score is the sum of its rankings across all categories.
 * Lower total rank = better (like golf). In a 10-team league, 1st in a
 * category gets 10 points, last gets 1 point.
 */

/** Accumulated stats for a single entry across a period. */
export interface RotisserieEntryStats {
  entryId: string;
  categoryValues: Record<string, number>;
}

/** Configuration for a rotisserie scoring setup. */
export interface RotisserieConfig {
  categories: string[];
  /** Categories where lower is better (e.g. turnovers, ERA). Default: higher is better. */
  lower_is_better_categories?: string[];
}

/** Result for a single entry. */
export interface RotisserieEntryResult {
  entryId: string;
  categoryRanks: Record<string, number>;
  totalRotoPoints: number;
}

/**
 * Score all entries in a rotisserie league.
 *
 * For each category, entries are ranked 1 to N (N = number of entries).
 * The entry with the best value gets N points, worst gets 1 point.
 * For lower_is_better categories, lowest value = best rank.
 * Total roto score = sum of all category points.
 */
export function scoreRotisserie(
  config: RotisserieConfig,
  entries: RotisserieEntryStats[],
): RotisserieEntryResult[] {
  const numEntries = entries.length;
  if (numEntries === 0) return [];

  const lowerIsBetter = new Set(config.lower_is_better_categories ?? []);

  // Initialize results
  const results = new Map<string, { categoryRanks: Record<string, number>; total: number }>();
  for (const entry of entries) {
    results.set(entry.entryId, { categoryRanks: {}, total: 0 });
  }

  // Rank each category
  for (const category of config.categories) {
    // Sort entries by this category's value
    const sorted = [...entries].sort((a, b) => {
      const aVal = a.categoryValues[category] ?? 0;
      const bVal = b.categoryValues[category] ?? 0;

      if (lowerIsBetter.has(category)) {
        return aVal - bVal; // ascending: lowest value = best
      }
      return bVal - aVal; // descending: highest value = best
    });

    // Assign rank points: best gets N points, worst gets 1
    // Handle ties by averaging rank points
    let i = 0;
    while (i < sorted.length) {
      const currentVal = sorted[i].categoryValues[category] ?? 0;

      // Find all entries tied at this value
      let j = i;
      while (j < sorted.length && (sorted[j].categoryValues[category] ?? 0) === currentVal) {
        j++;
      }

      // Average rank points for tied entries
      let rankPointSum = 0;
      for (let k = i; k < j; k++) {
        rankPointSum += numEntries - k; // N for 1st, N-1 for 2nd, etc.
      }
      const avgRankPoints = rankPointSum / (j - i);

      // Assign to all tied entries
      for (let k = i; k < j; k++) {
        const result = results.get(sorted[k].entryId)!;
        result.categoryRanks[category] = avgRankPoints;
        result.total += avgRankPoints;
      }

      i = j;
    }
  }

  return entries.map((entry) => {
    const result = results.get(entry.entryId)!;
    return {
      entryId: entry.entryId,
      categoryRanks: result.categoryRanks,
      totalRotoPoints: result.total,
    };
  });
}
