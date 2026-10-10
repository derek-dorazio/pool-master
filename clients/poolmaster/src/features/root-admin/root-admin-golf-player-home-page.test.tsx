import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { QueryKeys } from '@/lib/query-keys';
import { RootAdminGolfPlayerEditPage } from './root-admin-golf-player-edit-page';
import { RootAdminGolfPlayerHomePage } from './root-admin-golf-player-home-page';
import { participantFixture } from './golf-test-fixtures';

// A golfer's page, /manage/golf/players/:participantId, and its Edit details page (pool-master-rfy).

const { getParticipantMock, listParticipantProviderMappingsMock, updateParticipantMock, mockLogger } = vi.hoisted(
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
      getParticipantMock: vi.fn(),
      listParticipantProviderMappingsMock: vi.fn(),
      updateParticipantMock: vi.fn(),
      mockLogger: logger,
    };
  },
);

bindApiMocks({
  getParticipant: getParticipantMock,
  listParticipantProviderMappings: listParticipantProviderMappingsMock,
  updateParticipant: updateParticipantMock,
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
    firstName: 'Rory',
    lastName: 'McIlroy',
    shortName: 'R. McIlroy',
    nationality: 'NIR',
    role: '',
    teamAffiliation: '',
    externalId: 'rory-1',
    ...overrides,
  });
}

// #236: the golfer's provider mappings are their own read.
const MAPPING = {
  id: 'mapping-1',
  participantId: 'p-rory',
  providerId: 'mock-provider',
  externalId: 'ext-rory',
  confidence: 'HIGH',
  mappedAt: '2026-01-01T00:00:00.000Z',
};

function renderPage(
  path = '/manage/golf/players/p-rory',
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            element={<RootAdminGolfPlayerHomePage />}
            path="/manage/golf/players/:participantId"
          />
          <Route
            element={<RootAdminGolfPlayerEditPage />}
            path="/manage/golf/players/:participantId/edit"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-rfy RootAdminGolfPlayerHomePage', () => {
  beforeEach(() => {
    listParticipantProviderMappingsMock.mockResolvedValue({ data: { providerMappings: [MAPPING] } });
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-rfy shows the golfer\'s heading and status, the details with one Edit, and the read-only provider mappings', async () => {
    getParticipantMock.mockResolvedValue({ data: { participant: player() } });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Rory McIlroy', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-player-identity')).toHaveTextContent('ACTIVE');
    const details = screen.getByTestId('root-admin-golf-player-details');
    expect(within(details).getByText('NIR')).toBeInTheDocument();
    expect(within(details).getByText('rory-1')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-player-home-edit')).toHaveAttribute(
      'href',
      '/manage/golf/players/p-rory/edit',
    );
    const mappings = await screen.findByTestId('root-admin-golf-player-home-mappings');
    expect(within(mappings).getByText('mock-provider')).toBeInTheDocument();
    expect(within(mappings).getByText('HIGH')).toBeInTheDocument();
    expect(listParticipantProviderMappingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 'p-rory' } }),
    );
  });

  it('pool-master-rfy shows a not-found empty state and an error state', async () => {
    getParticipantMock.mockResolvedValue({
      error: { error: { code: 'NOT_FOUND', message: 'No such player' } },
      response: { status: 404 },
    });
    renderPage();
    expect(await screen.findByText('No such player')).toBeInTheDocument();
  });

  it('pool-master-rfy edits the player on its own page, including a status change, and returns to the player', async () => {
    getParticipantMock.mockResolvedValue({ data: { participant: player() } });
    updateParticipantMock.mockResolvedValue({
      data: { participant: player({ status: 'RETIRED', nationality: 'IRL' }) },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-player-home-edit'));
    await userEvent.selectOptions(
      await screen.findByTestId('root-admin-golf-player-edit-status'),
      'RETIRED',
    );
    await userEvent.click(screen.getByTestId('root-admin-golf-player-edit-save'));

    await waitFor(() =>
      expect(updateParticipantMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'p-rory' },
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric-matcher sentinel, typed any by design.
          body: expect.objectContaining({ name: 'Rory McIlroy', status: 'RETIRED' }),
        }),
      ),
    );
    expect(await screen.findByTestId('root-admin-golf-player-home-page')).toBeInTheDocument();
  });

  it('returns to the player from Edit details\' Cancel without saving', async () => {
    getParticipantMock.mockResolvedValue({ data: { participant: player() } });
    renderPage('/manage/golf/players/p-rory/edit');

    await screen.findByTestId('root-admin-golf-player-edit-page');
    await userEvent.click(screen.getByRole('link', { name: 'Cancel' }));

    expect(await screen.findByTestId('root-admin-golf-player-home-page')).toBeInTheDocument();
    expect(updateParticipantMock).not.toHaveBeenCalled();
  });

  it('keeps the Edit details page open with the server\'s reason when saving the golfer is refused', async () => {
    getParticipantMock.mockResolvedValue({ data: { participant: player() } });
    updateParticipantMock.mockResolvedValue({
      error: { error: { code: 'VALIDATION_ERROR', message: 'Short name is too long.' } },
      response: { status: 400 },
    });
    renderPage('/manage/golf/players/p-rory/edit');

    await userEvent.click(await screen.findByTestId('root-admin-golf-player-edit-save'));

    expect(await screen.findByText('Short name is too long.')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-player-edit-page')).toBeInTheDocument();
  });

  it('pool-master-rfy keeps Save enabled on open with no edits, and a no-op save still round-trips', async () => {
    getParticipantMock.mockResolvedValue({ data: { participant: player() } });
    updateParticipantMock.mockResolvedValue({ data: { participant: player() } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-player-home-edit'));
    const save = await screen.findByTestId('root-admin-golf-player-edit-save');
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() =>
      expect(updateParticipantMock).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric-matcher sentinel, typed any by design.
          body: expect.objectContaining({ name: 'Rory McIlroy', status: 'ACTIVE' }),
        }),
      ),
    );
  });

  it('pool-master-rfy does not clobber an in-progress edit when the player query refetches', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    getParticipantMock.mockResolvedValue({ data: { participant: player() } });
    renderPage('/manage/golf/players/p-rory', queryClient);

    await userEvent.click(await screen.findByTestId('root-admin-golf-player-home-edit'));
    const nameInput = await screen.findByTestId('root-admin-golf-player-edit-name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Rory M.');

    // A server refetch with changed data while the edit page is open.
    getParticipantMock.mockResolvedValue({
      data: { participant: player({ nationality: 'IRL' }) },
    });
    await queryClient.invalidateQueries({
      queryKey: QueryKeys.rootAdmin.golf.player('p-rory'),
    });

    // The user's typed edit survives the refetch.
    expect(nameInput).toHaveValue('Rory M.');
  });

  it('pool-master-rfy handles a player with no provider mappings', async () => {
    getParticipantMock.mockResolvedValue({
      data: { participant: player() },
    });
    listParticipantProviderMappingsMock.mockResolvedValue({ data: { providerMappings: [] } });
    renderPage();
    expect(await screen.findByText('No provider mappings recorded.')).toBeInTheDocument();
  });
});
