/**
 * Perpetual trophies (#874, plan §12): one per contest a league runs again every year, the same
 * event series and the same way of picking, with a plate per year's winners. Pure functions over
 * the league's one-event contests and its finishes, worked out on read and never stored.
 */

import type { SeriesContest } from '@poolmaster/shared/db';
import { CupWeight, type LeagueYearFinish, type SelectionType } from '@poolmaster/shared/domain';
import { formsNoBracket } from '../events/sport-event-bracket-service';

/** A trophy shows once the league has run its contest in this many years. */
export const PERPETUAL_TROPHY_MIN_YEARS = 2;

export interface PerpetualPlate {
  year: number;
  contestId: string;
  contestName: string;
  /** The contest's 1st place squads, every one on a tie; none for a contest with no result. */
  winnerSquadIds: string[];
}

export interface PerpetualTrophy {
  eventSeriesId: string;
  seriesName: string;
  sportLeagueName: string;
  selectionType: SelectionType;
  /** Newest year first; a year it didn't run has no plate. */
  plates: PerpetualPlate[];
}

/**
 * Whether an event is a week of games rather than one big event (an NFL regular-season week, a
 * group matchday): several games, one round, none sending its winner on. Its series recurs every
 * year, but a contest on it is a weekly slate, not a tradition, so it earns no trophy. A single
 * game (a Super Bowl), a bracket and an event without games (a golf tournament, a race) do.
 */
export function isWeekOfGames(games: SeriesContest['games']): boolean {
  return games.length > 1 && formsNoBracket(games, (game) => game.sendsWinnerOn);
}

/**
 * The league's perpetual trophies, in sports league, series and selection type order. Contests
 * not counted are left out, as everywhere; a contest that went final with nobody placed is a
 * plate with no winner.
 */
export function buildPerpetualTrophies(contests: readonly SeriesContest[], finishes: readonly LeagueYearFinish[]): PerpetualTrophy[] {
  const winners = new Map<string, string[]>();
  for (const finish of finishes) {
    if (finish.place === 1) winners.set(finish.contestId, [...(winners.get(finish.contestId) ?? []), finish.squadId]);
  }
  const byTrophy = new Map<string, SeriesContest[]>();
  for (const contest of contests) {
    if (contest.cupWeight === CupWeight.NOT_COUNTED || isWeekOfGames(contest.games)) continue;
    const key = `${contest.eventSeriesId}:${contest.selectionType}`;
    byTrophy.set(key, [...(byTrophy.get(key) ?? []), contest]);
  }
  return [...byTrophy.values()]
    .filter((runs) => new Set(runs.map((contest) => contest.eventYear)).size >= PERPETUAL_TROPHY_MIN_YEARS)
    .map((runs): PerpetualTrophy => {
      const [first] = runs as [SeriesContest, ...SeriesContest[]];
      return {
        eventSeriesId: first.eventSeriesId,
        seriesName: first.seriesName,
        sportLeagueName: first.sportLeagueName,
        selectionType: first.selectionType,
        plates: [...runs]
          .sort((left, right) => right.eventYear - left.eventYear || (right.completedAt?.getTime() ?? 0) - (left.completedAt?.getTime() ?? 0))
          .map((contest) => ({ year: contest.eventYear, contestId: contest.id, contestName: contest.name, winnerSquadIds: winners.get(contest.id) ?? [] })),
      };
    })
    .sort((left, right) => left.sportLeagueName.localeCompare(right.sportLeagueName)
      || left.seriesName.localeCompare(right.seriesName)
      || left.selectionType.localeCompare(right.selectionType));
}
