/**
 * A prediction contest entry's game picks → DTO (#716). `PredictionService` answers with a
 * `GamePicksView` in domain terms; the published `GamePicksResponse` is shaped here.
 */

import type { ContestEntryMatchPredictionWrite } from '@poolmaster/shared/db';
import type { GamePickGameDto, GamePicksResponse, SaveGamePicksRequest } from '@poolmaster/shared/dto';
import type { GamePickGame, GamePicksView } from '../modules/selections/prediction-service';

function toGamePickGameDto(game: GamePickGame): GamePickGameDto {
  const { match, pick, pickScore } = game;
  return {
    sportEventMatchId: match.id,
    matchNumber: match.matchNumber,
    roundNumber: match.roundNumber,
    kickoff: game.kickoff.toISOString(),
    status: match.status,
    isNeutralSite: match.isNeutralSite,
    regionLabel: match.regionLabel,
    home: game.home,
    away: game.away,
    predictedHome: game.predictedHome,
    predictedAway: game.predictedAway,
    locked: game.locked,
    revealed: game.revealed,
    pick: pick === null
      ? null
      : {
        sportEventParticipantId: pick.sportEventParticipantId,
        confidence: pick.confidence,
        pickedAt: pick.pickedAt.toISOString(),
        outcome: pickScore?.outcome ?? null,
        points: pickScore?.points ?? null,
      },
  };
}

export function toGamePicksResponse(view: GamePicksView): GamePicksResponse {
  return {
    contestId: view.contestId,
    entryId: view.entryId,
    entryName: view.entryName,
    sportEventId: view.sportEventId,
    selectionType: view.selectionType,
    mode: view.mode,
    survivor: view.survivor,
    status: view.status,
    submittedAt: view.submittedAt?.toISOString() ?? null,
    ownEntry: view.ownEntry,
    canSubmit: view.canSubmit,
    pickedCount: view.pickedCount,
    gameCount: view.gameCount,
    tiebreakerMatchId: view.tiebreakerMatchId,
    tiebreakerValue: view.tiebreakerValue,
    points: view.points,
    maxPossiblePoints: view.maxPossiblePoints,
    games: view.games.map(toGamePickGameDto),
  };
}

/** The picks a save request names, with an omitted confidence as none. */
export function toGamePickWrites(request: SaveGamePicksRequest): ContestEntryMatchPredictionWrite[] {
  return request.picks.map((pick) => ({
    sportEventMatchId: pick.sportEventMatchId,
    sportEventParticipantId: pick.sportEventParticipantId,
    confidence: pick.confidence ?? null,
  }));
}
