import { SelectionType, Sport, TournamentFormat } from '../enums';
import type { SportDefinition } from './sport-definition';

/**
 * Tennis (#704): individuals playing a knockout draw, scored by the head-to-head family from the
 * draw's matches, as the team sports are. Its sport leagues are the ATP (men's singles) and the
 * WTA (women's singles), split as every other sport's men's and women's competitions are; each
 * holds the four Grand Slams as event series. The NCAA Division I men's and women's singles
 * championships are two more, each a 64-player draw in six rounds, 16 of them seeded, with its
 * own round names. A Slam singles draw is 128 players in seven rounds, 32 of them seeded. A
 * match's score is sets won, and a match can end early (a retirement, a walkover or a default)
 * with its winner winning in full.
 *
 * A Slam draw's 16 qualifier places are play-in places (#709), filled once qualifying ends. The
 * field is cut into six tiers of eight by ranking, the last taking everyone else, so in a Slam
 * draw the first four tiers are the 32 seeds. There are no periods, so no squares, and no pick'em.
 */
export const tennisSportDefinition: SportDefinition = {
  sport: Sport.TENNIS,
  name: 'Tennis',
  tournamentFormat: TournamentFormat.MATCHES,
  defaultRounds: 7,
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.BRACKET, SelectionType.SURVIVOR],
  scoringDefinitions: ['KNOCKOUT_ROUND_POINTS'],
  // A tennis match always has a winner: no level score to settle.
  // A Slam's seven rounds read First round to Fourth round, then Quarterfinals, Semifinals,
  // Final; a 64 draw's six the same, with no Fourth round.
};
