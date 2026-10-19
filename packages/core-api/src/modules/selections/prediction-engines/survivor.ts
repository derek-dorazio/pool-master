/**
 * Survivor (#719): pick one team to win each week, never a team the entry picked in an earlier
 * week. The pick locks, and is revealed, at its game's kickoff; a loss, a tie or a week left
 * unsubmitted puts the entry out (survivor.ts in the head-to-head family holds the season rules).
 * There is no tiebreaker: entries out in the same week share their place.
 */

import { PickEmMode, SelectionType } from '@poolmaster/shared/domain';
import { PickWindow } from '../../contests/entry-window';
import { scoreGamePicks } from '../../scoring-families/head-to-head/game-picks';
import { PredictionIssueKind, type PredictionEngine, type PredictionIssue } from './prediction-engine';

export const survivorPredictionEngine: PredictionEngine = {
  selectionType: SelectionType.SURVIVOR,
  pickWindow: PickWindow.UNTIL_MATCH_START,
  onePickPerEvent: true,
  readsEarlierWeeks: true,

  tiebreakerGame() {
    return null;
  },

  resolvePicks({ games, predictions }) {
    const sides = new Map(games.map((game) => [game.id, {
      home: game.homeSportEventParticipantId,
      away: game.awaySportEventParticipantId,
    }]));
    const valid = (prediction: (typeof predictions)[number]) => {
      const game = sides.get(prediction.sportEventMatchId);
      return game !== undefined
        && (prediction.sportEventParticipantId === game.home || prediction.sportEventParticipantId === game.away);
    };
    // The week holds one pick: the latest valid one stands, and any other is cleared.
    const kept = predictions.filter(valid).slice(-1);
    return { sides, kept, stranded: predictions.filter((prediction) => !kept.includes(prediction)) };
  },

  scorePicks({ games, predictions }) {
    // The week's pick is marked right or wrong as a straight-up pick is, 1 point when its team
    // wins: what the week screen shows. Who is still standing is the season read's.
    return scoreGamePicks(games, predictions, PickEmMode.STRAIGHT_UP);
  },

  acceptsConfidence({ confidence }) {
    return confidence === null;
  },

  findWeekIssues({ gameMatchIds, predictions, season }) {
    const issues: PredictionIssue[] = [];
    if (season?.eliminatedInWeek !== null && season?.eliminatedInWeek !== undefined) {
      issues.push({ kind: PredictionIssueKind.ENTRY_ELIMINATED });
    }
    const games = new Set(gameMatchIds);
    const picked = predictions.filter((prediction) => games.has(prediction.sportEventMatchId));
    if (picked.length !== 1) {
      issues.push({ kind: PredictionIssueKind.ONE_PICK_REQUIRED, pickedCount: picked.length });
    }
    for (const pick of picked) {
      const participantId = season?.participantIdOf.get(pick.sportEventParticipantId);
      if (participantId !== undefined && season?.usedParticipantIds.has(participantId) === true) {
        issues.push({ kind: PredictionIssueKind.TEAM_ALREADY_USED, sportEventParticipantId: pick.sportEventParticipantId });
      }
    }
    return issues;
  },
};
