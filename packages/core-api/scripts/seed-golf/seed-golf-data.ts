/**
 * The pure rules for turning a golf data file into API calls: how far a test seed's dates
 * move, and what each stored round looks like. No I/O, so it is unit tested alone.
 */

import type { SportDataEvent, SportDataFieldEntry, SportDataFile } from './sport-data-file';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_LEAD_DAYS = 7;

/**
 * Whole weeks to move every tournament by, so the earliest starts at least a week after `now`
 * and each keeps its weekday and its gap to the others.
 */
export function seedDateOffsetDays(file: Pick<SportDataFile, 'sportLeagues'>, now: Date): number {
  const earliest = Math.min(...file.sportLeagues.flatMap((league) => league.events.map((event) => Date.parse(`${event.startDate}T00:00:00Z`))));
  const leadDays = (now.getTime() - earliest) / DAY_MS + MIN_LEAD_DAYS;
  return Math.max(0, Math.ceil(leadDays / 7) * 7);
}

/**
 * A tournament's dates after the offset (0 for real data): first tee at 12:00 UTC, last putt
 * by 23:00 UTC.
 */
export function shiftedEventDates(event: Pick<SportDataEvent, 'startDate' | 'endDate'>, offsetDays: number): { startDate: string; endDate: string } {
  const shift = (day: string, time: string) => new Date(Date.parse(`${day}T${time}Z`) + offsetDays * DAY_MS).toISOString();
  return { startDate: shift(event.startDate, '12:00:00'), endDate: shift(event.endDate, '23:00:00') };
}

type RoundStatus = 'COMPLETED' | 'MISSED_CUT' | 'DNF';

/** One golfer's round as the score upload takes it, or null when they did not play it. */
export function golferRoundScore(golfer: Pick<SportDataFieldEntry, 'rounds' | 'finish' | 'withdrawnThru'>, roundNumber: number, roundsPar: number): {
  strokes: number;
  scoreToPar: number;
  thru: number;
  status: RoundStatus;
} | null {
  const strokes = golfer.rounds?.at(roundNumber - 1);
  if (strokes === undefined) return null;
  const isLast = roundNumber === golfer.rounds?.length;
  if (isLast && golfer.finish === 'WD') {
    const thru = golfer.withdrawnThru ?? 9;
    return { strokes, scoreToPar: strokes - Math.round((roundsPar * thru) / 18), thru, status: 'DNF' };
  }
  const status: RoundStatus = isLast && golfer.finish === 'MC' ? 'MISSED_CUT' : 'COMPLETED';
  return { strokes, scoreToPar: strokes - roundsPar, thru: 18, status };
}
