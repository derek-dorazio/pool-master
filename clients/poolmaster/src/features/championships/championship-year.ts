import { championshipYear } from '@poolmaster/shared/domain';

/** A year from the route, such as "2026"; null for anything else. */
export function parseChampionshipYearParam(value: string | undefined): number | null {
  return value && /^\d{4}$/.test(value) ? Number(value) : null;
}

/** The year's title: the race while it is on, its championships once it is over. */
export function championshipsTitle(year: number, now: Date) {
  return year >= championshipYear(now) ? `${year} Championship Race` : `${year} Championships`;
}
