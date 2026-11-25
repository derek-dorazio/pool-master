/**
 * Contest template coverage (#2010, plan §7 and §9c): a template lists the slot definitions it
 * covers and a coverage mode, and a contest covers the template's definitions ∩ the chosen
 * event's or Season's slots, as the mode allows. Every rule here reads slot facts (phase kind,
 * slot kind, match format), never a name.
 */
import { LeaguePhase, LeaguePhaseOrder, MatchFormat, SelectionType, SlotKind, TemplateCoverageMode } from './enums';
import type { ContestTemplateSlot } from './contest-management-types';
import { compareByEnumOrder } from './enum-order';
import { compareSlotDefinitions } from './sport-league-structure';

/** One Season slot a coverage is resolved against: its definition, its owning event, in play order. */
export interface CoverageSeasonSlot {
  id: string;
  sportLeaguePhaseSlotId: string;
  /** The event that owns the slot, or null while no event has it. */
  sportEventId: string | null;
}

/** What the commissioner chose: the event (ALL_LISTED), the one slot (ONE_SLOT) or the starting slot (FROM_SLOT). */
export type CoverageChoice =
  | { coverageMode: typeof TemplateCoverageMode.ONE_SLOT; seasonSlotId: string }
  | { coverageMode: typeof TemplateCoverageMode.ALL_LISTED; sportEventId: string }
  | { coverageMode: typeof TemplateCoverageMode.FROM_SLOT; startingSeasonSlotId: string };

/**
 * The Season slots a contest from this template covers, in play order: the template's slot
 * definitions ∩ the Season's slots, as the mode allows. ONE_SLOT, the chosen slot; ALL_LISTED, the
 * chosen event's slots; FROM_SLOT, the starting slot and every later one. Empty when the choice
 * names no slot the template lists.
 */
export function coveredSeasonSlots(
  templateDefinitionIds: readonly string[],
  seasonSlots: readonly CoverageSeasonSlot[],
  choice: CoverageChoice,
): CoverageSeasonSlot[] {
  const listed = new Set(templateDefinitionIds);
  const offered = seasonSlots.filter((slot) => listed.has(slot.sportLeaguePhaseSlotId));
  switch (choice.coverageMode) {
    case TemplateCoverageMode.ONE_SLOT:
      return offered.filter((slot) => slot.id === choice.seasonSlotId);
    case TemplateCoverageMode.ALL_LISTED:
      return offered.filter((slot) => slot.sportEventId === choice.sportEventId);
    case TemplateCoverageMode.FROM_SLOT: {
      const start = offered.findIndex((slot) => slot.id === choice.startingSeasonSlotId);
      return start === -1 ? [] : offered.slice(start);
    }
  }
}

/** Why a template's listed slots are refused (#2010). */
export const TemplateCoverageProblem = {
  /** ALL_LISTED covers one event: its definitions must all be one event's (one phase, and one TOURNAMENT slot at most). */
  ALL_LISTED_SPANS_EVENTS: 'ALL_LISTED_SPANS_EVENTS',
  /** A bracket lists a slot where a side need not advance: outside a POSTSEASON phase, and not a head-to-head tournament. */
  BRACKET_OUTSIDE_KNOCKOUT: 'BRACKET_OUTSIDE_KNOCKOUT',
} as const;
export type TemplateCoverageProblem = (typeof TemplateCoverageProblem)[keyof typeof TemplateCoverageProblem];

/**
 * Whether a bracket may list this slot: a POSTSEASON slot, or a TOURNAMENT slot played head to
 * head (a knockout draw). In both one side always advances, so a bracket never meets a tie.
 */
export function isBracketSlot(slot: Pick<ContestTemplateSlot, 'phase' | 'slotKind' | 'matchFormat'>): boolean {
  return slot.phase === LeaguePhase.POSTSEASON
    || (slot.slotKind === SlotKind.TOURNAMENT && slot.matchFormat === MatchFormat.HEAD_TO_HEAD);
}

/**
 * The first problem with a template's listed slots, or null when they are fine. ALL_LISTED covers
 * one event's slots, so every definition is in one phase and a TOURNAMENT slot (an event of its
 * own) is listed alone; a bracket lists only slots where one side always advances.
 */
export function templateCoverageProblem(
  template: { coverageMode: TemplateCoverageMode; selectionType: SelectionType },
  slots: readonly Pick<ContestTemplateSlot, 'sportLeaguePhaseId' | 'phase' | 'slotKind' | 'matchFormat'>[],
): TemplateCoverageProblem | null {
  if (template.coverageMode === TemplateCoverageMode.ALL_LISTED) {
    const phases = new Set(slots.map((slot) => slot.sportLeaguePhaseId));
    const tournaments = slots.filter((slot) => slot.slotKind === SlotKind.TOURNAMENT).length;
    if (phases.size > 1 || (tournaments > 0 && slots.length > 1)) {
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

const byPhase = compareByEnumOrder(LeaguePhaseOrder);

/** Slot definitions in play order (#2010): phases as a Season plays them, then within each phase. */
export function compareCoveredSlots(
  left: Pick<ContestTemplateSlot, 'phase' | 'slotKind' | 'weekNumber' | 'key'>,
  right: Pick<ContestTemplateSlot, 'phase' | 'slotKind' | 'weekNumber' | 'key'>,
): number {
  return byPhase(left.phase, right.phase) || compareSlotDefinitions(left, right);
}
