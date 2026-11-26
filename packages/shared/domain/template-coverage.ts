/**
 * Contest template coverage (#2010, plan §7 and §9c): a template lists the slot definitions it
 * covers and a coverage mode, and a contest covers the template's definitions ∩ the chosen
 * event's or Season's slots, as the mode allows (resolved when a contest copies its slots, #2014).
 * Every rule here reads slot facts (competition, phase kind, slot kind, match format), never a name.
 */
import { MatchFormat, SelectionType, SlotKind, TemplateCoverageMode } from './enums';
import type { ContestTemplateSlot } from './contest-management-types';
import { compareSlotDefinitions, compareSlotPlaces } from './sport-league-structure';

/** Why a template's listed slots are refused (#2010, #2153). */
export const TemplateCoverageProblem = {
  /**
   * No contest crosses competitions (#2153): ALL_LISTED and FROM_SLOT list slots of one competition.
   * ONE_SLOT is exempt, as each of its contests covers a single slot.
   */
  SPANS_COMPETITIONS: 'SPANS_COMPETITIONS',
  /** ALL_LISTED covers one event: a TOURNAMENT slot (an event of its own) is listed alone. */
  ALL_LISTED_SPANS_EVENTS: 'ALL_LISTED_SPANS_EVENTS',
  /** A bracket lists a slot where a side need not advance: a field, or a week of a season's games. */
  BRACKET_OUTSIDE_KNOCKOUT: 'BRACKET_OUTSIDE_KNOCKOUT',
} as const;
export type TemplateCoverageProblem = (typeof TemplateCoverageProblem)[keyof typeof TemplateCoverageProblem];

/**
 * Whether a bracket may list this slot: a knockout, played head to head and not a week of a
 * season's games (Derek 2026-11-25). A playoff round and a tennis Slam alike, whatever the phase:
 * one side always advances, so a bracket never meets a tie.
 */
function isBracketSlot(slot: Pick<ContestTemplateSlot, 'slotKind' | 'matchFormat'>): boolean {
  return slot.matchFormat === MatchFormat.HEAD_TO_HEAD && slot.slotKind !== SlotKind.WEEK;
}

/**
 * The first problem with a template's listed slots, or null when they are fine. ALL_LISTED and
 * FROM_SLOT list slots of one competition (a ONE_SLOT contest covers one slot, so never crosses); ALL_LISTED covers one event's slots, so a TOURNAMENT slot (an event of
 * its own) is listed alone; a bracket lists only slots where one side always advances.
 */
export function templateCoverageProblem(
  template: { coverageMode: TemplateCoverageMode; selectionType: SelectionType },
  slots: readonly Pick<ContestTemplateSlot, 'sportLeagueCompetitionId' | 'slotKind' | 'matchFormat'>[],
): TemplateCoverageProblem | null {
  if (template.coverageMode !== TemplateCoverageMode.ONE_SLOT && new Set(slots.map((slot) => slot.sportLeagueCompetitionId)).size > 1) {
    return TemplateCoverageProblem.SPANS_COMPETITIONS;
  }
  if (template.coverageMode === TemplateCoverageMode.ALL_LISTED) {
    const tournaments = slots.filter((slot) => slot.slotKind === SlotKind.TOURNAMENT).length;
    if (tournaments > 0 && slots.length > 1) {
      return TemplateCoverageProblem.ALL_LISTED_SPANS_EVENTS;
    }
  }
  if (template.selectionType === SelectionType.BRACKET && !slots.every(isBracketSlot)) {
    return TemplateCoverageProblem.BRACKET_OUTSIDE_KNOCKOUT;
  }
  return null;
}

/** Whether an event is a week of a season's games (#2010): every slot it covers is a WEEK slot. */
export function isWeekEvent(event: { slotDefinitions: readonly { slotKind: SlotKind }[] }): boolean {
  return event.slotDefinitions.length > 0 && event.slotDefinitions.every((definition) => definition.slotKind === SlotKind.WEEK);
}

type CoveredSlot = Pick<ContestTemplateSlot, 'phase' | 'competitionOrderIndex' | 'slotKind' | 'weekNumber' | 'key'>;

/**
 * Slot definitions in play order (#2010, #2153): phases as a Season plays them, then each phase's
 * competitions by their order, then within each competition.
 */
export function compareCoveredSlots(left: CoveredSlot, right: CoveredSlot): number {
  return compareSlotPlaces(left, right) || compareSlotDefinitions(left, right);
}
