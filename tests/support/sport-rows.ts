import type { Sport } from '@poolmaster/shared/domain';

/**
 * Each sport's URL segment and display order as the reference-data migration stores them
 * (#2042): what a test that restores a `sports` row writes beside its sport, so the row matches
 * the one the migration made.
 */
const SPORT_ROW_KEYS: Readonly<Record<Sport, { urlSegment: string; displayOrder: number }>> = {
  FOOTBALL: { urlSegment: 'football', displayOrder: 0 },
  BASKETBALL: { urlSegment: 'basketball', displayOrder: 1 },
  BASEBALL: { urlSegment: 'baseball', displayOrder: 2 },
  HOCKEY: { urlSegment: 'hockey', displayOrder: 3 },
  SOCCER: { urlSegment: 'soccer', displayOrder: 4 },
  GOLF: { urlSegment: 'golf', displayOrder: 5 },
  AUTO_RACING: { urlSegment: 'auto-racing', displayOrder: 6 },
  TENNIS: { urlSegment: 'tennis', displayOrder: 7 },
  HORSE_RACING: { urlSegment: 'horse-racing', displayOrder: 8 },
  CYCLING: { urlSegment: 'cycling', displayOrder: 9 },
  RUNNING: { urlSegment: 'running', displayOrder: 10 },
};

/** A sport row's stored URL segment and display order, as the migration seeds them. */
export function sportRowKeys(sport: Sport): { urlSegment: string; displayOrder: number } {
  return SPORT_ROW_KEYS[sport];
}
