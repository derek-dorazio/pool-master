/**
 * League Home's derivations: which contest is up next, how long until it closes, and the top of
 * a live leaderboard. Pure, so each rule is testable on its own.
 */
import { ContestStatus } from '@poolmaster/shared/domain';
import type { ContestDto, ContestLeaderboardResponse } from '@/lib/api';
import { buildLeaderboardView } from '@/features/contests/contest-leaderboard';
import { areContestEntriesOpen } from '@/features/contests/contest-status';
import type { ContestSchedule } from '@/features/contests/use-contest-schedule';

/** Whether the viewer's entries in the current contests are known yet. */
export type MyEntriesState = 'loading' | 'failed' | 'ready';

export type UpNextContest = {
  contest: ContestDto;
  /** The entry cutoff: the event's scheduled start. */
  closesAt: string;
};

/** The open contest whose entries close soonest. A contest with no known cutoff comes last. */
export function pickUpNextContest(
  contests: readonly ContestDto[],
  schedules: ReadonlyArray<ContestSchedule | null>,
  now: Date,
): UpNextContest | null {
  const candidates = contests.flatMap((contest, index) => {
    const startsAt = schedules[index]?.startsAt ?? null;
    if (contest.status !== ContestStatus.OPEN || !areContestEntriesOpen(contest.status, startsAt, now)) {
      return [];
    }
    return startsAt ? [{ contest, closesAt: startsAt }] : [];
  });

  candidates.sort((left, right) => Date.parse(left.closesAt) - Date.parse(right.closesAt));
  return candidates[0] ?? null;
}

export type Countdown = { days: number; hours: number; minutes: number };

/** Whole days, hours and minutes from `now` until `until`, never negative. */
export function countdownUntil(until: string, now: Date): Countdown {
  const totalMinutes = Math.max(0, Math.floor((Date.parse(until) - now.getTime()) / 60_000));
  return {
    days: Math.floor(totalMinutes / (24 * 60)),
    hours: Math.floor((totalMinutes % (24 * 60)) / 60),
    minutes: totalMinutes % 60,
  };
}

export type StandingRow = {
  entryId: string;
  isMine: boolean;
  name: string;
  position: string | null;
  total: string | null;
};

export type TopStandings = {
  rows: StandingRow[];
  /** The viewer's best entry when it ranks below the rows shown, so they still see where they are. */
  myRowBelow: StandingRow | null;
};

/** The top `limit` entries of a leaderboard, in the server's order, marking the viewer's team. */
export function buildTopStandings(
  response: ContestLeaderboardResponse,
  mySquadId: string | null,
  limit = 5,
): TopStandings {
  const view = buildLeaderboardView(response);
  const rows = response.entries.map((entry, index): StandingRow => ({
    entryId: entry.entryId,
    isMine: mySquadId !== null && entry.squadId === mySquadId,
    name: entry.squadName,
    position: entry.displayPosition,
    total: view.entries[index]?.total ?? null,
  }));
  const top = rows.slice(0, limit);
  const myRowBelow = top.some((row) => row.isMine)
    ? null
    : rows.slice(limit).find((row) => row.isMine) ?? null;
  return { rows: top, myRowBelow };
}
