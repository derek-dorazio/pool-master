import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Component as LeagueHistoryPage } from './history';
import { createTestQueryClient } from '@/test-utils';

const { mockSeasons } = vi.hoisted(() => ({
  mockSeasons: [
    {
      id: 'season-2026',
      leagueId: 'league-1',
      seasonId: 'season-2026',
      seasonName: '2026 Season',
      sport: 'GOLF',
      year: 2026,
      numMembers: 12,
      numContests: 3,
      totalPrizePool: 600,
      champions: [
        {
          contestId: 'contest-1',
          contestName: 'Masters Pick 6',
          entryId: 'entry-1',
          entryName: 'Fairway Finders',
          memberId: 'member-1',
          memberName: 'Jordan Lee',
          finalScore: 412,
          prizeWon: 300,
        },
      ],
      highlights: {
        highestScore: 412,
        lowestScore: 291,
      },
      commissionerNote: null,
      openedAt: '2026-03-20T00:00:00.000Z',
      closedAt: '2026-04-15T00:00:00.000Z',
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-04-15T00:00:00.000Z',
    },
  ],
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ leagueId: 'league-1' }),
  };
});

vi.mock('@/lib/api', () => ({
  client: {},
  getSeasonSummaries: vi.fn().mockResolvedValue({
    data: {
      seasons: mockSeasons,
    },
    error: null,
  }),
}));

function renderPage() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LeagueHistoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LeagueHistoryPage', () => {
  it('renders real season summary information', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'League History' })).toBeInTheDocument();
    expect(await screen.findByText('2026 Season')).toBeInTheDocument();
    expect(screen.getByText(/3 finished contests/i)).toBeInTheDocument();
  });

  it('renders recorded champions instead of a fake season results list', async () => {
    renderPage();

    await screen.findByText('2026 Season');
    await screen.getByRole('button', { name: /2026 Season/i }).click();

    expect(screen.getByText('Jordan Lee')).toBeInTheDocument();
    expect(screen.getByText('Winning entry: Fairway Finders')).toBeInTheDocument();
    expect(screen.getByText('412 pts')).toBeInTheDocument();
    expect(screen.getByText('$600')).toBeInTheDocument();
  });
});
