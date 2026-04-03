import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as ContestStandingsPage } from './standings';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ contestId: 'contest-1' }),
  };
});

vi.mock('@/features/contests/hooks/use-contest', () => ({
  useContest: () => ({
    data: {
      contest: {
        id: 'contest-1',
        name: "NFL Weekly Pick'em",
        status: 'ACTIVE',
        contestType: 'SINGLE_EVENT',
        selectionType: 'PICK_EM',
        scoringEngine: 'CUMULATIVE',
        leagueId: 'league-1',
      },
      selectionConfig: null,
    },
  }),
}));

vi.mock('@/features/contests/hooks/use-standings', () => ({
  useStandings: () => ({
    data: {
      standings: [
        {
          rank: 1,
          entryId: 'entry-1',
          entryName: 'Alpha Entry',
          ownerDisplayName: 'Alice',
          ownerId: 'user-1',
          totalScore: 50,
          previousRank: null,
          movement: 'same',
          isEliminated: false,
          lastUpdatedAt: '2026-04-03T10:00:00Z',
        },
      ],
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
  it("uses mode-aware pick'em standings labels", () => {
    render(
      <MemoryRouter>
        <ContestStandingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Pick'em Standings — NFL Weekly Pick'em")).toBeInTheDocument();
    expect(screen.getByText(/1 predictions\. saved predictions ranked by the latest standings rollup/i)).toBeInTheDocument();
    expect(screen.getByText('Prediction')).toBeInTheDocument();
    expect(screen.getByText('Prediction Score')).toBeInTheDocument();
  });
});
