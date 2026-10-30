/**
 * League Home's derivations: which contest is up next, how long until it closes, and the top of
 * a live leaderboard. Pure, so each rule is testable on its own.
 */
import { ContestStatus } from '@poolmaster/shared/domain';
import type { BracketLeaderboardResponse, ContestDto, ContestLeaderboardResponse } from '@/lib/api';
import { buildLeaderboardView } from '@/features/contests/contest-leaderboard';
import { areContestEntriesOpen } from '@/features/contests/contest-status';
import { listedContestStartsAt } from '@/features/contests/use-contest-schedule';

export type UpNextContest = {
  contest: ContestDto;
  /** The entry cutoff: the event's scheduled start. */
  closesAt: string;
};

/** The open contest whose entries close soonest. A contest with no known cutoff comes last. */
export function pickUpNextContest(
  contests: readonly ContestDto[],
  now: Date,
): UpNextContest | null {
  const candidates = contests.flatMap((contest) => {
    const startsAt = listedContestStartsAt(contest);
    if (contest.status !== ContestStatus.OPEN || !areContestEntriesOpen(contest, startsAt, now)) {
      return [];
    }
    return startsAt ? [{ contest, closesAt: startsAt }] : [];
  });

  candidates.sort((left, right) => Date.parse(left.closesAt) - Date.parse(right.closesAt));
  return candidates[0] ?? null;
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
  return topOf(response.entries.map((entry, index): StandingRow => ({
    entryId: entry.entryId,
    isMine: mySquadId !== null && entry.squadId === mySquadId,
    name: entry.squadName,
    position: entry.displayPosition,
    total: view.entries[index]?.total ?? null,
  })), limit);
}

/** The top `limit` entries of a bracket contest's leaderboard (#721), by points. */
export function buildBracketTopStandings(
  response: BracketLeaderboardResponse,
  mySquadId: string | null,
  limit = 5,
): TopStandings {
  return topOf(response.entries.map((entry): StandingRow => ({
    entryId: entry.entryId,
    isMine: mySquadId !== null && entry.squadId === mySquadId,
    name: entry.squadName,
    position: entry.displayPosition,
    total: String(entry.points),
  })), limit);
}

function topOf(rows: StandingRow[], limit: number): TopStandings {
  const top = rows.slice(0, limit);
  const myRowBelow = top.some((row) => row.isMine)
    ? null
    : rows.slice(limit).find((row) => row.isMine) ?? null;
  return { rows: top, myRowBelow };
}
