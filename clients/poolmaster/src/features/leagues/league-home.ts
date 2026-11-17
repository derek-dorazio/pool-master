/**
 * League Home's derivations: which contests are heroes, a live hero's progress line, and the top
 * of a live leaderboard. Pure, so each rule is testable on its own.
 */
import { ContestFormat, ContestStatus, SportEventStatus } from '@poolmaster/shared/domain';
import type { BracketLeaderboardResponse, ContestDto, ContestLeaderboardResponse } from '@/lib/api';
import { buildLeaderboardView } from '@/features/contests/contest-leaderboard';
import { areContestEntriesOpen } from '@/features/contests/contest-status';
import { bySoonestStart, orderCurrentContests } from '@/features/contests/current-contests';
import { contestCapacityCount, isContestFull } from '@/features/contests/my-contest-entry';
import { listedContestStartsAt } from '@/features/contests/use-contest-schedule';

/** The most hero tiles Home shows: one row on a computer. */
export const MAX_HOME_HEROES = 3;

export type HomeContests = {
  /** Up to three: live contests first by start, then contests taking entries, soonest closing first. */
  heroes: ContestDto[];
  /** Every other current contest, in the shared list's order (Open, Live, Set up). */
  more: ContestDto[];
};

/**
 * Which of a league's current contests Home draws as heroes (#1763): every live contest and every
 * contest taking entries with room left, live first, then open by soonest closing, at most three.
 * A full contest, a set-up one and any beyond the three are in More contests.
 */
export function splitHomeContests(
  contests: readonly ContestDto[],
  { now, showDrafts }: { now: Date; showDrafts: boolean },
): HomeContests {
  const live = contests.filter((contest) => contest.status === ContestStatus.ACTIVE).sort(bySoonestStart);
  const open = contests
    .filter((contest) => areContestEntriesOpen(contest, listedContestStartsAt(contest), now)
      && !isContestFull(contest, contestCapacityCount(contest)))
    .sort(bySoonestStart);
  const heroes = [...live, ...open].slice(0, MAX_HOME_HEROES);
  const heroIds = new Set(heroes.map((contest) => contest.id));
  return {
    heroes,
    more: orderCurrentContests(contests.filter((contest) => !heroIds.has(contest.id)), { showDrafts }),
  };
}

/**
 * A live hero's progress line: how many of a contest's events are played, "9 of 14 games played"
 * for a pick'em's games, or null for a contest of one event, whose progress is its leaderboard.
 */
export function describeLiveProgress(contest: Pick<ContestDto, 'contestFormat' | 'sportEvents'>): string | null {
  const total = contest.sportEvents.length;
  if (total < 2) {
    return null;
  }
  const played = contest.sportEvents.filter((event) => event.status === SportEventStatus.COMPLETED).length;
  const noun = contest.contestFormat === ContestFormat.PREDICTION ? 'games' : 'events';
  return `${String(played)} of ${String(total)} ${noun} played`;
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
  /** The viewer's entries that rank below the rows shown, so they still see where each stands. */
  myRowsBelow: StandingRow[];
};

/** How many leaders a live hero shows above the viewer's own rows. */
const HERO_STANDINGS = 3;

/** The top `limit` entries of a leaderboard by entry name, in the server's order, marking the viewer's team. */
export function buildTopStandings(
  response: ContestLeaderboardResponse,
  mySquadId: string | null,
  limit = HERO_STANDINGS,
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
  limit = HERO_STANDINGS,
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
  return { rows: rows.slice(0, limit), myRowsBelow: rows.slice(limit).filter((row) => row.isMine) };
}
