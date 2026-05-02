import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import appShellSource from './app-shell.tsx?raw';
import { AppShell } from './app-shell';

const {
  listLeaguesMock,
  authState,
  clearSessionMock,
  mockLogger,
} = vi.hoisted(() => {
  const clearSessionMock = vi.fn();
  const authState = {
    isAuthenticated: true,
    isLoading: false,
    isRootAdmin: false,
    user: {
      id: 'user-1',
      firstName: 'Derek',
      lastName: 'Dorazio',
    },
    clearSession: clearSessionMock,
  };
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);

  return {
    listLeaguesMock: vi.fn(),
    authState,
    clearSessionMock,
    mockLogger,
  };
});

vi.mock('@/lib/api', () => ({
  listLeagues: (...args: unknown[]) => listLeaguesMock(...args),
}));

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => authState,
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

vi.mock('@/features/account/account-menu', () => ({
  AccountMenu: ({
    onLogout,
    userName,
    isRootAdmin,
  }: {
    onLogout: () => Promise<void>;
    userName: string;
    isRootAdmin?: boolean;
  }) => (
    <>
      <div data-testid="mock-account-menu-is-root-admin">{isRootAdmin ? 'true' : 'false'}</div>
      <button data-testid="mock-account-menu-logout" onClick={() => void onLogout()} type="button">
        Logout {userName}
      </button>
    </>
  ),
}));

vi.mock('@/features/app-shell/league-selector', () => ({
  LeagueSelector: ({
    onCreateLeague,
    onNavigate,
  }: {
    onCreateLeague: () => void;
    onNavigate: (path: string) => void;
  }) => (
    <div>
      <button data-testid="mock-league-selector-create" onClick={onCreateLeague} type="button">
        Create league
      </button>
      <button
        data-testid="mock-league-selector-navigate"
        onClick={() => onNavigate('/league/LEAGUE1')}
        type="button"
      >
        Navigate league
      </button>
    </div>
  ),
}));

vi.mock('@/features/leagues/create-league-modal', () => ({
  CreateLeagueModal: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) => (
    isOpen ? (
      <div data-testid="mock-create-league-modal">
        <button data-testid="mock-create-league-modal-close" onClick={onClose} type="button">
          Close
        </button>
      </div>
    ) : null
  ),
  buildCreateLeagueDestination: (leagueCode: string) => `/league/${leagueCode}`,
}));

function renderAppShell(initialEntries = ['/league/LEAGUE1']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route element={<AppShell />} path="/">
            <Route element={<div data-testid="mock-outlet">Outlet</div>} path="league/:leagueCode" />
            <Route element={<div data-testid="mock-outlet">Outlet</div>} path="*" />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppShell', () => {
  afterEach(() => {
    listLeaguesMock.mockReset();
    clearSessionMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.fatal.mockReset();
    mockLogger.child.mockClear();
    authState.isAuthenticated = true;
    authState.isLoading = false;
    authState.isRootAdmin = false;
    authState.user = {
      id: 'user-1',
      firstName: 'Derek',
      lastName: 'Dorazio',
    };
    authState.clearSession = clearSessionMock;
  });

  it('logs app-shell load after leagues resolve for an authenticated user', async () => {
    clearSessionMock.mockResolvedValue(undefined);
    listLeaguesMock.mockResolvedValue({
      data: {
        leagues: [
          {
            id: 'league-1',
            leagueCode: 'LEAGUE1',
            name: 'League One',
            isActive: true,
            iconKey: 'clubhouse',
            memberType: 'COMMISSIONER',
            leagueRelationship: { leagueMember: true, commissioner: true },
            isRootAdmin: false,
          },
        ],
      },
    });

    renderAppShell();

    await screen.findByTestId('mock-outlet');
    expect(screen.getByText('Prime Time Commissioner')).toBeInTheDocument();
    expect(screen.getByText('Ultimate Office Pool Manager')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument();
    expect(screen.getByTestId('app-shell-notifications')).toHaveAttribute('aria-label', 'Notifications');

    fireEvent.pointerDown(screen.getByTestId('app-menu-my-team-trigger'));
    expect(screen.getByTestId('app-menu-my-team-details')).toHaveAttribute(
      'href',
      '/league/LEAGUE1/team',
    );
    expect(screen.getByTestId('app-menu-my-contests')).toHaveAttribute(
      'href',
      '/league/LEAGUE1/contests?filter=my-entries',
    );
    expect(screen.getByTestId('app-menu-my-history')).toHaveAttribute(
      'href',
      '/league/LEAGUE1/history',
    );

    fireEvent.pointerDown(screen.getByTestId('app-menu-league-trigger'));
    expect(screen.getByTestId('app-menu-league-details')).toHaveAttribute(
      'href',
      '/league/LEAGUE1',
    );
    expect(screen.getByTestId('app-menu-league-teams')).toHaveAttribute(
      'href',
      '/league/LEAGUE1/teams',
    );
    expect(screen.getByTestId('app-menu-active-contests')).toHaveAttribute(
      'href',
      '/league/LEAGUE1/contests',
    );
    expect(screen.getByTestId('app-menu-contest-history')).toHaveAttribute(
      'href',
      '/league/LEAGUE1/contests/history',
    );
    await waitFor(() =>
      expect(screen.getByTestId('app-menu-create-contest')).toHaveAttribute(
        'href',
        '/league/LEAGUE1/contests/new',
      ),
    );
    await waitFor(() =>
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'appShell.loaded',
        }),
        expect.any(String),
      ),
    );
  });

  it('logs the expected negative branch when league loading fails', async () => {
    clearSessionMock.mockResolvedValue(undefined);
    listLeaguesMock.mockRejectedValue(new Error('League list unavailable'));

    renderAppShell();

    await screen.findByTestId('mock-outlet');
    await waitFor(() =>
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'appShell.leagues.failed',
        }),
        expect.any(String),
      ),
    );
  });

  it('forwards isRootAdmin from auth into the account menu', async () => {
    clearSessionMock.mockResolvedValue(undefined);
    listLeaguesMock.mockResolvedValue({ data: { leagues: [] } });
    authState.isRootAdmin = true;

    renderAppShell();

    await screen.findByTestId('mock-outlet');
    expect(await screen.findByTestId('mock-account-menu-is-root-admin')).toHaveTextContent('true');
  });

  it('forwards a false isRootAdmin for regular members', async () => {
    clearSessionMock.mockResolvedValue(undefined);
    listLeaguesMock.mockResolvedValue({
      data: {
        leagues: [
          {
            id: 'league-1',
            leagueCode: 'LEAGUE1',
            name: 'League One',
            isActive: true,
            iconKey: 'clubhouse',
            memberType: 'MEMBER',
            leagueRelationship: { leagueMember: true, commissioner: false },
            isRootAdmin: false,
          },
        ],
      },
    });
    authState.isRootAdmin = false;

    renderAppShell();

    await screen.findByTestId('mock-outlet');
    expect(await screen.findByTestId('mock-account-menu-is-root-admin')).toHaveTextContent('false');
    fireEvent.pointerDown(screen.getByTestId('app-menu-league-trigger'));
    expect(screen.queryByTestId('app-menu-create-contest')).not.toBeInTheDocument();
  });

  it('disables header menus when no active league is selected', async () => {
    clearSessionMock.mockResolvedValue(undefined);
    listLeaguesMock.mockResolvedValue({ data: { leagues: [] } });

    renderAppShell(['/welcome']);

    await screen.findByTestId('mock-outlet');
    expect(screen.getByTestId('app-menu-my-team-trigger')).toBeDisabled();
    expect(screen.getByTestId('app-menu-league-trigger')).toBeDisabled();
  });

  it('pool-master-dxd.29 does not load or render league navigation on root-admin manage routes', async () => {
    clearSessionMock.mockResolvedValue(undefined);
    authState.isRootAdmin = true;

    renderAppShell(['/manage/sync']);

    await screen.findByTestId('mock-outlet');
    expect(listLeaguesMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mock-league-selector-create')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-menu-my-team-trigger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-menu-league-trigger')).not.toBeInTheDocument();
  });

  it('pool-master-dxd.33 does not load member league shell while a root admin login redirects from root', async () => {
    clearSessionMock.mockResolvedValue(undefined);
    authState.isRootAdmin = true;

    renderAppShell(['/']);

    expect(await screen.findByTestId('mock-account-menu-is-root-admin')).toHaveTextContent('true');
    expect(listLeaguesMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mock-league-selector-create')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-menu-my-team-trigger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-menu-league-trigger')).not.toBeInTheDocument();
  });

  it('pool-master-fo5.5 does not render debug route copy for signed-out users', async () => {
    authState.isAuthenticated = false;

    renderAppShell(['/']);

    expect(screen.getByText('Prime Time Commissioner')).toBeInTheDocument();
    expect(screen.getByText('Ultimate Office Pool Manager')).toBeInTheDocument();
    expect(screen.queryByText(/Current route/i)).not.toBeInTheDocument();
    expect(listLeaguesMock).not.toHaveBeenCalled();
  });

  it('logs logout completion when the app-shell logout action succeeds', async () => {
    clearSessionMock.mockResolvedValue(undefined);
    listLeaguesMock.mockResolvedValue({
      data: {
        leagues: [],
      },
    });

    renderAppShell();

    fireEvent.click(await screen.findByTestId('mock-account-menu-logout'));

    await waitFor(() => expect(clearSessionMock).toHaveBeenCalledTimes(1));
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'appShell.logout.completed',
      }),
      expect.any(String),
    );
  });

  it('pool-master-dxd.21 derives league context from router params instead of pathname regex', () => {
    expect(appShellSource).not.toContain('location.pathname.match');
    expect(appShellSource).toContain('useParams');
  });
});
