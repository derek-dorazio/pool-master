import type { Sport } from '../enums';
import { getSportDefinition } from './registry';

/**
 * How one round of an event is labelled: by its sport league's own round names where the league
 * has one for the round (#706: the NBA's "Conference Finals"), otherwise by the sport's
 * (`SportDefinition.roundLabel`). The league's names, first to final, line up with the event's
 * last round, so a bracket with fewer rounds keeps the names nearest the final.
 */
export function eventRoundLabel(sport: Sport, leagueRoundNames: readonly string[], roundNumber: number, roundCount: number): string {
  const fromFinal = roundCount - roundNumber;
  const index = leagueRoundNames.length - 1 - fromFinal;
  // A stored round past the count (the count was lowered) has no league name: `at` would read a
  // negative index from the end.
  const leagueName = fromFinal >= 0 && index >= 0 ? leagueRoundNames.at(index) : undefined;
  return leagueName ?? getSportDefinition(sport).roundLabel(roundNumber, roundCount);
}
