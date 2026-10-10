import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfLeagueEditPage } from './root-admin-golf-league-edit-page';
import { RootAdminGolfLeagueHomePage } from './root-admin-golf-league-home-page';
import {
  GOLF_SPORT_FIXTURE,
  affiliationFixture,
  participantFixture,
  sportEventFixture,
  sportLeagueFixture,
} from './golf-test-fixtures';

// A tour's page, /manage/golf/leagues/:leagueId (pool-master-qqs): heading and details,
// the Edit details page, the danger zone's active toggle, the roster grid (inline rank
// edit, add, remove) and the bulk-upload flow.

const {
  listSportLeaguesMock,
  listParticipantLeagueAffiliationsMock,
  updateSportLeagueMock,
  updateParticipantLeagueAffiliationRankingsMock,
  listParticipantsMock,
  listSportsMock,
  createParticipantLeagueAffiliationMock,
  deleteParticipantLeagueAffiliationMock,
  previewParticipantLeagueAffiliationUploadMock,
  applyParticipantLeagueAffiliationUploadMock,
  listEventsMock,
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
    listSportLeaguesMock: vi.fn(),
    listParticipantLeagueAffiliationsMock: vi.fn(),
    updateSportLeagueMock: vi.fn(),
    updateParticipantLeagueAffiliationRankingsMock: vi.fn(),
    listParticipantsMock: vi.fn(),
    listSportsMock: vi.fn(),
    createParticipantLeagueAffiliationMock: vi.fn(),
    deleteParticipantLeagueAffiliationMock: vi.fn(),
    previewParticipantLeagueAffiliationUploadMock: vi.fn(),
    applyParticipantLeagueAffiliationUploadMock: vi.fn(),
    listEventsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  listSportLeagues: listSportLeaguesMock,
  listParticipantLeagueAffiliations: listParticipantLeagueAffiliationsMock,
  updateSportLeague: updateSportLeagueMock,
  updateParticipantLeagueAffiliationRankings: updateParticipantLeagueAffiliationRankingsMock,
  listParticipants: listParticipantsMock,
  listSports: listSportsMock,
  createParticipantLeagueAffiliation: createParticipantLeagueAffiliationMock,
  deleteParticipantLeagueAffiliation: deleteParticipantLeagueAffiliationMock,
  previewParticipantLeagueAffiliationUpload: previewParticipantLeagueAffiliationUploadMock,
  applyParticipantLeagueAffiliationUpload: applyParticipantLeagueAffiliationUploadMock,
  listEvents: listEventsMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function league(overrides: Parameters<typeof sportLeagueFixture>[0] = {}) {
  return sportLeagueFixture({
    id: 'pga',
    currentEventYear: 2026,
    affiliationCount: 2,
    sportEventCount: 3,
    ...overrides,
  });
}

// #236: a roster entry is a ParticipantLeagueAffiliation embedding its participant.
function rosterEntry({
  participantId = 'p-rory',
  name = 'Rory McIlroy',
  ranking = 2,
}: { participantId?: string; name?: string; ranking?: number | null } = {}) {
  return affiliationFixture({
    sportLeagueId: 'pga',
    participantId,
    ranking,
    participant: participantFixture({ id: participantId, name, shortName: 'R. McIlroy', nationality: 'NIR' }),
  });
}

function seed() {
  listSportsMock.mockResolvedValue({ data: { sports: [GOLF_SPORT_FIXTURE] } });
  listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [league()] } });
  listEventsMock.mockResolvedValue({
    data: { events: [sportEventFixture({ id: 'masters-2026', eventYear: 2026, sportLeagueId: 'pga' })] },
  });
  listParticipantLeagueAffiliationsMock.mockResolvedValue({
    data: {
      affiliations: [
        rosterEntry(),
        rosterEntry({ participantId: 'p-scottie', name: 'Scottie Scheffler', ranking: 1 }),
      ],
    },
  });
}

function renderPage(leagueId = 'pga', subPath = '') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/manage/golf/leagues/${leagueId}${subPath}`]}>
        <Routes>
          <Route
            element={<RootAdminGolfLeagueHomePage />}
            path="/manage/golf/leagues/:leagueId"
          />
          <Route
            element={<RootAdminGolfLeagueEditPage />}
            path="/manage/golf/leagues/:leagueId/edit"
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

  it('pool-master-qqs, plans/147: renders tour details, its tournament calendar for the current year, and the roster grid', async () => {
    seed();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'PGA Tour', level: 1 })).toBeInTheDocument();
    expect(await screen.findByTestId('root-admin-golf-tour-tournament-row-masters-2026')).toBeInTheDocument();
    expect(listEventsMock).toHaveBeenCalledWith(expect.objectContaining({ query: { sportLeagueId: 'pga' } }));
    expect(screen.getByText('Rory McIlroy')).toBeInTheDocument();
    expect(screen.getByText('Scottie Scheffler')).toBeInTheDocument();
  });

  it('shows the tour\'s active state and counts in its heading, and its details with one Edit', async () => {
    seed();
    renderPage();

    const identity = await screen.findByTestId('root-admin-golf-league-identity');
    expect(identity).toHaveTextContent('Active');
    expect(screen.getByTestId('root-admin-golf-league-counts')).toHaveTextContent(
      `${league().affiliationCount} golfers · ${league().sportEventCount} tournaments`,
    );
    const details = screen.getByTestId('root-admin-golf-league-details');
    expect(within(details).getByText('PGA')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-league-home-edit')).toHaveAttribute(
      'href',
      '/manage/golf/leagues/pga/edit',
    );
  });

  it('saves the tour\'s name and match keyword on Edit details and returns to the tour', async () => {
    seed();
    updateSportLeagueMock.mockResolvedValue({ data: { sportLeague: league({ name: 'PGA TOUR' }) } });
    renderPage('pga', '/edit');

    const name = await screen.findByTestId('root-admin-golf-league-edit-name');
    await userEvent.clear(name);
    await userEvent.type(name, 'PGA TOUR');
    await userEvent.click(screen.getByTestId('root-admin-golf-league-edit-save'));

    await waitFor(() =>
      expect(updateSportLeagueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { sportLeagueId: 'pga' },
          body: { name: 'PGA TOUR', matchKeyword: 'PGA' },
        }),
      ),
    );
    expect(await screen.findByTestId('root-admin-golf-league-home-page')).toBeInTheDocument();
  });

  it('keeps Edit details open with the server\'s reason when saving the tour is refused', async () => {
    seed();
    updateSportLeagueMock.mockResolvedValue({
      error: { error: { code: 'CONFLICT', message: 'A tour with this name already exists.' } },
      response: { status: 409 },
    });
    renderPage('pga', '/edit');

    await userEvent.click(await screen.findByTestId('root-admin-golf-league-edit-save'));

    expect(await screen.findByText('A tour with this name already exists.')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-league-edit-page')).toBeInTheDocument();
  });

  it('returns to the tour from Edit details\' Cancel without saving', async () => {
    seed();
    renderPage('pga', '/edit');

    await userEvent.click(await screen.findByRole('link', { name: 'Cancel' }));

    expect(await screen.findByTestId('root-admin-golf-league-home-page')).toBeInTheDocument();
    expect(updateSportLeagueMock).not.toHaveBeenCalled();
  });

  it('deactivates the tour from the danger zone only after the admin confirms', async () => {
    seed();
    updateSportLeagueMock.mockResolvedValue({ data: { sportLeague: league({ isActive: false }) } });
    renderPage();

    const dangerZone = await screen.findByTestId('root-admin-golf-league-danger-zone');
    await userEvent.click(within(dangerZone).getByTestId('root-admin-golf-league-home-toggle-active'));
    expect(updateSportLeagueMock).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByTestId('root-admin-golf-league-toggle-active-confirm'));

    await waitFor(() =>
      expect(updateSportLeagueMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: { sportLeagueId: 'pga' }, body: { isActive: false } }),
      ),
    );
  });

  it('leaves the tour active when the admin cancels the deactivate confirmation', async () => {
    seed();
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-league-home-toggle-active'));
    const dialog = await screen.findByTestId('root-admin-golf-league-toggle-active-dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByTestId('root-admin-golf-league-toggle-active-dialog')).not.toBeInTheDocument(),
    );
    expect(updateSportLeagueMock).not.toHaveBeenCalled();
  });

  it('offers Activate tour for an inactive tour and shows the server\'s reason in the dialog when it is refused', async () => {
    seed();
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [league({ isActive: false })] } });
    updateSportLeagueMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'The tour store is unavailable.' } },
      response: { status: 500 },
    });
    renderPage();

    const toggle = await screen.findByTestId('root-admin-golf-league-home-toggle-active');
    expect(toggle).toHaveTextContent('Activate tour');
    await userEvent.click(toggle);
    await userEvent.click(await screen.findByTestId('root-admin-golf-league-toggle-active-confirm'));

    const dialog = screen.getByTestId('root-admin-golf-league-toggle-active-dialog');
    expect(await within(dialog).findByText('The tour store is unavailable.')).toBeInTheDocument();
  });

  it('pool-master-qqs shows a not-found state when the tour id is unknown', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [league()] } });
    listParticipantLeagueAffiliationsMock.mockResolvedValue({ data: {
      affiliations: [] } });

    renderPage('missing');

    expect(await screen.findByText('Tour not found')).toBeInTheDocument();
  });

  it('pool-master-qqs surfaces the tour load error', async () => {
    listSportLeaguesMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL', message: 'Tour index offline' } },
      response: { status: 500 },
    });
    listParticipantLeagueAffiliationsMock.mockResolvedValue({ data: {
      affiliations: [] } });

    renderPage();

    expect(await screen.findByText('Tour index offline')).toBeInTheDocument();
  });

  it('pool-master-qqs collects an inline ranking edit into a dirty bar and saves the changed row only', async () => {
    seed();
    updateParticipantLeagueAffiliationRankingsMock.mockResolvedValue({
      data: {
      affiliations: [rosterEntry({ ranking: 5 })] },
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
      expect(updateParticipantLeagueAffiliationRankingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { sportLeagueId: 'pga' },
          body: { rankings: [{ participantId: 'p-rory', ranking: 5 }] },
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
    listParticipantsMock.mockResolvedValue({
      data: {
        participants: [
          participantFixture({ id: 'p-rory', name: 'Rory McIlroy' }),
          participantFixture({ id: 'p-jon', name: 'Jon Rahm' }),
        ],
      },
    });
    createParticipantLeagueAffiliationMock.mockResolvedValue({
      data: { affiliation: rosterEntry({ participantId: 'p-jon', name: 'Jon Rahm' }) },
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

    // The picker lists the golf sport's active participants.
    expect(listParticipantsMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: { sportId: 'sport-golf', status: 'ACTIVE' } }),
    );
    await waitFor(() =>
      expect(createParticipantLeagueAffiliationMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: { sportLeagueId: 'pga' }, body: { participantId: 'p-jon' } }),
      ),
    );
  });

  it('pool-master-qqs removes a golfer behind a confirmation', async () => {
    seed();
    deleteParticipantLeagueAffiliationMock.mockResolvedValue({ data: null, response: { status: 204 } });
    renderPage();

    await userEvent.click(
      await screen.findByTestId('root-admin-golf-league-roster-remove-p-rory'),
    );
    await userEvent.click(
      screen.getByTestId('root-admin-golf-league-roster-remove-confirm'),
    );

    await waitFor(() =>
      expect(deleteParticipantLeagueAffiliationMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: { sportLeagueId: 'pga', participantId: 'p-rory' } }),
      ),
    );
  });

  it('pool-master-qqs previews then applies a roster bulk upload', async () => {
    seed();
    previewParticipantLeagueAffiliationUploadMock.mockResolvedValue({
      data: {
        rows: [
          {
            row: { playerName: 'Rory McIlroy', ranking: 2 },
            resolution: 'MATCHED',
            participantId: 'p-rory',
            participantName: 'Rory McIlroy',
          },
        ],
      },
    });
    applyParticipantLeagueAffiliationUploadMock.mockResolvedValue({
      data: {
      affiliations: [rosterEntry()] },
    });
    renderPage();

    const textarea = await screen.findByTestId('root-admin-golf-league-roster-upload-textarea');
    await userEvent.type(
      textarea,
      'externalId,playerName,ranking\n,Rory McIlroy,2',
    );
    await userEvent.click(screen.getByTestId('root-admin-golf-league-roster-upload-preview'));

    await screen.findByTestId('root-admin-golf-league-roster-upload-preview-table');
    expect(screen.getByText('MATCHED')).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId('root-admin-golf-league-roster-upload-apply')).toBeEnabled(),
    );
    await userEvent.click(screen.getByTestId('root-admin-golf-league-roster-upload-apply'));

    await waitFor(() =>
      expect(applyParticipantLeagueAffiliationUploadMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { sportLeagueId: 'pga' },
          body: { rows: [{ playerName: 'Rory McIlroy', ranking: 2 }] },
        }),
      ),
    );
  });
});
