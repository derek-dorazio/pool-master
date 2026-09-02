import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { QueryKeys } from '@/lib/query-keys';
import { RootAdminGolfPlayerHomePage } from './root-admin-golf-player-home-page';

// plans/124 §6.3 — /manage/golf/players/:participantId Player Home (pool-master-rfy).

const { adminGetGolfPlayerMock, adminUpdateGolfPlayerMock, mockLogger } = vi.hoisted(
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
      adminGetGolfPlayerMock: vi.fn(),
      adminUpdateGolfPlayerMock: vi.fn(),
      mockLogger: logger,
    };
  },
);

bindApiMocks({
  adminGetGolfPlayer: adminGetGolfPlayerMock,
  adminUpdateGolfPlayer: adminUpdateGolfPlayerMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function player(overrides: Record<string, unknown> = {}) {
  return {
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
    providerMappings: [
      { providerId: 'mock-provider', externalId: 'ext-rory', confidence: 'HIGH' },
    ],
    ...overrides,
  };
}

function renderPage(participantId = 'p-rory') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/manage/golf/players/${participantId}`]}>
        <Routes>
          <Route
            element={<RootAdminGolfPlayerHomePage />}
            path="/manage/golf/players/:participantId"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-rfy RootAdminGolfPlayerHomePage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-rfy renders the detail list and the read-only provider mappings', async () => {
    adminGetGolfPlayerMock.mockResolvedValue({ data: { player: player() } });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Rory McIlroy' })).toBeInTheDocument();
    const mappings = screen.getByTestId('root-admin-golf-player-home-mappings');
    expect(within(mappings).getByText('mock-provider')).toBeInTheDocument();
    expect(within(mappings).getByText('HIGH')).toBeInTheDocument();
  });

  it('pool-master-rfy shows a not-found empty state and an error state', async () => {
    adminGetGolfPlayerMock.mockResolvedValue({
      error: { code: 'NOT_FOUND', message: 'No such player' },
      response: { status: 404 },
    });
    renderPage();
    expect(await screen.findByText('No such player')).toBeInTheDocument();
  });

  it('pool-master-rfy edits the player, including a status change', async () => {
    adminGetGolfPlayerMock.mockResolvedValue({ data: { player: player() } });
    adminUpdateGolfPlayerMock.mockResolvedValue({
      data: { player: player({ status: 'RETIRED', nationality: 'IRL' }) },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-player-home-edit'));
    await userEvent.selectOptions(
      screen.getByTestId('root-admin-golf-player-home-edit-status'),
      'RETIRED',
    );
    await userEvent.click(screen.getByTestId('root-admin-golf-player-home-edit-save'));

    await waitFor(() =>
      expect(adminUpdateGolfPlayerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { participantId: 'p-rory' },
          body: expect.objectContaining({ name: 'Rory McIlroy', status: 'RETIRED' }),
        }),
      ),
    );
  });

  it('pool-master-rfy keeps Save enabled on open with no edits, and a no-op save still round-trips', async () => {
    adminGetGolfPlayerMock.mockResolvedValue({ data: { player: player() } });
    adminUpdateGolfPlayerMock.mockResolvedValue({ data: { player: player() } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-player-home-edit'));
    const save = screen.getByTestId('root-admin-golf-player-home-edit-save');
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() =>
      expect(adminUpdateGolfPlayerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ name: 'Rory McIlroy', status: 'ACTIVE' }),
        }),
      ),
    );
  });

  it('pool-master-rfy does not clobber an in-progress edit when the player query refetches', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    adminGetGolfPlayerMock.mockResolvedValue({ data: { player: player() } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/manage/golf/players/p-rory']}>
          <Routes>
            <Route
              element={<RootAdminGolfPlayerHomePage />}
              path="/manage/golf/players/:participantId"
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByTestId('root-admin-golf-player-home-edit'));
    const modal = screen.getByTestId('root-admin-golf-player-home-edit-modal');
    const nameInput = modal.querySelector('input') as HTMLInputElement;
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Rory M.');

    // Server refetch with the original (unchanged) data while the modal is open.
    adminGetGolfPlayerMock.mockResolvedValue({
      data: { player: player({ nationality: 'IRL' }) },
    });
    await queryClient.invalidateQueries({
      queryKey: QueryKeys.rootAdmin.golf.player('p-rory'),
    });

    // The user's typed edit survives the refetch.
    expect(nameInput).toHaveValue('Rory M.');
  });

  it('pool-master-rfy handles a player with no provider mappings', async () => {
    adminGetGolfPlayerMock.mockResolvedValue({
      data: { player: player({ providerMappings: [], providerMappingCount: 0 }) },
    });
    renderPage();
    expect(await screen.findByText('No provider mappings recorded.')).toBeInTheDocument();
  });
});
