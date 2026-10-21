/**
 * Survivor (#719): pick one team to win each week, never a team the entry picked in an earlier
 * week. The pick locks, and is revealed, at its game's kickoff; a loss, a tie or a week left
 * unsubmitted puts the entry out (survivor.ts in the head-to-head family holds the season rules).
 * There is no tiebreaker: entries out in the same week share their place.
 *
 * In a playoff (#785) each round of the bracket is a week: the entry submits the event once, with
 * its first round's pick, and holds one pick in each later round, picked once that round's games
 * have their teams. A team picked in one round is used for every other.
 */

import { PickEmMode, SelectionType, isTeamChoice } from '@poolmaster/shared/domain';
import { PickWindow } from '../../contests/entry-window';
import { scoreGamePicks } from '../../scoring-families/head-to-head/game-picks';
import { PredictionIssueKind, type PredictionEngine, type PredictionIssue } from './prediction-engine';

export const survivorPredictionEngine: PredictionEngine = {
  selectionType: SelectionType.SURVIVOR,
  pickWindow: PickWindow.UNTIL_MATCH_START,
  onePickPerRound: true,
  readsEarlierWeeks: true,
  takesTiePicks: false,

  tiebreakerGame() {
    return null;
  },

  resolvePicks({ games, predictions }) {
    const sides = new Map(games.map((game) => [game.id, {
      home: game.homeSportEventParticipantId,
      away: game.awaySportEventParticipantId,
    }]));
    const roundOf = new Map(games.map((game) => [game.id, game.roundNumber]));
    // A survivor pick names a team: a tie pick never stands.
    const valid = (prediction: (typeof predictions)[number]) => {
      const game = sides.get(prediction.sportEventMatchId);
      return game !== undefined && isTeamChoice(prediction)
        && (prediction.sportEventParticipantId === game.home || prediction.sportEventParticipantId === game.away);
    };
    // Each round holds one pick: the latest valid one stands, and any other is cleared.
    const latestByRound = new Map<number, (typeof predictions)[number]>();
    for (const prediction of predictions.filter(valid)) {
      latestByRound.set(roundOf.get(prediction.sportEventMatchId) ?? 0, prediction);
    }
    const kept = predictions.filter((prediction) => [...latestByRound.values()].includes(prediction));
    return { sides, kept, stranded: predictions.filter((prediction) => !kept.includes(prediction)) };
  },

  scorePicks({ games, predictions }) {
    // The week's pick is marked right or wrong as a straight-up pick is, 1 point when its team
    // wins: what the week screen shows. Who is still standing is the season read's.
    return scoreGamePicks(games, predictions, { mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false });
  },

  acceptsConfidence({ confidence }) {
    return confidence === null;
  },

  findWeekIssues({ gameMatchIds, predictions, season }) {
    const issues: PredictionIssue[] = [];
    if (season?.eliminatedInWeek !== null && season?.eliminatedInWeek !== undefined && season.eliminatedInWeek < season.firstWeekNumber) {
      issues.push({ kind: PredictionIssueKind.ENTRY_ELIMINATED });
    }
    const games = new Set(gameMatchIds);
    const picked = predictions.filter((prediction) => games.has(prediction.sportEventMatchId));
    // The event's first round needs its one pick to submit; a later round holds at most one.
    const byRound = new Map<number, number>();
    for (const pick of picked) {
      const round = season?.roundOf.get(pick.sportEventMatchId) ?? 1;
      byRound.set(round, (byRound.get(round) ?? 0) + 1);
    }
    const firstRoundCount = byRound.get(season?.firstRoundNumber ?? 1) ?? 0;
    const crowded = [...byRound.values()].find((count) => count > 1);
    if (firstRoundCount !== 1 || crowded !== undefined) {
      issues.push({ kind: PredictionIssueKind.ONE_PICK_REQUIRED, pickedCount: crowded ?? firstRoundCount });
    }
    const seen = new Set<string>();
    for (const pick of picked.filter(isTeamChoice)) {
      const participantId = season?.participantIdOf.get(pick.sportEventParticipantId);
      if (seen.has(pick.sportEventParticipantId)
        || (participantId !== undefined && season?.usedParticipantIds.has(participantId) === true)) {
        issues.push({ kind: PredictionIssueKind.TEAM_ALREADY_USED, sportEventParticipantId: pick.sportEventParticipantId });
      }
      seen.add(pick.sportEventParticipantId);
    }
    return issues;
  },
};
