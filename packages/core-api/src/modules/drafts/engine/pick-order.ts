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

import type { ServiceLogger } from '../../../core/logger';

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
export function getRoundOrder(
  entryCount: number,
  round: number,
  logger?: ServiceLogger,
): number[] {
  const order = Array.from({ length: entryCount }, (_, i) => i);
  const roundOrder = round % 2 === 0 ? order.reverse() : order;
  logger?.debug(
    { action: 'draftPickOrder.getRoundOrder', data: { entryCount, round, reverse: round % 2 === 0 } },
    'Calculated snake draft round order',
  );
  return roundOrder;
}

/**
 * Determine who picks at a given global pick number.
 *
 * @param pickNumber - Global pick number (1-based)
 * @param entryCount - Total number of entries in the draft
 * @returns The pick position details
 */
export function getPickPosition(
  pickNumber: number,
  entryCount: number,
  logger?: ServiceLogger,
): PickPosition {
  const round = Math.ceil(pickNumber / entryCount);
  const pickInRound = ((pickNumber - 1) % entryCount) + 1;
  const entryIndex = round % 2 === 0
    ? entryCount - pickInRound
    : pickInRound - 1;
  const position = { pickNumber, round, pickInRound, entryIndex };
  logger?.debug(
    { action: 'draftPickOrder.getPickPosition', data: position },
    'Calculated snake draft pick position',
  );
  return position;
}

/**
 * Generate the full pick schedule for a snake draft.
 *
 * @param entryCount - Number of entries
 * @param rounds - Number of rounds
 * @returns Ordered array of all pick positions
 */
export function generatePickSchedule(
  entryCount: number,
  rounds: number,
  logger?: ServiceLogger,
): PickPosition[] {
  const totalPicks = entryCount * rounds;
  const schedule: PickPosition[] = [];

  for (let pick = 1; pick <= totalPicks; pick++) {
    schedule.push(getPickPosition(pick, entryCount, logger));
  }

  logger?.info(
    { action: 'draftPickOrder.generatePickSchedule', data: { entryCount, rounds, totalPicks } },
    'Generated full snake draft pick schedule',
  );
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
  logger?: ServiceLogger,
): number[] {
  const pickNumbers = generatePickSchedule(entryCount, rounds, logger)
    .filter((p) => p.entryIndex === entryIndex)
    .map((p) => p.pickNumber);
  logger?.info(
    { action: 'draftPickOrder.getEntryPickNumbers', data: { entryIndex, entryCount, rounds, pickCount: pickNumbers.length } },
    'Calculated snake draft pick numbers for entry',
  );
  return pickNumbers;
}
