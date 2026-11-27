import type { GamePicksResponse } from '@/lib/api';

/**
 * A pick screen game's sides (#2016) in the generated contract's shape: each side by its number,
 * where it plays, its real team and the team the entry's picks put there.
 */

type Side = GamePicksResponse['games'][number]['sides'][number];
type Team = NonNullable<Side['team']>;

interface SideTeams {
  /** The team the entry's own picks put on the side: the real team unless told otherwise. */
  predicted?: Team | null;
  /** The spread, carried on side 1 only. */
  spread?: number | null;
}

function side(sideNumber: 1 | 2, homeAway: Side['homeAway'], team: Team | null, { predicted = team, spread = null }: SideTeams = {}): Side {
  return { sideNumber, homeAway, team, predictedTeam: predicted, spread: sideNumber === 1 ? spread : null };
}

/**
 * A game as a synced schedule has it: the away team on side 1 and the home team on side 2.
 * `spread` is side 1's, the away team's: +3.5 has the home team favoured by 3.5.
 */
export function awayAtHomeSides(
  away: Team | null,
  home: Team | null,
  { predictedAway = away, predictedHome = home, spread = null }: { predictedAway?: Team | null; predictedHome?: Team | null; spread?: number | null } = {},
): Side[] {
  return [side(1, 'AWAY', away, { predicted: predictedAway, spread }), side(2, 'HOME', home, { predicted: predictedHome })];
}

/** A game at a neutral site, as a bracket's are: neither side home or away. */
export function neutralSides(
  sideOne: Team | null,
  sideTwo: Team | null,
  { predictedOne = sideOne, predictedTwo = sideTwo }: { predictedOne?: Team | null; predictedTwo?: Team | null } = {},
): Side[] {
  return [side(1, 'NONE', sideOne, { predicted: predictedOne }), side(2, 'NONE', sideTwo, { predicted: predictedTwo })];
}
