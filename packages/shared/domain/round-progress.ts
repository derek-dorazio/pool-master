/**
 * Where each round of an event stands (#1889): the root admin's Rounds grid shows its status, how
 * many results are in and when the last one arrived. Read off the results recorded in the round,
 * never stored.
 */
import { MatchStatus, ParticipantRoundStatus, RoundStatus } from './enums';

/** How many of a round's matches, or of its participant rounds, are in one status. */
export interface RoundResultGroup<Status> {
  status: Status;
  count: number;
  /** The latest completion time among them; null when none has one. */
  lastCompletedAt: Date | null;
}

/** What one round's recorded results say, grouped by status. */
export interface RoundResultFacts {
  matches: readonly RoundResultGroup<MatchStatus>[];
  participantRounds: readonly RoundResultGroup<ParticipantRoundStatus>[];
}

export interface RoundProgress {
  status: RoundStatus;
  /** Matches with a result, or participant rounds finished (any status but IN_PROGRESS). */
  resultCount: number;
  /** When the round's last result was recorded, once it is COMPLETED; null before, and when no result has a time. */
  completedAt: Date | null;
}

export const NO_ROUND_RESULTS: RoundResultFacts = { matches: [], participantRounds: [] };

/**
 * A round with matches is judged by them: COMPLETED once every match is finished or cancelled,
 * IN_PROGRESS once any is under way or finished. A round without matches (a golf round, a race) is
 * judged by its participant rounds: COMPLETED once some are recorded and none is still under way.
 */
export function roundProgressOf(facts: RoundResultFacts): RoundProgress {
  if (facts.matches.length > 0) {
    const total = sumCounts(facts.matches);
    const completed = facts.matches.filter((group) => group.status === MatchStatus.COMPLETED);
    const resolved = sumCounts(completed) + sumCounts(facts.matches.filter((group) => group.status === MatchStatus.CANCELLED));
    const started = resolved + sumCounts(facts.matches.filter((group) => group.status === MatchStatus.IN_PROGRESS));
    const status = resolved === total ? RoundStatus.COMPLETED : started > 0 ? RoundStatus.IN_PROGRESS : RoundStatus.SCHEDULED;
    return { status, resultCount: sumCounts(completed), completedAt: status === RoundStatus.COMPLETED ? latest(completed) : null };
  }
  const total = sumCounts(facts.participantRounds);
  const finished = facts.participantRounds.filter((group) => group.status !== ParticipantRoundStatus.IN_PROGRESS);
  const resultCount = sumCounts(finished);
  const status = total === 0 ? RoundStatus.SCHEDULED : resultCount < total ? RoundStatus.IN_PROGRESS : RoundStatus.COMPLETED;
  return { status, resultCount, completedAt: status === RoundStatus.COMPLETED ? latest(finished) : null };
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
