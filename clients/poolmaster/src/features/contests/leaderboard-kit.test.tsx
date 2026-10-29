import { render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';
import { MemoryRouter } from 'react-router';
import { ContestStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import type { ContestDto } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { entryColumn, isMySquadsEntry, placeColumn, totalColumn } from './leaderboard-columns';
import { LeaderboardFrame, ScoreboardGrid } from './leaderboard-kit';
import { useLeaderboardFallback } from './use-leaderboard-fallback';

type Row = { entryId: string; entryName: string; displayPosition: string | null; position: number | null; points: number; squadId: string; squadName: string };

const rows: Row[] = [
  { entryId: 'entry-1', entryName: 'Crushers 1', displayPosition: 'T1', position: 1, points: 42.5, squadId: 'squad-1', squadName: 'Casey Crushers' },
  { entryId: 'entry-2', entryName: 'Bandits 1', displayPosition: null, position: null, points: 0, squadId: 'squad-2', squadName: 'Birdie Bandits' },
];

function renderBoard(columns: ColumnDef<Row>[], data: Row[] = rows) {
  render(
    <MemoryRouter>
      <ScoreboardGrid columns={columns} data={data} emptyMessage="Nobody yet." rowTestIdPrefix="board-row" tableTestId="board" />
    </MemoryRouter>,
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
  it('links each entry to its page in the league and names its squad underneath', () => {
    renderBoard([entryColumn('board', { contestId: 'contest-1', leagueCode: 'BIGDAWGS', isMine: () => false })]);

    expect(screen.getByTestId('board-entry-link-entry-1')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-1/entries/entry-1');
    expect(screen.getByTestId('board-row-entry-1')).toHaveTextContent('Casey Crushers');
  });

  it('names the entry without a link while the league is unknown', () => {
    renderBoard([entryColumn('board', { contestId: 'contest-1', leagueCode: null, isMine: () => false })]);

    expect(screen.queryByTestId('board-entry-link-entry-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('board-row-entry-1')).toHaveTextContent('Crushers 1');
  });

  it('marks only the viewer\'s squad\'s entries Yours', () => {
    renderBoard([entryColumn('board', { contestId: 'contest-1', leagueCode: 'BIGDAWGS', isMine: isMySquadsEntry('squad-1') })]);

    expect(within(screen.getByTestId('board-row-entry-1')).getByText('Yours')).toBeInTheDocument();
    expect(within(screen.getByTestId('board-row-entry-2')).queryByText('Yours')).not.toBeInTheDocument();
  });

  it('marks nothing Yours for a viewer without a squad', () => {
    renderBoard([entryColumn('board', { contestId: 'contest-1', leagueCode: 'BIGDAWGS', isMine: isMySquadsEntry(null) })]);

    expect(screen.queryByText('Yours')).not.toBeInTheDocument();
  });

  it('finds an entry by its squad\'s name in the board\'s search', async () => {
    renderBoard([entryColumn('board', { contestId: 'contest-1', leagueCode: 'BIGDAWGS', isMine: () => false })]);

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
  it('says the board\'s own empty message when no entry is on it', () => {
    renderBoard([placeColumn('board')], []);

    expect(screen.getByTestId('board')).toHaveTextContent('Nobody yet.');
  });
});

const contest = { id: 'contest-1', myEntryIds: [], name: 'Masters Pool', status: ContestStatus.ACTIVE } as unknown as ContestDto;

function renderFrame(props: Partial<Parameters<typeof LeaderboardFrame>[0]> = {}) {
  render(
    <MemoryRouter>
      <LeaderboardFrame contest={contest} leagueCode="BIGDAWGS" notes={<p>Your best: T1</p>} {...props}>
        <p>The board</p>
      </LeaderboardFrame>
    </MemoryRouter>,
  );
}

describe('LeaderboardFrame', () => {
  it('frames the board on the Leaderboard option with its notes under the title', () => {
    renderFrame();

    expect(screen.getByTestId('contest-leaderboard-heading')).toHaveTextContent('Masters Pool');
    expect(screen.getByTestId('contest-menu-leaderboard')).toBeChecked();
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
  const settled = { data: undefined, error: null, isError: false, isLoading: false };

  function fallbackFor(query: typeof settled | { data: unknown; error: Error | null; isError: boolean; isLoading: boolean }) {
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

  it('names a refusal by its code, so picks-hidden reads apart from a server failure', () => {
    fallbackFor({ ...settled, error: new ApiError({ error: { code: 'CONTEST_LEADERBOARD_PICKS_HIDDEN', message: 'Picks are hidden.' } }), isError: true });

    expect(screen.getByTestId('contest-leaderboard-error-CONTEST_LEADERBOARD_PICKS_HIDDEN')).toHaveTextContent("We couldn't load this leaderboard.");
  });

  it('shows the plain error state for a failure without a code', () => {
    fallbackFor({ ...settled, error: new Error('boom'), isError: true });

    expect(screen.getByTestId('contest-leaderboard-error')).toBeInTheDocument();
  });

  it('steps aside once the board is there', () => {
    expect(fallbackFor({ ...settled, data: { entries: [] } })).toBeNull();
  });
});
