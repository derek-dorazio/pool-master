import { useEffect, useMemo } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { getLogger } from '@/lib/logger';

/**
 * Waits for auth state, sends a signed-out visitor to sign-in, and otherwise renders the
 * child routes. Every guard that needs a signed-in user nests under this one rather than
 * repeating these checks.
 */
export function MemberRouteGuard() {
  const auth = useAuth();
  const location = useLocation();
  // Memoised: `child()` returns a new logger on every call, and the effect depends on it.
  const logger = useMemo(() => getLogger().child({
    feature: 'member-route-guard',
  }), []);

  useEffect(() => {
    if (auth.isLoading) {
      logger.debug(
        {
          action: 'memberRoute.loading',
          data: {
            from: `${location.pathname}${location.search}`,
          },
        },
        'Member route guard is waiting for auth state',
      );
      return;
    }

    if (!auth.isAuthenticated) {
      logger.warn(
        {
          action: 'memberRoute.redirectUnauthenticated',
          data: {
            from: `${location.pathname}${location.search}`,
          },
        },
        'Redirected unauthenticated member-route request',
      );
      return;
    }

    logger.info(
      {
        action: 'memberRoute.allowed',
        data: {
          userId: auth.user?.id ?? null,
          from: `${location.pathname}${location.search}`,
        },
      },
      'Allowed member-route request',
    );
  }, [auth.isAuthenticated, auth.isLoading, auth.user?.id, location.pathname, location.search, logger]);

  if (auth.isLoading) {
    return (
      <div className="rounded-[2rem] border border-border bg-card p-8 text-sm text-muted-foreground">
        Loading your Prime Time Commissioner session...
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return <Navigate replace state={{ from: `${location.pathname}${location.search}` }} to="/" />;
  }

  return <Outlet />;
}

/**
 * Admits root admins only. It must be nested under `MemberRouteGuard`, which owns the loading
 * state and the signed-out redirect, so this guard only ever sees a signed-in user.
 */
export function RootAdminRouteGuard() {
  const auth = useAuth();
  const location = useLocation();
  const logger = useMemo(() => getLogger().child({
    feature: 'root-admin-route-guard',
  }), []);

  useEffect(() => {
    if (!auth.isRootAdmin) {
      logger.warn(
        {
          action: 'rootAdminRoute.redirectUnauthorized',
          data: {
            userId: auth.user?.id ?? null,
            from: `${location.pathname}${location.search}`,
          },
        },
        'Redirected non-root-admin request from root-admin route',
      );
      return;
    }

    logger.info(
      {
        action: 'rootAdminRoute.allowed',
        data: {
          userId: auth.user?.id ?? null,
          from: `${location.pathname}${location.search}`,
        },
      },
      'Allowed root-admin route request',
    );
  }, [auth.isRootAdmin, auth.user?.id, location.pathname, location.search, logger]);

  if (!auth.isRootAdmin) {
    return <Navigate replace to="/welcome" />;
  }

  return <Outlet />;
}
