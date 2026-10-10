import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
      <MemoryRouter initialEntries={['/manage/golf/tournaments']}>
        <Routes>
          <Route element={<RootAdminGolfTournamentListPage />} path="/manage/golf/tournaments" />
          <Route element={<div data-testid="golf-players-list" />} path="/manage/golf/players" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-3dg RootAdminGolfTournamentListPage', () => {
  afterEach(() => {
    listEventsMock.mockReset();
  });

  it('marks Tournaments in the golf sub-menu and moves to the Players list from it', async () => {
    listEventsMock.mockResolvedValue({ data: { events: [] } });
    renderPage();

    const menu = await screen.findByRole('navigation', { name: 'Golf lists' });
    expect(within(menu).getByRole('radio', { name: 'Tournaments' })).toBeChecked();
    expect(within(menu).getByRole('radio', { name: 'Tours' })).not.toBeChecked();
    fireEvent.click(within(menu).getByRole('radio', { name: 'Players' }));

    expect(await screen.findByTestId('golf-players-list')).toBeInTheDocument();
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

  it('narrows the tournament list to matching names from the search box', async () => {
    listEventsMock.mockResolvedValue({
      data: {
        events: [
          tournament({ id: 'tour-1', name: 'Masters Tournament' }),
          tournament({ id: 'tour-2', name: 'Open Championship' }),
        ],
      },
    });

    renderPage();

    await screen.findByTestId('root-admin-golf-tournament-row-tour-1');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a tournament' }), {
      target: { value: 'Open' },
    });

    expect(screen.queryByTestId('root-admin-golf-tournament-row-tour-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-tournament-row-tour-2')).toBeInTheDocument();
  });

  it('shows 25 tournaments a page and pages on to the rest', async () => {
    listEventsMock.mockResolvedValue({
      data: {
        events: Array.from({ length: 30 }, (_, index) =>
          tournament({ id: `tour-${String(index + 1)}`, name: `Event ${String(index + 1).padStart(2, '0')}` }),
        ),
      },
    });

    renderPage();

    await screen.findByTestId('root-admin-golf-tournament-row-tour-1');
    expect(screen.queryByTestId('root-admin-golf-tournament-row-tour-26')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(await screen.findByTestId('root-admin-golf-tournament-row-tour-26')).toBeInTheDocument();
  });
});
