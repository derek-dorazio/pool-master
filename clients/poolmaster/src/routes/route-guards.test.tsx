import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePostAuthDestination } from '@/features/auth/post-auth-destination';
import { MemberRouteGuard, RootAdminRouteGuard } from './route-guards';

const { authState, mockLogger } = vi.hoisted(() => {
  const authState = {
    isAuthenticated: false,
    isLoading: false,
    isRootAdmin: false,
    user: null as null | { id: string },
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
  return { authState, mockLogger };
});

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => authState,
}));

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const SIGNED_IN_USER_COOKIE = 'poolmaster_signed_in_user';

function SignInTarget() {
  const location = useLocation();
  return <div data-testid="redirect-target">{JSON.stringify(location.state)}</div>;
}

function memberGuardTree(initialEntries: string[]) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route element={<MemberRouteGuard />}>
          <Route element={<div data-testid="member-guard-allowed">Allowed</div>} path="/league/:leagueCode" />
        </Route>
        <Route element={<SignInTarget />} path="/" />
      </Routes>
    </MemoryRouter>
  );
}

function renderMemberGuard(initialEntries = ['/league/LEAGUE1?tab=history']) {
  return render(memberGuardTree(initialEntries));
}

function renderRootAdminGuard(initialEntries = ['/manage']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route element={<MemberRouteGuard />}>
          <Route element={<RootAdminRouteGuard />}>
            <Route element={<div data-testid="root-admin-guard-allowed">Allowed</div>} path="/manage" />
          </Route>
        </Route>
        <Route element={<div data-testid="welcome-target">Welcome</div>} path="/welcome" />
        <Route element={<div data-testid="sign-in-target">Sign in</div>} path="/" />
      </Routes>
    </MemoryRouter>,
  );
}

describe('route guards', () => {
  afterEach(() => {
    authState.isAuthenticated = false;
    authState.isLoading = false;
    authState.isRootAdmin = false;
    authState.user = null;
    document.cookie = `${SIGNED_IN_USER_COOKIE}=; Path=/; Max-Age=0`;
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.fatal.mockReset();
    mockLogger.child.mockClear();
  });

  it('redirects unauthenticated member routes and logs the warning branch', async () => {
    renderMemberGuard();

    expect(await screen.findByTestId('redirect-target')).toBeVisible();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'memberRoute.redirectUnauthenticated',
      }),
      expect.any(String),
    );
  });

  it('stamps the sign-in return page with the account last signed in, so another account does not inherit it', async () => {
    document.cookie = `${SIGNED_IN_USER_COOKIE}=user-9; Path=/`;

    renderMemberGuard(['/league/LEAGUE1']);

    expect(JSON.parse((await screen.findByTestId('redirect-target')).textContent)).toEqual({
      from: '/league/LEAGUE1',
      fromUserId: 'user-9',
    });
  });

  it('leaves the sign-in return page unstamped when no account was signed in, so a shared link still opens', async () => {
    renderMemberGuard(['/league/LEAGUE1']);

    expect(JSON.parse((await screen.findByTestId('redirect-target')).textContent)).toEqual({
      from: '/league/LEAGUE1',
    });
  });

  it('stamps the page an account signs out of with that account, so the next account to sign in (a root admin) does not land on it', async () => {
    // Signed in on a league page; sign-out forgets the remembered account before the guard
    // sees the session go, so only the guard itself still knows whose page this was.
    authState.isAuthenticated = true;
    authState.user = { id: 'member-1' };
    const view = renderMemberGuard(['/league/LEAGUE1']);
    expect(await screen.findByTestId('member-guard-allowed')).toBeVisible();

    authState.isAuthenticated = false;
    authState.user = null;
    view.rerender(memberGuardTree(['/league/LEAGUE1']));

    expect(JSON.parse((await screen.findByTestId('redirect-target')).textContent)).toEqual({
      from: '/league/LEAGUE1',
      fromUserId: 'member-1',
    });
  });

  it('returns the member who signed out to the league page they left, while a root admin signing in next goes to Manage', async () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'member-1' };
    const view = renderMemberGuard(['/league/LEAGUE1']);
    expect(await screen.findByTestId('member-guard-allowed')).toBeVisible();

    authState.isAuthenticated = false;
    authState.user = null;
    view.rerender(memberGuardTree(['/league/LEAGUE1']));
    const returnState = JSON.parse((await screen.findByTestId('redirect-target')).textContent) as {
      from: string;
      fromUserId?: string;
    };

    expect(resolvePostAuthDestination({ id: 'member-1', isRootAdmin: false, isActive: true }, returnState)).toBe('/league/LEAGUE1');
    expect(resolvePostAuthDestination({ id: 'root-admin', isRootAdmin: true, isActive: true }, returnState)).toBe('/manage');
  });

  it('allows authenticated member routes and logs the happy path', async () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'user-1' };

    renderMemberGuard(['/league/LEAGUE1']);

    expect(await screen.findByTestId('member-guard-allowed')).toBeVisible();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'memberRoute.allowed',
      }),
      expect.any(String),
    );
  });

  it('shows the shared loading line while the session is still being read, before deciding where to send the visitor', () => {
    authState.isLoading = true;

    renderMemberGuard(['/league/LEAGUE1']);

    expect(screen.getByTestId('member-route-loading')).toHaveTextContent(/^Loading your .+ session\.\.\.$/);
    expect(screen.queryByTestId('member-guard-allowed')).not.toBeInTheDocument();
  });

  it('creates the member guard logger once rather than on every render', () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'user-1' };

    const { rerender } = renderMemberGuard(['/league/LEAGUE1']);
    rerender(
      <MemoryRouter initialEntries={['/league/LEAGUE1']}>
        <Routes>
          <Route element={<MemberRouteGuard />}>
            <Route element={<div data-testid="member-guard-allowed">Allowed</div>} path="/league/:leagueCode" />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(mockLogger.child).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledTimes(1);
  });

  it('sends a signed-out visitor on /manage to sign-in before the root-admin check runs', async () => {
    renderRootAdminGuard();

    expect(await screen.findByTestId('sign-in-target')).toBeVisible();
    expect(screen.queryByTestId('root-admin-guard-allowed')).not.toBeInTheDocument();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'memberRoute.redirectUnauthenticated',
      }),
      expect.any(String),
    );
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rootAdminRoute.redirectUnauthorized',
      }),
      expect.any(String),
    );
  });

  it('redirects non-root-admin users away from the manage route and logs the warning branch', async () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'user-1' };

    renderRootAdminGuard();

    expect(await screen.findByTestId('welcome-target')).toBeVisible();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rootAdminRoute.redirectUnauthorized',
      }),
      expect.any(String),
    );
  });

  it('allows root-admin users through and logs the happy path', async () => {
    authState.isAuthenticated = true;
    authState.isRootAdmin = true;
    authState.user = { id: 'root-1' };

    renderRootAdminGuard();

    expect(await screen.findByTestId('root-admin-guard-allowed')).toBeVisible();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rootAdminRoute.allowed',
      }),
      expect.any(String),
    );
  });
});
