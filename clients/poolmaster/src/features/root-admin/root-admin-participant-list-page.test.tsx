import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminParticipantCreatePage } from './root-admin-participant-create-page';
import { RootAdminParticipantListPage } from './root-admin-participant-list-page';
import { GOLF_SPORT_FIXTURE, participantFixture } from './sport-test-fixtures';

// /manage/sports/golf/participants and its Add player page, /manage/sports/golf/participants/new (pool-master-rfy).

const { listParticipantsMock, listSportsMock, createParticipantMock, mockLogger } = vi.hoisted(
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
      listParticipantsMock: vi.fn(),
      listSportsMock: vi.fn(),
      createParticipantMock: vi.fn(),
      mockLogger: logger,
    };
  },
);

bindApiMocks({
  listParticipants: listParticipantsMock,
  listSports: listSportsMock,
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
    ...overrides,
  });
}

function renderPage({
  path = '/manage/sports/golf/participants',
  sportsLoaded = true,
}: { path?: string; sportsLoaded?: boolean } = {}) {
  // #236: golfers are the golf sport's participants, scoped by its id.
  if (sportsLoaded) {
    listSportsMock.mockResolvedValue({ data: { sports: [GOLF_SPORT_FIXTURE] } });
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

  it('asks for at least 3 characters and reads no golfers until they are typed', async () => {
    renderPage();

    expect(await screen.findByText('Type at least 3 characters to find a golfer.')).toBeInTheDocument();
    searchFor('Ro');
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(screen.getByText('Type at least 3 characters to find a golfer.')).toBeInTheDocument();
    expect(listParticipantsMock).not.toHaveBeenCalled();
  });

  it('pool-master-rfy sends the typed search to the server and renders the golfers it returns, with status and a row link', async () => {
    listParticipantsMock.mockResolvedValue({
      data: {
        participants: [player()],
      },
    });
    renderPage();

    searchFor('Ro');
    searchFor('Rory');

    expect(await screen.findByText('Rory McIlroy')).toBeInTheDocument();
    // #236: the mapping count column is gone; the golfer's page reads the mappings itself.
    expect(screen.queryByText('Provider mappings')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-participant-row-p-rory')).toHaveTextContent('Active');
    expect(screen.getByTestId('root-admin-participant-row-p-rory')).not.toHaveTextContent('ACTIVE');
    const statusFilter = screen.getByTestId('root-admin-participant-list-status');
    expect(within(statusFilter).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Active',
      'Inactive',
      'Retired',
      'Suspended',
    ]);
    // Default status filter is ACTIVE; the debounced term is sent once.
    expect(listParticipantsMock).toHaveBeenCalledTimes(1);
    expect(listParticipantsMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: { sportId: 'sport-golf', status: 'ACTIVE', q: 'Rory' } }),
    );
  });

  it('pool-master-rfy re-queries the search when the status filter changes, so non-active golfers are reachable', async () => {
    listParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    renderPage();
    searchFor('Rory');
    await screen.findByText('No active golfers matched the search.');

    await userEvent.selectOptions(
      screen.getByTestId('root-admin-participant-list-status'),
      'RETIRED',
    );

    await waitFor(() =>
      expect(listParticipantsMock).toHaveBeenCalledWith(
        expect.objectContaining({ query: { sportId: 'sport-golf', status: 'RETIRED', q: 'Rory' } }),
      ),
    );
    expect(await screen.findByText('No retired golfers matched the search.')).toBeInTheDocument();
  });

  it('keeps the search box and shows the load error in the grid when the search fails', async () => {
    listParticipantsMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL', message: 'Player index offline' } },
      response: { status: 500 },
    });
    renderPage();
    searchFor('Rory');

    expect(await screen.findByText('Player index offline')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-participant-list-search')).toHaveValue('Rory');
  });

  it('narrows the returned golfers with the search box and shows 25 a page', async () => {
    listParticipantsMock.mockResolvedValue({
      data: {
        participants: Array.from({ length: 30 }, (_, index) =>
          player({ id: `p-${index + 1}`, name: `Golfer ${String(index + 1).padStart(2, '0')}` })),
      },
    });
    renderPage();
    searchFor('Golfer');

    expect(await screen.findByText('Golfer 01')).toBeInTheDocument();
    expect(screen.getByText('Golfer 25')).toBeInTheDocument();
    expect(screen.queryByText('Golfer 26')).not.toBeInTheDocument();

    searchFor('Golfer 3');
    expect(await screen.findByText('Golfer 30')).toBeInTheDocument();
    expect(screen.queryByText('Golfer 01')).not.toBeInTheDocument();
  });

  it('opens Add player as its own page, and Cancel returns to the list without saving', async () => {
    listParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    renderPage();
    await screen.findByText('Type at least 3 characters to find a golfer.');

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
    renderPage({ path: '/manage/sports/golf/participants/new' });

    await userEvent.type(
      await screen.findByTestId('root-admin-participant-list-new-name'),
      'Ludvig Åberg',
    );
    await waitFor(() => expect(screen.getByTestId('root-admin-participant-list-new-save')).toBeEnabled());
    await userEvent.click(screen.getByTestId('root-admin-participant-list-new-save'));

    expect(await screen.findByText('A golfer with this external ID already exists.')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-participant-create-page')).toBeInTheDocument();
  });

  it('pool-master-rfy adds a player on the Add player page and returns to the list', async () => {
    listParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    createParticipantMock.mockResolvedValue({
      data: { participant: player({ id: 'new', name: 'Ludvig Åberg' }) },
    });
    renderPage();
    await screen.findByText('Type at least 3 characters to find a golfer.');

    await userEvent.click(screen.getByTestId('root-admin-participant-list-new'));
    await userEvent.type(
      screen.getByTestId('root-admin-participant-list-new-name'),
      'Ludvig Åberg',
    );
    await userEvent.click(screen.getByTestId('root-admin-participant-list-new-save'));

    await waitFor(() =>
      expect(createParticipantMock).toHaveBeenCalledWith(
        expect.objectContaining({ body: { sportId: 'sport-golf', participantType: 'INDIVIDUAL', name: 'Ludvig Åberg' } }),
      ),
    );
    expect(await screen.findByTestId('root-admin-participant-list-page')).toBeInTheDocument();
  });

  it('pool-master-rfy blocks submit until a name is entered', async () => {
    listParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    renderPage();
    await screen.findByText('Type at least 3 characters to find a golfer.');
    await userEvent.click(screen.getByTestId('root-admin-participant-list-new'));
    expect(screen.getByTestId('root-admin-participant-list-new-save')).toBeDisabled();
  });

  // #311: on a slow connection the golf sport query can still be in flight when the
  // admin has typed a name. A click in that window used to be thrown away client-side.
  it('keeps Add player disabled while the golf sport is loading, and enables it once the sport arrives', async () => {
    listParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    let resolveSports: (value: unknown) => void = () => {};
    listSportsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSports = resolve;
      }),
    );
    renderPage({ sportsLoaded: false });
    // The player list is scoped by the sport too, so it stays loading; the button does not.
    await userEvent.click(await screen.findByTestId('root-admin-participant-list-new'));
    await userEvent.type(
      screen.getByTestId('root-admin-participant-list-new-name'),
      'Ludvig Åberg',
    );
    const save = screen.getByTestId('root-admin-participant-list-new-save');
    expect(save).toBeDisabled();

    resolveSports({ data: { sports: [GOLF_SPORT_FIXTURE] } });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() =>
      expect(createParticipantMock).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { sportId: 'sport-golf', participantType: 'INDIVIDUAL', name: 'Ludvig Åberg' },
        }),
      ),
    );
  });

  it('refuses a form submit while the golf sport is loading with a wait-and-retry message, sending no request', async () => {
    listParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    listSportsMock.mockReturnValue(new Promise(() => {}));
    renderPage({ sportsLoaded: false });
    // The player list is scoped by the sport too, so it stays loading; the button does not.
    await userEvent.click(await screen.findByTestId('root-admin-participant-list-new'));
    await userEvent.type(
      screen.getByTestId('root-admin-participant-list-new-name'),
      'Ludvig Åberg',
    );
    // A submit by Enter is not gated by the disabled Save button.
    fireEvent.submit(screen.getByTestId('root-admin-participant-create-page'));

    expect(
      await screen.findByText(/golf sport is still loading\. Wait a moment and try again\./),
    ).toBeInTheDocument();
    expect(createParticipantMock).not.toHaveBeenCalled();
  });

  it('explains on the Add player page, with save disabled, when the golf sport fails to load', async () => {
    listParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    listSportsMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL', message: 'Sport catalog offline' } },
      response: { status: 500 },
    });
    renderPage({ sportsLoaded: false });

    await userEvent.click(await screen.findByTestId('root-admin-participant-list-new'));
    await userEvent.type(
      screen.getByTestId('root-admin-participant-list-new-name'),
      'Ludvig Åberg',
    );

    const page = screen.getByTestId('root-admin-participant-create-page');
    expect(await within(page).findByText('Sport catalog offline')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-participant-list-new-save')).toBeDisabled();
  });
});
