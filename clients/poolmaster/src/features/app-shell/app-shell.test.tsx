import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  useLogger: () => mockLogger,
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
          },
        ],
      },
    });

    renderAppShell();

    await screen.findByTestId('mock-outlet');
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
    listLeaguesMock.mockResolvedValue({ data: { leagues: [] } });
    authState.isRootAdmin = false;

    renderAppShell();

    await screen.findByTestId('mock-outlet');
    expect(await screen.findByTestId('mock-account-menu-is-root-admin')).toHaveTextContent('false');
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
});
