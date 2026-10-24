/**
 * Composite (championship stat pools, #932): each game is a round, and a player's round scores
 * the sport's composite of their stats in it (`SportComposite`: Box Score for baseball). A
 * player's contest score is their games summed, more is better (`COMPOSITE_TOTAL`), and a game
 * they did not play scores 0. Results are the stat lines extending each participant round. Its
 * one scoring definition takes no contest settings, so `scoreField` reads none. It takes no live
 * scores until a stat provider is chosen (plans/championship-stat-pools.md Q10).
 */
import { ScoringFamily } from '@poolmaster/shared/domain';
import type { ScoringFamilyModule } from '../scoring-family-module';
import { compositeOf, scorePlayerGames } from './score-games';

export const compositeScoringFamily: ScoringFamilyModule = {
  scoreField(field, event) {
    const composite = compositeOf(event);
    // Nothing is scored until the first game's lines are in; from then, a player with none
    // played no game yet and scores 0.
    const anyGameIn = field.some((row) => row.rounds.some((round) => round.statLines.length > 0));
    return field.map((row) => {
      const { score, gameScores, asOf } = scorePlayerGames(row, composite);
      return {
        sportEventParticipantId: row.entry.id,
        name: row.participant.name,
        score: anyGameIn ? score : null,
        detail: { scoringFamily: ScoringFamily.COMPOSITE, gameScores },
        asOf,
      };
    });
  },

  scoreMissedLineup() {
    // Every counting pick scores as a player who played no game.
    return 0;
  },

  liveScores: null,
};
