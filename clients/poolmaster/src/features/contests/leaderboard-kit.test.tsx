import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';
import { MemoryRouter } from 'react-router';
import { ContestFormat, ContestStatus } from '@poolmaster/shared/domain';
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

function renderBoard(
  columns: ColumnDef<Row>[],
  data: Row[] = rows,
  { address = '/', mySquadId = null }: { address?: string; mySquadId?: string | null } = {},
) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[address]}>
        <ScoreboardGrid
          columns={columns}
          data={data}
          emptyMessage="Nobody yet."
          isMine={isMySquadsEntry(mySquadId)}
          rowTestIdPrefix="board-row"
          tableTestId="board"
        />
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
  it('sits in the shared section titled Standings, so pick\'em, bracket, survivor and squares boards share one frame', () => {
    renderBoard([placeColumn('board')]);

    const section = screen.getByRole('region', { name: 'Standings' });
    expect(within(section).getByTestId('board')).toBeInTheDocument();
    // Bare: a title and rule with no box, so the board keeps the page's full width on a phone.
    expect(section).not.toHaveClass('border');
  });

  it('lists only the viewer\'s entries, each at its real place, once My entries is turned on, and every entry again once it is off', () => {
    const board = [...rows, { ...rows[0], entryId: 'entry-3', entryName: 'Crushers 2', displayPosition: '3', position: 3 }];
    renderBoard([placeColumn('board')], board, { mySquadId: 'squad-1' });

    fireEvent.click(screen.getByTestId('contest-leaderboard-my-entries'));

    expect(screen.getByTestId('contest-leaderboard-my-entries')).toBeChecked();
    expect(screen.queryByTestId('board-row-entry-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('board-place-entry-3')).toHaveTextContent('3');

    fireEvent.click(screen.getByTestId('contest-leaderboard-my-entries'));

    expect(screen.getByTestId('board-row-entry-2')).toBeInTheDocument();
  });

  it('starts the board again from its first page when My entries is turned off from a later page of the viewer\'s entries', () => {
    const board = Array.from({ length: 60 }, (_, index) => ({
      ...rows[0],
      entryId: `entry-${String(index + 1)}`,
      entryName: `Entry ${String(index + 1)}`,
      displayPosition: String(index + 1),
      position: index + 1,
      squadId: index % 2 === 0 ? 'squad-1' : 'squad-2',
    }));
    renderBoard([placeColumn('board')], board, { address: '/?mine=1', mySquadId: 'squad-1' });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('26–30 of 30')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('contest-leaderboard-my-entries'));

    expect(screen.getByText('1–25 of 60')).toBeInTheDocument();
  });

  it('starts with My entries on when the address carries ?mine=1, so a reload keeps the filter', () => {
    renderBoard([placeColumn('board')], rows, { address: '/?mine=1', mySquadId: 'squad-1' });

    expect(screen.getByTestId('contest-leaderboard-my-entries')).toBeChecked();
    expect(screen.getByTestId('board-row-entry-1')).toBeInTheDocument();
    expect(screen.queryByTestId('board-row-entry-2')).not.toBeInTheDocument();
  });

  it('offers no My entries switch to a viewer with no entry on the board, and lists every entry even with ?mine=1', () => {
    renderBoard([placeColumn('board')], rows, { address: '/?mine=1', mySquadId: 'squad-elsewhere' });

    expect(screen.queryByTestId('contest-leaderboard-my-entries')).not.toBeInTheDocument();
    expect(screen.getByTestId('board-row-entry-2')).toBeInTheDocument();
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
  it('frames the board under the contest\'s name, with no tabs, and its notes under the title', () => {
    renderFrame();

    expect(screen.getByTestId('contest-leaderboard-header-name')).toHaveTextContent('Masters Pool');
    expect(screen.queryByTestId('contest-menu-leaderboard')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-leaderboard')).toHaveTextContent('Your best: T1');
    expect(screen.getByTestId('contest-leaderboard')).toHaveTextContent('The board');
  });

  const scheduled = { ...contest, endsAt: null, sportEvents: [], startsAt: '2026-11-20T01:15:00.000Z' };

  it('says when the first game starts while a live prediction contest has nothing scored', () => {
    renderFrame({ contest: { ...scheduled, contestFormat: ContestFormat.PREDICTION }, isUnscored: true });

    expect(screen.getByTestId('contest-leaderboard-first-start')).toHaveTextContent(/^First game /);
  });

  it('says when scoring starts on any other live contest with nothing scored', () => {
    renderFrame({ contest: { ...scheduled, contestFormat: ContestFormat.ROSTER }, isUnscored: true });

    expect(screen.getByTestId('contest-leaderboard-first-start')).toHaveTextContent(/^Scoring starts /);
  });

  it('drops the first-start chip once anything is scored', () => {
    renderFrame({ contest: scheduled });

    expect(screen.queryByTestId('contest-leaderboard-first-start')).not.toBeInTheDocument();
  });

  it('never shows the first-start chip on a final contest', () => {
    renderFrame({ contest: { ...scheduled, status: ContestStatus.COMPLETED }, isUnscored: true });

    expect(screen.queryByTestId('contest-leaderboard-first-start')).not.toBeInTheDocument();
  });

  it('says nothing about settlement while the contest is live', () => {
    renderFrame();

    expect(screen.queryByTestId('contest-leaderboard-settled-note')).not.toBeInTheDocument();
  });

  it('says the standings are frozen once the contest is final, in an (i) beside the Final chip rather than under the title', async () => {
    renderFrame({ contest: { ...contest, status: ContestStatus.COMPLETED } });

    const header = within(screen.getByTestId('contest-leaderboard-header'));
    expect(header.getByText('Final')).toBeInTheDocument();
    expect(screen.queryByText('Final result: these standings are frozen at settlement.')).not.toBeInTheDocument();
    fireEvent.click(header.getByTestId('contest-leaderboard-settled-note'));
    expect(await screen.findByTestId('contest-leaderboard-settled-note-card')).toHaveTextContent('Final result: these standings are frozen at settlement.');
  });

  it('says it in the board\'s own words', async () => {
    renderFrame({ contest: { ...contest, status: ContestStatus.COMPLETED }, settledNote: 'The winners are frozen.' });

    fireEvent.click(screen.getByTestId('contest-leaderboard-settled-note'));
    expect(await screen.findByTestId('contest-leaderboard-settled-note-card')).toHaveTextContent('The winners are frozen.');
  });

  it('opens a final board on its winners banner, with the viewer\'s finish', () => {
    renderFrame({
      contest: { ...contest, status: ContestStatus.COMPLETED },
      finalRows: [
        { entryName: 'Big Hitters', isMine: false, position: 1, score: '11 pts' },
        { entryName: 'Lakers 2', isMine: false, position: 2, score: '10 pts' },
        { entryName: 'Sharks 1', isMine: true, position: 3, score: '9 pts' },
      ],
    });

    expect(screen.getByTestId('contest-winners-winner-names')).toHaveTextContent('Big Hitters');
    expect(screen.getByTestId('contest-winners-silver')).toHaveTextContent('Lakers 2 · 10 pts');
    expect(screen.getByTestId('contest-winners-bronze')).toHaveTextContent('Sharks 1 · 9 pts');
    expect(screen.getByTestId('contest-winners-yours')).toHaveTextContent('You finished 3rd of 3');
  });

  it('shows no winners banner while the contest is live, or for a board that names no standings', () => {
    renderFrame({ finalRows: [{ entryName: 'Big Hitters', isMine: false, position: 1, score: '11 pts' }] });
    expect(screen.queryByTestId('contest-winners')).not.toBeInTheDocument();
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
