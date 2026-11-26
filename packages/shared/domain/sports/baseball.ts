import { SelectionType, Sport, TournamentFormat } from '../enums';
import type { SportDefinition } from './sport-definition';

/**
 * Baseball (#789): teams playing a knockout bracket, scored by the head-to-head family from the
 * bracket's matches, as basketball and hockey are. Its one sport league is the MLB postseason,
 * where every round is a series: one bracket match whose scores are the games each side won.
 *
 * Twelve teams in four rounds, four tiers of three. Each league's top two seeds skip the Wild Card
 * Series and start in the Division Series, named straight into their match as the CFP's byes
 * are. A final that is a series has no single game for a squares pool, and baseball keeps no
 * score by period, so it offers no squares.
 */
export const baseballSportDefinition: SportDefinition = {
  sport: Sport.BASEBALL,
  name: 'Baseball',
  tournamentFormat: TournamentFormat.MATCHES,
  defaultRounds: 4,
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.BRACKET, SelectionType.SURVIVOR],
  scoringDefinitions: ['KNOCKOUT_ROUND_POINTS'],
  // A four-round postseason reads Wild Card Series, Division Series, League Championship Series,
  // World Series; a shorter one keeps the names counted back from its final.
};
