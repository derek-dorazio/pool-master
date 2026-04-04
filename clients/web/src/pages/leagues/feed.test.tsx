import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { Component as LeagueFeedPage } from './feed';

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
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LeagueFeedPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LeagueFeedPage', () => {
  it('renders the feed container with league data from MSW', async () => {
    renderPage();

    await screen.findByTestId('league-feed-page');
    expect(screen.getByRole('heading', { name: 'League Activity Feed' })).toBeInTheDocument();
    expect(await screen.findByTestId('league-feed')).toBeInTheDocument();
  });

  it('shows loading state while league data is in flight', async () => {
    server.use(
      http.get('/api/v1/leagues/:id', async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return HttpResponse.json({
          league: {
            id: 'league-1',
            name: 'Test League',
            role: 'OWNER',
            visibility: 'PRIVATE',
            memberCount: 5,
            activeContestCount: 1,
          },
        });
      }),
    );

    renderPage();

    expect(await screen.findByTestId('league-feed-loading')).toBeInTheDocument();
  });

  it('shows error state when league fetch fails', async () => {
    server.use(
      http.get('/api/v1/leagues/:id', () => {
        return HttpResponse.json({ error: 'not found' }, { status: 404 });
      }),
    );

    renderPage();

    expect(await screen.findByTestId('league-feed-error')).toBeInTheDocument();
    expect(screen.getByText('Failed to load league details.')).toBeInTheDocument();
  });

  it('passes commissioner access when league role is OWNER', async () => {
    server.use(
      http.get('/api/v1/leagues/:id', () => {
        return HttpResponse.json({
          league: {
            id: 'league-1',
            name: 'Test League',
            role: 'OWNER',
            visibility: 'PRIVATE',
            memberCount: 5,
            activeContestCount: 1,
          },
        });
      }),
    );

    renderPage();

    await screen.findByTestId('league-feed');
    expect(screen.getByTestId('league-feed-page')).toBeInTheDocument();
  });

  it('renders feed for non-commissioner member role', async () => {
    server.use(
      http.get('/api/v1/leagues/:id', () => {
        return HttpResponse.json({
          league: {
            id: 'league-1',
            name: 'Test League',
            role: 'MANAGER',
            visibility: 'PRIVATE',
            memberCount: 5,
            activeContestCount: 1,
          },
        });
      }),
    );

    renderPage();

    await screen.findByTestId('league-feed');
    expect(screen.getByTestId('league-feed-page')).toBeInTheDocument();
  });
});
