import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import type { LeagueListCache } from './league-cache';
import { CreateLeagueModal } from './create-league-modal';
import { suggestLeagueCode } from './create-league-form';
import {
  apiSuccess,
  buildLeague,
  createLeagueData,
} from './test/fixtures';
import { QueryKeys } from '@/lib/query-keys';

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

bindApiMocks({
  createLeague: createLeagueMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

// #202 — the league-list cache holds `{ leagues, memberships }` (access rule A8's one
// set-shaped exception), so this stand-in for the app shell's list query holds that shape.
function LeaguesQueryProbe({ queryFn }: { queryFn: () => Promise<LeagueListCache> }) {
  const leaguesQuery = useQuery({
    queryKey: QueryKeys.leagues.list,
    queryFn,
    retry: false,
  });

  if (leaguesQuery.isLoading) {
    return <div data-testid="league-list-state">loading</div>;
  }

  if (leaguesQuery.isError) {
    return <div data-testid="league-list-state">error</div>;
  }

  const leagues = leaguesQuery.data?.leagues ?? [];

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
    const createdLeague = buildLeague({
      id: 'league-1',
      leagueCode: 'BIGDAWGS',
      name: 'Big Dawgs',
      description: 'Neighborhood commissioner league',
      isActive: true,
      iconKey: 'TROPHY',
      memberCount: 1,
      activeContestCount: 0,
      createdAt: '2026-04-15T00:00:00.000Z',
    });
    createLeagueMock.mockResolvedValue(apiSuccess(createLeagueData(createdLeague)));

    const onCreated = vi.fn();
    const leaguesQueryFn = vi
      .fn<() => Promise<LeagueListCache>>()
      .mockResolvedValue({ leagues: [], memberships: [] });
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
    expect(queryClient.getQueryData<LeagueListCache>(QueryKeys.leagues.list)?.leagues).toEqual([
      buildLeague({
        id: 'league-1',
        leagueCode: 'BIGDAWGS',
        name: 'Big Dawgs',
        description: 'Neighborhood commissioner league',
        isActive: true,
        iconKey: 'TROPHY',
        memberCount: 1,
        activeContestCount: 0,
        createdAt: '2026-04-15T00:00:00.000Z',
      }),
    ]);
    // #215 — creating a league now seeds its league-context cache, at both of the cache's
    // addresses. The 201 carries the viewer's membership because creating a league creates it,
    // so the context is read off the response rather than invented here, and the new league's
    // page no longer issues its own `getLeagueByCode` on arrival.
    const expectedContext = createLeagueData(createdLeague);
    expect(queryClient.getQueryData(QueryKeys.leagues.detail('BIGDAWGS'))).toEqual(expectedContext);
    expect(queryClient.getQueryData(QueryKeys.leagues.contextById('league-1'))).toEqual(
      expectedContext,
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'league.create.succeeded',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric-matcher sentinel, typed any by design.
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
        error: {
          code: 'LEAGUE_CODE_IN_USE',
          message: 'League code is already taken.',
        },
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
    fireEvent.click(screen.getByTestId('create-league-submit'));

    await screen.findByText('League code is already taken.');
    // A save error is the shared danger Notice above the buttons, and the dialog stays open.
    expect(screen.getByRole('alert')).toHaveTextContent('League not created');
    expect(screen.getByRole('alert')).toHaveTextContent('League code is already taken.');
    expect(screen.getByTestId('create-league-modal')).toBeInTheDocument();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'league.create.failed',
      }),
      expect.any(String),
    );
  });

  function renderModal(props: Partial<{ nextStep: string }> = {}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CreateLeagueModal isOpen onClose={vi.fn()} onCreated={vi.fn()} {...props} />
      </QueryClientProvider>,
    );
  }

  it('asks for everything on one step: name, web address and an optional description, with Cancel and Create league', () => {
    renderModal();

    expect(screen.getByRole('textbox', { name: 'League name' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'League web address' })).toBeInTheDocument();
    expect(screen.getByLabelText('Description (optional)')).toBe(screen.getByTestId('create-league-description'));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByTestId('create-league-submit')).toHaveTextContent('Create league');
    expect(screen.queryByText(/Review/)).not.toBeInTheDocument();
    expect(screen.queryByText('Commissioner setup')).not.toBeInTheDocument();
    expect(screen.getByTestId('create-league-code-help')).toBeInTheDocument();
  });

  it('shows the full web address under the field as you type, from the site\'s own origin, not opening until the league exists', async () => {
    renderModal();

    expect(screen.queryByTestId('create-league-address')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('create-league-code'), { target: { value: 'big dawgs' } });

    const address = await screen.findByTestId('create-league-address-link');
    expect(address).toHaveTextContent(`${window.location.host}/league/bigdawgs`);
    expect(address).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('create-league-code'), { target: { value: 'BIGDAWGS2' } });
    expect(await screen.findByTestId('create-league-address-link')).toHaveTextContent('/league/bigdawgs2');
  });

  it('shows a taken web address as an error under the field, not as a save error, and clears it once the address changes', async () => {
    createLeagueMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_CODE_CONFLICT', message: 'League code already exists' } },
    });
    renderModal();

    fireEvent.change(screen.getByTestId('create-league-name'), { target: { value: 'Big Dawgs' } });
    fireEvent.blur(screen.getByTestId('create-league-name'));
    fireEvent.click(screen.getByTestId('create-league-submit'));

    expect(await screen.findByText('That web address is taken. Try another.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'League web address' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('create-league-code'), { target: { value: 'BIGDAWGS7' } });
    await waitFor(() => expect(screen.queryByText('That web address is taken. Try another.')).not.toBeInTheDocument());
  });

  it('says in one line what comes next when the league is a step on the way to a contest', () => {
    renderModal({ nextStep: 'your Squares for Championship Weekend' });

    expect(screen.getByRole('dialog', { name: 'Create your league' })).toHaveAccessibleDescription(
      "Then you'll set up your Squares for Championship Weekend.",
    );
  });
});
