import { ReactNode, createContext, useContext, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCurrentUser, logoutUser, refreshToken } from '@/lib/api';
import { getLogger } from '@/lib/logger';
import { useSessionStore } from './session-store';

type AuthContextValue = {
  isAuthenticated: boolean;
  isLoading: boolean;
  isRootAdmin: boolean;
  user: ReturnType<typeof useSessionStore.getState>['user'];
  clearSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const logger = getLogger().child({
    feature: 'auth-provider',
  });
  const user = useSessionStore((state) => state.user);
  const setSession = useSessionStore((state) => state.setSession);
  const setSessionId = useSessionStore((state) => state.setSessionId);
  const clearSessionState = useSessionStore((state) => state.clearSession);
  // The refresh-guard ref intentionally only resets in the refresh-success
  // path (after a /auth/refresh attempt that recovers a valid session). It is
  // not reset on me-query data updates or error-to-null transitions, because
  // that would let a flapping /auth/me endpoint repeatedly fire /auth/refresh
  // and clear the local session each time refresh fails. See pool-master-dxd.12.
  const attemptedRefreshRef = useRef(false);

  const meQuery = useQuery({
    queryKey: ['poolmaster', 'auth', 'me'],
    queryFn: async () => {
      logger.debug(
        {
          action: 'auth.me.started',
        },
        'Loading current auth user',
      );

      const response = await getCurrentUser();
      if (!response.data?.user) {
        throw new Error('Current user profile is missing from the auth response.');
      }
      return response.data.user;
    },
    retry: false,
  });

  const refreshQuery = useQuery({
    queryKey: ['poolmaster', 'auth', 'refresh'],
    queryFn: async () => {
      logger.debug(
        {
          action: 'auth.refresh.started',
        },
        'Refreshing auth session',
      );

      const response = await refreshToken();
      return response.data ?? null;
    },
    enabled: false,
    retry: false,
  });

  useEffect(() => {
    if (!meQuery.data) {
      return;
    }

    setSession(meQuery.data);
    logger.info(
      {
        action: 'auth.me.succeeded',
        data: {
          userId: meQuery.data.id,
          isRootAdmin: meQuery.data.isRootAdmin,
        },
      },
      'Hydrated authenticated user session',
    );
  }, [meQuery.data, setSession]);

  useEffect(() => {
    if (!meQuery.error) {
      return;
    }
    if (attemptedRefreshRef.current) {
      return;
    }

    attemptedRefreshRef.current = true;
    let cancelled = false;

    logger.warn(
      {
        action: 'auth.me.failed',
        err: meQuery.error,
      },
      'Current auth user lookup failed; attempting refresh',
    );

    void refreshQuery
      .refetch()
      .then(async (result) => {
        if (cancelled) {
          return;
        }

        if (!result.data) {
          logger.warn(
            {
              action: 'auth.refresh.missingSession',
            },
            'Refresh did not return session data',
          );
          clearSessionState();
          return;
        }

        setSessionId(result.data.sessionId);

        const meResult = await meQuery.refetch();
        if (cancelled) {
          return;
        }

        if (!meResult.data) {
          logger.warn(
            {
              action: 'auth.refresh.refetchMissingUser',
              data: {
                sessionId: result.data.sessionId,
              },
            },
            'Refresh succeeded but current user reload returned no user',
          );
          clearSessionState();
          return;
        }

        attemptedRefreshRef.current = false;
        logger.info(
          {
            action: 'auth.refresh.succeeded',
            data: {
              sessionId: result.data.sessionId,
              userId: meResult.data.id,
            },
          },
          'Recovered authenticated session from refresh',
        );
      })
      .catch((error) => {
        if (!cancelled) {
          logger.warn(
            {
              action: 'auth.refresh.failed',
              err: error,
            },
            'Refresh failed; clearing auth session',
          );
          clearSessionState();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clearSessionState, meQuery.error, meQuery.refetch, refreshQuery.refetch, setSessionId]);

  const value: AuthContextValue = {
    isAuthenticated: Boolean(user),
    isLoading: meQuery.isLoading || refreshQuery.isFetching,
    isRootAdmin: user?.isRootAdmin ?? false,
    user,
    clearSession: async () => {
      logger.debug(
        {
          action: 'auth.logout.started',
          data: {
            userId: user?.id ?? null,
          },
        },
        'Clearing authenticated session',
      );

      await logoutUser().catch((error) => {
        logger.warn(
          {
            action: 'auth.logout.failed',
            err: error,
          },
          'Logout request failed; clearing local session anyway',
        );
      });
      clearSessionState();
      logger.info(
        {
          action: 'auth.logout.completed',
          data: {
            userId: user?.id ?? null,
          },
        },
        'Cleared authenticated session',
      );
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }
  return value;
}
