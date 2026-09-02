import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfPlayerListPage } from './root-admin-golf-player-list-page';

// plans/124 §6.3 — /manage/golf/players list (pool-master-rfy).

const { adminListGolfPlayersMock, adminCreateGolfPlayerMock, mockLogger } = vi.hoisted(
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
      adminListGolfPlayersMock: vi.fn(),
      adminCreateGolfPlayerMock: vi.fn(),
      mockLogger: logger,
    };
  },
);

bindApiMocks({
  adminListGolfPlayers: adminListGolfPlayersMock,
  adminCreateGolfPlayer: adminCreateGolfPlayerMock,
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
    providerMappingCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

  it('pool-master-rfy renders players with status + mapping count and a row link to Player Home', async () => {
    adminListGolfPlayersMock.mockResolvedValue({
      data: {
        players: [
          player(),
          player({ id: 'p-jon', name: 'Jon Rahm', providerMappingCount: 0 }),
        ],
      },
    });
    renderPage();

    expect(await screen.findByText('Rory McIlroy')).toBeInTheDocument();
    expect(screen.getByText('Jon Rahm')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-player-row-p-rory')).toBeInTheDocument();
    // Default status filter is ACTIVE.
    expect(adminListGolfPlayersMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: { status: 'ACTIVE' } }),
    );
  });

  it('pool-master-rfy re-queries when the status filter changes, so non-active golfers are reachable', async () => {
    adminListGolfPlayersMock.mockResolvedValue({ data: { players: [] } });
    renderPage();
    await screen.findByText('No active golf players.');

    await userEvent.selectOptions(
      screen.getByTestId('root-admin-golf-player-list-status'),
      'RETIRED',
    );

    await waitFor(() =>
      expect(adminListGolfPlayersMock).toHaveBeenCalledWith(
        expect.objectContaining({ query: { status: 'RETIRED' } }),
      ),
    );
    expect(await screen.findByText('No retired golf players.')).toBeInTheDocument();
  });

  it('pool-master-rfy shows empty and error states', async () => {
    adminListGolfPlayersMock.mockResolvedValue({ data: { players: [] } });
    renderPage();
    expect(
      await screen.findByText('No active golf players.'),
    ).toBeInTheDocument();
  });

  it('pool-master-rfy surfaces the load error', async () => {
    adminListGolfPlayersMock.mockResolvedValue({
      error: { code: 'INTERNAL', message: 'Player index offline' },
      response: { status: 500 },
    });
    renderPage();
    expect(await screen.findByText('Player index offline')).toBeInTheDocument();
  });

  it('pool-master-rfy adds a player through the modal', async () => {
    adminListGolfPlayersMock.mockResolvedValue({ data: { players: [] } });
    adminCreateGolfPlayerMock.mockResolvedValue({
      data: { player: player({ id: 'new', name: 'Ludvig Åberg' }) },
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
      expect(adminCreateGolfPlayerMock).toHaveBeenCalledWith(
        expect.objectContaining({ body: { name: 'Ludvig Åberg' } }),
      ),
    );
  });

  it('pool-master-rfy blocks submit until a name is entered', async () => {
    adminListGolfPlayersMock.mockResolvedValue({ data: { players: [] } });
    renderPage();
    await screen.findByText('No active golf players.');
    await userEvent.click(screen.getByTestId('root-admin-golf-player-list-new'));
    expect(screen.getByTestId('root-admin-golf-player-list-new-save')).toBeDisabled();
  });
});
