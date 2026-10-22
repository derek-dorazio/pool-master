import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useParams } from 'react-router-dom';
import { ContestStatus, describeSquaresRules  } from '@poolmaster/shared/domain';
import type { ContestDto, SquaresBoardResponse, SquaresEntryDto } from '@/lib/api';
import { buildLeagueContestPath, buildLeaguePath } from '@/features/leagues/league-routing';
import { useLeagueContextById } from '@/features/leagues/use-league-context';
import { DataGrid, LinkButton, Tile } from '@/features/shared/ui';
import { QueryKeys } from '@/lib/query-keys';
import { parseRouteState } from '@/routes/route-state';
import { ContestHeader, ContestSubMenu } from './contest-header';
import { ContestStatusBadge } from './contest-status-badge';
import { SquaresBoardView } from './squares-board-view';
import { useSquaresBoardQuery } from './use-squares-board';
import { fetchContestEntries } from './use-contest-entries';

/** A squares contest's rules sentence, once its board has loaded with the box limit. */
function squaresRules(board: SquaresBoardResponse | undefined) {
  return board ? describeSquaresRules(board.maxSquaresPerEntry) : null;
}

/**
 * A squares contest's entry page (#711): the grid, where the entry's owners claim its boxes until
 * the numbers are drawn, and then follow each quarter's winner.
 */
export function SquaresEntryPage({ contest }: { contest: ContestDto }) {
  const { entryId = '', leagueCode: routeLeagueCode } = useParams<{ entryId: string; leagueCode?: string }>();
  const location = useLocation();
  const contestId = contest.id;
  const hintedLeagueCode = routeLeagueCode ?? parseRouteState(location.state).leagueCode ?? null;
  const boardQuery = useSquaresBoardQuery(contest);
  const contestEntriesQuery = useQuery({
    queryKey: QueryKeys.contestEntries.byContest(contestId),
    queryFn: () => fetchContestEntries(contestId),
    retry: false,
  });
  const { league, viewer } = useLeagueContextById(contest.leagueId);
  const backLeagueCode = hintedLeagueCode ?? league?.leagueCode ?? null;
  const myEntryIds = contestEntriesQuery.data?.myEntryIds ?? [];
  const entry = contestEntriesQuery.data?.entries.find((candidate) => candidate.id === entryId) ?? null;
  const backToContestPath = backLeagueCode ? buildLeagueContestPath(backLeagueCode, contestId) : `/contests/${contestId}`;

  return (
    <section className="space-y-6" data-testid="squares-entry-page">
      <ContestHeader
        actions={(
          <>
            {backLeagueCode ? null : (
              <LinkButton data-testid="contest-entry-back-to-contest" to={backToContestPath} variant="secondary">
                Back to contest
              </LinkButton>
            )}
            <LinkButton
              data-testid="contest-entry-back-to-league"
              to={backLeagueCode ? buildLeaguePath(backLeagueCode) : '/welcome'}
              variant="secondary"
            >
              Back to league
            </LinkButton>
          </>
        )}
        badges={<ContestStatusBadge status={contest.status} />}
        menu={backLeagueCode ? (
          <ContestSubMenu
            contestId={contestId}
            current={myEntryIds.includes(entryId) ? 'my-entry' : null}
            leagueCode={backLeagueCode}
            myEntryId={myEntryIds[0] ?? null}
            picksRevealed={contestEntriesQuery.data?.picksRevealed ?? false}
          />
        ) : null}
        summary={(
          <p className="mt-2 text-sm text-muted-foreground" data-testid="contest-entry-summary">
            {[contest.name, squaresRules(boardQuery.data)].filter((part) => part !== null).join(' · ')}
          </p>
        )}
        title={entry?.name ?? contest.name}
        titleTestId="contest-entry-heading"
      />
      <SquaresBoardView
        canManage={viewer.isCommissioner || viewer.isRootAdmin}
        contest={contest}
        myEntryIds={myEntryIds}
        shownEntryId={entryId}
      />
    </section>
  );
}

const STANDINGS_COLUMNS: ColumnDef<SquaresEntryDto>[] = [
  {
    id: 'place',
    header: 'Place',
    accessorFn: (row) => row.displayPosition ?? '—',
    cell: ({ row }) => (
      <span className="font-semibold" data-testid={`squares-standing-place-${row.original.contestEntryId}`}>
        {row.original.displayPosition ?? '—'}
      </span>
    ),
  },
  { id: 'entry', header: 'Entry', accessorFn: (row) => row.entryName },
  { id: 'boxes', header: 'Boxes', accessorFn: (row) => row.boxCount },
  {
    id: 'won',
    header: 'Quarters won',
    accessorFn: (row) => row.periodsWon,
    cell: ({ row }) => (
      <span className="font-semibold" data-testid={`squares-standing-won-${row.original.contestEntryId}`}>{row.original.periodsWon}</span>
    ),
  },
];

/**
 * A squares contest's leaderboard (#711): each quarter's winner and the grid with the winning
 * boxes outlined, then every entry with its boxes and the quarters it won, placed once Final.
 */
export function SquaresLeaderboard({ contest, leagueCode: hintedLeagueCode }: { contest: ContestDto; leagueCode: string | null }) {
  const contestId = contest.id;
  const boardQuery = useSquaresBoardQuery(contest);
  const contestEntriesQuery = useQuery({
    queryKey: QueryKeys.contestEntries.byContest(contestId),
    queryFn: () => fetchContestEntries(contestId),
    retry: false,
  });
  const { league, viewer } = useLeagueContextById(contest.leagueId);
  const leagueCode = hintedLeagueCode ?? league?.leagueCode ?? null;
  const myEntryIds = contestEntriesQuery.data?.myEntryIds ?? [];

  return (
    <section className="space-y-6" data-testid="contest-leaderboard">
      <ContestHeader
        badges={<ContestStatusBadge status={contest.status} />}
        menu={leagueCode ? (
          <ContestSubMenu
            contestId={contestId}
            current="leaderboard"
            leagueCode={leagueCode}
            myEntryId={myEntryIds[0] ?? null}
            picksRevealed
          />
        ) : null}
        summary={(
          <p className="mt-2 text-sm text-muted-foreground" data-testid="squares-leaderboard-rules">{squaresRules(boardQuery.data)}</p>
        )}
        title={contest.name}
        titleTestId="contest-leaderboard-heading"
      >
        {contest.status === ContestStatus.COMPLETED ? (
          <p className="mt-2 text-sm text-muted-foreground" data-testid="contest-leaderboard-settled-note">
            Final result: the winners are frozen at settlement.
          </p>
        ) : null}
      </ContestHeader>
      <SquaresBoardView canManage={viewer.isCommissioner || viewer.isRootAdmin} contest={contest} myEntryIds={myEntryIds} />
      {boardQuery.data ? (
        <Tile>
          <DataGrid
            columns={STANDINGS_COLUMNS}
            data={boardQuery.data.entries}
            emptyMessage="No entry holds a box yet."
            getRowId={(row) => row.contestEntryId}
            pageSize={25}
            rowTestId={(row) => `squares-standing-row-${row.contestEntryId}`}
            showColumnFilters={false}
            tableTestId="squares-standings-table"
          />
        </Tile>
      ) : null}
    </section>
  );
}
