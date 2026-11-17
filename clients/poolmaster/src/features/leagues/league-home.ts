/**
 * League Home's derivations: which contests are heroes, a live hero's progress line, and the top
 * of a live leaderboard. Pure, so each rule is testable on its own.
 */
import { ContestFormat, ContestStatus, MatchStatus, SportEventStatus } from '@poolmaster/shared/domain';
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
 * A live hero's progress line, in the unit the contest is played in: a season of several events
 * counts them ("11 of 18 weeks played" for a pick'em or survivor season, "events" for a roster
 * contest over several tournaments); a prediction contest on one event counts that event's games
 * ("9 of 14 games played", cancelled games left out) once they are read. Null where no count
 * says more than the leaderboard: one roster event, a single game, or games not read yet.
 */
export function describeLiveProgress(
  contest: Pick<ContestDto, 'contestFormat' | 'sportEvents'>,
  games?: readonly { status: MatchStatus }[],
): string | null {
  const isPrediction = contest.contestFormat === ContestFormat.PREDICTION;
  const events = contest.sportEvents;
  if (events.length > 1) {
    const played = events.filter((event) => event.status === SportEventStatus.COMPLETED).length;
    return `${String(played)} of ${String(events.length)} ${isPrediction ? 'weeks' : 'events'} played`;
  }
  if (!isPrediction || !games) {
    return null;
  }
  const counted = games.filter((game) => game.status !== MatchStatus.CANCELLED);
  if (counted.length < 2) {
    return null;
  }
  const played = counted.filter((game) => game.status === MatchStatus.COMPLETED).length;
  return `${String(played)} of ${String(counted.length)} games played`;
}

/** Whether a live hero's progress line counts its one event's games, which it reads for them. */
export function countsEventGames(contest: Pick<ContestDto, 'contestFormat' | 'sportEvents'>): boolean {
  return contest.contestFormat === ContestFormat.PREDICTION && contest.sportEvents.length === 1;
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
