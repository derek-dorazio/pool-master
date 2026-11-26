/**
 * Bracket mapper (#698) — an event's matches → their DTOs, dates as ISO strings.
 */

import { isMatchUnplayed, type SportEventRoundMatch, type SportEventRoundSlot } from '@poolmaster/shared/domain';
import type { SportEventRoundMatchDto, SportEventRoundSlotDto } from '@poolmaster/shared/dto/bracket.dto';

export function mapSportEventRoundMatchToDto(match: SportEventRoundMatch): SportEventRoundMatchDto {
  return {
    id: match.id,
    sportEventId: match.sportEventId,
    roundNumber: match.roundNumber,
    slot: mapRoundSlotToDto(match.slot),
    matchNumber: match.matchNumber,
    homeSportEventParticipantId: match.homeSportEventParticipantId,
    awaySportEventParticipantId: match.awaySportEventParticipantId,
    isNeutralSite: match.isNeutralSite,
    scheduledDate: match.scheduledDate?.toISOString() ?? null,
    status: match.status,
    isUnplayed: isMatchUnplayed(match.status),
    winnerSide: match.winnerSide,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homeShootoutScore: match.homeShootoutScore,
    awayShootoutScore: match.awayShootoutScore,
    ending: match.ending,
    resultSource: match.resultSource,
    completedAt: match.completedAt?.toISOString() ?? null,
    advancesToMatchId: match.advancesToMatchId,
    advancesToSide: match.advancesToSide,
    regionLabel: match.regionLabel,
    homeSpread: match.homeSpread,
    periodScores: match.periodScores.map(({ periodNumber, homeScore, awayScore }) => ({ periodNumber, homeScore, awayScore })),
  };
}

/** The slot a round is played in, for the wire (#2006): its series length and pairing stay server-side. */
export function mapRoundSlotToDto({ seasonSlotId, name, slotKind, weekNumber }: SportEventRoundSlot): SportEventRoundSlotDto {
  return { seasonSlotId, name, slotKind, weekNumber };
}
