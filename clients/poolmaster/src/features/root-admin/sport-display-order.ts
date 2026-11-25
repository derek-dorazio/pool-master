import { explicitOrder, type ExplicitEnumOrder, type Sport } from '@poolmaster/shared/domain';

/**
 * The sports' display order as a grid's sport column sorts by it (#2042): each sport's place
 * as the API gives it (SportDto.displayOrder, carried on the rows that hold a sport), never an
 * order kept in the web app.
 */
export function sportDisplayOrder(rows: readonly { sport: Sport; displayOrder: number }[]): ExplicitEnumOrder<string> {
  return explicitOrder<string>(Object.fromEntries(rows.map(({ sport, displayOrder }) => [sport, displayOrder])));
}
