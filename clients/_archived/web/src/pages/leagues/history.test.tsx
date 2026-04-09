import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { Component as LeagueHistoryPage } from './history';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ leagueId: 'league-1' }),
  };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LeagueHistoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LeagueHistoryPage', () => {
  it('renders season summary information from MSW', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'League History' })).toBeInTheDocument();
    expect(await screen.findByText('2026 Season')).toBeInTheDocument();
    expect(screen.getByText(/3 finished contests/i)).toBeInTheDocument();
    expect(screen.getByTestId('league-history-page')).toBeInTheDocument();
  });

  it('renders recorded champions when season accordion is expanded', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('2026 Season');
    await user.click(screen.getByRole('button', { name: /2026 Season/i }));

    expect(screen.getByText('Jordan Lee')).toBeInTheDocument();
    expect(screen.getByText('Winning entry: Fairway Finders')).toBeInTheDocument();
    expect(screen.getByText('412 pts')).toBeInTheDocument();
    expect(screen.getByText('$600')).toBeInTheDocument();
  });

  it('shows empty state when no seasons have completed', async () => {
    server.use(
      http.get('/api/v1/leagues/:id/history/seasons', () => {
        return HttpResponse.json({ seasons: [] });
      }),
    );

    renderPage();

    expect(await screen.findByTestId('league-history-empty')).toBeInTheDocument();
    expect(screen.getByText('No seasons completed yet.')).toBeInTheDocument();
  });

  it('shows error state when the history fetch fails', async () => {
    server.use(
      http.get('/api/v1/leagues/:id/history/seasons', () => {
        return HttpResponse.json({ error: 'server error' }, { status: 500 });
      }),
    );

    renderPage();

    expect(await screen.findByTestId('league-history-error')).toBeInTheDocument();
    expect(screen.getByText('Failed to load history')).toBeInTheDocument();
  });

  it('shows loading state while history data is in flight', async () => {
    server.use(
      http.get('/api/v1/leagues/:id/history/seasons', async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return HttpResponse.json({ seasons: [] });
      }),
    );

    renderPage();

    expect(await screen.findByTestId('league-history-loading')).toBeInTheDocument();
  });

  it('renders season stats in the expanded accordion', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('2026 Season');
    await user.click(screen.getByRole('button', { name: /2026 Season/i }));

    expect(screen.getByText('Members')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Prize Pool')).toBeInTheDocument();
  });

  it('shows no-champion message for season without champions', async () => {
    server.use(
      http.get('/api/v1/leagues/:id/history/seasons', () => {
        return HttpResponse.json({
          seasons: [
            {
              id: 'season-empty',
              leagueId: 'league-1',
              seasonId: 'season-empty',
              seasonName: 'Empty Season',
              sport: 'NFL',
              year: 2025,
              numMembers: 4,
              numContests: 0,
              totalPrizePool: 0,
              champions: [],
              highlights: { highestScore: 0, lowestScore: 0 },
              commissionerNote: null,
              openedAt: null,
              closedAt: null,
              createdAt: '2025-01-01T00:00:00.000Z',
              updatedAt: '2025-01-01T00:00:00.000Z',
            },
          ],
        });
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empty Season');
    await user.click(screen.getByRole('button', { name: /Empty Season/i }));

    expect(screen.getByText('No finished contest champions recorded for this season.')).toBeInTheDocument();
    expect(screen.getByText('No prize pool recorded')).toBeInTheDocument();
    expect(screen.getByText('Still open')).toBeInTheDocument();
  });
});
