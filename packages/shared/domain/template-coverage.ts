/**
 * Contest template coverage (#2010, plan §7 and §9c): a template lists the slot definitions it
 * covers and a coverage mode, and a contest covers the template's definitions ∩ the chosen
 * event's or Season's slots, as the mode allows (resolved when a contest copies its slots, #2014).
 * Every rule here reads slot facts (competition, phase kind, slot kind, match format), never a name.
 */
import { MatchFormat, SelectionType, SlotKind, TemplateCoverageMode } from './enums';
import type { ContestConfiguration, ContestTemplateSlot } from './contest-management-types';
import type { ContestScoringSettings } from './contest-scoring';
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
  /**
   * A template scored by knockout round points that covers all its listed bracket rounds gives
   * other than one round value for each (#2177): a round with no value would score nothing.
   */
  ROUND_VALUES_MISMATCH: 'ROUND_VALUES_MISMATCH',
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
 * Whether a listed slot is one round of a bracket (#2177): slots govern rounds, so each knockout
 * slot is a round, and the FINAL slot's round is the final. The third-place play-off is a match
 * beside the bracket, no round of it; a TOURNAMENT slot is an event of its own, whose rounds its
 * slot does not show.
 */
function isBracketRoundSlot(slot: Pick<ContestTemplateSlot, 'slotKind' | 'matchFormat'>): boolean {
  return isBracketSlot(slot) && slot.slotKind !== SlotKind.THIRD_PLACE && slot.slotKind !== SlotKind.TOURNAMENT;
}

/**
 * The bracket rounds a template's scoring must give a value for, in play order, or null when its
 * slots do not show them: a template covering all its listed slots, none a TOURNAMENT, scores
 * every listed bracket round (#2177). One that covers a slot at a time, or a tournament, plays
 * whatever rounds its event has.
 */
function templateBracketRounds<Slot extends Pick<ContestTemplateSlot, 'slotKind' | 'matchFormat'>>(
  template: { coverageMode: TemplateCoverageMode },
  slots: readonly Slot[],
): Slot[] | null {
  if (template.coverageMode !== TemplateCoverageMode.ALL_LISTED || slots.some((slot) => slot.slotKind === SlotKind.TOURNAMENT)) {
    return null;
  }
  return slots.filter(isBracketRoundSlot);
}

/**
 * The first problem with a template's listed slots, or null when they are fine. ALL_LISTED and
 * FROM_SLOT list slots of one competition (a ONE_SLOT contest covers one slot, so never crosses); ALL_LISTED covers one event's slots, so a TOURNAMENT slot (an event of
 * its own) is listed alone; a bracket lists only slots where one side always advances; and
 * knockout round points give one value for each bracket round the slots list
 * (`templateBracketRounds`).
 */
export function templateCoverageProblem(
  template: { coverageMode: TemplateCoverageMode; selectionType: SelectionType; configJson: { scoring?: ContestScoringSettings } },
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
  const scoring = template.configJson.scoring;
  const rounds = templateBracketRounds(template, slots);
  if (scoring?.participantScoringDefinitionId === 'KNOCKOUT_ROUND_POINTS' && rounds !== null && scoring.config.roundValues.length !== rounds.length) {
    return TemplateCoverageProblem.ROUND_VALUES_MISMATCH;
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

/**
 * What a contest covers of its event (#2014): the slot definitions its template lists. Null for a
 * contest made with no template, which covers every round until #2014 makes the template required.
 */
export interface ContestRoundCoverage {
  slotDefinitionIds: readonly string[] | null;
}

type CoverableMatch = { roundNumber: number; slot: { slotDefinitionId: string } };

/** Whether a contest covers a match's round: its slot's definition is one the contest's template lists. */
export function coversMatchRound(coverage: ContestRoundCoverage, match: Pick<CoverableMatch, 'slot'>): boolean {
  return coverage.slotDefinitionIds === null || coverage.slotDefinitionIds.includes(match.slot.slotDefinitionId);
}

/**
 * The rounds of an event a contest covers, in play order (lowest first), by number. Since #2184 an
 * event's play-in is its first round, and a bracket or knockout template leaves it out, so the
 * NCAA tournament's covered rounds start at round 2, the round of 64.
 */
export function coveredRoundNumbers(coverage: ContestRoundCoverage, matches: readonly CoverableMatch[]): number[] {
  return [...new Set(matches.filter((match) => coversMatchRound(coverage, match)).map((match) => match.roundNumber))]
    .sort((left, right) => left - right);
}

/**
 * What a win in round `roundNumber` scores under knockout round points (#2014): the value of that
 * round's place among the contest's covered rounds (`roundValues[0]` the first covered round,
 * whatever its number in the event). Undefined for a round the contest does not cover, which
 * scores nothing, and for a covered round past the table's end.
 */
export function coveredRoundValue(roundValues: readonly number[], coveredRounds: readonly number[], roundNumber: number): number | undefined {
  const place = coveredRounds.indexOf(roundNumber);
  return place === -1 ? undefined : roundValues.at(place);
}

/**
 * A contest's coverage from its configuration: the slots its template lists. A contest with no
 * configuration or no template covers every round, until #2014 makes the template required.
 */
export function contestRoundCoverage(configuration: Pick<ContestConfiguration, 'coveredSlotDefinitionIds'> | null | undefined): ContestRoundCoverage {
  return { slotDefinitionIds: configuration?.coveredSlotDefinitionIds ?? null };
}

/** Why a new contest covers none of its event's Season slots (#2014). */
export const ContestCoverageProblem = {
  /** The chosen event holds none of the slots the template lists. */
  NO_LISTED_SLOT: 'NO_LISTED_SLOT',
  /** A ONE_SLOT template lists several of the event's slots and the contest chose none of them. */
  SLOT_NOT_CHOSEN: 'SLOT_NOT_CHOSEN',
  /** The chosen starting slot is not a listed slot of the chosen event. */
  SLOT_NOT_COVERABLE: 'SLOT_NOT_COVERABLE',
} as const;
export type ContestCoverageProblem = (typeof ContestCoverageProblem)[keyof typeof ContestCoverageProblem];

/** A slot of the contest's Season, as coverage reads it: what it plays, where it sits, and its event. */
export interface CoverableSeasonSlot extends CoveredSlot {
  id: string;
  /** The slot definition it plays. */
  slotDefinitionId: string;
  /** The Season competition it is in: FROM_SLOT never leaves it. */
  seasonCompetitionId: string;
  /** The event covering it; null while it is free. */
  sportEventId: string | null;
}

/**
 * The Season slots a new contest covers, in play order (#2014, plan §7): the template's listed
 * slots ∩ the chosen event's Season slots under ONE_SLOT (the one chosen) and ALL_LISTED (all of
 * them); under FROM_SLOT the listed Season slots from the starting slot on, ending with the
 * starting slot's competition (a survivor started in the last regular week never runs into the
 * postseason). The starting slot is the one chosen, or the event's first listed slot. Resolved
 * once, at creation: no later slot joins a contest.
 */
export function resolveCoveredSeasonSlots(
  template: { coverageMode: TemplateCoverageMode; slotDefinitionIds: readonly string[] },
  choice: { sportEventId: string; seasonSlots: readonly CoverableSeasonSlot[]; startingSlotId?: string | null },
): { seasonSlotIds: string[] } | { problem: ContestCoverageProblem } {
  const listed = [...choice.seasonSlots]
    .filter((slot) => template.slotDefinitionIds.includes(slot.slotDefinitionId))
    .sort(compareCoveredSlots);
  const ofEvent = listed.filter((slot) => slot.sportEventId === choice.sportEventId);
  const chosenId = choice.startingSlotId ?? null;
  const chosen = chosenId === null ? undefined : ofEvent.find((slot) => slot.id === chosenId);
  if (chosenId !== null && chosen === undefined) {
    return { problem: ContestCoverageProblem.SLOT_NOT_COVERABLE };
  }
  if (ofEvent.length === 0) {
    return { problem: ContestCoverageProblem.NO_LISTED_SLOT };
  }
  switch (template.coverageMode) {
    case TemplateCoverageMode.ALL_LISTED:
      return { seasonSlotIds: ofEvent.map((slot) => slot.id) };
    case TemplateCoverageMode.ONE_SLOT: {
      const only = chosen ?? (ofEvent.length === 1 ? ofEvent[0] : undefined);
      return only === undefined ? { problem: ContestCoverageProblem.SLOT_NOT_CHOSEN } : { seasonSlotIds: [only.id] };
    }
    case TemplateCoverageMode.FROM_SLOT: {
      const start = chosen ?? ofEvent[0];
      const competition = listed.filter((slot) => slot.seasonCompetitionId === start.seasonCompetitionId);
      return { seasonSlotIds: competition.slice(competition.indexOf(start)).map((slot) => slot.id) };
    }
  }
}
