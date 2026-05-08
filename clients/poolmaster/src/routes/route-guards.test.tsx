import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => authState,
}));

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function renderMemberGuard(initialEntries = ['/league/LEAGUE1?tab=history']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route element={<MemberRouteGuard />}>
          <Route element={<div data-testid="member-guard-allowed">Allowed</div>} path="/league/:leagueCode" />
        </Route>
        <Route element={<div data-testid="redirect-target">Sign in</div>} path="/" />
      </Routes>
    </MemoryRouter>,
  );
}

function renderRootAdminGuard(initialEntries = ['/manage']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route element={<RootAdminRouteGuard />}>
          <Route element={<div data-testid="root-admin-guard-allowed">Allowed</div>} path="/manage" />
        </Route>
        <Route element={<div data-testid="redirect-target">Welcome</div>} path="/welcome" />
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

  it('redirects non-root-admin users away from the manage route and logs the warning branch', async () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'user-1' };

    renderRootAdminGuard();

    expect(await screen.findByTestId('redirect-target')).toBeVisible();
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
