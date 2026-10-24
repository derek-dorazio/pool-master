/**
 * The league's record book (#873, plan §11): pure functions over its counted contest finishes and
 * its championship years and perpetual trophies, so the records are worked out on read and never stored. Each record is
 * ranked from candidates (one per squad, or one per squad and year, or one per win) to its holders,
 * every one on a tie, and the next best value's holders.
 */

import { CupWeight, RecordType, isHallOfLameRecord, type LeagueYearFinish } from '@poolmaster/shared/domain';
import type { PerpetualTrophy } from './perpetual-trophies';

/** One way a squad could hold a record: its value, and the year or contest it was set in. */
export interface RecordCandidate {
  squadId: string;
  value: number;
  year: number | null;
  contestId: string | null;
}

/** The holders of one value of a record. */
export interface RecordStand {
  value: number;
  holders: RecordCandidate[];
}

export interface RankedRecord {
  type: RecordType;
  best: RecordStand;
  nextBest: RecordStand | null;
}

/** A championship year and its champions (its 1st, several on a tie), for the years that are over. */
export interface ChampionshipYearChampions {
  year: number;
  championSquadIds: string[];
}

/** A last place needs at least this many squads in the contest, so a two-squad contest's 2nd is not "last". */
export const LAST_PLACE_MIN_SQUADS = 3;

/**
 * Every record somebody holds, in `RecordType` order; the Hall of Lame's only when the league shows
 * it. A record nobody holds yet (no counted win, no championship) is left out. Finishes of contests
 * not counted are left out, as everywhere.
 */
export function rankRecords(
  finishes: readonly LeagueYearFinish[],
  championships: readonly ChampionshipYearChampions[],
  trophies: readonly PerpetualTrophy[],
  { hallOfLame }: { hallOfLame: boolean },
): RankedRecord[] {
  const counted = finishes
    .filter((finish) => finish.weight !== CupWeight.NOT_COUNTED)
    .sort((left, right) => left.settledAt.getTime() - right.settledAt.getTime() || left.contestId.localeCompare(right.contestId));
  const wins = counted.filter((finish) => finish.place === 1);
  const candidates: Record<RecordType, RecordCandidate[]> = {
    [RecordType.MOST_CHAMPIONSHIPS]: countBySquad(championships.flatMap((year) => year.championSquadIds)),
    [RecordType.BACK_TO_BACK_CHAMPIONS]: championshipRuns(championships).filter((candidate) => candidate.value >= 2),
    [RecordType.MOST_WINS_IN_A_YEAR]: winsByYear(wins),
    [RecordType.MOST_WINS_ALL_TIME]: countBySquad(wins.map((finish) => finish.squadId)),
    [RecordType.LONGEST_PODIUM_RUN]: podiumRuns(counted),
    [RecordType.BIGGEST_FIELD_WON]: wins.map((finish) => ({ squadId: finish.squadId, value: finish.rankedEntryCount, year: finish.year, contestId: finish.contestId })),
    [RecordType.REPEAT_WINNER]: trophies.flatMap(repeatWins).filter((candidate) => candidate.value >= 2),
    [RecordType.MOST_RUNNER_UPS]: countBySquad(counted.filter((finish) => finish.place === 2).map((finish) => finish.squadId)),
    [RecordType.MOST_FOURTHS]: countBySquad(counted.filter((finish) => finish.place === 4).map((finish) => finish.squadId)),
    [RecordType.MOST_LAST_PLACES]: countBySquad(lastPlaces(counted).map((finish) => finish.squadId)),
    [RecordType.LONGEST_DROUGHT]: droughts(counted),
  };
  return Object.values(RecordType).filter((type) => hallOfLame || !isHallOfLameRecord(type)).flatMap((type) => {
    const ranked = rank(candidates[type]);
    return ranked === null ? [] : [{ type, ...ranked }];
  });
}

/** The best value's candidates and the next best's; null when nobody has one above 0. */
function rank(candidates: readonly RecordCandidate[]): { best: RecordStand; nextBest: RecordStand | null } | null {
  const values = [...new Set(candidates.map((candidate) => candidate.value).filter((value) => value > 0))].sort((left, right) => right - left);
  const stand = (value: number | undefined): RecordStand | null => value === undefined ? null : {
    value,
    holders: candidates.filter((candidate) => candidate.value === value),
  };
  const best = stand(values.at(0));
  return best === null ? null : { best, nextBest: stand(values.at(1)) };
}

function countBySquad(squadIds: readonly string[]): RecordCandidate[] {
  const counts = new Map<string, number>();
  for (const squadId of squadIds) counts.set(squadId, (counts.get(squadId) ?? 0) + 1);
  return [...counts].map(([squadId, value]) => ({ squadId, value, year: null, contestId: null }));
}

/** Each squad's wins in each year it won. */
function winsByYear(wins: readonly LeagueYearFinish[]): RecordCandidate[] {
  const counts = new Map<string, RecordCandidate>();
  for (const finish of wins) {
    const key = `${finish.squadId}:${String(finish.year)}`;
    const known = counts.get(key);
    counts.set(key, { squadId: finish.squadId, value: (known?.value ?? 0) + 1, year: finish.year, contestId: null });
  }
  return [...counts.values()];
}

/** Each squad's longest run of championships in consecutive years, ending in its year (the latest on a tie). */
function championshipRuns(championships: readonly ChampionshipYearChampions[]): RecordCandidate[] {
  const yearsBySquad = new Map<string, number[]>();
  for (const { year, championSquadIds } of championships) {
    for (const squadId of championSquadIds) yearsBySquad.set(squadId, [...(yearsBySquad.get(squadId) ?? []), year]);
  }
  return [...yearsBySquad].map(([squadId, years]) => longestRun(squadId, [...years].sort((left, right) => left - right).map((year, index, sorted) => ({
    year,
    continues: index > 0 && sorted[index - 1] === year - 1,
  }))));
}

/**
 * Each squad's longest run of a perpetual trophy won in consecutive event years, one per trophy it
 * won, ending in its year (the latest on a tie) and naming that year's contest. A year the league
 * didn't run the contest breaks the run, as it does a championship run.
 */
function repeatWins(trophy: PerpetualTrophy): RecordCandidate[] {
  const wonBySquad = new Map<string, Map<number, string>>();
  for (const plate of trophy.plates) {
    for (const squadId of plate.winnerSquadIds) {
      const years = wonBySquad.get(squadId) ?? new Map<number, string>();
      // Plates run newest first, so the first contest seen in a year is its latest.
      if (!years.has(plate.year)) years.set(plate.year, plate.contestId);
      wonBySquad.set(squadId, years);
    }
  }
  return [...wonBySquad].map(([squadId, years]) => {
    const run = longestRun(squadId, [...years.keys()].sort((left, right) => left - right).map((year) => ({ year, continues: years.has(year - 1) })));
    return { ...run, contestId: run.year === null ? null : years.get(run.year) ?? null };
  });
}

/** Each squad's longest run of contests on the podium, of those it placed in, ending in its year. */
function podiumRuns(counted: readonly LeagueYearFinish[]): RecordCandidate[] {
  const bySquad = new Map<string, LeagueYearFinish[]>();
  for (const finish of counted) bySquad.set(finish.squadId, [...(bySquad.get(finish.squadId) ?? []), finish]);
  return [...bySquad].map(([squadId, rows]) => {
    let run = 0;
    let best: RecordCandidate = { squadId, value: 0, year: null, contestId: null };
    for (const finish of rows) {
      run = finish.place <= 3 ? run + 1 : 0;
      if (run > 0 && run >= best.value) best = { squadId, value: run, year: finish.year, contestId: null };
    }
    return best;
  });
}

/**
 * The squads last in each contest of three or more squads: the worst place any squad finished in
 * it (each squad's best entry), every squad on it on a tie. A contest everyone won has no last.
 */
function lastPlaces(counted: readonly LeagueYearFinish[]): LeagueYearFinish[] {
  const byContest = new Map<string, LeagueYearFinish[]>();
  for (const finish of counted) byContest.set(finish.contestId, [...(byContest.get(finish.contestId) ?? []), finish]);
  return [...byContest.values()].flatMap((rows) => {
    const worst = Math.max(...rows.map((finish) => finish.place));
    return worst > 1 && rows.length >= LAST_PLACE_MIN_SQUADS
      ? rows.filter((finish) => finish.place === worst)
      : [];
  });
}

/** Each squad's longest run of contests placed in without a win, ending in its year (the latest on a tie). */
function droughts(counted: readonly LeagueYearFinish[]): RecordCandidate[] {
  const bySquad = new Map<string, LeagueYearFinish[]>();
  for (const finish of counted) bySquad.set(finish.squadId, [...(bySquad.get(finish.squadId) ?? []), finish]);
  return [...bySquad].map(([squadId, rows]) => {
    let run = 0;
    let best: RecordCandidate = { squadId, value: 0, year: null, contestId: null };
    for (const finish of rows) {
      run = finish.place === 1 ? 0 : run + 1;
      if (run > 0 && run >= best.value) best = { squadId, value: run, year: finish.year, contestId: null };
    }
    return best;
  });
}

/** The longest run of steps that each continue the one before, ending in its year (the latest on a tie). */
function longestRun(squadId: string, steps: ReadonlyArray<{ year: number; continues: boolean }>): RecordCandidate {
  let run = 0;
  let best: RecordCandidate = { squadId, value: 0, year: null, contestId: null };
  for (const step of steps) {
    run = step.continues ? run + 1 : 1;
    if (run >= best.value) best = { squadId, value: run, year: step.year, contestId: null };
  }
  return best;
}
