import type { ColumnDef } from '@tanstack/react-table';
import { SportEventStatus, SurvivorWeekOutcome, describeSurvivorRules, pluralize } from '@poolmaster/shared/domain';
import type { ContestDto, SurvivorLeaderboardResponse } from '@/lib/api';
import { Chip, type StatusBadgeProps } from '@/features/shared/ui';
import { entryColumn, isMySquadsEntry, placeColumn, totalColumn } from './leaderboard-columns';
import { LeaderboardFrame, ScoreboardGrid } from './leaderboard-kit';
import { useLeaderboardFallback } from './use-leaderboard-fallback';
import { useBracketRoundLabel } from './use-bracket-round-label';
import { useContestLeague } from './use-contest-league';
import { useSurvivorLeaderboardQuery } from './use-contest-leaderboard';

type SurvivorRow = SurvivorLeaderboardResponse['entries'][number];
type SurvivorWeek = SurvivorLeaderboardResponse['weeks'][number];

/** The prefix of the board's test ids. */
const TEST_ID = 'survivor-leaderboard';

const OUTCOME_LABELS: Record<SurvivorWeekOutcome, string> = {
  SURVIVED: 'Survived',
  ELIMINATED: 'Out',
  PENDING: 'Pending',
};

const OUTCOME_TONES: Record<SurvivorWeekOutcome, NonNullable<StatusBadgeProps['tone']>> = {
  SURVIVED: 'success',
  ELIMINATED: 'danger',
  PENDING: 'neutral',
};

/** What a week is called on the board: its event's name, or a playoff round's name (#785). */
type WeekName = (week: Pick<SurvivorWeek, 'name' | 'roundCount' | 'roundNumber'>) => string;

/**
 * A week's key on the board: its event, and its round when the event is a playoff of several
 * rounds (#785), each of which is a week.
 */
function weekKey(week: Pick<SurvivorWeek, 'roundCount' | 'roundNumber' | 'sportEventId'>): string {
  return week.roundCount > 1 ? `${week.sportEventId}-round-${week.roundNumber}` : week.sportEventId;
}

/** "In" for an entry still standing, else "Out in week 3", or in a playoff "Out in Divisional". */
function formatSurvivorStanding(entry: Pick<SurvivorRow, 'alive' | 'eliminatedInWeek'>, weeks: readonly SurvivorWeek[], weekName: WeekName): string {
  if (entry.alive || entry.eliminatedInWeek === null) {
    return 'In';
  }
  const week = weeks.find((candidate) => candidate.weekNumber === entry.eliminatedInWeek);
  return week && week.roundCount > 1 ? `Out in ${weekName(week)}` : `Out in week ${entry.eliminatedInWeek}`;
}

/** A week's column heading: its name, with how it stands once it is under way. */
function weekHeading(week: SurvivorWeek, weekName: WeekName): string {
  const name = weekName(week);
  if (week.status === SportEventStatus.CANCELLED) {
    return `${name} (cancelled)`;
  }
  return week.started ? `${name} (${week.aliveCount} in)` : name;
}

/** One entry's cell for one week: the team it picked once shown, and how the week went for it. */
function WeekCell({ entryId, week, weekId }: { entryId: string; week: SurvivorRow['weeks'][number]; weekId: string }) {
  if (week.outcome === null && week.team === null) {
    return <span data-testid={`survivor-leaderboard-week-${weekId}-${entryId}`}>—</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid={`survivor-leaderboard-week-${weekId}-${entryId}`}>
      {/* A pending week has a pick, kept hidden until its match starts; a week lost with no pick named had none. */}
      {week.team ?? (week.outcome === SurvivorWeekOutcome.PENDING ? 'Hidden until it starts' : 'No pick')}
      {week.outcome ? <Chip tone={OUTCOME_TONES[week.outcome]}>{OUTCOME_LABELS[week.outcome]}</Chip> : null}
    </span>
  );
}

/** The board's columns: place, the entry and its group, whether it is still in, weeks survived, then one per week. */
function survivorColumns(
  contestId: string,
  leagueCode: string | null,
  mySquadId: string | null,
  weeks: readonly SurvivorWeek[],
  weekName: WeekName,
): ColumnDef<SurvivorRow>[] {
  const cellOf = (row: SurvivorRow, week: SurvivorWeek) =>
    row.weeks.find((cell) => cell.sportEventId === week.sportEventId && cell.roundNumber === week.roundNumber);
  return [
    placeColumn(TEST_ID),
    entryColumn(TEST_ID, { contestId, isMine: isMySquadsEntry(mySquadId), leagueCode }),
    {
      id: 'standing',
      header: 'Status',
      accessorFn: (row) => formatSurvivorStanding(row, weeks, weekName),
      cell: ({ row }) => (
        <Chip data-testid={`survivor-leaderboard-standing-${row.original.entryId}`} tone={row.original.alive ? 'success' : 'neutral'}>
          {formatSurvivorStanding(row.original, weeks, weekName)}
        </Chip>
      ),
    },
    totalColumn(TEST_ID, { header: 'Weeks survived', id: 'survived', value: (row) => row.weeksSurvived }),
    ...weeks.map((week): ColumnDef<SurvivorRow> => ({
      id: `week-${weekKey(week)}`,
      header: weekHeading(week, weekName),
      accessorFn: (row) => cellOf(row, week)?.outcome ?? null,
      cell: ({ row }) => {
        const cell = cellOf(row.original, week);
        return cell ? <WeekCell entryId={row.original.entryId} week={cell} weekId={weekKey(week)} /> : '—';
      },
    })),
  ];
}

/**
 * A survivor contest's leaderboard (#719): place, the entry and its group, whether it is still in
 * or the week it went out, its weeks survived, and a column for every week with the team it picked
 * (shown from that game's kickoff) and how the week went. On a playoff bracket (#785) each round
 * is a column of its own, named as the bracket names it. Polled while the contest is live, so
 * entries drop out as the results come in.
 */
export function SurvivorLeaderboard({ contest, leagueCode: hintedLeagueCode }: { contest: ContestDto; leagueCode: string | null }) {
  const contestId = contest.id;
  const leaderboardQuery = useSurvivorLeaderboardQuery(contestId, contest.status);
  const { leagueCode, viewer } = useContestLeague(contest.leagueId, hintedLeagueCode);
  // A playoff's rounds (#785) are named as its bracket names them.
  const playoffEventId = leaderboardQuery.data?.weeks.find((week) => week.roundCount > 1)?.sportEventId ?? '';
  const roundLabel = useBracketRoundLabel(contest.sport, playoffEventId);
  const weekName: WeekName = (week) => (week.roundCount > 1 ? roundLabel(week.roundNumber, week.roundCount) : week.name);
  const fallback = useLeaderboardFallback(leaderboardQuery, { action: 'survivorLeaderboard.load.failed', contestId });

  if (fallback || !leaderboardQuery.data) {
    return fallback;
  }

  const board = leaderboardQuery.data;
  const stillIn = board.entries.filter((entry) => entry.alive).length;
  const isUnderWay = board.weeks.some((week) => week.started);

  return (
    <LeaderboardFrame
      contest={contest}
      leagueCode={leagueCode}
      notes={(
        <>
          {board.entries.length ? (
            <p data-testid="survivor-leaderboard-still-in">{`${pluralize(stillIn, 'entry', 'entries')} still in.`}</p>
          ) : null}
          {isUnderWay ? null : (
            <p data-testid="survivor-leaderboard-not-started">Picks show from each game&apos;s kickoff. Entries are listed once they submit a week.</p>
          )}
        </>
      )}
      summary={(
        <p className="mt-2 text-sm text-muted-foreground" data-testid="survivor-leaderboard-rules">
          {describeSurvivorRules(null)}
        </p>
      )}
    >
      <ScoreboardGrid
        columns={survivorColumns(contestId, leagueCode, viewer.mySquadId, board.weeks, weekName)}
        data={board.entries}
        emptyMessage="No entry has submitted a week yet."
        rowTestIdPrefix="survivor-leaderboard-row"
        tableTestId="survivor-leaderboard-table"
      />
    </LeaderboardFrame>
  );
}
