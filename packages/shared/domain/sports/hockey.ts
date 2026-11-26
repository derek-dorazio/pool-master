import { SelectionType, Sport, TournamentFormat } from '../enums';
import type { SportDefinition } from './sport-definition';

/**
 * Hockey (#788): teams playing a knockout bracket, scored by the head-to-head family from the
 * bracket's matches, as basketball is. Its sport leagues are the NHL and PWHL playoffs, where a
 * series is one match whose scores are the games each side won, and the NCAA Division I men's
 * and women's tournaments, single games whose scores are goals. Every round is named by the slot it
 * is played in (#2006). A game is three periods; overtime goals count only in the final score.
 *
 * The NHL and the men's tournament are 16 teams in four rounds, four tiers of four. The women's
 * tournament seeds five teams and fills three quarterfinal places from a first round, through
 * play-in places as March Madness's First Four does. The PWHL's four teams start on two tiers
 * (its tier profile, `SportLeague.platformTierProfileId`).
 */
export const hockeySportDefinition: SportDefinition = {
  sport: Sport.HOCKEY,
  name: 'Hockey',
  tournamentFormat: TournamentFormat.MATCHES,
  defaultRounds: 4,
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.BRACKET, SelectionType.SURVIVOR, SelectionType.SQUARES],
  scoringDefinitions: ['KNOCKOUT_ROUND_POINTS'],
  // Playoff games play overtime to a goal, so none ends in a shoot-out (#791).
  // A four-round bracket reads Regional Semifinals, Regional Finals, Frozen Four, National
  // Championship; a shorter one keeps the names counted back from its final.
};
