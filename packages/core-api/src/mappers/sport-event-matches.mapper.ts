/**
 * Bracket mapper (#698) — an event's matches → their DTOs, dates as ISO strings.
 */

import type { SportEventMatch } from '@poolmaster/shared/domain';
import type { SportEventMatchDto } from '@poolmaster/shared/dto/bracket.dto';

export function mapSportEventMatchToDto(match: SportEventMatch): SportEventMatchDto {
  return {
    id: match.id,
    sportEventId: match.sportEventId,
    roundNumber: match.roundNumber,
    matchNumber: match.matchNumber,
    homeSportEventParticipantId: match.homeSportEventParticipantId,
    awaySportEventParticipantId: match.awaySportEventParticipantId,
    isNeutralSite: match.isNeutralSite,
    scheduledDate: match.scheduledDate?.toISOString() ?? null,
    status: match.status,
    winnerSide: match.winnerSide,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    advancesToMatchId: match.advancesToMatchId,
    advancesToSide: match.advancesToSide,
    regionLabel: match.regionLabel,
    homeSpread: match.homeSpread,
  };
}
