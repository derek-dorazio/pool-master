import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';
import { MemoryRouter } from 'react-router';
import { ContestStatus } from '@poolmaster/shared/domain';
import { describe, expect, it, vi } from 'vitest';
import type { ContestDto } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { entryColumn, isMySquadsEntry, placeColumn, totalColumn } from './leaderboard-columns';
import { LeaderboardFrame, ScoreboardGrid, YourBestNote } from './leaderboard-kit';
import { useLeaderboardFallback } from './use-leaderboard-fallback';

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, isRootAdmin: false, user: { id: 'user-1', isRootAdmin: false }, clearSession: vi.fn() }),
}));

type Row = { entryId: string; entryName: string; displayPosition: string | null; position: number | null; points: number; squadId: string; squadName: string };

const rows: Row[] = [
  { entryId: 'entry-1', entryName: 'Crushers 1', displayPosition: 'T1', position: 1, points: 42.5, squadId: 'squad-1', squadName: 'Casey Crushers' },
  { entryId: 'entry-2', entryName: 'Bandits 1', displayPosition: null, position: null, points: 0, squadId: 'squad-2', squadName: 'Birdie Bandits' },
];

function renderBoard(columns: ColumnDef<Row>[], data: Row[] = rows) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ScoreboardGrid columns={columns} data={data} emptyMessage="Nobody yet." rowTestIdPrefix="board-row" tableTestId="board" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('placeColumn', () => {
  it('shows the server\'s place, shared places as it writes them, and a dash for an unplaced entry', () => {
    renderBoard([placeColumn('board')]);

    expect(screen.getByTestId('board-place-entry-1')).toHaveTextContent('T1');
    expect(screen.getByTestId('board-place-entry-2')).toHaveTextContent('—');
  });
});

describe('entryColumn', () => {
  it('links each entry to its page in the league by its name alone, with an (i) that says whose it is', () => {
    renderBoard([entryColumn('board', { contestId: 'contest-1', leagueCode: 'BIGDAWGS', leagueId: 'league-1', isMine: () => false })]);

    expect(screen.getByTestId('board-entry-link-entry-1')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-1/entries/entry-1');
    expect(screen.getByTestId('board-row-entry-1')).not.toHaveTextContent('Casey Crushers');
    expect(screen.getByRole('button', { name: 'About Crushers 1' })).toBeInTheDocument();
  });

  it('shows no (i) for an entry the board names no team for', () => {
    renderBoard(
      [entryColumn('board', { contestId: 'contest-1', leagueCode: 'BIGDAWGS', leagueId: 'league-1', isMine: () => false })],
      [{ ...rows[0], squadId: '' }],
    );

    expect(screen.queryByRole('button', { name: 'About Crushers 1' })).not.toBeInTheDocument();
  });

  it('marks only the viewer\'s squad\'s entries Yours', () => {
    renderBoard([entryColumn('board', { contestId: 'contest-1', leagueCode: 'BIGDAWGS', leagueId: 'league-1', isMine: isMySquadsEntry('squad-1') })]);

    expect(within(screen.getByTestId('board-row-entry-1')).getByText('Yours')).toBeInTheDocument();
    expect(within(screen.getByTestId('board-row-entry-2')).queryByText('Yours')).not.toBeInTheDocument();
  });

  it('marks nothing Yours for a viewer without a squad', () => {
    renderBoard([entryColumn('board', { contestId: 'contest-1', leagueCode: 'BIGDAWGS', leagueId: 'league-1', isMine: isMySquadsEntry(null) })]);

    expect(screen.queryByText('Yours')).not.toBeInTheDocument();
  });

  it('finds an entry by its squad\'s name in the board\'s search', async () => {
    renderBoard([entryColumn('board', { contestId: 'contest-1', leagueCode: 'BIGDAWGS', leagueId: 'league-1', isMine: () => false })]);

    await userEvent.type(screen.getByTestId('contest-leaderboard-search'), 'Bandits');

    expect(screen.queryByTestId('board-row-entry-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('board-row-entry-2')).toBeInTheDocument();
  });
});

describe('totalColumn', () => {
  it('shows the figure the board ranks by under its own heading, formatted as the board asks', () => {
    renderBoard([totalColumn('board', { format: (value) => value.toFixed(1), header: 'Points', id: 'points', value: (row) => row.points })]);

    expect(screen.getByRole('columnheader', { name: /Points/ })).toBeInTheDocument();
    expect(screen.getByTestId('board-points-entry-1')).toHaveTextContent('42.5');
    expect(screen.getByTestId('board-points-entry-2')).toHaveTextContent('0.0');
  });

  it('shows the plain number when the board gives no format', () => {
    renderBoard([totalColumn('board', { header: 'Weeks survived', id: 'survived', value: (row) => row.position ?? 0 })]);

    expect(screen.getByTestId('board-survived-entry-1')).toHaveTextContent('1');
  });
});

describe('ScoreboardGrid', () => {
  it('sits in the shared section titled Leaderboard, so pick\'em, bracket, survivor and squares boards share one frame', () => {
    renderBoard([placeColumn('board')]);

    expect(within(screen.getByRole('region', { name: 'Leaderboard' })).getByTestId('board')).toBeInTheDocument();
  });

  it('says the board\'s own empty message when no entry is on it', () => {
    renderBoard([placeColumn('board')], []);

    expect(screen.getByTestId('board')).toHaveTextContent('Nobody yet.');
  });
});

const contest = { id: 'contest-1', myEntryIds: [], name: 'Masters Pool', status: ContestStatus.ACTIVE } as unknown as ContestDto;

function renderFrame(props: Partial<Parameters<typeof LeaderboardFrame>[0]> = {}) {
  // The frame reads the contest's league to check the URL names it (#1412); this contest names none.
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <LeaderboardFrame contest={contest} leagueCode="BIGDAWGS" notes={<p>Your best: T1</p>} {...props}>
          <p>The board</p>
        </LeaderboardFrame>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LeaderboardFrame', () => {
  it('frames the board on the Leaderboard option with its notes under the title', () => {
    renderFrame();

    expect(screen.getByTestId('contest-leaderboard-header-name')).toHaveTextContent('Masters Pool');
    expect(screen.getByTestId('contest-menu-leaderboard')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('contest-leaderboard')).toHaveTextContent('Your best: T1');
    expect(screen.getByTestId('contest-leaderboard')).toHaveTextContent('The board');
  });

  it('says nothing about settlement while the contest is live', () => {
    renderFrame();

    expect(screen.queryByTestId('contest-leaderboard-settled-note')).not.toBeInTheDocument();
  });

  it('says the standings are frozen once the contest is final', () => {
    renderFrame({ contest: { ...contest, status: ContestStatus.COMPLETED } });

    expect(screen.getByTestId('contest-leaderboard-settled-note')).toHaveTextContent('Final result: these standings are frozen at settlement.');
  });

  it('says it in the board\'s own words, or not at all where the board has a note of its own', () => {
    renderFrame({ contest: { ...contest, status: ContestStatus.COMPLETED }, settledNote: 'The winners are frozen.' });
    expect(screen.getByTestId('contest-leaderboard-settled-note')).toHaveTextContent('The winners are frozen.');
  });

  it('leaves the settled note out when the board says null', () => {
    renderFrame({ contest: { ...contest, status: ContestStatus.COMPLETED }, settledNote: null });

    expect(screen.queryByTestId('contest-leaderboard-settled-note')).not.toBeInTheDocument();
  });
});

describe('useLeaderboardFallback', () => {
  const refetch = vi.fn();
  const settled = { data: undefined, error: null, isError: false, isLoading: false, refetch };

  function fallbackFor(query: typeof settled | { data: unknown; error: Error | null; isError: boolean; isLoading: boolean; refetch: typeof refetch }) {
    const { result } = renderHook(() => useLeaderboardFallback(query, { action: 'board.load.failed', contestId: 'contest-1' }));
    if (result.current) {
      render(result.current);
    }
    return result.current;
  }

  it('shows the loading state while the board loads', () => {
    fallbackFor({ ...settled, isLoading: true });

    expect(screen.getByText('Loading contest leaderboard...')).toBeInTheDocument();
  });

  it('names a refusal by its code and explains it, with no Retry, since reading again cannot lift it', () => {
    fallbackFor({ ...settled, error: new ApiError({ error: { code: 'CONTEST_LEADERBOARD_PICKS_HIDDEN', message: 'Picks are hidden.' } }), isError: true });

    const error = screen.getByTestId('contest-leaderboard-error-CONTEST_LEADERBOARD_PICKS_HIDDEN');
    expect(error).toHaveTextContent("We couldn't load this leaderboard. Scores appear once picks are revealed.");
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('offers Retry for a coded failure that is not a refusal, such as a server error', () => {
    fallbackFor({ ...settled, error: new ApiError({ error: { code: 'INTERNAL_ERROR', message: 'Down.' } }), isError: true });

    expect(screen.getByTestId('contest-leaderboard-error-INTERNAL_ERROR')).toHaveTextContent("We couldn't load this leaderboard.");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows the plain error state for a failure without a code, whose Retry reads the board again', () => {
    fallbackFor({ ...settled, error: new Error('boom'), isError: true });

    expect(screen.getByTestId('contest-leaderboard-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('steps aside once the board is there', () => {
    expect(fallbackFor({ ...settled, data: { entries: [] } })).toBeNull();
  });
});

describe('YourBestNote', () => {
  const ranked: Row[] = [
    { entryId: 'entry-unplaced', entryName: 'Crushers 2', displayPosition: null, position: null, points: 0, squadId: 'squad-1', squadName: 'Casey Crushers' },
    { entryId: 'entry-3', entryName: 'Bandits 1', displayPosition: '1', position: 1, points: 50, squadId: 'squad-2', squadName: 'Birdie Bandits' },
    { entryId: 'entry-4', entryName: 'Crushers 1', displayPosition: 'T2', position: 2, points: 42.5, squadId: 'squad-1', squadName: 'Casey Crushers' },
    { entryId: 'entry-5', entryName: 'Crushers 3', displayPosition: '4', position: 4, points: 10, squadId: 'squad-1', squadName: 'Casey Crushers' },
  ];

  it('names the viewer\'s best placed entry, skipping one not yet placed, with its place and points', () => {
    render(<YourBestNote entries={ranked} mySquadId="squad-1" points={(row) => row.points} testId="my-best" />);

    expect(screen.getByTestId('my-best')).toHaveTextContent('Your best: T2 · Crushers 1, 42.5');
  });

  it('says nothing for a viewer without a squad or without a placed entry', () => {
    render(
      <>
        <YourBestNote entries={ranked} mySquadId={null} points={(row) => row.points} testId="no-squad" />
        <YourBestNote entries={ranked} mySquadId="squad-9" points={(row) => row.points} testId="no-entry" />
      </>,
    );

    expect(screen.queryByTestId('no-squad')).not.toBeInTheDocument();
    expect(screen.queryByTestId('no-entry')).not.toBeInTheDocument();
  });
});
