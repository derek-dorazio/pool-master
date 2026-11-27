/**
 * Status bubbling (#2013, plan §6 step 5): a Season slot's status from its Matches, and an event's
 * status from its slots. Pure, so the refresh jobs and their tests read the same rule.
 */

import { MatchStatus, SeasonSlotStatus, SportEventStatus } from './enums';
import { isMatchUnplayed } from './match-status';
import { ScoringFamily } from './sports/scoring-family';

/** What a slot's status is computed from: where it stands, its Matches' statuses, and the feed's word that its play is over. */
export interface SlotStatusFacts {
  current: SeasonSlotStatus;
  matchStatuses: readonly MatchStatus[];
  /** The provider's feed called the slot's play final (a golf tournament's FINAL status). */
  feedFinal: boolean;
}

/** Statuses a slot never leaves on its own: COMPLETED is final (corrections go through Re-settle, ADR 0013), CANCELLED a root admin's. */
const SETTLED_SLOT_STATUSES: readonly SeasonSlotStatus[] = [SeasonSlotStatus.COMPLETED, SeasonSlotStatus.CANCELLED];

/** A Match that will not be played further: its result is in, or it was cancelled. */
function isMatchDecided(status: MatchStatus): boolean {
  return status === MatchStatus.COMPLETED || status === MatchStatus.CANCELLED;
}

function everyMatchDecided({ matchStatuses }: SlotStatusFacts): boolean {
  return matchStatuses.length > 0 && matchStatuses.every(isMatchDecided);
}

/**
 * When a slot's play is complete, one rule per scoring family. Matches and races are complete
 * when every Match is decided. A stroke-play event's rounds are not known in advance (a 3-round
 * event, a playoff), so it is complete only on the feed's word.
 */
const SLOT_COMPLETES = {
  [ScoringFamily.HEAD_TO_HEAD]: everyMatchDecided,
  [ScoringFamily.FINISH_POSITION]: everyMatchDecided,
  [ScoringFamily.STROKE_PLAY]: (facts: SlotStatusFacts) => facts.feedFinal,
} as const satisfies Record<ScoringFamily, (facts: SlotStatusFacts) => boolean>;

/** Whether a slot never moves on its own from `status`. */
function isSlotStatusSettled(status: SeasonSlotStatus): boolean {
  return SETTLED_SLOT_STATUSES.includes(status);
}

/**
 * The status a slot's Matches give it: COMPLETED by its family's rule, IN_PROGRESS once any Match
 * has started, SCHEDULED before. A COMPLETED or CANCELLED slot keeps its status.
 */
export function seasonSlotStatusOf(scoringFamily: ScoringFamily, facts: SlotStatusFacts): SeasonSlotStatus {
  if (isSlotStatusSettled(facts.current)) return facts.current;
  if (SLOT_COMPLETES[scoringFamily](facts)) return SeasonSlotStatus.COMPLETED;
  return facts.matchStatuses.some((status) => !isMatchUnplayed(status)) ? SeasonSlotStatus.IN_PROGRESS : SeasonSlotStatus.SCHEDULED;
}

/**
 * The status an event's slots give it, or null for an event with no slots, which keeps its own:
 * CANCELLED when every slot is, COMPLETED when every slot is complete or cancelled, IN_PROGRESS
 * once any slot has started, SCHEDULED before.
 */
export function sportEventStatusOfSlots(slotStatuses: readonly SeasonSlotStatus[]): SportEventStatus | null {
  if (slotStatuses.length === 0) return null;
  if (slotStatuses.every((status) => status === SeasonSlotStatus.CANCELLED)) return SportEventStatus.CANCELLED;
  if (slotStatuses.every(isSlotStatusSettled)) return SportEventStatus.COMPLETED;
  return slotStatuses.some((status) => status !== SeasonSlotStatus.SCHEDULED) ? SportEventStatus.IN_PROGRESS : SportEventStatus.SCHEDULED;
}
