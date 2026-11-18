import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminParticipantCreatePage } from './root-admin-participant-create-page';
import { RootAdminParticipantListPage } from './root-admin-participant-list-page';
import { participantFixture, sportLeagueFixture } from './sport-test-fixtures';

// /manage/sports/golf/participants and its Add player page, /manage/sports/golf/participants/new
// (pool-master-rfy): one tour's golfers at a time, as a golfer belongs to one tour (#1853).

const { listSportLeaguesMock, listSportLeagueParticipantsMock, createParticipantMock, mockLogger } = vi.hoisted(
  () => {
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
      listSportLeagueParticipantsMock: vi.fn(),
      createParticipantMock: vi.fn(),
      mockLogger: logger,
    };
  },
);

bindApiMocks({
  listSportLeagues: listSportLeaguesMock,
  listSportLeagueParticipants: listSportLeagueParticipantsMock,
  createParticipant: createParticipantMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function player(overrides: Parameters<typeof participantFixture>[0] = {}) {
  return participantFixture({
    id: 'p-rory',
    name: 'Rory McIlroy',
    shortName: 'R. McIlroy',
    nationality: 'NIR',
    externalId: 'rory-1',
    sportLeagueId: 'pga',
    ranking: 2,
    ...overrides,
  });
}

const PGA = sportLeagueFixture({ id: 'pga', name: 'PGA Tour' });
const LIV = sportLeagueFixture({ id: 'liv', name: 'LIV Golf' });

function renderPage({
  path = '/manage/sports/golf/participants',
  leaguesLoaded = true,
}: { path?: string; leaguesLoaded?: boolean } = {}) {
  if (leaguesLoaded) {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [PGA, LIV] } });
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<RootAdminParticipantListPage />} path="/manage/sports/:sport/participants" />
          <Route element={<RootAdminParticipantCreatePage />} path="/manage/sports/:sport/participants/new" />
          <Route element={<div data-testid="player-home" />} path="/manage/sports/:sport/participants/:participantId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-rfy RootAdminParticipantListPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  function searchFor(term: string) {
    fireEvent.change(screen.getByTestId('root-admin-participant-list-search'), { target: { value: term } });
  }

  it('reads the first tour\'s golfers and lists its active ones with ranking and status, each row linking to the golfer', async () => {
    listSportLeagueParticipantsMock.mockResolvedValue({
      data: { participants: [player(), player({ id: 'p-old', name: 'Old Timer', status: 'RETIRED' })] },
    });
    renderPage();

    const row = await screen.findByTestId('root-admin-participant-row-p-rory');
    expect(row).toHaveTextContent('Rory McIlroy');
    expect(row).toHaveTextContent('Active');
    expect(row).not.toHaveTextContent('ACTIVE');
    expect(screen.queryByTestId('root-admin-participant-row-p-old')).not.toBeInTheDocument();
    expect(listSportLeagueParticipantsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sportLeagueId: 'pga' } }));
    const statusFilter = screen.getByTestId('root-admin-participant-list-status');
    expect(within(statusFilter).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Active',
      'Inactive',
      'Retired',
      'Suspended',
    ]);

    await userEvent.click(within(row).getByText('Rory McIlroy'));
    expect(await screen.findByTestId('player-home')).toBeInTheDocument();
  });

  it('shows another status from the same read, without asking the server again', async () => {
    listSportLeagueParticipantsMock.mockResolvedValue({
      data: { participants: [player(), player({ id: 'p-old', name: 'Old Timer', status: 'RETIRED' })] },
    });
    renderPage();
    await screen.findByTestId('root-admin-participant-row-p-rory');

    await userEvent.selectOptions(screen.getByTestId('root-admin-participant-list-status'), 'RETIRED');

    expect(await screen.findByTestId('root-admin-participant-row-p-old')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-participant-row-p-rory')).not.toBeInTheDocument();
    expect(listSportLeagueParticipantsMock).toHaveBeenCalledTimes(1);

    await userEvent.selectOptions(screen.getByTestId('root-admin-participant-list-status'), 'SUSPENDED');
    expect(await screen.findByText('No suspended golfers in this tour.')).toBeInTheDocument();
  });

  it('reads another tour\'s golfers when that tour is chosen', async () => {
    listSportLeagueParticipantsMock.mockImplementation((options: { path: { sportLeagueId: string } }) => Promise.resolve({
      data: { participants: options.path.sportLeagueId === 'liv' ? [player({ id: 'p-jon', name: 'Jon Rahm', sportLeagueId: 'liv' })] : [player()] },
    }));
    renderPage();
    await screen.findByTestId('root-admin-participant-row-p-rory');

    await userEvent.selectOptions(screen.getByTestId('root-admin-participant-list-league'), 'liv');

    expect(await screen.findByTestId('root-admin-participant-row-p-jon')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-participant-row-p-rory')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-participant-list-new')).toHaveAttribute('href', '/manage/sports/golf/participants/new?sportLeague=liv');
  });

  it('shows the load error in red with Retry above the grid when the tour\'s golfers cannot be read', async () => {
    listSportLeagueParticipantsMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL', message: 'Player index offline' } },
      response: { status: 500 },
    });
    renderPage();

    expect(await screen.findByTestId('root-admin-participant-list-error')).toHaveTextContent('Player index offline');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('narrows the tour\'s golfers with the search box and shows 25 a page', async () => {
    listSportLeagueParticipantsMock.mockResolvedValue({
      data: {
        participants: Array.from({ length: 30 }, (_, index) =>
          player({ id: `p-${index + 1}`, name: `Golfer ${String(index + 1).padStart(2, '0')}` })),
      },
    });
    renderPage();

    expect(await screen.findByText('Golfer 01')).toBeInTheDocument();
    expect(screen.getByText('Golfer 25')).toBeInTheDocument();
    expect(screen.queryByText('Golfer 26')).not.toBeInTheDocument();

    searchFor('Golfer 3');
    expect(await screen.findByText('Golfer 30')).toBeInTheDocument();
    expect(screen.queryByText('Golfer 01')).not.toBeInTheDocument();
  });

  it('opens Add player as its own page, and Cancel returns to the list without saving', async () => {
    listSportLeagueParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    renderPage();
    await screen.findByText('No active golfers in this tour.');

    await userEvent.click(screen.getByTestId('root-admin-participant-list-new'));
    expect(await screen.findByTestId('root-admin-participant-create-page')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Cancel' }));

    expect(await screen.findByTestId('root-admin-participant-list-page')).toBeInTheDocument();
    expect(createParticipantMock).not.toHaveBeenCalled();
  });

  it('shows the server\'s reason on the Add player page when adding the golfer is refused', async () => {
    createParticipantMock.mockResolvedValue({
      error: { error: { code: 'CONFLICT', message: 'A golfer with this external ID already exists.' } },
      response: { status: 409 },
    });
    renderPage({ path: '/manage/sports/golf/participants/new?sportLeague=pga' });

    await userEvent.type(
      await screen.findByTestId('root-admin-participant-list-new-name'),
      'Ludvig Åberg',
    );
    await waitFor(() => expect(screen.getByTestId('root-admin-participant-list-new-save')).toBeEnabled());
    await userEvent.click(screen.getByTestId('root-admin-participant-list-new-save'));

    expect(await screen.findByText('A golfer with this external ID already exists.')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-participant-create-page')).toBeInTheDocument();
  });

  it('pool-master-rfy adds a player to the tour the list showed and returns to the list', async () => {
    listSportLeagueParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    createParticipantMock.mockResolvedValue({
      data: { participant: player({ id: 'new', name: 'Ludvig Åberg' }) },
    });
    renderPage();
    await screen.findByText('No active golfers in this tour.');

    await userEvent.click(screen.getByTestId('root-admin-participant-list-new'));
    await waitFor(() => expect(screen.getByTestId('root-admin-participant-list-new-league')).toHaveValue('pga'));
    await userEvent.type(
      screen.getByTestId('root-admin-participant-list-new-name'),
      'Ludvig Åberg',
    );
    await userEvent.click(screen.getByTestId('root-admin-participant-list-new-save'));

    await waitFor(() =>
      expect(createParticipantMock).toHaveBeenCalledWith(
        expect.objectContaining({ body: { sportLeagueId: 'pga', participantType: 'INDIVIDUAL', name: 'Ludvig Åberg' } }),
      ),
    );
    expect(await screen.findByTestId('root-admin-participant-list-page')).toBeInTheDocument();
  });

  it('pool-master-rfy blocks submit until a tour is chosen and a name is entered', async () => {
    renderPage({ path: '/manage/sports/golf/participants/new' });

    await userEvent.type(await screen.findByTestId('root-admin-participant-list-new-name'), 'Ludvig Åberg');
    expect(screen.getByTestId('root-admin-participant-list-new-save')).toBeDisabled();

    await userEvent.selectOptions(screen.getByTestId('root-admin-participant-list-new-league'), 'liv');
    await waitFor(() => expect(screen.getByTestId('root-admin-participant-list-new-save')).toBeEnabled());
  });

  it('explains on the Add player page, with save disabled, when the sport\'s tours fail to load', async () => {
    listSportLeaguesMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL', message: 'Sport catalog offline' } },
      response: { status: 500 },
    });
    renderPage({ path: '/manage/sports/golf/participants/new', leaguesLoaded: false });

    await userEvent.type(
      await screen.findByTestId('root-admin-participant-list-new-name'),
      'Ludvig Åberg',
    );

    const page = screen.getByTestId('root-admin-participant-create-page');
    expect(await within(page).findByText('Sport catalog offline')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-participant-list-new-save')).toBeDisabled();
  });
});
