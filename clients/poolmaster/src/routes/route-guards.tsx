import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-provider';
import { useLogger } from '@/lib/logger';

export function MemberRouteGuard() {
  const auth = useAuth();
  const location = useLocation();
  const logger = useLogger().child({
    feature: 'member-route-guard',
  });

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
        Loading your PoolMaster session...
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return <Navigate replace state={{ from: `${location.pathname}${location.search}` }} to="/" />;
  }

  return <Outlet />;
}

export function RootAdminRouteGuard() {
  const auth = useAuth();
  const location = useLocation();
  const logger = useLogger().child({
    feature: 'root-admin-route-guard',
  });

  useEffect(() => {
    if (auth.isLoading) {
      logger.debug(
        {
          action: 'rootAdminRoute.loading',
          data: {
            from: `${location.pathname}${location.search}`,
          },
        },
        'Root-admin route guard is waiting for auth state',
      );
      return;
    }

    if (!auth.isAuthenticated) {
      logger.warn(
        {
          action: 'rootAdminRoute.redirectUnauthenticated',
          data: {
            from: `${location.pathname}${location.search}`,
          },
        },
        'Redirected unauthenticated root-admin request',
      );
      return;
    }

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
  }, [
    auth.isAuthenticated,
    auth.isLoading,
    auth.isRootAdmin,
    auth.user?.id,
    location.pathname,
    location.search,
    logger,
  ]);

  if (auth.isLoading) {
    return (
      <div className="rounded-[2rem] border border-border bg-card p-8 text-sm text-muted-foreground">
        Loading your PoolMaster session...
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return <Navigate replace state={{ from: `${location.pathname}${location.search}` }} to="/" />;
  }

  if (!auth.isRootAdmin) {
    return <Navigate replace to="/welcome" />;
  }

  return <Outlet />;
}
