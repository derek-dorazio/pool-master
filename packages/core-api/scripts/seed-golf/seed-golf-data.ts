/**
 * The pure rules for turning a sport data file into API calls: how far a test seed's dates
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
 * An event's dates after the offset (0 for real data): it starts at `startsAt` when the file
 * gives one (a race's post time), else at 12:00 UTC, and ends by 23:00 UTC on its end date, or
 * at its start if that is later (an evening post time on a one-day race).
 */
export function shiftedEventDates(event: Pick<SportDataEvent, 'startDate' | 'endDate' | 'startsAt'>, offsetDays: number): { startDate: string; endDate: string } {
  const shift = (instant: number) => new Date(instant + offsetDays * DAY_MS).toISOString();
  const start = event.startsAt === undefined ? Date.parse(`${event.startDate}T12:00:00Z`) : Date.parse(event.startsAt);
  const end = Math.max(Date.parse(`${event.endDate}T23:00:00Z`), start);
  return { startDate: shift(start), endDate: shift(end) };
}

/** The file with every match time moved by the offset (the file itself for real data). */
export function shiftedMatchTimes(file: SportDataFile, offsetDays: number): SportDataFile {
  if (offsetDays === 0) return file;
  const shift = (scheduledAt: string) => new Date(Date.parse(scheduledAt) + offsetDays * DAY_MS).toISOString();
  return {
    ...file,
    sportLeagues: file.sportLeagues.map((league) => ({
      ...league,
      events: league.events.map((event) => (event.matches
        ? { ...event, matches: event.matches.map((match) => (match.scheduledAt === undefined ? match : { ...match, scheduledAt: shift(match.scheduledAt) })) }
        : event)),
    })),
  };
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
