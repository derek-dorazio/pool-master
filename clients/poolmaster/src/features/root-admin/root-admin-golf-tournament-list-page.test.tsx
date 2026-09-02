import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfTournamentListPage } from './root-admin-golf-tournament-list-page';

// plans/124 §6.3 — /manage/golf/tournaments list (pool-master-3dg).

const { adminListGolfTournamentsMock } = vi.hoisted(() => ({
  adminListGolfTournamentsMock: vi.fn(),
}));

bindApiMocks({ adminListGolfTournaments: adminListGolfTournamentsMock });

function tournament(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tour-1',
    name: 'Rolling Weekend Invitational',
    venue: 'Mock Golf Club',
    location: 'Augusta, GA',
    startDate: '2026-05-07T12:00:00.000Z',
    endDate: '2026-05-10T22:00:00.000Z',
    status: 'SCHEDULED',
    rounds: 4,
    releaseAt: '2026-04-23T12:00:00.000Z',
    fieldLocksAt: '2026-05-06T16:00:00.000Z',
    fieldLocked: false,
    seasonId: 'season-1',
    leagueEventId: '',
    source: 'MANUAL',
    syncScope: 'NONE',
    scoreSource: { providerId: '', externalId: '' },
    autoLifecycleEnabled: true,
    fieldCount: 0,
    tierCount: 6,
    contestCount: 0,
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T11:00:00.000Z',
    ...overrides,
  };
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
    adminListGolfTournamentsMock.mockReset();
  });

  it('pool-master-3dg renders tournaments with a sync badge, derived readiness, and a create link', async () => {
    adminListGolfTournamentsMock.mockResolvedValue({
      data: {
        tournaments: [
          tournament(),
          tournament({
            id: 'tour-2',
            name: 'Provincial Open',
            syncScope: 'SCORES_ONLY',
            status: 'IN_PROGRESS',
            fieldCount: 120,
          }),
        ],
      },
    });

    renderPage();

    expect(await screen.findByText('Rolling Weekend Invitational')).toBeInTheDocument();
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
    adminListGolfTournamentsMock.mockResolvedValue({
      error: { code: 'INTERNAL', message: 'Golf tournament index is offline' },
      response: { status: 500 },
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('root-admin-golf-tournament-list-page')).toBeInTheDocument(),
    );
    expect(
      await screen.findByText('Golf tournament index is offline'),
    ).toBeInTheDocument();
  });

  it('pool-master-3dg shows the empty state when no tournaments exist', async () => {
    adminListGolfTournamentsMock.mockResolvedValue({ data: { tournaments: [] } });

    renderPage();

    expect(
      await screen.findByText('No golf tournaments have been created yet.'),
    ).toBeInTheDocument();
  });
});
