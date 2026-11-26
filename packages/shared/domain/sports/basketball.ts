import { MatchPeriodLayout, SelectionType, Sport, TournamentFormat } from '../enums';
import type { SportDefinition } from './sport-definition';

/**
 * Basketball (#698, plans/knockout-and-pickem-design.md §3.5): teams playing a knockout bracket,
 * scored by the head-to-head family from the bracket's matches. The NCAA Division I men's and
 * women's tournaments are its sport leagues, and the NBA and WNBA playoffs are two more (#706): a
 * series is one match, its scores the games each side won. A round is named by the slot it is
 * played in (#2006). The NBA play-in fills the 7 and 8 seeds through play-in places, as the First
 * Four does.
 *
 * The March Madness field is 64 bracket places in six rounds: the First Four play-in winners
 * fill their places through one combined field member each, not through play-in matches. Four
 * tiers of 16 are the seed lines (seeds 1-4, 5-8, 9-12 and 13-16 across the four regions), in
 * the field's overall ranking order.
 */
export const basketballSportDefinition: SportDefinition = {
  sport: Sport.BASKETBALL,
  name: 'Basketball',
  tournamentFormat: TournamentFormat.MATCHES,
  defaultRounds: 6,
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.PICK_EM, SelectionType.BRACKET, SelectionType.SURVIVOR, SelectionType.SQUARES],
  scoringDefinitions: ['KNOCKOUT_ROUND_POINTS'],
  shootout: false,
  // Quarters, as the NBA, the WNBA and women's college basketball play; men's college basketball
  // plays halves (its sport league's `matchPeriodLayout`).
  matchPeriodLayout: MatchPeriodLayout.QUARTERS,
  pickEm: { tiePicks: false, againstTheSpread: true },
  // A six-round bracket reads First Round, Second Round, Sweet 16, Elite Eight, Final Four,
  // National Championship; a shorter one keeps the names counted back from its final.
};
