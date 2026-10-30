import type { ColumnDef } from '@tanstack/react-table';
import { Trophy } from 'lucide-react';
import { SportEventStatus, formatPickEmRulesName } from '@poolmaster/shared/domain';
import type { ContestDto, PickEmLeaderboardResponse } from '@/lib/api';
import { formatPoints } from './bracket-layout';
import { entryColumn, isMySquadsEntry, placeColumn, totalColumn } from './leaderboard-columns';
import { LeaderboardFrame, ScoreboardGrid, YourBestNote } from './leaderboard-kit';
import { useLeaderboardFallback } from './use-leaderboard-fallback';
import { useContestLeague } from './use-contest-league';
import { usePickEmLeaderboardQuery } from './use-contest-leaderboard';

type PickEmRow = PickEmLeaderboardResponse['entries'][number];
type PickEmWeek = PickEmLeaderboardResponse['weeks'][number];

/** The prefix of the board's test ids. */
const TEST_ID = 'pick-em-leaderboard';

/** A week's column heading: its name, with how it stands once it is under way. */
function weekHeading(week: PickEmWeek): string {
  if (week.status === SportEventStatus.CANCELLED) {
    return `${week.name} (cancelled)`;
  }
  if (week.settled) {
    return `${week.name} (final)`;
  }
  return week.started ? `${week.name} (live)` : week.name;
}

/** One entry's cell for one week: its points and place, a trophy for a weekly winner, a dash before. */
function WeekCell({ entryId, week }: { entryId: string; week: PickEmRow['weeks'][number] }) {
  return (
    <span className="inline-flex items-center gap-1.5" data-testid={`pick-em-leaderboard-week-${week.sportEventId}-${entryId}`}>
      {week.points === null ? '—' : formatPoints(week.points)}
      {week.displayPosition ? <span className="text-xs text-muted-foreground">{week.displayPosition}</span> : null}
      {week.weeklyWinner ? (
        <Trophy aria-label="Weekly winner" className="text-primary" data-testid={`pick-em-leaderboard-winner-${week.sportEventId}-${entryId}`} size={14} />
      ) : null}
    </span>
  );
}

/** The season board's columns: place, the entry and its group, the season total, then one per week. */
function pickEmColumns(
  contestId: string,
  leagueCode: string | null,
  mySquadId: string | null,
  weeks: readonly PickEmWeek[],
): ColumnDef<PickEmRow>[] {
  return [
    placeColumn(TEST_ID),
    entryColumn(TEST_ID, { contestId, isMine: isMySquadsEntry(mySquadId), leagueCode }),
    totalColumn(TEST_ID, { format: formatPoints, header: 'Season', id: 'total', value: (row) => row.totalPoints }),
    ...weeks.map((week): ColumnDef<PickEmRow> => ({
      id: `week-${week.sportEventId}`,
      header: weekHeading(week),
      accessorFn: (row) => row.weeks.find((cell) => cell.sportEventId === week.sportEventId)?.points ?? null,
      cell: ({ row }) => {
        const cell = row.original.weeks.find((candidate) => candidate.sportEventId === week.sportEventId);
        return cell ? <WeekCell entryId={row.original.entryId} week={cell} /> : '—';
      },
    })),
  ];
}

/**
 * A pick'em contest's season leaderboard (#718): place, the entry and its group, the season total,
 * and a column for every week with the entry's points and place in it, each week's winners marked
 * with a trophy. A week under way is scored live from the games played; a settled week is frozen.
 * Polled while the contest is live, so places move with the results.
 */
export function PickEmLeaderboard({ contest, leagueCode: hintedLeagueCode }: { contest: ContestDto; leagueCode: string | null }) {
  const contestId = contest.id;
  const leaderboardQuery = usePickEmLeaderboardQuery(contestId, contest.status);
  const { leagueCode, viewer } = useContestLeague(contest.leagueId, hintedLeagueCode);
  const fallback = useLeaderboardFallback(leaderboardQuery, { action: 'pickEmLeaderboard.load.failed', contestId });

  if (fallback || !leaderboardQuery.data) {
    return fallback;
  }

  const board = leaderboardQuery.data;
  const mySquadId = viewer.mySquadId;
  const isUnderWay = board.weeks.some((week) => week.started);

  return (
    <LeaderboardFrame
      contest={contest}
      leagueCode={leagueCode}
      notes={(
        <>
          <YourBestNote entries={board.entries} mySquadId={mySquadId} points={(entry) => entry.totalPoints} testId="pick-em-leaderboard-my-best" />
          {isUnderWay ? null : (
            <p data-testid="pick-em-leaderboard-not-started">Points show from the first kickoff. Entries are listed once they submit a week.</p>
          )}
        </>
      )}
      summary={(
        <p className="mt-2 text-sm text-muted-foreground" data-testid="pick-em-leaderboard-mode">
          {formatPickEmRulesName(board)}
        </p>
      )}
    >
      <ScoreboardGrid
        columns={pickEmColumns(contestId, leagueCode, mySquadId, board.weeks)}
        data={board.entries}
        emptyMessage="No entry has submitted a week yet."
        rowTestIdPrefix="pick-em-leaderboard-row"
        tableTestId="pick-em-leaderboard-table"
      />
    </LeaderboardFrame>
  );
}
