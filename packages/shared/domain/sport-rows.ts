import type { Sport } from './enums';

/**
 * The row in `rows` that carries `sport`, such as the Sport catalog row for an event's sport.
 * A keyed lookup rather than an equality test, so it reads the same while `Sport` has one
 * member as it will with many.
 */
export function findSportRow<T extends { sport: Sport }>(rows: readonly T[], sport: Sport): T | undefined {
  return new Map(rows.map((row) => [row.sport, row])).get(sport);
}
