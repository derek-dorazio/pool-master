import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfTournamentListPage } from './root-admin-golf-tournament-list-page';
import { sportEventFixture } from './golf-test-fixtures';

// plans/124 §6.3 — /manage/golf/tournaments list (pool-master-3dg).

const { listEventsMock } = vi.hoisted(() => ({
  listEventsMock: vi.fn(),
}));

bindApiMocks({ listEvents: listEventsMock });

function tournament(overrides: Parameters<typeof sportEventFixture>[0] = {}) {
  return sportEventFixture({ id: 'tour-1', ...overrides });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RootAdminGolfTournamentListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-3dg RootAdminGolfTournamentListPage', () => {
  afterEach(() => {
    listEventsMock.mockReset();
  });

  it('pool-master-3dg renders tournaments with a sync badge, derived readiness, and a create link', async () => {
    listEventsMock.mockResolvedValue({
      data: {
        events: [
          tournament(),
          tournament({
            id: 'tour-2',
            name: 'Provincial Open',
            syncScope: 'SCORES_ONLY',
            status: 'IN_PROGRESS',
            loadedParticipantCount: 120,
          }),
        ],
      },
    });

    renderPage();

    expect(await screen.findByText('Rolling Weekend Invitational')).toBeInTheDocument();
    // #236: the golf list is the shared event list, scoped to golf.
    expect(listEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: { sport: 'GOLF' } }),
    );
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.getByText('Scores synced')).toBeInTheDocument();
    // tour-1 has an empty field -> derived readiness "Setup" with a reason.
    expect(screen.getByText('Setup')).toBeInTheDocument();
    expect(screen.getByText('No field loaded')).toBeInTheDocument();
    // tour-2 is live.
    expect(screen.getByText('Live')).toBeInTheDocument();

    expect(screen.getByTestId('root-admin-golf-tournament-list-new')).toHaveAttribute(
      'href',
      '/manage/golf/tournaments/new',
    );
    expect(
      screen.getByTestId('root-admin-golf-tournament-row-tour-1'),
    ).toBeInTheDocument();
  });

  it('pool-master-3dg surfaces the load error state', async () => {
    listEventsMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL', message: 'Golf tournament index is offline' } },
      response: { status: 500 },
    });

    renderPage();

    expect(await screen.findByTestId('root-admin-golf-tournament-list-page')).toBeInTheDocument();
    expect(
      await screen.findByText('Golf tournament index is offline'),
    ).toBeInTheDocument();
  });

  it('pool-master-3dg shows the empty state when no tournaments exist', async () => {
    listEventsMock.mockResolvedValue({ data: { events: [] } });

    renderPage();

    expect(
      await screen.findByText('No golf tournaments have been created yet.'),
    ).toBeInTheDocument();
  });
});
