/**
 * Bracket (#721): pick the winner of every game of one knockout event before it starts, all the
 * way to the final, with a guess of the final's total points as the tiebreaker. A later game's
 * pick is a team the entry picked to get there (bracket-picks.ts holds the rules), and every
 * pick locks, and is revealed, when the event starts.
 */

import { SelectionType } from '@poolmaster/shared/domain';
import { PickWindow } from '../../contests/entry-window';
import { bracketFinal, resolveBracketPicks, scoreBracketPicks } from '../../scoring-families/head-to-head/bracket-picks';
import { PredictionIssueKind, type PredictionEngine, type PredictionIssue } from './prediction-engine';

export const bracketPredictionEngine: PredictionEngine = {
  selectionType: SelectionType.BRACKET,
  pickWindow: PickWindow.UNTIL_EVENT_START,

  tiebreakerGame({ games }) {
    return bracketFinal(games);
  },

  acceptsConfidence({ confidence }) {
    return confidence === null;
  },

  resolvePicks({ games, predictions, seedOf }) {
    return resolveBracketPicks(games, predictions, seedOf);
  },

  scorePicks({ games, predictions, seedOf, scoring }) {
    // A bracket scores with the knockout round values; contest setup refuses any other definition.
    return scoring?.participantScoringDefinitionId === 'KNOCKOUT_ROUND_POINTS'
      ? scoreBracketPicks(games, predictions, seedOf, scoring.config)
      : null;
  },

  findWeekIssues({ gameMatchIds, predictions, tiebreakerValue }) {
    const issues: PredictionIssue[] = [];
    const games = new Set(gameMatchIds);
    const pickedCount = predictions.filter((prediction) => games.has(prediction.sportEventMatchId)).length;
    if (pickedCount < games.size) {
      issues.push({ kind: PredictionIssueKind.WEEK_INCOMPLETE, pickedCount, gameCount: games.size });
    }
    if (tiebreakerValue === null) {
      issues.push({ kind: PredictionIssueKind.TIEBREAKER_MISSING });
    }
    return issues;
  },
};
