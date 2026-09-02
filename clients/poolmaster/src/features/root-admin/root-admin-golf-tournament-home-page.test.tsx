import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfTournamentHomePage } from './root-admin-golf-tournament-home-page';

// plans/124 §6.3 — Tournament Home: summary + workflow rail + score source + sections
// (pool-master-3dg).

const {
  adminGetGolfSeasonMock,
  adminGetGolfTournamentMock,
  adminGetGolfTournamentRoundsMock,
  adminLinkGolfTournamentScoreSourceMock,
  adminListProviderCatalogEventsMock,
  adminListProvidersMock,
  adminTransitionGolfTournamentMock,
  adminUnlinkGolfTournamentScoreSourceMock,
  adminUpdateGolfTournamentMock,
  adminUpdateGolfTournamentRoundsMock,
  mockLogger,
} = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return {
    adminGetGolfSeasonMock: vi.fn(),
    adminGetGolfTournamentMock: vi.fn(),
    adminGetGolfTournamentRoundsMock: vi.fn(),
    adminLinkGolfTournamentScoreSourceMock: vi.fn(),
    adminListProviderCatalogEventsMock: vi.fn(),
    adminListProvidersMock: vi.fn(),
    adminTransitionGolfTournamentMock: vi.fn(),
    adminUnlinkGolfTournamentScoreSourceMock: vi.fn(),
    adminUpdateGolfTournamentMock: vi.fn(),
    adminUpdateGolfTournamentRoundsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  adminGetGolfSeason: adminGetGolfSeasonMock,
  adminGetGolfTournament: adminGetGolfTournamentMock,
  adminGetGolfTournamentRounds: adminGetGolfTournamentRoundsMock,
  adminLinkGolfTournamentScoreSource: adminLinkGolfTournamentScoreSourceMock,
  adminListProviderCatalogEvents: adminListProviderCatalogEventsMock,
  adminListProviders: adminListProvidersMock,
  adminTransitionGolfTournament: adminTransitionGolfTournamentMock,
  adminUnlinkGolfTournamentScoreSource: adminUnlinkGolfTournamentScoreSourceMock,
  adminUpdateGolfTournament: adminUpdateGolfTournamentMock,
  adminUpdateGolfTournamentRounds: adminUpdateGolfTournamentRoundsMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

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
    fieldCount: 120,
    tierCount: 6,
    contestCount: 0,
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T11:00:00.000Z',
    workflow: {
      currentStatus: 'SCHEDULED',
      allowedTransitions: ['IN_PROGRESS', 'CANCELLED'],
    },
    ...overrides,
  };
}

function seedDefaults() {
  adminGetGolfTournamentMock.mockResolvedValue({ data: { tournament: tournament() } });
  adminGetGolfTournamentRoundsMock.mockResolvedValue({
    data: {
      rounds: [
        { roundNumber: 1, scheduledDate: '2026-05-07T12:00:00.000Z', scheduledEndAt: '2026-05-07T22:00:00.000Z' },
        { roundNumber: 2, scheduledDate: '2026-05-08T12:00:00.000Z', scheduledEndAt: '' },
      ],
    },
  });
  adminGetGolfSeasonMock.mockResolvedValue({
    data: { season: { id: 'season-1', name: 'PGA Tour 2026' } },
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/golf/tournaments/tour-1']}>
        <Routes>
          <Route
            element={<RootAdminGolfTournamentHomePage />}
            path="/manage/golf/tournaments/:eventId"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-3dg RootAdminGolfTournamentHomePage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-3dg renders summary, workflow rail, auto-lifecycle hint, and section links', async () => {
    seedDefaults();
    renderPage();

    expect(await screen.findByText('Rolling Weekend Invitational')).toBeInTheDocument();
    expect(await screen.findByText('PGA Tour 2026')).toBeInTheDocument();

    const rail = screen.getByTestId('root-admin-golf-tournament-workflow-rail');
    expect(within(rail).getByText('Setup')).toBeInTheDocument();
    expect(within(rail).getByText('Completed')).toBeInTheDocument();

    // SCHEDULED + autoLifecycleEnabled + round 1 in the schedule -> hint present.
    expect(
      screen.getByTestId('root-admin-golf-tournament-auto-hint'),
    ).toHaveTextContent('In Progress');

    expect(screen.getByTestId('root-admin-golf-tournament-section-field')).toHaveAttribute(
      'href',
      '/manage/golf/tournaments/tour-1/field',
    );
    expect(screen.getByTestId('root-admin-golf-tournament-section-tiers')).toHaveAttribute(
      'href',
      '/manage/golf/tournaments/tour-1/tiers',
    );
    expect(screen.getByTestId('root-admin-golf-tournament-section-scores')).toHaveAttribute(
      'href',
      '/manage/golf/tournaments/tour-1/scores',
    );
  });

  it('pool-master-3dg confirms and applies an allowed lifecycle transition', async () => {
    seedDefaults();
    adminTransitionGolfTournamentMock.mockResolvedValue({
      data: { tournament: tournament({ status: 'IN_PROGRESS' }) },
    });
    renderPage();

    fireEvent.click(
      await screen.findByTestId('root-admin-golf-tournament-transition-IN_PROGRESS'),
    );

    const modal = await screen.findByTestId('root-admin-golf-tournament-transition-modal');
    fireEvent.click(
      within(modal).getByTestId('root-admin-golf-tournament-transition-confirm'),
    );

    await waitFor(() =>
      expect(adminTransitionGolfTournamentMock).toHaveBeenCalledWith({
        path: { eventId: 'tour-1' },
        body: { toStatus: 'IN_PROGRESS' },
      }),
    );
  });

  it('pool-master-3dg opens the score-source picker for an unlinked tournament', async () => {
    seedDefaults();
    adminListProvidersMock.mockResolvedValue({
      data: { items: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'] }] },
    });
    adminListProviderCatalogEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            externalId: 'mock-weekend',
            name: 'Mock Weekend Event',
            startDate: '2026-05-07T12:00:00.000Z',
            endDate: '2026-05-10T22:00:00.000Z',
            status: 'SCHEDULED',
          },
        ],
      },
    });
    adminLinkGolfTournamentScoreSourceMock.mockResolvedValue({
      data: { tournament: tournament({ syncScope: 'SCORES_ONLY' }) },
    });
    renderPage();

    expect(
      await screen.findByText('Not linked — scores must be entered manually.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('root-admin-golf-tournament-link-open'));

    const modal = await screen.findByTestId('root-admin-golf-tournament-link-modal');
    fireEvent.click(
      await within(modal).findByTestId(
        'root-admin-golf-tournament-link-option-mock-weekend',
      ),
    );
    fireEvent.click(within(modal).getByTestId('root-admin-golf-tournament-link-modal-apply'));

    await waitFor(() =>
      expect(adminLinkGolfTournamentScoreSourceMock).toHaveBeenCalledWith({
        path: { eventId: 'tour-1' },
        body: { providerId: 'mock-contest-feed', externalId: 'mock-weekend' },
      }),
    );
  });

  it('pool-master-3dg renders a read-only notice and hides editing for a fully provider-owned tournament', async () => {
    adminGetGolfTournamentMock.mockResolvedValue({
      data: { tournament: tournament({ syncScope: 'FULL' }) },
    });
    adminGetGolfTournamentRoundsMock.mockResolvedValue({ data: { rounds: [] } });
    adminGetGolfSeasonMock.mockResolvedValue({
      data: { season: { id: 'season-1', name: 'PGA Tour 2026' } },
    });
    renderPage();

    expect(
      await screen.findByText(
        'This tournament is fully provider-owned. Setup, workflow, and score source are read-only here.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('root-admin-golf-tournament-home-edit'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('root-admin-golf-tournament-transition-IN_PROGRESS'),
    ).not.toBeInTheDocument();
  });

  it('pool-master-3dg saves edited summary details through RHF + adminUpdateGolfTournament', async () => {
    seedDefaults();
    adminUpdateGolfTournamentMock.mockResolvedValue({
      data: { tournament: tournament({ name: 'Renamed Invitational' }) },
    });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-home-edit'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-home-edit-modal');
    fireEvent.change(within(modal).getByDisplayValue('Rolling Weekend Invitational'), {
      target: { value: 'Renamed Invitational' },
    });
    fireEvent.click(
      within(modal).getByTestId('root-admin-golf-tournament-home-edit-save'),
    );

    await waitFor(() =>
      expect(adminUpdateGolfTournamentMock).toHaveBeenCalledTimes(1),
    );
    expect(adminUpdateGolfTournamentMock.mock.calls[0][0]).toMatchObject({
      path: { eventId: 'tour-1' },
      body: { name: 'Renamed Invitational', rounds: 4 },
    });
  });

  it('pool-master-3dg blocks the edit save when a required field is cleared', async () => {
    seedDefaults();
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-home-edit'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-home-edit-modal');
    fireEvent.change(within(modal).getByDisplayValue('Rolling Weekend Invitational'), {
      target: { value: '' },
    });
    fireEvent.click(
      within(modal).getByTestId('root-admin-golf-tournament-home-edit-save'),
    );

    await screen.findByText('Name is required');
    expect(adminUpdateGolfTournamentMock).not.toHaveBeenCalled();
  });

  it('pool-master-3dg confirms the manage-lifecycle-manually toggle', async () => {
    seedDefaults();
    adminUpdateGolfTournamentMock.mockResolvedValue({
      data: { tournament: tournament({ autoLifecycleEnabled: false }) },
    });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-auto-toggle'));
    fireEvent.click(
      await screen.findByTestId('root-admin-golf-tournament-auto-confirm'),
    );

    await waitFor(() =>
      expect(adminUpdateGolfTournamentMock).toHaveBeenCalledWith({
        path: { eventId: 'tour-1' },
        body: { autoLifecycleEnabled: false },
      }),
    );
  });

  it('pool-master-3dg saves an edited round schedule', async () => {
    seedDefaults();
    adminUpdateGolfTournamentRoundsMock.mockResolvedValue({
      data: { rounds: [] },
    });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-rounds-edit'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-rounds-modal');
    fireEvent.change(
      within(modal).getByTestId('root-admin-golf-tournament-round-1-date'),
      { target: { value: '2026-05-09T09:00' } },
    );
    fireEvent.click(within(modal).getByTestId('root-admin-golf-tournament-rounds-save'));

    await waitFor(() =>
      expect(adminUpdateGolfTournamentRoundsMock).toHaveBeenCalledTimes(1),
    );
    const body = adminUpdateGolfTournamentRoundsMock.mock.calls[0][0].body;
    expect(body.rounds[0]).toMatchObject({ roundNumber: 1 });
    expect(body.rounds[0].scheduledDate).toContain('2026-05-09T');
  });

  it('pool-master-3dg unlinks a linked score source after confirmation', async () => {
    adminGetGolfTournamentMock.mockResolvedValue({
      data: {
        tournament: tournament({
          syncScope: 'SCORES_ONLY',
          scoreSource: { providerId: 'mock-contest-feed', externalId: 'mock-weekend' },
        }),
      },
    });
    adminGetGolfTournamentRoundsMock.mockResolvedValue({ data: { rounds: [] } });
    adminGetGolfSeasonMock.mockResolvedValue({
      data: { season: { id: 'season-1', name: 'PGA Tour 2026' } },
    });
    adminUnlinkGolfTournamentScoreSourceMock.mockResolvedValue({
      data: { tournament: tournament({ syncScope: 'NONE' }) },
    });
    renderPage();

    fireEvent.click(
      await screen.findByTestId('root-admin-golf-tournament-unlink-open'),
    );
    fireEvent.click(
      await screen.findByTestId('root-admin-golf-tournament-unlink-confirm'),
    );

    await waitFor(() =>
      expect(adminUnlinkGolfTournamentScoreSourceMock).toHaveBeenCalledWith({
        path: { eventId: 'tour-1' },
      }),
    );
  });
});
