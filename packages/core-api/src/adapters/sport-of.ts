/**
 * A row's sport, read through its sport league (#2042). Sporting events, contest templates and
 * sync runs no longer copy their league's sport onto themselves; each read selects these instead.
 */
import type { Sport } from '@poolmaster/shared/domain';

/** Select it on a row with a `sportLeague` relation: a contest template, a sync run. */
export const SPORT_LEAGUE_SPORT_SELECT = { sport: { select: { sport: true, urlSegment: true } } } as const;

/** Select it on a SportEvent: the event reaches its sport league through its Season (#2004). */
export const SPORT_EVENT_SPORT_SELECT = {
  sportLeagueSeason: { select: { sportLeague: { select: SPORT_LEAGUE_SPORT_SELECT } } },
} as const;

export interface SportLeagueSportRow {
  sport: { sport: Sport; urlSegment: string };
}

export interface SportEventSportRow {
  sportLeagueSeason: { sportLeague: SportLeagueSportRow };
}

/** The sport of a sport event read with `SPORT_EVENT_SPORT_SELECT`. */
export function sportOfEvent(row: SportEventSportRow): Sport {
  return row.sportLeagueSeason.sportLeague.sport.sport;
}

/** The URL segment of that sport. */
export function sportUrlSegmentOfEvent(row: SportEventSportRow): string {
  return row.sportLeagueSeason.sportLeague.sport.urlSegment;
}

/** The sport where a sport event is filtered by it: `where: { ...sportEventSportWhere(sport) }`. */
export function sportEventSportWhere(sport: Sport) {
  return { sportLeagueSeason: { sportLeague: { sport: { sport } } } } as const;
}
