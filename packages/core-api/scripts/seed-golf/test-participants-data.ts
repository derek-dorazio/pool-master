/**
 * The pure parts of loading test participants (test-participants.ts): which sites may take
 * them, what each sport league's test pool is called, and which picks a draft entry makes.
 * No I/O.
 */

import { createHash } from 'node:crypto';
import { ContestFormat, getSportDefinition, SelectionType, type Sport } from '@poolmaster/shared/domain';
import type { ContestConfigTemplateListResponse, SelectionStateResponse, SportEventListResponse } from '@poolmaster/shared/generated/hey-api';
import { AppEnvironment } from '../../src/core/config';

type SelectionGroup = NonNullable<SelectionStateResponse['selectionGroups']>[number];
type GroupParticipant = SelectionGroup['participants'][number];
type StoredEvent = SportEventListResponse['events'][number];
type Template = ContestConfigTemplateListResponse['templates'][number];

/** The environments a test-data run may write to: QA and the local ones, never staging or prod. */
const TEST_TARGET_ENVIRONMENTS: ReadonlySet<string> = new Set([AppEnvironment.QA, AppEnvironment.DEVELOPMENT, AppEnvironment.TEST, AppEnvironment.CI]);

/**
 * Refuses a run that would put test data on a site that is not a test target. `environment`
 * is what the site's /version reports, the server's POOLMASTER_ENVIRONMENT.
 */
export function refuseUnlessTestTarget(environment: string, what: string): void {
  if (!TEST_TARGET_ENVIRONMENTS.has(environment)) {
    throw new Error(`${what} is for QA only, and this site is ${environment}.`);
  }
}

/**
 * A league code from the sport and the sport league's name: stable across runs, unique per
 * sport league. The sport is part of it because two sports can each have a league of the same
 * name (college basketball and college hockey both have "NCAA Division I Men").
 */
export function testLeagueCode(sport: Sport, sportLeagueName: string): string {
  const letters = sportLeagueName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const hash = createHash('sha256').update(`${sport}:${sportLeagueName}`).digest('hex').slice(0, 6).toUpperCase();
  return `QA${letters}${hash}`;
}

export function testLeagueName(sport: Sport, sportLeagueName: string): string {
  return `${sportLeagueName} ${getSportDefinition(sport).name} test pool`;
}

/**
 * The template a test contest on this event is created from: a tiered or budget one, its sport
 * league's ahead of a sport-wide one, the default first. A draw deals its picks to every entry at
 * once and closes them, so the run picks for itself instead. Null when none is offered.
 */
export function chooseContestTemplate(templates: readonly Template[], _event: Pick<StoredEvent, 'sport' | 'sportLeagueId' | 'rounds'>): Template | null {
  const pickable = templates.filter((template) => template.contestFormat === ContestFormat.ROSTER
    && template.selectionType !== SelectionType.RANDOM_DRAW);
  const ranked = [...pickable].sort((left, right) => Number(right.sportLeagueId !== null) - Number(left.sportLeagueId !== null)
    || Number(right.isDefault) - Number(left.isDefault) || left.sortOrder - right.sortOrder);
  return ranked.at(0) ?? null;
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
