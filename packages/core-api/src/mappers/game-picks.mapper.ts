/**
 * A prediction contest entry's game picks → DTO (#716). `PredictionService` answers with a
 * `GamePicksView` in domain terms; the published `GamePicksResponse` is shaped here.
 */

import type { ContestEntryMatchPredictionWrite } from '@poolmaster/shared/db';
import { PredictedResult, type PredictedChoice } from '@poolmaster/shared/domain';
import type { GamePickGameDto, GamePickWrite, GamePicksResponse, SaveGamePicksRequest } from '@poolmaster/shared/dto';
import type { GamePickGame, GamePicksView } from '../modules/selections/prediction-service';
import { selectionErrors } from '../modules/selections/selection-errors';

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
    homeSpread: match.homeSpread,
    home: game.home,
    away: game.away,
    predictedHome: game.predictedHome,
    predictedAway: game.predictedAway,
    locked: game.locked,
    revealed: game.revealed,
    pick: pick === null
      ? null
      : {
        predictedResult: pick.predictedResult,
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
    againstTheSpread: view.againstTheSpread,
    tiePicksOffered: view.tiePicksOffered,
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

/**
 * What one requested pick says: its team, or a tie (#792). The request schema's refinement is not
 * part of its published JSON schema, so the pairing is checked here: 400 PREDICTION_PICK_INVALID for
 * a TEAM pick without its team or a TIE pick with one.
 */
function toChoice(pick: GamePickWrite): PredictedChoice {
  if (pick.predictedResult === PredictedResult.TIE && pick.sportEventParticipantId === null) {
    return { predictedResult: PredictedResult.TIE, sportEventParticipantId: null };
  }
  if (pick.predictedResult === PredictedResult.TEAM && pick.sportEventParticipantId !== null) {
    return { predictedResult: PredictedResult.TEAM, sportEventParticipantId: pick.sportEventParticipantId };
  }
  throw selectionErrors.pickInvalid(pick.sportEventMatchId);
}

/** The picks a save request names, with an omitted confidence as none. */
export function toGamePickWrites(request: SaveGamePicksRequest): ContestEntryMatchPredictionWrite[] {
  return request.picks.map((pick) => ({
    sportEventMatchId: pick.sportEventMatchId,
    ...toChoice(pick),
    confidence: pick.confidence ?? null,
  }));
}
