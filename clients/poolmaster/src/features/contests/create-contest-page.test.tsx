import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateContestPage } from './create-contest-page';

const createManagedContestMock = vi.fn();
const deleteContestMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const getManagedContestMock = vi.fn();
const listEventsMock = vi.fn();
const updateContestMock = vi.fn();
const updateManagedContestConfigurationMock = vi.fn();

vi.mock('@/lib/api', () => ({
  createManagedContest: (...args: unknown[]) => createManagedContestMock(...args),
  deleteContest: (...args: unknown[]) => deleteContestMock(...args),
  getLeagueByCode: (...args: unknown[]) => getLeagueByCodeMock(...args),
  getManagedContest: (...args: unknown[]) => getManagedContestMock(...args),
  listEvents: (...args: unknown[]) => listEventsMock(...args),
  updateContest: (...args: unknown[]) => updateContestMock(...args),
  updateManagedContestConfiguration: (...args: unknown[]) =>
    updateManagedContestConfigurationMock(...args),
}));

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    isRootAdmin: false,
    user: {
      id: 'user-1',
      email: 'commissioner@example.com',
      username: 'commissioner@example.com',
      firstName: 'Casey',
      lastName: 'Commissioner',
      isActive: true,
      isRootAdmin: false,
      createdAt: '2026-04-15T00:00:00.000Z',
    },
    clearSession: vi.fn(),
  }),
}));

function renderCreateContestPage() {
  return renderContestPage('/league/BIGDAWGS/contests/new');
}

function renderContestPage(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<CreateContestPage />} path="/league/:leagueCode/contests/new" />
          <Route element={<CreateContestPage />} path="/league/:leagueCode/contests/:contestId/manage" />
          <Route element={<div data-testid="contest-detail-page" />} path="/contests/:contestId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function primeCommonMocks() {
  getLeagueByCodeMock.mockResolvedValue({
    data: {
      league: {
        id: 'league-1',
        leagueCode: 'BIGDAWGS',
        name: 'Big Dawgs',
        description: 'A test league',
        isActive: true,
        iconKey: 'TROPHY',
        memberCount: 2,
        activeContestCount: 0,
        role: 'COMMISSIONER',
        joinPolicy: 'COMMISSIONER_ONLY',
        createdAt: '2026-04-15T00:00:00.000Z',
      },
    },
  });
  listEventsMock.mockResolvedValue({
    data: {
      events: [
        {
          id: 'event-1',
          sport: 'GOLF',
          name: 'Masters Tournament',
          status: 'SCHEDULED',
          startDate: '2026-04-10T12:00:00.000Z',
          fieldLocked: false,
        },
      ],
    },
  });
}

describe('CreateContestPage', () => {
  afterEach(() => {
    createManagedContestMock.mockReset();
    deleteContestMock.mockReset();
    getLeagueByCodeMock.mockReset();
    getManagedContestMock.mockReset();
    listEventsMock.mockReset();
    updateContestMock.mockReset();
    updateManagedContestConfigurationMock.mockReset();
  });

  it('submits the commissioner golf tiered contest payload', async () => {
    primeCommonMocks();
    createManagedContestMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-1',
        },
      },
    });

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    fireEvent.change(screen.getByTestId('contest-name'), {
      target: { value: 'Masters Pick 6' },
    });
    fireEvent.change(screen.getByTestId('contest-tiered-roster-size'), {
      target: { value: '6' },
    });
    fireEvent.change(screen.getByTestId('contest-tiered-counted-scores'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() =>
      expect(createManagedContestMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: expect.objectContaining({
          name: 'Masters Pick 6',
          sportEventId: 'event-1',
          contestType: 'SINGLE_EVENT',
          configuration: expect.objectContaining({
            mode: 'GOLF_TIERED',
            locksAt: '2026-04-10T11:55:00.000Z',
            rosterSize: 6,
            countedScores: 4,
            tierSource: 'ODDS',
            tierGeneration: { defaultTierSize: 10 },
            cutRule: { type: 'FIXED_SCORE', fixedScore: 80 },
            tiebreaker: { type: 'PREDICT_WINNING_SCORE' },
            tiers: expect.arrayContaining([
              expect.objectContaining({
                tierKey: 'A',
                pickCount: 1,
                startPosition: 1,
                endPosition: 10,
              }),
              expect.objectContaining({
                tierKey: 'F',
                pickCount: 1,
                startPosition: 51,
                endPosition: null,
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it('submits the commissioner golf category contest payload', async () => {
    primeCommonMocks();
    createManagedContestMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-2',
        },
      },
    });

    renderCreateContestPage();

    await screen.findByTestId('contest-mode-category');
    fireEvent.click(screen.getByTestId('contest-mode-category'));
    fireEvent.change(screen.getByTestId('contest-name'), {
      target: { value: 'Masters Categories' },
    });
    fireEvent.click(screen.getByTestId('contest-category-toggle-US_PLAYER'));
    fireEvent.click(screen.getByTestId('contest-category-toggle-INTERNATIONAL_PLAYER'));
    fireEvent.click(screen.getByTestId('contest-toggle-advanced'));
    fireEvent.change(screen.getByTestId('contest-category-fallback-score'), {
      target: { value: '82' },
    });
    fireEvent.click(screen.getByTestId('contest-max-entries-unlimited'));
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() =>
      expect(createManagedContestMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: expect.objectContaining({
          name: 'Masters Categories',
          sportEventId: 'event-1',
          contestType: 'SINGLE_EVENT',
          configuration: expect.objectContaining({
            mode: 'GOLF_CATEGORY_PICKS',
            locksAt: '2026-04-10T11:55:00.000Z',
            cutRule: { type: 'FIXED_SCORE', fixedScore: 82 },
            tiebreaker: { type: 'PREDICT_WINNING_SCORE' },
            categories: [
              { categoryKey: 'SENIOR', label: 'Senior', pickCount: 1 },
              { categoryKey: 'ROOKIE', label: 'Rookie', pickCount: 1 },
              { categoryKey: 'PREVIOUS_WINNER', label: 'Previous Winner', pickCount: 1 },
            ],
          }),
        }),
      }),
    );
  });

  it('hydrates and saves the commissioner managed golf contest payload', async () => {
    primeCommonMocks();
    getManagedContestMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-77',
          leagueId: 'league-1',
          sportEventId: 'event-1',
          name: 'Masters Pick 6',
          status: 'DRAFT',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          configuration: {
            id: 'config-77',
            contestId: 'contest-77',
            mode: 'GOLF_TIERED',
            locksAt: '2026-04-10T11:55:00.000Z',
            maxEntriesPerSquad: 2,
            rosterSize: 6,
            countedScores: 4,
            tierSource: 'ODDS',
            tierGeneration: { defaultTierSize: 10 },
            tiers: [
              { tierKey: 'A', label: 'Tier A', pickCount: 1, startPosition: 1, endPosition: 10 },
              { tierKey: 'B', label: 'Tier B', pickCount: 1, startPosition: 11, endPosition: 20 },
              { tierKey: 'C', label: 'Tier C', pickCount: 1, startPosition: 21, endPosition: 30 },
              { tierKey: 'D', label: 'Tier D', pickCount: 1, startPosition: 31, endPosition: 40 },
              { tierKey: 'E', label: 'Tier E', pickCount: 1, startPosition: 41, endPosition: 50 },
              { tierKey: 'F', label: 'Tier F', pickCount: 1, startPosition: 51, endPosition: null },
            ],
            cutRule: { type: 'FIXED_SCORE', fixedScore: 80 },
            playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
            displayScoring: 'TO_PAR',
            tiebreaker: { type: 'PREDICT_WINNING_SCORE' },
          },
        },
      },
    });
    updateContestMock.mockResolvedValue({ data: { contest: { id: 'contest-77' } } });
    updateManagedContestConfigurationMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-77',
        },
      },
    });

    renderContestPage('/league/BIGDAWGS/contests/contest-77/manage');

    expect(await screen.findByTestId('manage-contest-page')).toBeInTheDocument();
    expect(screen.getByTestId('contest-name')).toHaveValue('Masters Pick 6');
    expect(screen.getByTestId('contest-lock-preset')).toHaveValue('FIVE_MINUTES');

    fireEvent.change(screen.getByTestId('contest-name'), {
      target: { value: 'Masters Pick 6 Updated' },
    });
    fireEvent.click(screen.getByTestId('contest-toggle-advanced'));
    fireEvent.change(screen.getByTestId('contest-tiered-fallback-score'), {
      target: { value: '82' },
    });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() =>
      expect(updateContestMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-77' },
        body: expect.objectContaining({
          name: 'Masters Pick 6 Updated',
          lockAt: '2026-04-10T11:55:00.000Z',
        }),
      }),
    );

    await waitFor(() =>
      expect(updateManagedContestConfigurationMock).toHaveBeenCalledWith({
        path: { id: 'league-1', contestId: 'contest-77' },
        body: expect.objectContaining({
          mode: 'GOLF_TIERED',
          cutRule: { type: 'FIXED_SCORE', fixedScore: 82 },
        }),
      }),
    );
  });

  it('deletes a draft contest from the manage page', async () => {
    primeCommonMocks();
    getManagedContestMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-78',
          leagueId: 'league-1',
          sportEventId: 'event-1',
          name: 'Delete Me',
          status: 'DRAFT',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          configuration: {
            id: 'config-78',
            contestId: 'contest-78',
            mode: 'GOLF_CATEGORY_PICKS',
            locksAt: '2026-04-10T11:55:00.000Z',
            maxEntriesPerSquad: 1,
            categories: [{ categoryKey: 'SENIOR', label: 'Senior', pickCount: 1 }],
            cutRule: { type: 'FIXED_SCORE', fixedScore: 80 },
            playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
            displayScoring: 'TO_PAR',
            tiebreaker: { type: 'PREDICT_WINNING_SCORE' },
          },
        },
      },
    });
    deleteContestMock.mockResolvedValue({ data: undefined });

    renderContestPage('/league/BIGDAWGS/contests/contest-78/manage');

    expect(await screen.findByTestId('manage-contest-page')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('contest-delete'));

    await waitFor(() =>
      expect(deleteContestMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-78' },
      }),
    );
  });
});
