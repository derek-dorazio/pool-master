import { MatchSide, MatchStatus } from '@poolmaster/shared/domain';
import type { PickEmLeaderboardResponse, SportEventMatchDto, SportEventParticipantDto } from '@/lib/api';
import { formatOrdinal, type PeekFact } from '@/features/shared/ui';
import { logger } from '@/lib/logger';

/**
 * The pick'em season board's pieces (#1751), apart from how they are drawn: each week's cell for
 * an entry, with its medal and the peek that says how the week went, and the current week's games
 * an opened entry lists, each with the entry's pick on it.
 */

type PickEmBoard = PickEmLeaderboardResponse;
type PickEmBoardWeek = PickEmBoard['weeks'][number];
type PickEmBoardEntryWeek = PickEmBoard['entries'][number]['weeks'][number];
export type PickEmBoardPick = PickEmBoard['entries'][number]['currentWeekPicks'][number];

/** The week's top three, by place: a place shared is a medal shared. */
const MEDALS: Readonly<Record<number, string>> = { 1: '🥇', 2: '🥈', 3: '🥉' };

/** Kept on one line: a score's dash never breaks it. */
const SCORE_DASH = '–⁠';

export interface PickEmWeekCellView {
  /** The picks right so far; a dash for a week not started or not submitted. */
  text: string;
  medal: string | null;
  /** What the week's peek says, once the entry has a week to tell. */
  peek: { title: string; facts: PeekFact[] } | null;
}

/** "1st", or "T2nd" for a place shared. */
function formatPlace(cell: Pick<PickEmBoardEntryWeek, 'displayPosition' | 'position'>): string | null {
  if (cell.position === null) {
    return null;
  }
  return `${cell.displayPosition?.startsWith('T') ? 'T' : ''}${formatOrdinal(cell.position)}`;
}

/**
 * The weeks the board has a column for: every week under way or played, and the week it is on,
 * so a week still to come shows no column of dashes.
 */
export function pickEmShownWeeks(board: Pick<PickEmBoard, 'currentWeekId' | 'weeks'>): PickEmBoardWeek[] {
  return board.weeks.filter((week) => week.started || week.sportEventId === board.currentWeekId);
}

/**
 * How many entries each week has placed, by week id: the "of N" of a week's place, counted once
 * per week for the whole board.
 */
export function pickEmPlacedCounts(board: Pick<PickEmBoard, 'entries'>): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const cell of board.entries.flatMap((entry) => entry.weeks)) {
    if (cell.position !== null) {
      counts.set(cell.sportEventId, (counts.get(cell.sportEventId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * One entry's cell for one week: how many of its picks came true so far, a medal for the week's
 * top three, and a peek with its place among the week's `placed` entries and the picks it missed.
 */
export function pickEmWeekCell(week: PickEmBoardWeek, placed: number, cell: PickEmBoardEntryWeek | undefined): PickEmWeekCellView {
  if (!cell || cell.correctPickCount === null) {
    return { text: '—', medal: null, peek: null };
  }
  const place = formatPlace(cell);
  return {
    text: String(cell.correctPickCount),
    medal: cell.position === null ? null : MEDALS[cell.position] ?? null,
    peek: {
      title: week.name,
      facts: [
        { label: 'Right', value: `${String(cell.correctPickCount)} of ${String(week.gameCount)}` },
        ...(place ? [{ label: 'Place', value: `${place} of ${String(placed)}` }] : []),
        {
          label: 'Missed',
          value: cell.missedPicks.length > 0 ? cell.missedPicks.map((miss) => miss.teamName ?? 'Tie').join(', ') : 'None',
        },
      ],
    },
  };
}

export interface PickEmBoardGame {
  id: string;
  /** "BUF at KC", or "BUF vs KC" at a neutral site. */
  matchup: string;
  /** The result ("KC 27–20"), "Playing now", or the kickoff. */
  progress: string;
}

/**
 * The week's games an opened entry lists, in kickoff order: each named by its teams, with its
 * result once played, else when it kicks off. A cancelled game is not one of the week's games.
 */
export function pickEmBoardGames(
  matches: readonly SportEventMatchDto[],
  teamName: (fieldRowId: string | null) => string,
  formatKickoff: (startsAt: string) => string,
): PickEmBoardGame[] {
  return [...matches]
    .filter((match) => match.status !== MatchStatus.CANCELLED)
    .sort((left, right) => (Date.parse(left.scheduledDate ?? '') || 0) - (Date.parse(right.scheduledDate ?? '') || 0) || left.matchNumber - right.matchNumber)
    .map((match) => {
      const home = teamName(match.homeSportEventParticipantId);
      const away = teamName(match.awaySportEventParticipantId);
      return { id: match.id, matchup: `${away} ${match.isNeutralSite ? 'vs' : 'at'} ${home}`, progress: gameProgress(match, home, away, formatKickoff) };
    });
}

function gameProgress(match: SportEventMatchDto, home: string, away: string, formatKickoff: (startsAt: string) => string): string {
  if (match.status === MatchStatus.COMPLETED && match.homeScore !== null && match.awayScore !== null) {
    if (match.winnerSide === null) {
      return `Tie ${String(match.homeScore)}${SCORE_DASH}${String(match.awayScore)}`;
    }
    const homeWon = match.winnerSide === MatchSide.HOME;
    const [winning, losing] = homeWon ? [match.homeScore, match.awayScore] : [match.awayScore, match.homeScore];
    return `${homeWon ? home : away} ${String(winning)}${SCORE_DASH}${String(losing)}`;
  }
  if (match.status === MatchStatus.IN_PROGRESS) {
    return 'Playing now';
  }
  return match.scheduledDate === null ? 'Time to be set' : formatKickoff(match.scheduledDate);
}

/** The field's teams by field row, by short name where a team has one, so a game fits a phone row. */
export function teamNamesOf(field: readonly SportEventParticipantDto[]): ReadonlyMap<string, string> {
  return new Map(field.map((row) => [row.id, row.participant.shortName ?? row.participant.name]));
}

/** What a team the field doesn't hold is called: a gap in the data, not a side to be decided. */
const UNKNOWN_TEAM = '—';

/**
 * A team's name by its field row, from `teamNamesOf`. A side not yet decided says so; a field row
 * the field doesn't hold is a gap in the data, so it shows a dash and is passed to `onMissing`.
 */
export function teamNameIn(names: ReadonlyMap<string, string>, onMissing?: (fieldRowId: string) => void) {
  return (fieldRowId: string | null): string => {
    if (fieldRowId === null) {
      return 'To be decided';
    }
    const name = names.get(fieldRowId);
    if (name === undefined) {
      onMissing?.(fieldRowId);
      return UNKNOWN_TEAM;
    }
    return name;
  };
}

/** The field rows already reported missing, by event, so a poll doesn't log the same gap again. */
const reportedMissingTeams = new Set<string>();

/** Logs, once per event and field row, a team a game or pick names that the event's field doesn't hold. */
export function reportMissingTeam(sportEventId: string) {
  return (fieldRowId: string) => {
    const key = `${sportEventId}:${fieldRowId}`;
    if (reportedMissingTeams.has(key)) {
      return;
    }
    reportedMissingTeams.add(key);
    logger.warn({ action: 'pickEm.team.missingFromField', data: { sportEventId, fieldRowId } }, 'A pick\'em game or pick names a team the event\'s field does not hold');
  };
}

/** A pick named as the board names teams: its team, or "Tie" for a tie pick. */
export function pickLabel(sportEventParticipantId: string | null, teamName: (fieldRowId: string | null) => string): string {
  return sportEventParticipantId === null ? 'Tie' : teamName(sportEventParticipantId);
}
