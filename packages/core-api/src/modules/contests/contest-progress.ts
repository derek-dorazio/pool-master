import { ContestFormat, ContestStatus, MatchStatus, SportEventStatus } from '@poolmaster/shared/domain';
import type { Contest, SportEvent, SportEventMatch } from '@poolmaster/shared/domain';

/** What a live contest's progress counts: its one event's games, or its weeks or events. */
export type ContestProgressUnit = 'GAMES' | 'WEEKS' | 'EVENTS';

/** How far a live contest has got (#1782): `played` of `total`, in `unit`. */
export type ContestProgress = { played: number; total: number; unit: ContestProgressUnit };

/**
 * A live contest's progress (#1782), the one place it is worked out. A contest of several events
 * counts its events, as weeks for a prediction contest (a pick'em or survivor season) and as
 * events for a roster one; a prediction contest of one event counts that event's games. Cancelled
 * events and games count for neither side. Null when the contest is not ACTIVE, when it is one
 * roster event (its leaderboard says more), or when its one event has fewer than two games to count.
 * `games` are the contest's one event's games; only a one-event prediction contest reads them.
 */
export function describeContestProgress(
  contest: Pick<Contest, 'contestFormat' | 'status'>,
  events: readonly Pick<SportEvent, 'status'>[],
  games: readonly Pick<SportEventMatch, 'status'>[],
): ContestProgress | null {
  if (contest.status !== ContestStatus.ACTIVE) {
    return null;
  }
  const isPrediction = contest.contestFormat === ContestFormat.PREDICTION;
  if (events.length > 1) {
    const counted = events.filter((event) => event.status !== SportEventStatus.CANCELLED);
    return {
      played: counted.filter((event) => event.status === SportEventStatus.COMPLETED).length,
      total: counted.length,
      unit: isPrediction ? 'WEEKS' : 'EVENTS',
    };
  }
  if (!isPrediction) {
    return null;
  }
  const counted = games.filter((game) => game.status !== MatchStatus.CANCELLED);
  if (counted.length < 2) {
    return null;
  }
  return { played: counted.filter((game) => game.status === MatchStatus.COMPLETED).length, total: counted.length, unit: 'GAMES' };
}

/** Whether a contest's progress counts its one event's games, which the list then reads. */
export function countsEventGames(contest: Pick<Contest, 'contestFormat' | 'sportEventIds' | 'status'>): boolean {
  return contest.status === ContestStatus.ACTIVE && contest.contestFormat === ContestFormat.PREDICTION && contest.sportEventIds.length === 1;
}
