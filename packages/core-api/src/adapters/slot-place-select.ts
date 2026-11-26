/**
 * Where a slot definition sits in a Season's play (#2153): its competition, that competition's
 * place in its phase, and the phase's kind. The one select and mapping every read that puts slot
 * definitions in play order uses (`compareCoveredSlots`).
 */
import type { LeaguePhase } from '@poolmaster/shared/domain';

export const SLOT_PLACE_SELECT = {
  competition: { select: { id: true, code: true, orderIndex: true, phase: { select: { phase: true } } } },
} as const;

/** A definition row selected with `SLOT_PLACE_SELECT`. */
export interface SlotPlaceRow {
  competition: { id: string; code: string; orderIndex: number; phase: { phase: LeaguePhase } };
}

export interface SlotPlace {
  sportLeagueCompetitionId: string;
  competitionCode: string;
  competitionOrderIndex: number;
  phase: LeaguePhase;
}

export function slotPlaceOf({ competition }: SlotPlaceRow): SlotPlace {
  return {
    sportLeagueCompetitionId: competition.id,
    competitionCode: competition.code,
    competitionOrderIndex: competition.orderIndex,
    phase: competition.phase.phase,
  };
}
