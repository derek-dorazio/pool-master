/**
 * Snake draft pick order algorithm.
 *
 * In a snake draft, the pick order reverses each round:
 *   Round 1 (odd):  1 → 2 → 3 → ... → N
 *   Round 2 (even): N → N-1 → ... → 1
 *   Round 3 (odd):  1 → 2 → 3 → ... → N
 *
 * This ensures the manager who picks last in one round picks first in the next.
 */

export interface PickPosition {
  pickNumber: number;
  round: number;
  pickInRound: number;
  entryIndex: number;
}

/**
 * Get the ordered entry indices for a given round in a snake draft.
 *
 * @param entryCount - Total number of entries in the draft
 * @param round - Round number (1-based)
 * @returns Array of entry indices (0-based) in pick order for this round
 */
export function getRoundOrder(entryCount: number, round: number): number[] {
  const order = Array.from({ length: entryCount }, (_, i) => i);
  return round % 2 === 0 ? order.reverse() : order;
}

/**
 * Determine who picks at a given global pick number.
 *
 * @param pickNumber - Global pick number (1-based)
 * @param entryCount - Total number of entries in the draft
 * @returns The pick position details
 */
export function getPickPosition(pickNumber: number, entryCount: number): PickPosition {
  const round = Math.ceil(pickNumber / entryCount);
  const pickInRound = ((pickNumber - 1) % entryCount) + 1;
  const entryIndex = round % 2 === 0
    ? entryCount - pickInRound
    : pickInRound - 1;

  return { pickNumber, round, pickInRound, entryIndex };
}

/**
 * Generate the full pick schedule for a snake draft.
 *
 * @param entryCount - Number of entries
 * @param rounds - Number of rounds
 * @returns Ordered array of all pick positions
 */
export function generatePickSchedule(entryCount: number, rounds: number): PickPosition[] {
  const totalPicks = entryCount * rounds;
  const schedule: PickPosition[] = [];

  for (let pick = 1; pick <= totalPicks; pick++) {
    schedule.push(getPickPosition(pick, entryCount));
  }

  return schedule;
}

/**
 * Get all pick numbers assigned to a specific entry.
 *
 * @param entryIndex - The entry's index (0-based)
 * @param entryCount - Total entries in draft
 * @param rounds - Number of rounds
 * @returns Array of global pick numbers for this entry
 */
export function getEntryPickNumbers(
  entryIndex: number,
  entryCount: number,
  rounds: number,
): number[] {
  return generatePickSchedule(entryCount, rounds)
    .filter((p) => p.entryIndex === entryIndex)
    .map((p) => p.pickNumber);
}
