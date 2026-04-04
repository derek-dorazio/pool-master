import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { InvitePolicy } from '@poolmaster/shared/domain';
import { server } from '@/test/msw/server';
import { Component as CreateLeaguePage } from './create';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

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
        <CreateLeaguePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CreateLeaguePage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    vi.clearAllMocks();
  });

  it('submits the shared invite policy contract and routes to the new league', async () => {
    const user = userEvent.setup();
    let submittedBody: Record<string, unknown> | null = null;

    server.use(
      http.post('/api/v1/leagues/', async ({ request }) => {
        submittedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            league: {
              id: 'league-new',
              name: 'Weekend Winners',
              visibility: 'PUBLIC',
              memberCount: 1,
              activeContestCount: 0,
              createdAt: new Date().toISOString(),
            },
          },
          { status: 201 },
        );
      }),
    );

    renderPage();

    await user.type(screen.getByLabelText('League Name'), 'Weekend Winners');
    await user.click(screen.getByRole('button', { name: /next/i }));
    await user.click(
      screen.getByRole('radio', {
        name: /Open Anyone can join directly from discovery\./i,
      }),
    );
    await user.click(
      screen.getByRole('radio', {
        name: /Public League appears in search and discovery pages\./i,
      }),
    );
    await user.click(screen.getByRole('button', { name: /next/i }));
    await user.click(screen.getByTestId('league-create-submit'));

    await waitFor(() => {
      expect(submittedBody).toMatchObject({
        name: 'Weekend Winners',
        visibility: 'PUBLIC',
        settings: {
          invitePolicy: InvitePolicy.OPEN,
        },
      });
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/leagues/league-new');
    });
  });

  it('shows an inline error when league creation fails', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('/api/v1/leagues/', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json(
          {
            error: 'validation_error',
            message: 'League creation failed.',
          },
          { status: 500 },
        );
      }),
    );

    renderPage();

    await user.type(screen.getByLabelText('League Name'), 'Weekend Winners');
    await user.click(screen.getByRole('button', { name: /next/i }));
    await user.click(
      screen.getByRole('radio', {
        name: /Open Anyone can join directly from discovery\./i,
      }),
    );
    await user.click(screen.getByRole('button', { name: /next/i }));
    await user.click(screen.getByTestId('league-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('league-create-submit')).toBeDisabled();
    });

    await screen.findByTestId('league-create-error');
    expect(screen.getByTestId('league-create-error')).toHaveTextContent('League creation failed.');
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
