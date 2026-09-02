import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { GolfSeasonCloneAction } from './golf-season-clone-action';

// plans/124 §6.3 / §4.2a — "Clone to next year" (pool-master-pcd).

const { adminCloneGolfSeasonMock, navigateMock, mockLogger } = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return { adminCloneGolfSeasonMock: vi.fn(), navigateMock: vi.fn(), mockLogger: logger };
});

bindApiMocks({ adminCloneGolfSeason: adminCloneGolfSeasonMock });

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function season(overrides: Record<string, unknown> = {}) {
  return {
    id: 'season-2026',
    sportLeagueId: 'pga',
    name: 'PGA Tour 2026',
    year: 2026,
    startDate: '2026-01-04T00:00:00.000Z',
    endDate: '2026-11-30T00:00:00.000Z',
    isActive: true,
    createdAt: '2025-06-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
    tournamentCount: 6,
    isCurrent: false,
    ...overrides,
  };
}

function renderAction(overrides: Record<string, unknown> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<GolfSeasonCloneAction season={season(overrides)} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-pcd GolfSeasonCloneAction', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-pcd previews the count + target year, then clones and navigates to the new season Home', async () => {
    adminCloneGolfSeasonMock.mockResolvedValue({
      data: { season: { ...season({ id: 'season-2027', name: 'PGA Tour 2027', year: 2027 }) }, tournamentsCloned: 6 },
    });
    renderAction();

    await userEvent.click(screen.getByTestId('root-admin-golf-season-home-clone'));
    expect(
      screen.getByText(/6 tournaments will be copied to a new 2027 season/i),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('root-admin-golf-season-home-clone-confirm'));

    await waitFor(() =>
      expect(adminCloneGolfSeasonMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: { seasonId: 'season-2026' }, body: {} }),
      ),
    );
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/manage/golf/seasons/season-2027'),
    );
  });

  it('pool-master-pcd surfaces a SEASON_YEAR_ALREADY_EXISTS conflict with specific copy', async () => {
    adminCloneGolfSeasonMock.mockResolvedValue({
      error: { code: 'SEASON_YEAR_ALREADY_EXISTS', message: 'exists' },
      response: { status: 409 },
    });
    renderAction();

    await userEvent.click(screen.getByTestId('root-admin-golf-season-home-clone'));
    await userEvent.click(screen.getByTestId('root-admin-golf-season-home-clone-confirm'));

    expect(
      await screen.findByText('This tour already has a 2027 season.'),
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('pool-master-pcd shows the generic fallback and does not navigate on an unmapped error', async () => {
    adminCloneGolfSeasonMock.mockResolvedValue({
      error: { code: 'INTERNAL' },
      response: { status: 500 },
    });
    renderAction();

    await userEvent.click(screen.getByTestId('root-admin-golf-season-home-clone'));
    await userEvent.click(screen.getByTestId('root-admin-golf-season-home-clone-confirm'));

    expect(
      await screen.findByText('We could not clone this season.'),
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('pool-master-pcd singularises the count copy for a one-tournament season', async () => {
    renderAction({ tournamentCount: 1 });
    await userEvent.click(screen.getByTestId('root-admin-golf-season-home-clone'));
    expect(
      screen.getByText(/1 tournament will be copied to a new 2027 season/i),
    ).toBeInTheDocument();
  });
});
