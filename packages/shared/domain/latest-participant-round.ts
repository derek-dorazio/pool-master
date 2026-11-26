/**
 * A participant's current round (#2047): the latest of its own rounds, by round number. A standing
 * stores no round of its own; the golf standings writer and the API's standing both read it here.
 */
export function latestParticipantRound<T>(rounds: readonly T[], roundOf: (each: T) => { readonly roundNumber: number }): T | null {
  return rounds.reduce<T | null>((latest, each) => (latest === null || roundOf(each).roundNumber > roundOf(latest).roundNumber ? each : latest), null);
}
