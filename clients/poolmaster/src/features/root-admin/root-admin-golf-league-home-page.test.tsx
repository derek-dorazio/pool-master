import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfLeagueHomePage } from './root-admin-golf-league-home-page';

// plans/124 §6.3 — /manage/golf/leagues/:leagueId Tour Home (pool-master-qqs):
// details edit + active toggle + roster grid (inline rank edit, add, remove) +
// bulk-upload flow.

const {
  adminListGolfLeaguesMock,
  adminGetGolfLeagueRosterMock,
  adminUpdateGolfLeagueMock,
  adminUpdateGolfLeagueRosterMock,
  adminListGolfPlayersMock,
  adminAddGolfLeagueRosterEntryMock,
  adminRemoveGolfLeagueRosterEntryMock,
  adminPreviewGolfLeagueRosterUploadMock,
  adminApplyGolfLeagueRosterUploadMock,
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
    adminListGolfLeaguesMock: vi.fn(),
    adminGetGolfLeagueRosterMock: vi.fn(),
    adminUpdateGolfLeagueMock: vi.fn(),
    adminUpdateGolfLeagueRosterMock: vi.fn(),
    adminListGolfPlayersMock: vi.fn(),
    adminAddGolfLeagueRosterEntryMock: vi.fn(),
    adminRemoveGolfLeagueRosterEntryMock: vi.fn(),
    adminPreviewGolfLeagueRosterUploadMock: vi.fn(),
    adminApplyGolfLeagueRosterUploadMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  adminListGolfLeagues: adminListGolfLeaguesMock,
  adminGetGolfLeagueRoster: adminGetGolfLeagueRosterMock,
  adminUpdateGolfLeague: adminUpdateGolfLeagueMock,
  adminUpdateGolfLeagueRoster: adminUpdateGolfLeagueRosterMock,
  adminListGolfPlayers: adminListGolfPlayersMock,
  adminAddGolfLeagueRosterEntry: adminAddGolfLeagueRosterEntryMock,
  adminRemoveGolfLeagueRosterEntry: adminRemoveGolfLeagueRosterEntryMock,
  adminPreviewGolfLeagueRosterUpload: adminPreviewGolfLeagueRosterUploadMock,
  adminApplyGolfLeagueRosterUpload: adminApplyGolfLeagueRosterUploadMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function league(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pga',
    sportId: 'sport-golf',
    name: 'PGA Tour',
    matchKeyword: 'PGA',
    currentSeasonId: 'season-2026',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rosterSize: 2,
    seasonCount: 3,
    ...overrides,
  };
}

function rosterEntry(overrides: Record<string, unknown> = {}) {
  return {
    participantId: 'p-rory',
    name: 'Rory McIlroy',
    shortName: 'R. McIlroy',
    nationality: 'NIR',
    status: 'ACTIVE',
    worldRanking: 2,
    ...overrides,
  };
}

function seed() {
  adminListGolfLeaguesMock.mockResolvedValue({ data: { leagues: [league()] } });
  adminGetGolfLeagueRosterMock.mockResolvedValue({
    data: {
      entries: [
        rosterEntry(),
        rosterEntry({ participantId: 'p-scottie', name: 'Scottie Scheffler', worldRanking: 1 }),
      ],
    },
  });
}

function renderPage(leagueId = 'pga') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/manage/golf/leagues/${leagueId}`]}>
        <Routes>
          <Route
            element={<RootAdminGolfLeagueHomePage />}
            path="/manage/golf/leagues/:leagueId"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-qqs RootAdminGolfLeagueHomePage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-qqs renders tour details, the seasons link, and the roster grid', async () => {
    seed();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'PGA Tour' })).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-league-home-seasons-link')).toHaveAttribute(
      'href',
      '/manage/golf/seasons?sportLeagueId=pga',
    );
    expect(screen.getByText('Rory McIlroy')).toBeInTheDocument();
    expect(screen.getByText('Scottie Scheffler')).toBeInTheDocument();
  });

  it('pool-master-qqs shows a not-found state when the tour id is unknown', async () => {
    adminListGolfLeaguesMock.mockResolvedValue({ data: { leagues: [league()] } });
    adminGetGolfLeagueRosterMock.mockResolvedValue({ data: { entries: [] } });

    renderPage('missing');

    expect(await screen.findByText('Tour not found')).toBeInTheDocument();
  });

  it('pool-master-qqs surfaces the tour load error', async () => {
    adminListGolfLeaguesMock.mockResolvedValue({
      error: { code: 'INTERNAL', message: 'Tour index offline' },
      response: { status: 500 },
    });
    adminGetGolfLeagueRosterMock.mockResolvedValue({ data: { entries: [] } });

    renderPage();

    expect(await screen.findByText('Tour index offline')).toBeInTheDocument();
  });

  it('pool-master-qqs collects an inline world-ranking edit into a dirty bar and saves the changed row only', async () => {
    seed();
    adminUpdateGolfLeagueRosterMock.mockResolvedValue({
      data: { entries: [rosterEntry({ worldRanking: 5 })] },
    });
    renderPage();

    const rankInput = await screen.findByTestId('root-admin-golf-league-roster-rank-p-rory');
    await userEvent.clear(rankInput);
    await userEvent.type(rankInput, '5');

    expect(
      await screen.findByTestId('root-admin-golf-league-roster-dirty-bar'),
    ).toHaveTextContent('1 unsaved');

    await userEvent.click(screen.getByTestId('root-admin-golf-league-roster-save'));

    await waitFor(() =>
      expect(adminUpdateGolfLeagueRosterMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { leagueId: 'pga' },
          body: { entries: [{ participantId: 'p-rory', worldRanking: 5 }] },
        }),
      ),
    );
  });

  it('pool-master-qqs blocks save while a ranking value is invalid', async () => {
    seed();
    renderPage();

    const rankInput = await screen.findByTestId('root-admin-golf-league-roster-rank-p-rory');
    await userEvent.clear(rankInput);
    await userEvent.type(rankInput, '0');

    expect(
      await screen.findByTestId('root-admin-golf-league-roster-dirty-bar'),
    ).toHaveTextContent('invalid');
    expect(screen.getByTestId('root-admin-golf-league-roster-save')).toBeDisabled();
  });

  it('pool-master-qqs adds a golfer via the picker, excluding roster members', async () => {
    seed();
    adminListGolfPlayersMock.mockResolvedValue({
      data: {
        players: [
          {
            id: 'p-rory',
            name: 'Rory McIlroy',
            firstName: 'Rory',
            lastName: 'McIlroy',
            shortName: 'R. McIlroy',
            nationality: 'NIR',
            position: '',
            teamAffiliation: '',
            externalId: 'rory-1',
            status: 'ACTIVE',
            providerMappingCount: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'p-jon',
            name: 'Jon Rahm',
            firstName: 'Jon',
            lastName: 'Rahm',
            shortName: 'J. Rahm',
            nationality: 'ESP',
            position: '',
            teamAffiliation: '',
            externalId: 'jon-1',
            status: 'ACTIVE',
            providerMappingCount: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    });
    adminAddGolfLeagueRosterEntryMock.mockResolvedValue({
      data: { entry: rosterEntry({ participantId: 'p-jon', name: 'Jon Rahm' }) },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-league-roster-add'));
    const modal = await screen.findByTestId('root-admin-golf-league-roster-add-modal');
    // Roster member Rory is filtered out; only Jon Rahm is offered.
    await waitFor(() =>
      expect(within(modal).getByText('Jon Rahm')).toBeInTheDocument(),
    );
    expect(within(modal).queryByText('Rory McIlroy')).not.toBeInTheDocument();

    await userEvent.click(within(modal).getByText('Jon Rahm'));
    await userEvent.click(screen.getByTestId('root-admin-golf-league-roster-add-modal-apply'));

    await waitFor(() =>
      expect(adminAddGolfLeagueRosterEntryMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: { leagueId: 'pga' }, body: { participantId: 'p-jon' } }),
      ),
    );
  });

  it('pool-master-qqs removes a golfer behind a confirmation', async () => {
    seed();
    adminRemoveGolfLeagueRosterEntryMock.mockResolvedValue({ data: null, response: { status: 204 } });
    renderPage();

    await userEvent.click(
      await screen.findByTestId('root-admin-golf-league-roster-remove-p-rory'),
    );
    await userEvent.click(
      screen.getByTestId('root-admin-golf-league-roster-remove-confirm'),
    );

    await waitFor(() =>
      expect(adminRemoveGolfLeagueRosterEntryMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: { leagueId: 'pga', participantId: 'p-rory' } }),
      ),
    );
  });

  it('pool-master-qqs previews then applies a roster bulk upload', async () => {
    seed();
    adminPreviewGolfLeagueRosterUploadMock.mockResolvedValue({
      data: {
        rows: [
          {
            row: { playerName: 'Rory McIlroy', worldRanking: 2 },
            resolution: 'MATCHED',
            participantId: 'p-rory',
            participantName: 'Rory McIlroy',
          },
        ],
      },
    });
    adminApplyGolfLeagueRosterUploadMock.mockResolvedValue({
      data: { entries: [rosterEntry()] },
    });
    renderPage();

    const textarea = await screen.findByTestId('root-admin-golf-league-roster-upload-textarea');
    await userEvent.type(
      textarea,
      'externalId,playerName,worldRanking\n,Rory McIlroy,2',
    );
    await userEvent.click(screen.getByTestId('root-admin-golf-league-roster-upload-preview'));

    await screen.findByTestId('root-admin-golf-league-roster-upload-preview-table');
    expect(screen.getByText('MATCHED')).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId('root-admin-golf-league-roster-upload-apply')).toBeEnabled(),
    );
    await userEvent.click(screen.getByTestId('root-admin-golf-league-roster-upload-apply'));

    await waitFor(() =>
      expect(adminApplyGolfLeagueRosterUploadMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { leagueId: 'pga' },
          body: { rows: [{ playerName: 'Rory McIlroy', worldRanking: 2 }] },
        }),
      ),
    );
  });
});
