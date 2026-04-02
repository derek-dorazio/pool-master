import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
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

  it('renders settings form fields', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText('League Name')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save Changes/ })).toBeInTheDocument();
  });

  it('shows currency selector', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText('League Currency')).toBeInTheDocument();
    });
  });

  it('shows invite policy section', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Invitations')).toBeInTheDocument();
    });
    expect(screen.getByText(/Invite Only/)).toBeInTheDocument();
    expect(screen.getByText('Invite Link')).toBeInTheDocument();
  });
});
