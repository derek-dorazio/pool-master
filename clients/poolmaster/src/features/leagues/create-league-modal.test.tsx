import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListLeaguesResponses } from '@/lib/api';
import { CreateLeagueModal, suggestLeagueCode } from './create-league-modal';
import {
  apiSuccess,
  buildLeagueDetail,
  buildLeagueSummary,
  createLeagueData,
  type LeagueSummary,
} from './test/fixtures';

const { createLeagueMock, mockLogger } = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };

  logger.child.mockImplementation(() => logger);

  return {
    createLeagueMock: vi.fn(),
    mockLogger: logger,
  };
});

vi.mock('@/lib/api', () => ({
  createLeague: (...args: unknown[]) => createLeagueMock(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function LeaguesQueryProbe({ queryFn }: { queryFn: () => Promise<LeagueSummary[]> }) {
  const leaguesQuery = useQuery({
    queryKey: ['poolmaster', 'leagues'],
    queryFn,
    retry: false,
  });

  if (leaguesQuery.isLoading) {
    return <div data-testid="league-list-state">loading</div>;
  }

  if (leaguesQuery.isError) {
    return <div data-testid="league-list-state">error</div>;
  }

  const leagues = leaguesQuery.data ?? [];

  return (
    <div data-testid="league-list-state">
      {leagues.map((league) => league.leagueCode).join(',') || 'empty'}
    </div>
  );
}

describe('pool-master-rop.23: CreateLeagueModal generated DTO fixtures', () => {
  afterEach(() => {
    createLeagueMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    document.cookie = 'poolmaster_recent_league=; Path=/; Max-Age=0';
  });

  it('pool-master-rop.23: suggests a league code from the league name', () => {
    expect(suggestLeagueCode('Big Dawgs 2026')).toBe('BIGDAWGS2026');
    expect(suggestLeagueCode('A')).toBe('A');
  });

  it('pool-master-rop.23: creates a league by syncing the shell league list without refetching it', async () => {
    const createdLeague = buildLeagueDetail({
      id: 'league-1',
      leagueCode: 'BIGDAWGS',
      name: 'Big Dawgs',
      description: 'Neighborhood commissioner league',
      isActive: true,
      iconKey: 'TROPHY',
      memberCount: 1,
      activeContestCount: 0,
      memberType: 'COMMISSIONER',
      leagueRelationship: {
        leagueMember: true,
        commissioner: true,
      },
      isRootAdmin: false,
      createdAt: '2026-04-15T00:00:00.000Z',
      joinPolicy: 'COMMISSIONER_ONLY',
    });
    createLeagueMock.mockResolvedValue(apiSuccess(createLeagueData(createdLeague)));

    const onCreated = vi.fn();
    const leaguesQueryFn = vi.fn<() => Promise<LeagueSummary[]>>().mockResolvedValue([]);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <LeaguesQueryProbe queryFn={leaguesQueryFn} />
        <CreateLeagueModal isOpen onClose={vi.fn()} onCreated={onCreated} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('league-list-state')).toHaveTextContent('empty'));

    fireEvent.change(screen.getByTestId('create-league-name'), {
      target: { value: 'Big Dawgs' },
    });
    fireEvent.blur(screen.getByTestId('create-league-name'));
    await waitFor(() => expect(screen.getByTestId('create-league-code')).toHaveValue('BIGDAWGS'));
    fireEvent.change(screen.getByTestId('create-league-description'), {
      target: { value: 'Neighborhood commissioner league' },
    });
    fireEvent.click(screen.getByTestId('create-league-next'));
    await waitFor(() => expect(screen.getByTestId('create-league-submit')).toBeVisible());
    fireEvent.click(screen.getByTestId('create-league-submit'));

    await waitFor(() =>
      expect(createLeagueMock).toHaveBeenCalledWith({
        body: {
          name: 'Big Dawgs',
          leagueCode: 'BIGDAWGS',
          description: 'Neighborhood commissioner league',
        },
      }),
    );

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('BIGDAWGS'));
    await waitFor(() => expect(screen.getByTestId('league-list-state')).toHaveTextContent('BIGDAWGS'));
    expect(leaguesQueryFn).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData<ListLeaguesResponses[200]['leagues']>(['poolmaster', 'leagues'])).toEqual([
      buildLeagueSummary({
        id: 'league-1',
        leagueCode: 'BIGDAWGS',
        name: 'Big Dawgs',
        description: 'Neighborhood commissioner league',
        isActive: true,
        iconKey: 'TROPHY',
        memberCount: 1,
        activeContestCount: 0,
        memberType: 'COMMISSIONER',
        leagueRelationship: {
          leagueMember: true,
          commissioner: true,
        },
        isRootAdmin: false,
        createdAt: '2026-04-15T00:00:00.000Z',
      }),
    ]);
    expect(queryClient.getQueryData(['poolmaster', 'league', 'BIGDAWGS'])).toEqual(createdLeague);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'league.create.succeeded',
        data: expect.objectContaining({
          leagueCode: 'BIGDAWGS',
        }),
      }),
      expect.any(String),
    );
  });

  it('pool-master-rop.23: stops overwriting league code after the user edits it', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CreateLeagueModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByTestId('create-league-name'), {
      target: { value: 'Big Dawgs' },
    });
    fireEvent.blur(screen.getByTestId('create-league-name'));
    await waitFor(() => expect(screen.getByTestId('create-league-code')).toHaveValue('BIGDAWGS'));

    fireEvent.change(screen.getByTestId('create-league-code'), {
      target: { value: 'BIGDOGS26' },
    });
    fireEvent.change(screen.getByTestId('create-league-name'), {
      target: { value: 'Big Dawgs Updated' },
    });
    fireEvent.blur(screen.getByTestId('create-league-name'));

    await waitFor(() => expect(screen.getByTestId('create-league-code')).toHaveValue('BIGDOGS26'));
  });

  it('pool-master-rop.23: shows a rejection message when league creation is rejected with a validation payload', async () => {
    createLeagueMock.mockResolvedValue({
      error: {
        message: 'League code is already taken.',
      },
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CreateLeagueModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByTestId('create-league-name'), {
      target: { value: 'Big Dawgs' },
    });
    fireEvent.blur(screen.getByTestId('create-league-name'));
    fireEvent.click(screen.getByTestId('create-league-next'));
    await screen.findByTestId('create-league-submit');
    fireEvent.click(screen.getByTestId('create-league-submit'));

    await screen.findByText('League code is already taken.');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'league.create.failed',
      }),
      expect.any(String),
    );
  });
});
