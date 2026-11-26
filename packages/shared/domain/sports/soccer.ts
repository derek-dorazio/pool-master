import { MatchPeriodLayout, SelectionType, Sport, TournamentFormat } from '../enums';
import type { SportDefinition } from './sport-definition';

/**
 * Soccer (#787): teams playing a knockout bracket, scored by the head-to-head family from the
 * bracket's matches, as basketball and hockey are. Its sport leagues are the FIFA World Cup and
 * Women's World Cup, the UEFA European Championship, the Copa América and the UEFA Champions
 * League, each event its knockout stage. A match's score is the score after extra time (IFAB
 * Law 10); one level after extra time goes to penalties, kept apart as the match's shoot-out
 * (#791). A Champions League two-legged tie is one match whose score is the aggregate, kicking
 * off at the first leg. Every round is named by the slot it is played in (#2006).
 *
 * A knockout stage of 16 is four rounds, four tiers of four, seeded by FIFA ranking for the
 * international tournaments and by league-phase place for the Champions League. A match is two
 * halves; extra-time goals count only in the final score.
 */
export const soccerSportDefinition: SportDefinition = {
  sport: Sport.SOCCER,
  name: 'Soccer',
  tournamentFormat: TournamentFormat.MATCHES,
  defaultRounds: 4,
  selectionTypes: [
    SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.PICK_EM, SelectionType.BRACKET, SelectionType.SURVIVOR, SelectionType.SQUARES,
  ],
  scoringDefinitions: ['KNOCKOUT_ROUND_POINTS'],
  // A pick'em pick may be a draw (#792); soccer has no spread to pick against.
  pickEm: { tiePicks: true, againstTheSpread: false },
  shootout: true,
  matchPeriodLayout: MatchPeriodLayout.HALVES,
  // A four-round knockout reads Round of 16, Quarter-finals, Semi-finals, Final; a five-round one
  // starts at the Round of 32.
};
