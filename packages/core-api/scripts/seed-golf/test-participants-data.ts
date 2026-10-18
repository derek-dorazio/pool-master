/**
 * The pure parts of loading test participants (test-participants.ts): which sites may take
 * them, what each sport league's test pool is called, and which picks a draft entry makes.
 * No I/O.
 */

import { createHash } from 'node:crypto';
import { SelectionType } from '@poolmaster/shared/domain';
import type { SelectionStateResponse } from '@poolmaster/shared/generated/hey-api';

type SelectionGroup = NonNullable<SelectionStateResponse['selectionGroups']>[number];
type GroupParticipant = SelectionGroup['participants'][number];

/** The environments a test-data run may write to: QA and the local ones, never staging or prod. */
const TEST_TARGET_ENVIRONMENTS: ReadonlySet<string> = new Set(['qa', 'development', 'test', 'ci']);

/**
 * Refuses a run that would put test data on a site that is not a test target. `environment`
 * is what the site's /version reports, the server's POOLMASTER_ENVIRONMENT.
 */
export function refuseUnlessTestTarget(environment: string, what: string): void {
  if (!TEST_TARGET_ENVIRONMENTS.has(environment)) {
    throw new Error(`${what} is for QA only, and this site is ${environment}.`);
  }
}

/** A league code from the sport league's name: stable across runs, unique per sport league. */
export function testLeagueCode(sportLeagueName: string): string {
  const letters = sportLeagueName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const hash = createHash('sha256').update(sportLeagueName).digest('hex').slice(0, 6).toUpperCase();
  return `QA${letters}${hash}`;
}

export function testLeagueName(sportLeagueName: string): string {
  return `${sportLeagueName} test pool`;
}

/**
 * The picks a draft entry still needs, varied by the player's place in the list so the
 * squads do not all hold the same lineup. Tiered: each group's missing picks, starting at a
 * different row of the group for each player. Budget: the open places, from a varied window of
 * the cheapest players, falling back to the cheapest when that window costs more than is left.
 */
export function choosePicks(state: SelectionStateResponse, playerIndex: number): string[] {
  const groups = state.selectionGroups ?? [];
  const open = (group: SelectionGroup): GroupParticipant[] => group.participants.filter((row) => row.isAvailable && row.isSelected !== true);
  const rotate = <T>(rows: readonly T[], by: number): T[] => (rows.length === 0 ? [] : [...rows.slice(by % rows.length), ...rows.slice(0, by % rows.length)]);

  if (state.selectionType === SelectionType.BUDGET_PICK) {
    const summary = state.lineupSummary;
    const slots = summary?.openSlots ?? 0;
    if (slots === 0) return [];
    const byPrice = groups.flatMap(open).sort((left, right) => (left.price ?? 0) - (right.price ?? 0));
    const window = rotate(byPrice.slice(0, slots * 3), playerIndex * slots).slice(0, slots);
    const cost = (rows: readonly GroupParticipant[]): number => rows.reduce((sum, row) => sum + (row.price ?? 0), 0);
    const chosen = summary && cost(window) > summary.remaining ? byPrice.slice(0, slots) : window;
    return chosen.map((row) => row.sportEventParticipantId);
  }

  return groups.flatMap((group) => {
    const missing = group.picksFromGroup - group.participants.filter((row) => row.isSelected === true).length;
    if (missing <= 0) return [];
    return rotate(open(group), playerIndex * group.picksFromGroup).slice(0, missing).map((row) => row.sportEventParticipantId);
  });
}
