import { eventSportDefinition, type SportLeagueEvent } from './sport-league-definition';

/**
 * A sport league's own entry for one round of an event, from a list kept first to final (round
 * names, series lengths). The list lines up with the event's last round, so a bracket with fewer
 * rounds keeps the entries nearest the final. Undefined where the list has no entry for the round.
 */
function leagueRoundEntry<T>(leagueList: readonly T[], roundNumber: number, roundCount: number): T | undefined {
  const fromFinal = roundCount - roundNumber;
  const index = leagueList.length - 1 - fromFinal;
  // A stored round past the count (the count was lowered) has no entry: `at` would read a
  // negative index from the end.
  return fromFinal >= 0 && index >= 0 ? leagueList.at(index) : undefined;
}

/**
 * How one round of an event is labelled: by its sport league's own round names where the league
 * has one for the round (#706: the NBA's "Conference Finals"), otherwise by the event's sport
 * league definition (`SportDefinition.roundLabel`), so a stat pool's rounds are its games.
 */
export function eventRoundLabel(event: SportLeagueEvent, leagueRoundNames: readonly string[], roundNumber: number, roundCount: number): string {
  return leagueRoundEntry(leagueRoundNames, roundNumber, roundCount) ?? eventSportDefinition(event).roundLabel(roundNumber, roundCount);
}

/**
 * How many games one match of a round is played over (#1545): its sport league's best-of length
 * for the round (`SportLeague.roundSeriesLengths`, the NBA's 7), or 1 where the league names none,
 * a single game. A series is won by the first side to win more than half of it.
 */
export function roundSeriesLength(leagueSeriesLengths: readonly number[], roundNumber: number, roundCount: number): number {
  return leagueRoundEntry(leagueSeriesLengths, roundNumber, roundCount) ?? 1;
}

/** The games a side must win to take a best-of series: more than half of them. */
export function seriesWinsNeeded(seriesLength: number): number {
  return Math.floor(seriesLength / 2) + 1;
}
