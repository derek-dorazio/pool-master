/**
 * The shape of golf-2026.json and the pure rules for turning it into API calls: how far the
 * dates move, and what each stored round looks like. No I/O, so it is unit tested alone.
 */

export interface GolfSeedPlayer {
  /** Stored as the participant's externalId; how a re-run finds the player again. */
  key: string;
  name: string;
  countryCode: string;
  ranking: number;
}

export interface GolfSeedGolfer {
  player: string;
  ranking: number;
  oddsToWin: number;
  /** Strokes per round played. A withdrawal's last entry is the partial round. */
  rounds: number[];
  /** MC: missed the cut after round 2. WD: withdrew during their last round. */
  finish?: 'MC' | 'WD';
  /** Holes a withdrawn golfer finished in their last round. */
  withdrawnThru?: number;
}

export interface GolfSeedEvent {
  key: string;
  name: string;
  /** The real 2026 dates, YYYY-MM-DD; the seed moves them forward (shiftedEventDates). */
  startDate: string;
  endDate: string;
  venue: string | null;
  location: string | null;
  rounds: number;
  roundsPar: number;
  /** Whether the winner is a public result or made up. */
  winner: 'public' | 'generated';
  field: GolfSeedGolfer[];
}

export interface GolfSeedTour {
  name: string;
  players: GolfSeedPlayer[];
  events: GolfSeedEvent[];
}

export interface GolfSeedFile {
  season: number;
  notes: string;
  tours: GolfSeedTour[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_LEAD_DAYS = 7;

/**
 * Whole weeks to move every tournament by, so the earliest starts at least a week after `now`
 * and each keeps its weekday and its gap to the others.
 */
export function seedDateOffsetDays(seed: GolfSeedFile, now: Date): number {
  const earliest = Math.min(...seed.tours.flatMap((tour) => tour.events.map((event) => Date.parse(`${event.startDate}T00:00:00Z`))));
  const leadDays = (now.getTime() - earliest) / DAY_MS + MIN_LEAD_DAYS;
  return Math.max(0, Math.ceil(leadDays / 7) * 7);
}

/** A tournament's dates after the offset: first tee at 12:00 UTC, last putt by 23:00 UTC. */
export function shiftedEventDates(event: Pick<GolfSeedEvent, 'startDate' | 'endDate'>, offsetDays: number): { startDate: string; endDate: string } {
  const shift = (day: string, time: string) => new Date(Date.parse(`${day}T${time}Z`) + offsetDays * DAY_MS).toISOString();
  return { startDate: shift(event.startDate, '12:00:00'), endDate: shift(event.endDate, '23:00:00') };
}

type RoundStatus = 'COMPLETED' | 'MISSED_CUT' | 'DNF';

/** One golfer's round as the score upload takes it, or null when they did not play it. */
export function golferRoundScore(golfer: GolfSeedGolfer, roundNumber: number, roundsPar: number): {
  strokes: number;
  scoreToPar: number;
  thru: number;
  status: RoundStatus;
} | null {
  const strokes = golfer.rounds[roundNumber - 1];
  if (strokes === undefined) return null;
  const isLast = roundNumber === golfer.rounds.length;
  if (isLast && golfer.finish === 'WD') {
    const thru = golfer.withdrawnThru ?? 9;
    return { strokes, scoreToPar: strokes - Math.round((roundsPar * thru) / 18), thru, status: 'DNF' };
  }
  const status: RoundStatus = isLast && golfer.finish === 'MC' ? 'MISSED_CUT' : 'COMPLETED';
  return { strokes, scoreToPar: strokes - roundsPar, thru: 18, status };
}
