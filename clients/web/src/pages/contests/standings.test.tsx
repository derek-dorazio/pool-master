import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as ContestStandingsPage } from './standings';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ contestId: 'contest-1' }),
  };
});

let contestSelectionType = 'PICK_EM';
let contestName = "NFL Weekly Pick'em";

vi.mock('@/features/contests/hooks/use-contest', () => ({
  useContest: () => ({
    data: {
      contest: {
        id: 'contest-1',
        name: contestName,
        status: 'ACTIVE',
        contestType: 'SINGLE_EVENT',
        selectionType: contestSelectionType,
        scoringEngine: 'CUMULATIVE',
        leagueId: 'league-1',
      },
      selectionConfig: null,
    },
  }),
}));

const baseStandings = [
  {
    rank: 1,
    entryId: 'entry-1',
    entryName: 'Charlie Entry',
    ownerDisplayName: 'Alice',
    ownerId: 'user-1',
    totalScore: 50,
    previousRank: null,
    movement: 'same',
    isEliminated: false,
    lastUpdatedAt: '2026-04-03T10:00:00Z',
  },
  {
    rank: 2,
    entryId: 'entry-2',
    entryName: 'Alpha Entry',
    ownerDisplayName: 'Bob',
    ownerId: 'user-2',
    totalScore: 60,
    previousRank: null,
    movement: 'same',
    isEliminated: false,
    lastUpdatedAt: '2026-04-03T10:00:00Z',
  },
  {
    rank: 3,
    entryId: 'entry-3',
    entryName: 'Bravo Entry',
    ownerDisplayName: 'Cara',
    ownerId: 'user-3',
    totalScore: 70,
    previousRank: null,
    movement: 'same',
    isEliminated: false,
    lastUpdatedAt: '2026-04-03T10:00:00Z',
  },
];
let standings = [...baseStandings];

vi.mock('@/features/contests/hooks/use-standings', () => ({
  useStandings: () => ({
    data: {
      standings,
      total: 1,
      page: 1,
      pageSize: 25,
      contestId: 'contest-1',
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

describe('ContestStandingsPage', () => {
  beforeEach(() => {
    contestSelectionType = 'PICK_EM';
    contestName = "NFL Weekly Pick'em";
    standings = [...baseStandings];
  });

  it("uses mode-aware pick'em standings labels", () => {
    render(
      <MemoryRouter>
        <ContestStandingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Pick'em Standings — NFL Weekly Pick'em")).toBeInTheDocument();
    expect(screen.getByText(/1 prediction\. saved predictions ranked by the latest standings rollup/i)).toBeInTheDocument();
    expect(screen.getByText('Prediction')).toBeInTheDocument();
    expect(screen.getByText('Prediction Score')).toBeInTheDocument();
  });

  it("uses mode-aware bracket standings labels", () => {
    contestSelectionType = 'BRACKET_PICK_EM';
    contestName = 'March Madness Bracket';

    render(
      <MemoryRouter>
        <ContestStandingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Bracket Pick'em Standings — March Madness Bracket")).toBeInTheDocument();
    expect(screen.getByText(/1 bracket\. saved bracket predictions ranked by the latest standings rollup/i)).toBeInTheDocument();
    expect(screen.getByText('Bracket')).toBeInTheDocument();
    expect(screen.getByText('Bracket Score')).toBeInTheDocument();
  });

  it('sorts standings rows by entry name and total score when the headers are clicked', () => {
    contestSelectionType = 'SNAKE_DRAFT';
    contestName = 'Masters Pool';

    render(
      <MemoryRouter>
        <ContestStandingsPage />
      </MemoryRouter>,
    );

    const getRenderedEntries = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.querySelector('td:nth-child(3)')?.textContent?.trim());

    expect(getRenderedEntries()).toEqual(['Charlie Entry', 'Alpha Entry', 'Bravo Entry']);

    fireEvent.click(screen.getByRole('columnheader', { name: /Entry/ }));
    expect(getRenderedEntries()).toEqual(['Charlie Entry', 'Bravo Entry', 'Alpha Entry']);

    fireEvent.click(screen.getByRole('columnheader', { name: /Entry/ }));
    expect(getRenderedEntries()).toEqual(['Alpha Entry', 'Bravo Entry', 'Charlie Entry']);

    fireEvent.click(screen.getByRole('columnheader', { name: 'Total' }));
    expect(getRenderedEntries()).toEqual(['Bravo Entry', 'Alpha Entry', 'Charlie Entry']);
  });
});
