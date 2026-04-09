import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { Component as LeagueMembersPage } from './members';

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
        <LeagueMembersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LeagueMembersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the real member list and commissioner invite controls', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Members' });
    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('Jordan Lee')).toBeInTheDocument();
    expect(screen.getByText('2 members in this league')).toBeInTheDocument();
    expect(screen.getByTestId('league-members-invite-button')).toBeEnabled();
  });

  it('generates a shareable invite link from the live route', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'Members' });
    await user.click(screen.getByTestId('league-members-invite-button'));

    await waitFor(() => {
      expect(screen.getByDisplayValue(/\/join\/test-code$/)).toBeInTheDocument();
    });
    expect(screen.getByTestId('league-members-copy-invite-link')).toBeEnabled();
  });

  it('sends an email invite and clears the compose state for the commissioner', async () => {
    const user = userEvent.setup();
    let invitedEmail: string | null = null;

    server.use(
      http.post('/api/v1/leagues/:id/invitations', async ({ request }) => {
        const body = (await request.json()) as { emails: string[] };
        invitedEmail = body.emails[0] ?? null;
        return HttpResponse.json({
          sent: [
            {
              id: 'invite-1',
              inviteType: 'EMAIL',
              inviteCode: 'test-code',
              email: body.emails[0],
              status: 'PENDING',
            },
          ],
          skippedMembers: [],
          skippedDuplicates: [],
        }, { status: 201 });
      }),
    );

    renderPage();

    await screen.findByRole('heading', { name: 'Members' });
    await user.click(screen.getByTestId('league-members-invite-button'));

    await user.type(screen.getByPlaceholderText('email@example.com'), 'invitee@example.com');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(invitedEmail).toBe('invitee@example.com');
    });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('email@example.com')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  it('lets a commissioner remove a non-owner member', async () => {
    const user = userEvent.setup();
    let removedMemberId: string | null = null;

    server.use(
      http.delete('/api/v1/leagues/:id/members/:uid', ({ params }) => {
        removedMemberId = params.uid as string;
        return HttpResponse.json({ success: true });
      }),
    );

    renderPage();

    await screen.findByRole('heading', { name: 'Members' });

    await user.click(screen.getByTestId('league-member-actions-u-2'));
    await user.click(screen.getByTestId('league-member-remove-u-2'));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(removedMemberId).toBe('u-2');
    });
  });
});
