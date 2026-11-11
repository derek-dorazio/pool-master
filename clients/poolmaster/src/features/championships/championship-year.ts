import { championshipYear } from '@poolmaster/shared/domain';
import { buildLeagueChampionshipsPath, buildLeagueTrophyCasePath } from '@/features/leagues/league-routing';

/** A year from the route, such as "2026"; null for anything else. */
export function parseChampionshipYearParam(value: string | undefined): number | null {
  return value && /^\d{4}$/.test(value) ? Number(value) : null;
}

/**
 * The years the Championships page offers, newest first: every championship year and cup season
 * the league has, and always the current year, so a league with nothing counted yet still opens it.
 */
export function championshipYearsOffered(championshipYears: readonly number[], cupSeasons: readonly number[], currentYear: number): number[] {
  return [...new Set([currentYear, ...championshipYears, ...cupSeasons])].sort((left, right) => right - left);
}

/** The year's title: the race while it is on, its championships once it is over. */
export function championshipsTitle(year: number, now: Date) {
  return year >= championshipYear(now) ? `${year} Championship Race` : `${year} Championships`;
}

/** The Championships tabs that read one year, which the season picker moves between years; All years is the fourth. */
export type ChampionshipsYearTab = 'championship' | 'trophies' | 'race';

/** Where each year-based tab opens for a year. */
export function championshipsYearTabPaths(leagueCode: string, year: number): Record<ChampionshipsYearTab, string> {
  return {
    championship: buildLeagueChampionshipsPath(leagueCode, year),
    trophies: buildLeagueTrophyCasePath(leagueCode, year),
    race: `${buildLeagueChampionshipsPath(leagueCode, year)}/race`,
  };
}
