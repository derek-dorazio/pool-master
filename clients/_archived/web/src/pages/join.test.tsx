import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { Component as JoinPage } from './join';

const mockNavigate = vi.fn();
let mockIsAuthenticated = false;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: mockIsAuthenticated }),
}));

function renderJoin(initialEntry = '/join/invite-123') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/join/:inviteCode" element={<JoinPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('JoinPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockIsAuthenticated = false;
    vi.clearAllMocks();
  });

  it('renders auth CTAs for signed-out users', () => {
    renderJoin();

    expect(screen.getByRole('heading', { name: 'Join League' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Log In To Join/i })).toHaveAttribute(
      'href',
      '/login?redirectTo=%2Fjoin%2Finvite-123',
    );
    expect(screen.getByRole('link', { name: /Create Account/i })).toHaveAttribute(
      'href',
      '/register?redirectTo=%2Fjoin%2Finvite-123',
    );
  });

  it('accepts an invite once and navigates to the league', async () => {
    mockIsAuthenticated = true;
    let submittedInviteCode: string | null = null;

    server.use(
      http.post('/api/v1/invitations/accept', async ({ request }) => {
        const body = (await request.json()) as { inviteCode: string };
        submittedInviteCode = body.inviteCode;
        return HttpResponse.json(
          {
            membership: {
              id: 'membership-1',
              leagueId: 'league-1',
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

    renderJoin();

    await waitFor(() => {
      expect(submittedInviteCode).toBe('invite-123');
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/leagues/league-1');
    });

    expect(screen.getByText('Invitation accepted.')).toBeInTheDocument();
    expect(screen.queryByTestId('join-invitation-error')).not.toBeInTheDocument();
  });

  it('shows an error once and allows manual retry instead of auto-looping', async () => {
    mockIsAuthenticated = true;
    const user = userEvent.setup();
    let requestCount = 0;

    server.use(
      http.post('/api/v1/invitations/accept', async () => {
        requestCount += 1;
        if (requestCount === 1) {
          return HttpResponse.json(
            {
              error: 'invite_expired',
              message: 'This invite code has expired.',
            },
            { status: 400 },
          );
        }

        return HttpResponse.json(
          {
            membership: {
              id: 'membership-1',
              leagueId: 'league-1',
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

    renderJoin();

    await screen.findByTestId('join-invitation-error');
    expect(screen.getByTestId('join-invitation-error')).toHaveTextContent('This invite code has expired.');
    expect(requestCount).toBe(1);

    await user.click(screen.getByTestId('join-invitation-retry'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/leagues/league-1');
    });
    expect(requestCount).toBe(2);
  });
});
