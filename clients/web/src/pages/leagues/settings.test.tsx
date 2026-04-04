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

  it('renders the persisted settings shell from the live API response', async () => {
    renderPage();

    await screen.findByDisplayValue('Test League');
    expect(screen.getByLabelText('Invite Policy')).toBeInTheDocument();
    expect(screen.getByLabelText('League Currency')).toBeInTheDocument();
    expect(screen.getByTestId('league-settings-save-button')).toBeEnabled();
    expect(screen.getByTestId('league-settings-generate-invite-link')).toBeEnabled();
    expect(screen.getByTestId('league-settings-transfer-ownership')).toBeDisabled();
  });

  it('saves a changed league setting through the generated API client', async () => {
    const user = userEvent.setup();
    let savedBody: Record<string, unknown> | null = null;

    server.use(
      http.put('/api/v1/leagues/:id/settings', async ({ request }) => {
        savedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          league: {
            id: 'league-1',
            name: 'Test League',
            description: 'A competitive pool league.',
            visibility: 'PRIVATE',
            memberCount: 5,
            activeContestCount: 1,
            role: 'OWNER',
            createdAt: new Date().toISOString(),
            settings: {
              invitePolicy: 'COMMISSIONER_ONLY',
              allowMidSeasonJoin: true,
              requireApproval: false,
              activityFeedEnabled: true,
              weeklyRecapEnabled: false,
              weeklyRecapDay: 'MONDAY',
              timezone: 'America/New_York',
              currency: 'USD',
            },
            invitePolicy: 'COMMISSIONER_ONLY',
          },
        });
      }),
    );

    renderPage();

    await screen.findByDisplayValue('Test League');
    await user.click(screen.getByRole('switch', { name: 'Allow Mid-Season Join' }));
    await user.click(screen.getByTestId('league-settings-save-button'));

    await waitFor(() => {
      expect(savedBody).toMatchObject({
        allowMidSeasonJoin: true,
        invitePolicy: 'COMMISSIONER_ONLY',
        currency: 'USD',
      });
    });
  });

  it('generates an invite link and transfers ownership to a real member', async () => {
    const user = userEvent.setup();
    let transferredTo: string | null = null;

    server.use(
      http.post('/api/v1/leagues/:id/transfer-ownership', async ({ request }) => {
        const body = (await request.json()) as { newOwnerId: string };
        transferredTo = body.newOwnerId;
        return HttpResponse.json({
          previousOwner: {
            id: 'm-1',
            leagueId: 'league-1',
            userId: 'u-1',
            role: 'COMMISSIONER',
            permissions: [],
            joinedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          newOwner: {
            id: 'm-2',
            leagueId: 'league-1',
            userId: 'u-2',
            role: 'OWNER',
            permissions: [],
            joinedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        });
      }),
    );

    renderPage();

    await screen.findByDisplayValue('Test League');
    await user.click(screen.getByTestId('league-settings-generate-invite-link'));

    await waitFor(() => {
      expect(screen.getByDisplayValue(/\/join\/test-code$/)).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText('New Owner'), 'u-2');
    await user.click(screen.getByTestId('league-settings-transfer-ownership'));
    await user.click(screen.getByRole('button', { name: 'Transfer' }));

    await waitFor(() => {
      expect(transferredTo).toBe('u-2');
    });
  });
});
