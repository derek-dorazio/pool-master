/**
 * Where each round of an event stands (#1889): the root admin's Rounds grid shows its status, how
 * many results are in and when the last one arrived. Read off the results recorded in the round,
 * never stored.
 */
import { MatchStatus, RoundStatus } from './enums';

/** How many of a round's matches are in one status. */
export interface RoundResultGroup<Status> {
  status: Status;
  count: number;
  /** The latest completion time among them; null when none has one. */
  lastCompletedAt: Date | null;
}

/** What one round's recorded results say, grouped by status. */
export interface RoundResultFacts {
  matches: readonly RoundResultGroup<MatchStatus>[];
}

export interface RoundProgress {
  status: RoundStatus;
  /** Matches with a result: a golf round or a race is one FIELD match (#2008). */
  resultCount: number;
  /** When the round's last result was recorded, once it is COMPLETED; null before, and when no result has a time. */
  completedAt: Date | null;
}

export const NO_ROUND_RESULTS: RoundResultFacts = { matches: [] };

/**
 * A round is judged by its matches: COMPLETED once every match is finished or cancelled,
 * IN_PROGRESS once any is under way or finished, SCHEDULED before. A golf round or a race is one
 * FIELD match (#2008), COMPLETED once every competitor in it has finished.
 */
export function roundProgressOf(facts: RoundResultFacts): RoundProgress {
  const total = sumCounts(facts.matches);
  const completed = facts.matches.filter((group) => group.status === MatchStatus.COMPLETED);
  const resolved = sumCounts(completed) + sumCounts(facts.matches.filter((group) => group.status === MatchStatus.CANCELLED));
  const started = resolved + sumCounts(facts.matches.filter((group) => group.status === MatchStatus.IN_PROGRESS));
  const status = total > 0 && resolved === total ? RoundStatus.COMPLETED : started > 0 ? RoundStatus.IN_PROGRESS : RoundStatus.SCHEDULED;
  return { status, resultCount: sumCounts(completed), completedAt: status === RoundStatus.COMPLETED ? latest(completed) : null };
}

function sumCounts(groups: readonly RoundResultGroup<unknown>[]): number {
  return groups.reduce((total, group) => total + group.count, 0);
}

function latest(groups: readonly RoundResultGroup<unknown>[]): Date | null {
  return groups.reduce<Date | null>(
    (last, group) => (group.lastCompletedAt !== null && (last === null || group.lastCompletedAt > last) ? group.lastCompletedAt : last),
    null,
  );
}
