/**
 * The pure rules for turning a sport data file into API calls: how far a test seed's dates
 * move, which of a test seed's events a run loads, and what each stored round looks like. No I/O, so it is unit tested alone.
 */

import { SportEventStatus } from '@poolmaster/shared/domain';
import { isTestEventName, TEST_EVENT_NAME_PREFIX, type SportDataEvent, type SportDataFieldEntry, type SportDataFile, type SportDataLeague } from './sport-data-file';

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
 * Whole weeks to move one test event by so it starts on its own weekday, on the first such
 * day on or after `notBefore`'s date (#1524). A run gives its first event of a league the
 * day after the run, so it lands within the week ahead, and each next event the day a week
 * after the one before, so they keep a week apart.
 */
export function rollingOffsetDays(event: Pick<SportDataEvent, 'startDate'>, notBefore: Date): number {
  const start = Date.parse(`${event.startDate}T00:00:00Z`) / DAY_MS;
  const earliest = Math.floor(notBefore.getTime() / DAY_MS);
  return Math.max(0, Math.ceil((earliest - start) / 7) * 7);
}

/**
 * An event's dates after the offset (0 for real data): it starts at `startsAt` when the file
 * gives one (a race's post time), else at 12:00 UTC, and ends at 12:00 UTC the day after its
 * end date. The end is when automatic lifecycle completes the event and settles its contests,
 * so it falls after any US finish on the end date, Hawaii's evening included (#1068). A
 * `startsAt` is on the start date in its own offset, so it is always before that end.
 */
export function shiftedEventDates(event: Pick<SportDataEvent, 'startDate' | 'endDate' | 'startsAt'>, offsetDays: number): { startDate: string; endDate: string } {
  const shift = (instant: number) => new Date(instant + offsetDays * DAY_MS).toISOString();
  const start = event.startsAt === undefined ? Date.parse(`${event.startDate}T12:00:00Z`) : Date.parse(event.startsAt);
  const end = Date.parse(`${event.endDate}T12:00:00Z`) + DAY_MS;
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

/** A test event already on the site: its name and where it stands. */
export interface StoredTestEvent {
  name: string;
  status: SportEventStatus;
  /** ISO start. */
  startDate: string;
}

/** One test event to load: a one-event file and the days its dates move by. */
export interface TestSeedEventLoad {
  file: SportDataFile;
  offsetDays: number;
}

/** What a test seed run loads, per sport league: its chosen events together, and each alone. */
export interface TestSeedLeagueLoad {
  /** The league with just its chosen events, for the test pool's contests. */
  file: SportDataFile;
  events: TestSeedEventLoad[];
}

export interface TestSeedSelection {
  leagues: TestSeedLeagueLoad[];
  /** Sport leagues left as they are: each still has a test event that has not started. */
  waiting: string[];
}

/**
 * The part of a test seed to load now (#1524). A sport league that still has a released test
 * event yet to start is left as it is, so running again every day does not pile events up.
 * Any other league gets its next `eventsPerLeague` events not yet on the site, in file order,
 * each named "Test- <event name>"; once every event of the file is on the site the league
 * starts over with numbered copies ("Test- Super Bowl LX (2)"), so a one-event seed can be
 * loaded again and again. Any test event an earlier run left a draft is included too, so it is
 * finished. Each event is loaded as its own file with its own offset.
 *
 * Dates roll with the run, a week at a time across the whole file: the chosen events are
 * grouped by the week (Monday to Sunday) they were really played in, and those weeks are laid
 * one after another from the run. The first week's events land on their own weekdays within
 * the week after `now`; each next week's land on their own weekdays a week or more after the
 * week before's first event (rollingOffsetDays). So a football week still starts on a
 * Thursday, a tournament still runs Thursday to Sunday, the conference championships fall in
 * the coming week with the Super Bowl a week after, and two tours' events of the same real week
 * share a week.
 *
 * `stored` holds each sport league's events on the site, by lower-cased league name.
 */
export function selectTestSeedEvents(
  file: SportDataFile,
  stored: ReadonlyMap<string, readonly StoredTestEvent[]>,
  eventsPerLeague: number,
  now: Date,
): TestSeedSelection {
  const chosenByLeague: Array<{ league: SportDataLeague; events: SportDataEvent[] }> = [];
  const waiting: string[] = [];
  /** Which round of copies each candidate is: 1 for the event itself, 2 for "(2)", and so on. */
  const copies = new Map<SportDataEvent, number>();
  for (const league of file.sportLeagues) {
    if (league.events.length === 0) continue;
    const testEvents = (stored.get(league.name.toLowerCase()) ?? []).filter((event) => isTestEventName(event.name));
    const statuses = new Map(testEvents.map((event) => [event.name.toLowerCase(), event.status]));
    const upcoming = testEvents.some((event) => event.status !== SportEventStatus.DRAFT && Date.parse(event.startDate) > now.getTime());
    // Enough rounds of copies to hold every stored test event and the next ones after them.
    const rounds = Math.ceil((testEvents.length + eventsPerLeague) / league.events.length) + 1;
    const candidates = Array.from({ length: rounds }, (_, index) => index + 1).flatMap((copy) => league.events.map((event) => {
      const named = { ...event, name: `${TEST_EVENT_NAME_PREFIX}${event.name}${copy === 1 ? '' : ` (${copy})`}` };
      copies.set(named, copy);
      return named;
    }));
    // The next events not yet on the site, never two copies of one real event in the same run.
    const fresh = new Set<SportDataEvent>();
    const freshKeys = new Set<string>();
    for (const candidate of upcoming ? [] : candidates) {
      if (fresh.size === eventsPerLeague) break;
      if (statuses.has(candidate.name.toLowerCase()) || freshKeys.has(candidate.key)) continue;
      fresh.add(candidate);
      freshKeys.add(candidate.key);
    }
    const events = candidates.filter((event) => fresh.has(event) || statuses.get(event.name.toLowerCase()) === SportEventStatus.DRAFT);
    if (upcoming) waiting.push(league.name);
    if (events.length > 0) chosenByLeague.push({ league, events });
  }

  const offsets = new Map<SportDataEvent, number>();
  const offsetOf = (event: SportDataEvent): number => offsets.get(event) ?? 0;
  const startDay = (event: SportDataEvent): number => Date.parse(`${event.startDate}T00:00:00Z`) / DAY_MS;
  // Day 0 (1 January 1970) was a Thursday, so day + 3 counts weeks from a Monday. A later round
  // of copies comes after every real week of the round before.
  const realWeek = (event: SportDataEvent): number => (copies.get(event) ?? 1) * 1_000_000 + Math.floor((startDay(event) + 3) / 7);
  const weeks = [...new Set(chosenByLeague.flatMap(({ events }) => events.map(realWeek)))].sort((a, b) => a - b);
  let notBefore = new Date(now.getTime() + DAY_MS);
  for (const week of weeks) {
    const inWeek = chosenByLeague.flatMap(({ events }) => events.filter((event) => realWeek(event) === week));
    for (const event of inWeek) offsets.set(event, rollingOffsetDays(event, notBefore));
    const firstStart = Math.min(...inWeek.map((event) => startDay(event) + offsetOf(event)));
    notBefore = new Date((firstStart + 7) * DAY_MS);
  }

  const leagueFile = (league: SportDataLeague, events: SportDataEvent[]): SportDataFile => ({
    ...file,
    scope: { ...file.scope, sportLeagues: [league.name] },
    sportLeagues: [{ ...league, events }],
  });
  const leagues = chosenByLeague.map(({ league, events }) => ({
    file: leagueFile(league, events),
    events: events.map((event) => ({ file: leagueFile(league, [event]), offsetDays: offsetOf(event) })),
  }));
  return { leagues, waiting };
}
