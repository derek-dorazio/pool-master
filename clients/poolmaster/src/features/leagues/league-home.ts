/**
 * League Home's derivations: the order of the Live standings tabs and the top of a live
 * leaderboard. Pure, so each rule is testable on its own.
 */
import type { BracketLeaderboardResponse, ContestDto, ContestLeaderboardResponse } from '@/lib/api';
import { buildLeaderboardView } from '@/features/contests/contest-leaderboard';
import { bySoonestStart } from '@/features/contests/current-contests';

/**
 * Live standings' tabs (#1763): the live contests the viewer has an entry in first, then the rest,
 * each group by start, soonest first.
 */
export function orderLiveStandings(contests: readonly ContestDto[], myContestIds: ReadonlySet<string>): ContestDto[] {
  const rank = (contest: ContestDto) => (myContestIds.has(contest.id) ? 0 : 1);
  return [...contests].sort((left, right) => rank(left) - rank(right) || bySoonestStart(left, right));
}

export type StandingRow = {
  entryId: string;
  isMine: boolean;
  /** The entry's name; its (i) says whose it is. */
  name: string;
  position: string | null;
  /** The entry's team, which the (i) reads when opened. */
  squadId: string;
  total: string | null;
};

export type TopStandings = {
  rows: StandingRow[];
  /** The viewer's best entry when it ranks below the rows shown, so they still see where they are. */
  myRowBelow: StandingRow | null;
};

/** The top `limit` entries of a leaderboard by entry name, in the server's order, marking the viewer's team. */
export function buildTopStandings(
  response: ContestLeaderboardResponse,
  mySquadId: string | null,
  limit = 5,
): TopStandings {
  const view = buildLeaderboardView(response);
  return topOf(response.entries.map((entry, index): StandingRow => ({
    entryId: entry.entryId,
    isMine: mySquadId !== null && entry.squadId === mySquadId,
    name: entry.entryName,
    position: entry.displayPosition,
    squadId: entry.squadId,
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
    name: entry.entryName,
    position: entry.displayPosition,
    squadId: entry.squadId,
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
