import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { Component as LeagueSettingsPage } from './settings';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ leagueId: 'league-1' }),
  };
});

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LeagueSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LeagueSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders real persisted settings controls', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test League')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Invite Policy')).toBeInTheDocument();
    expect(screen.getByLabelText('League Currency')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save Changes/ })).toBeInTheDocument();
    expect(
      screen.getByText(/League name and description are read-only here until the backend supports a real edit route/i),
    ).toBeInTheDocument();
  });

  it('generates a real invite link on demand', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Generate Invite Link/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Generate Invite Link/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue(/\/join\/test-code$/)).toBeInTheDocument();
    });
  });

  it('shows ownership transfer options for the real member list', async () => {
    const user = userEvent.setup();

    server.use(
      http.get('/api/v1/leagues/:id/members', () => HttpResponse.json({
        members: [
          { id: 'm-1', userId: 'u-1', displayName: 'Owner User', role: 'OWNER', joinedAt: new Date().toISOString() },
          { id: 'm-2', userId: 'u-2', displayName: 'Jordan Lee', role: 'MANAGER', joinedAt: new Date().toISOString() },
        ],
      })),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('New Owner')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText('New Owner'), 'u-2');

    expect(screen.getByRole('option', { name: /Jordan Lee \(MANAGER\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Transfer Ownership/i })).toBeEnabled();
  });
});
