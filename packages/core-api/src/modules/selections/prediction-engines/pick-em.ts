/**
 * Pick'em (#716): pick the winner of every game of each week, straight up or ranked by
 * confidence. Each pick locks, and is revealed, at its own game's kickoff.
 */

import { PickEmMode, SelectionType, type ContestSelectionConfig } from '@poolmaster/shared/domain';
import { PickWindow } from '../../contests/entry-window';
import { PredictionIssueKind, type PredictionEngine, type PredictionIssue } from './prediction-engine';

/** The contest's pick'em mode, or undefined when its stored rules are not pick'em rules. */
function pickEmMode(configuration: ContestSelectionConfig | undefined): PickEmMode | undefined {
  return configuration?.selectionType === SelectionType.PICK_EM ? configuration.mode : undefined;
}

export const pickEmPredictionEngine: PredictionEngine = {
  selectionType: SelectionType.PICK_EM,
  pickWindow: PickWindow.UNTIL_MATCH_START,
  // A weekly pool's tiebreaker is one per week, with its scoring (#717).
  takesTiebreaker: false,

  resolvePicks({ games, predictions }) {
    const sides = new Map(games.map((game) => [game.id, {
      home: game.homeSportEventParticipantId,
      away: game.awaySportEventParticipantId,
    }]));
    const stands = (prediction: (typeof predictions)[number]) => {
      const game = sides.get(prediction.sportEventMatchId);
      return game !== undefined
        && (prediction.sportEventParticipantId === game.home || prediction.sportEventParticipantId === game.away);
    };
    return {
      sides,
      kept: predictions.filter(stands),
      stranded: predictions.filter((prediction) => !stands(prediction)),
    };
  },

  scorePicks() {
    return null;
  },

  acceptsConfidence({ configuration, confidence, gameCount }) {
    if (confidence === null) {
      return true;
    }
    return pickEmMode(configuration) === PickEmMode.CONFIDENCE
      && Number.isInteger(confidence)
      && confidence >= 1
      && confidence <= gameCount;
  },

  findWeekIssues({ configuration, gameMatchIds, predictions }) {
    const issues: PredictionIssue[] = [];
    const games = new Set(gameMatchIds);
    const picked = predictions.filter((prediction) => games.has(prediction.sportEventMatchId));
    if (picked.length < games.size) {
      issues.push({ kind: PredictionIssueKind.WEEK_INCOMPLETE, pickedCount: picked.length, gameCount: games.size });
    }
    const mode = pickEmMode(configuration);
    const values = picked.map((prediction) => prediction.confidence);
    const confidenceValid = mode === PickEmMode.CONFIDENCE
      // 1 to the game count, each once: as many distinct values in range as there are games.
      ? values.every((value) => value !== null && value >= 1 && value <= games.size)
        && new Set(values).size === values.length
      : values.every((value) => value === null);
    if (!confidenceValid) {
      issues.push({ kind: PredictionIssueKind.CONFIDENCE_INVALID });
    }
    return issues;
  },
};
