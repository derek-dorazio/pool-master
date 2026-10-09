import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfPlayerListPage } from './root-admin-golf-player-list-page';
import { GOLF_SPORT_FIXTURE, participantFixture } from './golf-test-fixtures';

// plans/124 §6.3 — /manage/golf/players list (pool-master-rfy).

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

function renderPage({ sportsLoaded = true }: { sportsLoaded?: boolean } = {}) {
  // #236: golfers are the golf sport's participants, scoped by its id.
  if (sportsLoaded) {
    listSportsMock.mockResolvedValue({ data: { sports: [GOLF_SPORT_FIXTURE] } });
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RootAdminGolfPlayerListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-rfy RootAdminGolfPlayerListPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-rfy renders players with status and a row link to Player Home', async () => {
    listParticipantsMock.mockResolvedValue({
      data: {
        participants: [
          player(),
          player({ id: 'p-jon', name: 'Jon Rahm' }),
        ],
      },
    });
    renderPage();

    expect(await screen.findByText('Rory McIlroy')).toBeInTheDocument();
    expect(screen.getByText('Jon Rahm')).toBeInTheDocument();
    // #236: the mapping count column is gone; Player Home reads the mappings themselves.
    expect(screen.queryByText('Provider mappings')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-player-row-p-rory')).toBeInTheDocument();
    // Default status filter is ACTIVE.
    expect(listParticipantsMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: { sportId: 'sport-golf', status: 'ACTIVE' } }),
    );
  });

  it('pool-master-rfy re-queries when the status filter changes, so non-active golfers are reachable', async () => {
    listParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    renderPage();
    await screen.findByText('No active golf players.');

    await userEvent.selectOptions(
      screen.getByTestId('root-admin-golf-player-list-status'),
      'RETIRED',
    );

    await waitFor(() =>
      expect(listParticipantsMock).toHaveBeenCalledWith(
        expect.objectContaining({ query: { sportId: 'sport-golf', status: 'RETIRED' } }),
      ),
    );
    expect(await screen.findByText('No retired golf players.')).toBeInTheDocument();
  });

  it('pool-master-rfy shows empty and error states', async () => {
    listParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    renderPage();
    expect(
      await screen.findByText('No active golf players.'),
    ).toBeInTheDocument();
  });

  it('pool-master-rfy surfaces the load error', async () => {
    listParticipantsMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL', message: 'Player index offline' } },
      response: { status: 500 },
    });
    renderPage();
    expect(await screen.findByText('Player index offline')).toBeInTheDocument();
  });

  it('pool-master-rfy adds a player through the modal', async () => {
    listParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    createParticipantMock.mockResolvedValue({
      data: { participant: player({ id: 'new', name: 'Ludvig Åberg' }) },
    });
    renderPage();
    await screen.findByText('No active golf players.');

    await userEvent.click(screen.getByTestId('root-admin-golf-player-list-new'));
    await userEvent.type(
      screen.getByTestId('root-admin-golf-player-list-new-name'),
      'Ludvig Åberg',
    );
    await userEvent.click(screen.getByTestId('root-admin-golf-player-list-new-save'));

    await waitFor(() =>
      expect(createParticipantMock).toHaveBeenCalledWith(
        expect.objectContaining({ body: { sportId: 'sport-golf', participantType: 'INDIVIDUAL', name: 'Ludvig Åberg' } }),
      ),
    );
  });

  it('pool-master-rfy blocks submit until a name is entered', async () => {
    listParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    renderPage();
    await screen.findByText('No active golf players.');
    await userEvent.click(screen.getByTestId('root-admin-golf-player-list-new'));
    expect(screen.getByTestId('root-admin-golf-player-list-new-save')).toBeDisabled();
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
    await userEvent.click(await screen.findByTestId('root-admin-golf-player-list-new'));
    await userEvent.type(
      screen.getByTestId('root-admin-golf-player-list-new-name'),
      'Ludvig Åberg',
    );
    const save = screen.getByTestId('root-admin-golf-player-list-new-save');
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
    await userEvent.click(await screen.findByTestId('root-admin-golf-player-list-new'));
    await userEvent.type(
      screen.getByTestId('root-admin-golf-player-list-new-name'),
      'Ludvig Åberg',
    );
    // The form's own onSubmit is not gated by the modal's canSave.
    fireEvent.submit(screen.getByTestId('root-admin-golf-player-list-new-form'));

    expect(
      await screen.findByText(/golf sport is still loading\. Wait a moment and try again\./),
    ).toBeInTheDocument();
    expect(createParticipantMock).not.toHaveBeenCalled();
  });

  it('explains in the Add player modal, with save disabled, when the golf sport fails to load', async () => {
    listParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    listSportsMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL', message: 'Sport catalog offline' } },
      response: { status: 500 },
    });
    renderPage({ sportsLoaded: false });

    await userEvent.click(await screen.findByTestId('root-admin-golf-player-list-new'));
    await userEvent.type(
      screen.getByTestId('root-admin-golf-player-list-new-name'),
      'Ludvig Åberg',
    );

    // The page's player list surfaces the same error behind the modal; this is the modal's own.
    const modal = screen.getByTestId('root-admin-golf-player-list-new-modal');
    expect(await within(modal).findByText('Sport catalog offline')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-player-list-new-save')).toBeDisabled();
  });
});
