import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '@/test/msw-api';
import { WelcomePage } from './leagues-page';
import { apiSuccess, buildLeagueSummary, listLeaguesData } from './test/fixtures';

const {
  authState,
  sharedStateCalls,
} = vi.hoisted(() => ({
  authState: {
    user: {
      id: 'user-1',
      firstName: 'Derek',
      lastName: 'Dorazio',
    },
  },
  sharedStateCalls: {
    empty: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => authState,
}));

vi.mock('@/features/shared/ui/state', () => ({
  EmptyState: (props: {
    action?: ReactNode;
    body?: ReactNode;
    testId?: string;
    title?: ReactNode;
  }) => {
    sharedStateCalls.empty(props);

    return (
      <section data-testid={props.testId}>
        <div data-testid="shared-empty-state" />
        {props.title ? <h2>{props.title}</h2> : null}
        {props.body ? <p>{props.body}</p> : null}
        {props.action}
      </section>
    );
  },
  ErrorState: (props: {
    action?: ReactNode;
    body?: ReactNode;
    testId?: string;
    title?: ReactNode;
  }) => {
    sharedStateCalls.error(props);

    return (
      <section data-testid={props.testId}>
        <div data-testid="shared-error-state" />
        {props.title ? <h2>{props.title}</h2> : null}
        {props.body ? <p>{props.body}</p> : null}
        {props.action}
      </section>
    );
  },
  LoadingState: (props: {
    action?: ReactNode;
    body?: ReactNode;
    testId?: string;
    title?: ReactNode;
  }) => {
    sharedStateCalls.loading(props);

    return (
      <section data-testid={props.testId}>
        <div data-testid="shared-loading-state" />
        {props.title ? <h2>{props.title}</h2> : null}
        {props.body ? <p>{props.body}</p> : null}
        {props.action}
      </section>
    );
  },
}));

function renderWelcomePage(initialEntries = ['/welcome']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 2,
        retryDelay: 1,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route element={<WelcomePage />} path="/welcome" />
          <Route
            element={<div data-testid="league-home-destination">League home</div>}
            path="/league/:leagueCode"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-rop.23: WelcomePage generated DTO fixtures', () => {
  beforeEach(() => {
    mockApi.listLeagues.mockReset();
    sharedStateCalls.empty.mockClear();
    sharedStateCalls.error.mockClear();
    sharedStateCalls.loading.mockClear();
  });

  it('pool-master-rop.63: shows the shared zero-league state and create action when the member has no leagues', async () => {
    mockApi.listLeagues.mockResolvedValue(apiSuccess(listLeaguesData([])));

    renderWelcomePage();

    expect(await screen.findByTestId('authenticated-landing-empty')).toBeInTheDocument();
    expect(screen.getByTestId('shared-empty-state')).toBeInTheDocument();
    expect(sharedStateCalls.empty).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Once you create leagues"),
        testId: 'authenticated-landing-empty',
        title: expect.stringContaining('Welcome to Ultimate Office Pool Manager'),
      }),
    );
    fireEvent.click(screen.getByTestId('welcome-create-league'));
    expect(screen.getByRole('button', { name: 'Create league' })).toBeInTheDocument();
  });

  it('pool-master-rop.63: renders the shared loading state while leagues load', () => {
    mockApi.listLeagues.mockImplementation(() => new Promise(() => {}));

    renderWelcomePage();

    expect(screen.getByTestId('authenticated-landing-loading')).toBeInTheDocument();
    expect(screen.getByTestId('shared-loading-state')).toBeInTheDocument();
    expect(sharedStateCalls.loading).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Loading your leagues...',
        testId: 'authenticated-landing-loading',
      }),
    );
  });

  it('pool-master-rop.63: preserves redirect into the resolved league context', async () => {
    mockApi.listLeagues.mockResolvedValue(apiSuccess(listLeaguesData([
      buildLeagueSummary({
        id: 'league-1',
        leagueCode: 'LEAGUE1',
        name: 'League One',
        memberCount: 10,
        activeContestCount: 2,
        memberType: 'MEMBER',
        leagueRelationship: { leagueMember: true, commissioner: false },
        createdAt: '2026-04-20T12:00:00.000Z',
      }),
    ])));

    renderWelcomePage();

    expect(await screen.findByTestId('league-home-destination')).toBeInTheDocument();
  });

  it('pool-master-dxd.15/pool-master-rop.63: uses the shared no-retry leagues query policy and shared error state', async () => {
    mockApi.listLeagues.mockResolvedValue({
      error: {
        code: 'LEAGUES_UNAVAILABLE',
        message: 'League list unavailable',
      },
      response: { status: 500 },
    });

    renderWelcomePage();

    expect(await screen.findByTestId('authenticated-landing-error')).toBeInTheDocument();
    expect(screen.getByTestId('shared-error-state')).toBeInTheDocument();
    expect(sharedStateCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Try refreshing after signing in again.',
        testId: 'authenticated-landing-error',
        title: "We couldn't load your leagues.",
      }),
    );
    await waitFor(() => expect(mockApi.listLeagues).toHaveBeenCalledTimes(1));
  });
});
