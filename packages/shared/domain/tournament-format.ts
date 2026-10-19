import { type Sport, TournamentFormat } from './enums';
import { getSportDefinition } from './sports/registry';

/**
 * Which tournament formats are played as matches between two sides (#698, #715). Exhaustive, so a
 * format added to the enum must say. Such an event has its matches loaded by an admin, cannot be
 * released until every match has its teams or an earlier match to fill them, and locks its seeds
 * at release (the upset bonus reads them), all decided here rather than by comparing sports.
 * Whether the matches form a bracket is read from their links, not from the format.
 */
const PLAYS_MATCHES: Readonly<Record<TournamentFormat, boolean>> = {
  [TournamentFormat.STROKE_PLAY_TOURNAMENT]: false,
  [TournamentFormat.RACE]: false,
  [TournamentFormat.MATCHES]: true,
};

/** Whether an event of this sport is played as matches between two sides, by its sport's tournament format. */
export function sportPlaysMatches(sport: Sport): boolean {
  return PLAYS_MATCHES[getSportDefinition(sport).tournamentFormat];
}
