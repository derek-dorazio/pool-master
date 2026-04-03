import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as ContestResultsPage } from './results';

const mockToast = vi.fn();
let mockQueryResult = {
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
      {
        rank: 2,
        entryId: 'entry-2',
        entryName: 'Beta Entry',
        ownerDisplayName: 'Bob',
        ownerId: 'user-2',
        totalScore: 42,
        previousRank: null,
        movement: 'same',
        isEliminated: false,
        lastUpdatedAt: '2026-04-03T10:00:00Z',
      },
    ],
    total: 2,
    page: 1,
    pageSize: 25,
    contestId: 'contest-1',
  },
  isLoading: false,
  isError: false,
  error: null,
};

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

vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: () => mockQueryResult,
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ContestResultsPage />
    </MemoryRouter>,
  );
}

describe('ContestResultsPage', () => {
  beforeEach(() => {
    mockQueryResult = {
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
          {
            rank: 2,
            entryId: 'entry-2',
            entryName: 'Beta Entry',
            ownerDisplayName: 'Bob',
            ownerId: 'user-2',
            totalScore: 42,
            previousRank: null,
            movement: 'same',
            isEliminated: false,
            lastUpdatedAt: '2026-04-03T10:00:00Z',
          },
        ],
        total: 2,
        page: 1,
        pageSize: 25,
        contestId: 'contest-1',
      },
      isLoading: false,
      isError: false,
      error: null,
    };
  });

  it('copies the results link when native share is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
      share: undefined,
    });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Share Results/ }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(window.location.href);
    });
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Link copied',
      description: 'The contest results link is ready to share.',
    });
  });

  it("renders mode-aware pick'em result context", () => {
    renderPage();

    expect(screen.getByText("NFL Weekly Pick'em")).toBeInTheDocument();
    expect(screen.getByText("Pick'em Results")).toBeInTheDocument();
    expect(screen.getByText(/Pick'em mode/i)).toBeInTheDocument();
    expect(screen.getByText("Pick'em Standings Snapshot")).toBeInTheDocument();
    expect(screen.getByText('Prediction')).toBeInTheDocument();
    expect(screen.getByText("Pick'em Leader")).toBeInTheDocument();
  });

  it('shows the persisted winner even when only one standings entry exists', () => {
    mockQueryResult = {
      data: {
        standings: [
          {
            rank: 1,
            entryId: 'entry-1',
            entryName: 'Solo Entry',
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
    };

    renderPage();

    expect(screen.getByText("Pick'em Results")).toBeInTheDocument();
    expect(screen.getAllByText('Solo Entry')).toHaveLength(2);
    expect(screen.queryByText('Lead Over 2nd')).not.toBeInTheDocument();
    expect(screen.queryByText('Results unavailable')).not.toBeInTheDocument();
  });
});
