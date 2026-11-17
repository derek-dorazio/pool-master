import { MatchSide, MatchStatus, SportEventStatus, SurvivorWeekOutcome, pluralize } from '@poolmaster/shared/domain';
import type { SurvivorLeaderboardResponse } from '@/lib/api';

/**
 * The survivor leaderboard's reading of its rows (#1757): what each entry's status chip says,
 * what each week's cell shows, and the game and result lines of an opened entry's weeks.
 */

export type SurvivorRow = SurvivorLeaderboardResponse['entries'][number];
export type SurvivorWeek = SurvivorLeaderboardResponse['weeks'][number];
export type SurvivorPick = SurvivorRow['weeks'][number];

/** What a week is called on the board: its event's name, or a playoff round's name (#785). */
export type SurvivorWeekName = (week: SurvivorWeek) => string;

/** Between two scores, a dash that never breaks across lines. */
const SCORE_DASH = '–⁠';

/** How many of an opened entry's weeks show; earlier ones open from one line. */
export const SURVIVOR_SHOWN_WEEKS = 6;

/**
 * A week's key on the board: its event, and its round when the event is a playoff of several
 * rounds (#785), each of which is a week.
 */
export function survivorWeekKey(week: Pick<SurvivorWeek, 'roundCount' | 'roundNumber' | 'sportEventId'>): string {
  return week.roundCount > 1 ? `${week.sportEventId}-round-${week.roundNumber}` : week.sportEventId;
}

/** The entry's pick for a week of the board, if it has a cell there. */
export function survivorPickOf(entry: SurvivorRow, week: Pick<SurvivorWeek, 'roundNumber' | 'sportEventId'>): SurvivorPick | undefined {
  return entry.weeks.find((cell) => cell.sportEventId === week.sportEventId && cell.roundNumber === week.roundNumber);
}

/**
 * The status chip under an entry's name: "In", "In · 2 lives" in a two-life contest before a loss,
 * "In · 1 life left" after one (#1754), or "Out · Week 9" naming the week that put it out ("Out"
 * where the board names no week).
 */
export function survivorStatusLabel(
  entry: Pick<SurvivorRow, 'alive' | 'eliminatedInWeek' | 'livesLeft' | 'livesLost'>,
  weeks: readonly SurvivorWeek[],
  weekName: SurvivorWeekName,
): string {
  if (entry.alive) {
    if (entry.livesLost > 0) {
      return `In · ${pluralize(entry.livesLeft, 'life', 'lives')} left`;
    }
    return entry.livesLeft > 1 ? `In · ${pluralize(entry.livesLeft, 'life', 'lives')}` : 'In';
  }
  if (entry.eliminatedInWeek === null) {
    return 'Out';
  }
  const week = weeks.find((candidate) => candidate.weekNumber === entry.eliminatedInWeek);
  return `Out · ${week ? weekName(week) : `Week ${entry.eliminatedInWeek}`}`;
}

/** A pick's team as the board writes it: its code ("KC"), or its name where it has none. */
function teamLabel(pick: Pick<SurvivorPick, 'team' | 'teamShortName'>): string | null {
  return pick.teamShortName ?? pick.team;
}

function isLost(outcome: SurvivorPick['outcome']): boolean {
  return outcome === SurvivorWeekOutcome.LIFE_LOST || outcome === SurvivorWeekOutcome.ELIMINATED;
}

/** What one entry's cell for one week shows. */
export type SurvivorCellView =
  | { kind: 'blank' }
  | { kind: 'hidden' }
  | { kind: 'missed' }
  | { kind: 'pick'; label: string; tone: 'survived' | 'lost' | 'pending' };

/**
 * An entry's cell for a week: its team, green once survived and red once lost; 🔒 while another
 * entry's pick waits for its game's kickoff, though the viewer's own (`ownTeam`) shows; ✗ for a
 * week lost with no pick; blank for a week not reached, or after the entry went out.
 */
export function survivorCellView(pick: SurvivorPick | undefined, ownTeam: string | null): SurvivorCellView {
  if (!pick) {
    return { kind: 'blank' };
  }
  const label = teamLabel(pick);
  if (label === null) {
    if (pick.outcome === SurvivorWeekOutcome.PENDING) {
      return ownTeam === null ? { kind: 'hidden' } : { kind: 'pick', label: ownTeam, tone: 'pending' };
    }
    return isLost(pick.outcome) ? { kind: 'missed' } : { kind: 'blank' };
  }
  if (pick.outcome === SurvivorWeekOutcome.SURVIVED) {
    return { kind: 'pick', label, tone: 'survived' };
  }
  return { kind: 'pick', label, tone: isLost(pick.outcome) ? 'lost' : 'pending' };
}

/** A pick's game as an opened entry lists it: "KC v BUF" at home, "KC at BUF" away, "KC vs BUF" at a neutral site. */
export function survivorGameLine(pick: SurvivorPick): string {
  const team = teamLabel(pick);
  if (team === null) {
    return isLost(pick.outcome) ? 'No pick' : 'Hidden until kickoff';
  }
  if (!pick.game) {
    return team;
  }
  const opponent = pick.game.opponentShortName ?? pick.game.opponent;
  const joiner = pick.game.isNeutralSite ? 'vs' : pick.game.side === MatchSide.HOME ? 'v' : 'at';
  return `${team} ${joiner} ${opponent}`;
}

/** What a lost week left the entry: its lives left, or out. */
function afterLoss(livesLeft: number | null): string {
  return livesLeft !== null && livesLeft > 0 ? `${pluralize(livesLeft, 'life', 'lives')} left` : 'Out';
}

/**
 * The muted line under a week's game: "✓ Won 27–20", "✗ Lost 20–24 · 1 life left", the kickoff
 * of a game still to come, or "Playing now". `livesLeft` is what a lost week left the entry.
 */
export function survivorResultLine(pick: SurvivorPick, livesLeft: number | null, formatKickoff: (startsAt: string) => string): string {
  const { game } = pick;
  if (teamLabel(pick) === null) {
    return isLost(pick.outcome) ? `✗ No pick · ${afterLoss(livesLeft)}` : 'Hidden until kickoff';
  }
  if (!game) {
    return '';
  }
  if (game.status === MatchStatus.CANCELLED) {
    return 'Cancelled · counts as survived';
  }
  if (game.status === MatchStatus.IN_PROGRESS) {
    return 'Playing now';
  }
  if (game.status !== MatchStatus.COMPLETED) {
    return game.scheduledDate === null ? 'Time to be set' : formatKickoff(game.scheduledDate);
  }
  const score = game.teamScore !== null && game.opponentScore !== null ? ` ${game.teamScore}${SCORE_DASH}${game.opponentScore}` : '';
  if (pick.outcome === SurvivorWeekOutcome.SURVIVED) {
    return `✓ Won${score}`;
  }
  const tied = game.teamScore !== null && game.teamScore === game.opponentScore;
  return `✗ ${tied ? 'Tied' : 'Lost'}${score} · ${afterLoss(livesLeft)}`;
}

/** One week of an opened entry: the week, its pick, and for a lost week the lives it left. */
export type SurvivorDetailWeek = { week: SurvivorWeek; pick: SurvivorPick; livesLeft: number | null };

/**
 * The weeks an opened entry lists, newest first: each week it has a pick or a result in, a lost
 * week with the lives it left (counted down from the lives the entry started with).
 */
export function survivorDetailWeeks(entry: SurvivorRow, weeks: readonly SurvivorWeek[]): SurvivorDetailWeek[] {
  let livesLeft = entry.livesLeft + entry.livesLost;
  const played: SurvivorDetailWeek[] = [];
  for (const week of weeks) {
    const pick = survivorPickOf(entry, week);
    if (!pick || (pick.outcome === null && teamLabel(pick) === null)) {
      continue;
    }
    if (isLost(pick.outcome)) {
      livesLeft -= 1;
    }
    played.push({ week, pick, livesLeft: isLost(pick.outcome) ? Math.max(livesLeft, 0) : null });
  }
  return played.reverse();
}

/** The line that opens an entry's earlier weeks: "Weeks 1–6", or a playoff's "Earlier rounds". */
export function survivorEarlierLabel(weeks: readonly SurvivorWeek[]): string {
  if (weeks.some((week) => week.roundCount > 1)) {
    return 'Earlier rounds';
  }
  const numbers = weeks.map((week) => week.weekNumber);
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);
  return first === last ? `Week ${first}` : `Weeks ${first}–${last}`;
}

/** The week the board is on: the latest week started, else the first; live while its games are under way. */
export function survivorCurrentWeek(weeks: readonly SurvivorWeek[]): { week: SurvivorWeek | null; isLive: boolean } {
  const week = [...weeks].reverse().find((candidate) => candidate.started) ?? weeks.at(0) ?? null;
  return { week, isLive: week !== null && week.started && week.status === SportEventStatus.IN_PROGRESS };
}
