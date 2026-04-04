import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { http, HttpResponse } from 'msw';
import { InvitePolicy } from '@poolmaster/shared/domain';
import { server } from '@/test/msw/server';
import { JoinLeagueButton, LeaveLeagueButton } from './join-leave-flow';

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  );
}

describe('JoinLeagueButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the direct join action only for open leagues', () => {
    renderWithClient(
      <JoinLeagueButton leagueId="lg-1" joinPolicy={InvitePolicy.OPEN} membershipState="none" />,
    );

    expect(screen.getByRole('button', { name: /Join League/i })).toBeEnabled();
  });

  it('disables non-open join policies with honest guidance', () => {
    renderWithClient(
      <JoinLeagueButton
        leagueId="lg-1"
        joinPolicy={InvitePolicy.COMMISSIONER_ONLY}
        membershipState="none"
      />,
    );

    expect(screen.getByRole('button', { name: /Commissioner Only/i })).toBeDisabled();
    expect(screen.getByText(/Only the commissioner can add members/i)).toBeInTheDocument();
  });

  it('joins through the real discovery route and surfaces failures inline', async () => {
    const user = userEvent.setup();
    let joinCalls = 0;

    server.use(
      http.post('/api/v1/search/discover/leagues/:leagueId/join', async ({ params }) => {
        joinCalls += 1;
        if (joinCalls === 1) {
          return HttpResponse.json(
            {
              error: 'join_not_allowed',
              message: `League ${String(params.leagueId)} is temporarily unavailable.`,
            },
            { status: 409 },
          );
        }

        return HttpResponse.json(
          {
            membership: {
              id: 'membership-1',
              leagueId: String(params.leagueId),
              userId: 'user-1',
              role: 'MANAGER',
              permissions: [],
              joinedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
          { status: 201 },
        );
      }),
    );

    renderWithClient(
      <JoinLeagueButton leagueId="lg-1" joinPolicy={InvitePolicy.OPEN} membershipState="none" />,
    );

    await user.click(screen.getByTestId('league-join-button'));

    await screen.findByTestId('league-join-error');
    expect(screen.getByTestId('league-join-error')).toHaveTextContent('temporarily unavailable');
    expect(joinCalls).toBe(1);

    await user.click(screen.getByTestId('league-join-button'));

    await waitFor(() => {
      expect(screen.queryByTestId('league-join-error')).not.toBeInTheDocument();
    });
    expect(joinCalls).toBe(2);
  });
});

describe('LeaveLeagueButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows confirmation dialog when Leave League is clicked', async () => {
    const user = userEvent.setup();

    renderWithClient(<LeaveLeagueButton leagueId="lg-1" leagueName="Weekend Warriors" />);

    await user.click(screen.getByRole('button', { name: /Leave League/i }));

    expect(screen.getByText(/Are you sure you want to leave/)).toBeInTheDocument();
    expect(screen.getByText('Weekend Warriors')).toBeInTheDocument();
  });

  it('leaves through the real API route and closes the dialog', async () => {
    const user = userEvent.setup();
    let leftLeagueId: string | null = null;

    server.use(
      http.delete('/api/v1/leagues/:id/members/me', ({ params }) => {
        leftLeagueId = String(params.id);
        return HttpResponse.json({ success: true });
      }),
    );

    renderWithClient(<LeaveLeagueButton leagueId="lg-1" leagueName="Weekend Warriors" />);

    await user.click(screen.getByRole('button', { name: /Leave League/i }));
    await user.click(screen.getByTestId('league-leave-confirm'));

    await waitFor(() => {
      expect(leftLeagueId).toBe('lg-1');
    });
    expect(screen.queryByText(/Are you sure you want to leave/)).not.toBeInTheDocument();
  });

  it('keeps the dialog open when leaving fails', async () => {
    const user = userEvent.setup();

    server.use(
      http.delete('/api/v1/leagues/:id/members/me', () =>
        HttpResponse.json(
          {
            error: 'leave_failed',
            message: 'You cannot leave this league yet.',
          },
          { status: 409 },
        ),
      ),
    );

    renderWithClient(<LeaveLeagueButton leagueId="lg-1" leagueName="Weekend Warriors" />);

    await user.click(screen.getByRole('button', { name: /Leave League/i }));
    await user.click(screen.getByTestId('league-leave-confirm'));

    await screen.findByTestId('league-leave-error');
    expect(screen.getByTestId('league-leave-error')).toHaveTextContent('cannot leave this league yet');
    expect(screen.getByText(/Are you sure you want to leave/)).toBeInTheDocument();
  });
});
