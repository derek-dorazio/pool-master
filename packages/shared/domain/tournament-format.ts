import { type Sport, TournamentFormat } from './enums';
import { getSportDefinition } from './sports/registry';

/**
 * Which tournament formats are played as a bracket of matches (#698). Exhaustive, so a format
 * added to the enum must say. A bracket event has its matches loaded by an admin, cannot be
 * released until its bracket is complete, and locks its seeds at release (the upset bonus reads
 * them), all decided here rather than by comparing sports.
 */
const PLAYS_A_BRACKET: Readonly<Record<TournamentFormat, boolean>> = {
  [TournamentFormat.STROKE_PLAY_TOURNAMENT]: false,
  [TournamentFormat.RACE]: false,
  [TournamentFormat.KNOCKOUT_BRACKET]: true,
};

/** Whether an event of this sport is played as a bracket of matches, by its sport's tournament format. */
export function sportPlaysBracket(sport: Sport): boolean {
  return PLAYS_A_BRACKET[getSportDefinition(sport).tournamentFormat];
}
