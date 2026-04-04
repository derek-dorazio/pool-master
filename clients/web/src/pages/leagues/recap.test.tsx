import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { Component as RecapPage } from './recap';

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
        <RecapPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RecapPage', () => {
  it('renders standings, highlights, and upcoming events from MSW', async () => {
    renderPage();

    expect(await screen.findByTestId('league-recap-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Weekly Recap' })).toBeInTheDocument();

    expect(screen.getByText('Mar 16-22')).toBeInTheDocument();

    expect(screen.getByText('Mike T.')).toBeInTheDocument();
    expect(screen.getByText('145 pts')).toBeInTheDocument();
    expect(screen.getByText('Sarah K.')).toBeInTheDocument();
    expect(screen.getByText('132 pts')).toBeInTheDocument();
    expect(screen.getByText('John D.')).toBeInTheDocument();
    expect(screen.getByText('128 pts')).toBeInTheDocument();

    expect(screen.getByText('Highest Score')).toBeInTheDocument();
    expect(screen.getByText('Mike T. — 45 pts this week')).toBeInTheDocument();

    expect(screen.getByText('NBA Playoff Draft')).toBeInTheDocument();
    expect(screen.getByText('2 days')).toBeInTheDocument();
  });

  it('shows standings movement indicators', async () => {
    renderPage();

    await screen.findByTestId('league-recap-page');

    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });

  it('shows error state when recap fetch fails', async () => {
    server.use(
      http.get('/api/v1/social/leagues/:leagueId/recap', () => {
        return HttpResponse.json({ error: 'server error' }, { status: 500 });
      }),
    );

    renderPage();

    expect(await screen.findByTestId('league-recap-error')).toBeInTheDocument();
    expect(screen.getByText("Couldn't load recap")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows loading state while recap data is in flight', async () => {
    server.use(
      http.get('/api/v1/social/leagues/:leagueId/recap', async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return HttpResponse.json({
          weekLabel: 'Mar 16-22',
          standings: [],
          highlights: [],
          upcoming: [],
        });
      }),
    );

    renderPage();

    expect(await screen.findByTestId('league-recap-loading')).toBeInTheDocument();
  });

  it('renders the share button', async () => {
    renderPage();

    await screen.findByTestId('league-recap-page');
    expect(screen.getByRole('button', { name: /share recap/i })).toBeInTheDocument();
  });

  it('renders singular day label for 1-day upcoming event', async () => {
    server.use(
      http.get('/api/v1/social/leagues/:leagueId/recap', () => {
        return HttpResponse.json({
          weekLabel: 'Apr 1-7',
          standings: [],
          highlights: [],
          upcoming: [
            { name: 'Tomorrow Draft', dateTime: '2026-04-05T19:00:00Z', daysUntil: 1 },
          ],
        });
      }),
    );

    renderPage();

    await screen.findByTestId('league-recap-page');
    expect(screen.getByText('1 day')).toBeInTheDocument();
  });
});
