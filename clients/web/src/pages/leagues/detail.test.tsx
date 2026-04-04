import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { Component as LeagueDetailPage } from './detail';

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
        <LeagueDetailPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LeagueDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the active league overview from the real API data', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Test League' });
    expect(screen.getByText('5 members')).toBeInTheDocument();
    expect(screen.getByText('Active Contests')).toBeInTheDocument();
    expect(screen.getByTestId('league-detail-settings-link')).toHaveAttribute(
      'href',
      '/leagues/league-1/settings',
    );
    expect(screen.getByTestId('league-detail-create-contest')).toHaveAttribute(
      'href',
      '/contests/create',
    );
    expect(screen.getByTestId('league-detail-invite-members')).toHaveAttribute(
      'href',
      '/leagues/league-1/members',
    );
  });

  it('shows a loading state while contest data is still in flight', async () => {
    server.use(
      http.get('/api/v1/leagues/:id/contests/', async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return HttpResponse.json({ contests: [] });
      }),
    );

    renderPage();

    await screen.findByRole('heading', { name: 'Test League' });
    await waitFor(() => {
      expect(screen.getByText('Loading contests...')).toBeInTheDocument();
    });
  });

  it('shows a loading state while member data is still in flight', async () => {
    server.use(
      http.get('/api/v1/leagues/:id/members', async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return HttpResponse.json({
          members: [
            {
              id: 'm-1',
              userId: 'u-1',
              displayName: 'Test User',
              role: 'OWNER',
            },
          ],
        });
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'Test League' });
    await user.click(screen.getByRole('tab', { name: 'Members' }));

    await waitFor(() => {
      expect(screen.getByText('Loading members...')).toBeInTheDocument();
    });
  });
});
