import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { ContestStatus, SportEventStatus, formatPickEmRulesName  } from '@poolmaster/shared/domain';
import type { ContestDto, PickEmLeaderboardResponse } from '@/lib/api';
import { buildLeagueContestEntryPath } from '@/features/leagues/league-routing';
import { useLeagueContextById } from '@/features/leagues/use-league-context';
import { Chip, DataGrid, ErrorState, LoadingState, Tile } from '@/features/shared/ui';
import { ApiError, extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { QueryKeys } from '@/lib/query-keys';
import { formatPoints } from './bracket-layout';
import { ContestHeader, ContestSubMenu } from './contest-header';
import { LEADERBOARD_ERROR_MESSAGES } from './contest-leaderboard';
import { ContestStatusBadge } from './contest-status-badge';
import { fetchContestEntries } from './use-contest-entries';
import { usePickEmLeaderboardQuery } from './use-contest-leaderboard';

type PickEmRow = PickEmLeaderboardResponse['entries'][number];
type PickEmWeek = PickEmLeaderboardResponse['weeks'][number];

/** Entries per page. A league can have hundreds; one page stays readable on a phone. */
const PAGE_SIZE = 25;

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
    {
      id: 'place',
      header: 'Place',
      accessorFn: (row) => row.position,
      cell: ({ row }) => (
        <span className="font-semibold" data-testid={`pick-em-leaderboard-place-${row.original.entryId}`}>
          {row.original.displayPosition ?? '—'}
        </span>
      ),
    },
    {
      id: 'entry',
      header: 'Entry',
      // Searched by the entry's name and its group's name.
      accessorFn: (row) => `${row.entryName} ${row.squadName}`,
      cell: ({ row }) => (
        <span className="block min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            {leagueCode ? (
              <Link
                className="font-medium text-foreground hover:underline"
                data-testid={`pick-em-leaderboard-entry-link-${row.original.entryId}`}
                state={{ leagueCode }}
                to={buildLeagueContestEntryPath(leagueCode, contestId, row.original.entryId)}
              >
                {row.original.entryName}
              </Link>
            ) : (
              <span className="font-medium">{row.original.entryName}</span>
            )}
            {mySquadId !== null && row.original.squadId === mySquadId ? <Chip tone="active">Yours</Chip> : null}
          </span>
          <span className="block text-xs text-muted-foreground">{row.original.squadName}</span>
        </span>
      ),
    },
    {
      id: 'total',
      header: 'Season',
      accessorFn: (row) => row.totalPoints,
      cell: ({ row }) => (
        <span className="score-total" data-testid={`pick-em-leaderboard-total-${row.original.entryId}`}>
          {formatPoints(row.original.totalPoints)}
        </span>
      ),
    },
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
  const logger = getLogger().child({ feature: 'pick-em-leaderboard' });
  const contestId = contest.id;
  const leaderboardQuery = usePickEmLeaderboardQuery(contestId, contest.status);
  const contestEntriesQuery = useQuery({
    queryKey: QueryKeys.contestEntries.byContest(contestId),
    queryFn: () => fetchContestEntries(contestId),
    retry: false,
  });
  const { league, viewer } = useLeagueContextById(contest.leagueId);
  const leagueCode = hintedLeagueCode ?? league?.leagueCode ?? null;

  useEffect(() => {
    if (leaderboardQuery.isError) {
      logger.warn(
        { action: 'pickEmLeaderboard.load.failed', data: { contestId }, err: leaderboardQuery.error },
        'Pick\'em leaderboard failed to load',
      );
    }
  }, [contestId, leaderboardQuery.error, leaderboardQuery.isError, logger]);

  if (leaderboardQuery.isLoading) {
    return <LoadingState body="Loading contest leaderboard..." />;
  }
  if (leaderboardQuery.isError || !leaderboardQuery.data) {
    const { error } = leaderboardQuery;
    return (
      <ErrorState
        body={extractErrorMessage(error, {
          codeMessages: LEADERBOARD_ERROR_MESSAGES,
          fallback: 'Try refreshing, or return to the contest board.',
        })}
        testId={error instanceof ApiError && error.code ? `contest-leaderboard-error-${error.code}` : 'contest-leaderboard-error'}
        title="We couldn't load this leaderboard."
      />
    );
  }

  const board = leaderboardQuery.data;
  const mySquadId = viewer.mySquadId;
  // The server ranks best first, so the viewer's first row is their best placed entry.
  const myBest = mySquadId === null ? undefined : board.entries.find((entry) => entry.squadId === mySquadId && entry.displayPosition !== null);
  const isUnderWay = board.weeks.some((week) => week.started);

  return (
    <section className="space-y-6" data-testid="contest-leaderboard">
      <ContestHeader
        badges={<ContestStatusBadge status={contest.status} />}
        menu={leagueCode ? (
          <ContestSubMenu
            contestId={contestId}
            current="leaderboard"
            leagueCode={leagueCode}
            myEntryId={contestEntriesQuery.data?.myEntryIds?.[0] ?? null}
            picksRevealed
          />
        ) : null}
        summary={(
          <p className="mt-2 text-sm text-muted-foreground" data-testid="pick-em-leaderboard-mode">
            {formatPickEmRulesName(board)}
          </p>
        )}
        title={contest.name}
        titleTestId="contest-leaderboard-heading"
      >
        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
          {myBest?.displayPosition ? (
            <p data-testid="pick-em-leaderboard-my-best">{`Your best: ${myBest.displayPosition} · ${myBest.entryName}, ${formatPoints(myBest.totalPoints)}`}</p>
          ) : null}
          {isUnderWay ? null : (
            <p data-testid="pick-em-leaderboard-not-started">Points show from the first kickoff. Entries are listed once they submit a week.</p>
          )}
          {contest.status === ContestStatus.COMPLETED ? (
            <p data-testid="contest-leaderboard-settled-note">Final result: these standings are frozen at settlement.</p>
          ) : null}
        </div>
      </ContestHeader>

      <Tile>
        <DataGrid
          headerTone="scoreboard"
          columns={pickEmColumns(contestId, leagueCode, mySquadId, board.weeks)}
          data={board.entries}
          emptyMessage="No entry has submitted a week yet."
          getRowId={(row) => row.entryId}
          pageSize={PAGE_SIZE}
          rowTestId={(row) => `pick-em-leaderboard-row-${row.entryId}`}
          search={{ label: 'Find an entry', placeholder: 'Find an entry', testId: 'contest-leaderboard-search' }}
          showColumnFilters={false}
          tableTestId="pick-em-leaderboard-table"
        />
      </Tile>
    </section>
  );
}
