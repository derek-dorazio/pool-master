/**
 * Perpetual trophies (#874, plan §12): one per contest a league runs again every year, on the same
 * slot definitions and the same way of picking (#2010; by template from #2024), with a plate per
 * year's winners. Pure functions over
 * the league's one-event contests and its finishes, worked out on read and never stored.
 */

import type { SeriesContest } from '@poolmaster/shared/db';
import { CupWeight, type LeagueYearFinish, type SelectionType } from '@poolmaster/shared/domain';

/** A trophy shows once the league has run its contest in this many years. */
export const PERPETUAL_TROPHY_MIN_YEARS = 2;

export interface PerpetualPlate {
  year: number;
  contestId: string;
  /** The contest's 1st place squads, every one on a tie; none for a contest with no result. */
  winnerSquadIds: string[];
}

export interface PerpetualTrophy {
  /** Until #2024: the first slot definition, in play order, of the slots its contests cover. */
  trophyId: string;
  /** What it is run on: its first slot's proper name, else its newest run's event name. */
  name: string;
  sportLeagueName: string;
  selectionType: SelectionType;
  /** Newest year first; a year it didn't run has no plate. */
  plates: PerpetualPlate[];
}

/**
 * Whether an event is a week of games rather than one big event (an NFL regular-season week, a
 * group matchday): several games, one round, none sending its winner on. Its slots recur every
 * year, but a contest on it is a weekly slate, not a tradition, so it earns no trophy. A single
 * game (a Super Bowl), a bracket and an event without games (a golf tournament, a race) do.
 */
export function isWeekOfGames(games: SeriesContest['games']): boolean {
  // `formsNoBracket` over the games' counts: one round, none linking anywhere.
  return games.count > 1 && games.roundCount === 1 && games.sendingWinnerOn === 0;
}

/**
 * The league's perpetual trophies, in sports league, name and selection type order. Contests
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
    // An event with no Season slot is no contest run again: there is nothing to key it by.
    if (contest.cupWeight === CupWeight.NOT_COUNTED || isWeekOfGames(contest.games) || contest.slotDefinitionIds.length === 0) continue;
    // A map key only, never read back: the definitions the event covers and the way of picking.
    const key = JSON.stringify([[...contest.slotDefinitionIds].sort(), contest.selectionType]);
    byTrophy.set(key, [...(byTrophy.get(key) ?? []), contest]);
  }
  return [...byTrophy.values()]
    .filter((runs) => new Set(runs.map((contest) => contest.championshipYear)).size >= PERPETUAL_TROPHY_MIN_YEARS)
    .map((runs): PerpetualTrophy => {
      const newestFirst = [...runs]
        .sort((left, right) => right.championshipYear - left.championshipYear || (right.completedAt?.getTime() ?? 0) - (left.completedAt?.getTime() ?? 0));
      const [newest] = newestFirst as [SeriesContest, ...SeriesContest[]];
      return {
        trophyId: newest.slotDefinitionIds[0],
        name: newest.slotName ?? newest.eventName,
        sportLeagueName: newest.sportLeagueName,
        selectionType: newest.selectionType,
        plates: newestFirst.map((contest) => ({ year: contest.championshipYear, contestId: contest.id, winnerSquadIds: winners.get(contest.id) ?? [] })),
      };
    })
    .sort((left, right) => left.sportLeagueName.localeCompare(right.sportLeagueName)
      || left.name.localeCompare(right.name)
      || left.selectionType.localeCompare(right.selectionType));
}
