/**
 * Bracket mapper (#698) — an event's matches → their DTOs, dates as ISO strings.
 */

import {
  MatchStatus,
  isMatchUnplayed,
  matchScoreOf,
  runningPeriodScores,
  shootoutScoreOf,
  type SportEventRoundMatch,
  type SportEventRoundMatchGame,
  type SportEventRoundSlot,
} from '@poolmaster/shared/domain';
import type { SportEventRoundMatchDto, SportEventRoundMatchGameDto, SportEventRoundSlotDto } from '@poolmaster/shared/dto/bracket.dto';

/**
 * A match for the wire, on its sides (#2184): each side's score is its Games' (`matchScoreOf`), and
 * each Game's side results carry their running period scores (`runningPeriodScores`).
 */
export function mapSportEventRoundMatchToDto(match: SportEventRoundMatch): SportEventRoundMatchDto {
  return {
    id: match.id,
    sportEventId: match.sportEventId,
    roundNumber: match.roundNumber,
    slot: mapRoundSlotToDto(match.slot),
    matchNumber: match.matchNumber,
    isNeutralSite: match.isNeutralSite,
    scheduledDate: match.scheduledDate?.toISOString() ?? null,
    status: match.status,
    isFinal: match.status === MatchStatus.COMPLETED,
    isUnplayed: isMatchUnplayed(match.status),
    ending: match.ending,
    completedAt: match.completedAt?.toISOString() ?? null,
    advancesTo: match.advancesToMatchId === null || match.advancesToSideNumber === null
      ? null
      : { matchId: match.advancesToMatchId, sideNumber: match.advancesToSideNumber },
    regionLabel: match.regionLabel,
    sides: match.sides.map((side) => ({
      sideNumber: side.sideNumber,
      sportEventParticipantId: side.sportEventParticipantId,
      outcome: side.outcome,
      score: matchScoreOf(match, side.sideNumber),
      spread: side.spread,
    })),
    games: match.games.map(mapMatchGameToDto),
  };
}

/** One Game of a match, each side's period scores as running totals (a shoot-out is never a period there). */
function mapMatchGameToDto(game: SportEventRoundMatchGame): SportEventRoundMatchGameDto {
  const periods = runningPeriodScores(game);
  return {
    gameNumber: game.gameNumber,
    status: game.status,
    isFinal: game.status === MatchStatus.COMPLETED,
    scheduledDate: game.scheduledDate?.toISOString() ?? null,
    sideResults: game.sideResults.map((result) => ({
      sideNumber: result.sideNumber,
      score: result.score,
      homeAway: result.homeAway,
      shootoutScore: shootoutScoreOf(game, result.sideNumber),
      periodScores: periods.map(({ kind, periodNumber, totals }) => ({ kind, periodNumber, score: totals.get(result.sideNumber) ?? 0 })),
    })),
  };
}

/** The slot a round is played in, for the wire (#2006): its series length and pairing stay server-side. */
export function mapRoundSlotToDto({ seasonSlotId, name, slotKind, weekNumber, periods }: SportEventRoundSlot): SportEventRoundSlotDto {
  return { seasonSlotId, name, slotKind, weekNumber, periods: periods === null ? null : { unit: periods.unit, count: periods.count } };
}
