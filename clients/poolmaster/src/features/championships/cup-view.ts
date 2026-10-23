import { ContestStatus, CupContestCount, CupWeight } from '@poolmaster/shared/domain';
import type { CupContestRowDto, CupDto, CupStandingRowDto } from '@/lib/api';

/** How many squads the race chart draws. */
export const RACE_CHART_SQUADS = 5;

const POINTS_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 0 });

/** Cup points arrive in tenths of a point: 6125 reads "612.5", 6000 reads "600". */
export function formatCupPoints(tenths: number): string {
  return POINTS_FORMAT.format(tenths / 10);
}

/**
 * A cup weight as a contest row shows it: nothing for an ordinary contest, the multiplier for a
 * heavier one. A `Record` over the enum, so a new weight without a label fails the typecheck.
 */
export const CUP_WEIGHT_LABELS: Record<CupWeight, string | null> = {
  [CupWeight.NORMAL]: null,
  [CupWeight.BONUS]: 'x1.5',
  [CupWeight.DOUBLE]: 'x2',
  [CupWeight.NOT_COUNTED]: null,
};

export type Movement = { label: string; description: string; direction: 'up' | 'down' | 'none' };

/** A squad's movement since before the latest counted contest: "▲2", "▼1", or "–" for none yet. */
export function describeMovement(movement: number | null): Movement {
  if (movement === null || movement === 0) {
    return { label: '–', description: movement === null ? 'No movement yet' : 'No change', direction: 'none' };
  }
  const places = Math.abs(movement);
  const noun = places === 1 ? 'place' : 'places';
  return movement > 0
    ? { label: `▲${places}`, description: `Up ${places} ${noun}`, direction: 'up' }
    : { label: `▼${places}`, description: `Down ${places} ${noun}`, direction: 'down' };
}

function ordinalSuffix(position: number) {
  const lastTwo = position % 100;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return 'th';
  }
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[position % 10] ?? 'th';
}

/** A place as a sentence reads it: "6th", or "T2" for a shared 2nd. */
export function formatPlace(row: Pick<CupStandingRowDto, 'displayPosition' | 'position'>): string {
  return row.displayPosition.startsWith('T') ? row.displayPosition : `${row.position}${ordinalSuffix(row.position)}`;
}

function joinNames(names: string[]) {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export type CupContestState = {
  label: string;
  tone: 'final' | 'live' | 'active' | 'neutral';
  /** Why it stands where it does: who won it, or why it doesn't count. */
  note: string;
};

/** What a cup's contest row says about the contest: Final with its winner, Live, or why it doesn't count. */
export function describeCupContest(contest: CupContestRowDto): CupContestState {
  switch (contest.count) {
    case CupContestCount.COUNTED:
      return { label: 'Final', tone: 'final', note: `Won by ${joinNames(contest.winners.map((winner) => winner.squadName))}` };
    case CupContestCount.NOT_COUNTED:
      return { label: 'Not counted', tone: 'neutral', note: 'The commissioner set it not to count' };
    case CupContestCount.NO_RESULT:
      return { label: 'No result', tone: 'neutral', note: 'Every event was cancelled, so nobody placed' };
    case CupContestCount.NOT_FINAL:
      return contest.status === ContestStatus.ACTIVE
        ? { label: 'Live', tone: 'live', note: 'Counts once it is final' }
        : { label: 'Open', tone: 'active', note: 'Counts once it is final' };
  }
}

/** How many counted contests a cup needs before it is shown, so one side contest doesn't make a cup. */
export const CUP_SHOWN_FROM_COUNTED = 2;

/** The cups to show: those with enough counted contests (plans/season-cups.md §2, *Created, never set up*). */
export function cupsOnShow(cups: CupDto[]): CupDto[] {
  return cups.filter(
    (cup) => cup.contests.filter((contest) => contest.count === CupContestCount.COUNTED).length >= CUP_SHOWN_FROM_COUNTED,
  );
}

/** How far through its contests a cup is: how many are final, out of how many listed. */
export function cupProgress(cup: CupDto): { final: number; total: number } {
  return {
    final: cup.contests.filter((contest) => contest.status === ContestStatus.COMPLETED).length,
    total: cup.contests.length,
  };
}

/** The squads in 1st, once any contest has counted; nobody leads a cup still at 0. */
export function cupLeaders(cup: CupDto): CupStandingRowDto[] {
  return cup.standings.filter((row) => row.position === 1 && row.points > 0);
}

/** The contest that will count next: a live one first, then the next to open, by first event start. */
export function nextContestToCount(cup: CupDto): CupContestRowDto | null {
  const waiting = cup.contests.filter((contest) => contest.count === CupContestCount.NOT_FINAL);
  return waiting.find((contest) => contest.status === ContestStatus.ACTIVE) ?? waiting.at(0) ?? null;
}

export type RaceSeries = {
  squadId: string;
  squadName: string;
  /** The running total before any contest (0), then after each counted contest. */
  points: number[];
};

/** The race chart's lines: the top squads' running totals, from 0 before the first counted contest. */
export function buildRaceSeries(cup: CupDto, squads = RACE_CHART_SQUADS): RaceSeries[] {
  return cup.standings.slice(0, squads).map((row) => ({
    squadId: row.squadId,
    squadName: row.squadName,
    points: [0, ...row.pointsAfter],
  }));
}

/**
 * One line on where a cup stands: who leads, and the focus squad's place ("you are 6th", or the
 * squad by name on a squad's own page). Before anything has counted, it says so.
 */
export function describeCupStanding(cup: CupDto, focus: { squadId: string | null; isViewer: boolean }): string {
  const leaders = cupLeaders(cup);
  if (!leaders.length) {
    return 'No contest has counted yet';
  }
  const leaderText = leaders.length === 1
    ? `${leaders[0]?.squadName} leads`
    : `${joinNames(leaders.map((row) => row.squadName))} share the lead`;
  const focusRow = cup.standings.find((row) => row.squadId === focus.squadId);
  if (!focusRow) {
    return leaderText;
  }
  return `${leaderText} · ${focus.isViewer ? 'you are' : `${focusRow.squadName} is`} ${formatPlace(focusRow)}`;
}
