import { ReactNode, createContext, useContext, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCurrentUser, logoutUser, refreshToken } from '@/lib/api';
import { clearCookie, writeCookie } from '@/lib/cookies';
import { useSessionStore } from './session-store';

type AuthContextValue = {
  isAuthenticated: boolean;
  isLoading: boolean;
  isRootAdmin: boolean;
  user: ReturnType<typeof useSessionStore.getState>['user'];
  clearSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function persistCsrfToken(csrfToken: string | undefined) {
  if (!csrfToken) {
    return;
  }

  writeCookie('poolmaster_csrf', csrfToken, { maxAgeSeconds: SESSION_COOKIE_MAX_AGE_SECONDS });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const user = useSessionStore((state) => state.user);
  const setSession = useSessionStore((state) => state.setSession);
  const clearSessionState = useSessionStore((state) => state.clearSession);
  const attemptedRefreshRef = useRef(false);

  const meQuery = useQuery({
    queryKey: ['poolmaster', 'auth', 'me'],
    queryFn: async () => {
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

    attemptedRefreshRef.current = false;
    setSession(meQuery.data);
  }, [meQuery.data, setSession]);

  useEffect(() => {
    if (!meQuery.error) {
      attemptedRefreshRef.current = false;
      return;
    }
    if (attemptedRefreshRef.current) {
      return;
    }

    attemptedRefreshRef.current = true;
    let cancelled = false;

    void refreshQuery
      .refetch()
      .then(async (result) => {
        if (cancelled) {
          return;
        }

        if (!result.data) {
          clearCookie('poolmaster_csrf');
          clearSessionState();
          return;
        }

        persistCsrfToken(result.data.csrfToken);
        const meResult = await meQuery.refetch();
        if (cancelled) {
          return;
        }

        if (!meResult.data) {
          clearSessionState();
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearCookie('poolmaster_csrf');
          clearSessionState();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clearSessionState, meQuery.error, meQuery.refetch, refreshQuery.refetch]);

  const value: AuthContextValue = {
    isAuthenticated: Boolean(user),
    isLoading: meQuery.isLoading || refreshQuery.isFetching,
    isRootAdmin: user?.isRootAdmin ?? false,
    user,
    clearSession: async () => {
      await logoutUser().catch(() => undefined);
      clearCookie('poolmaster_csrf');
      clearSessionState();
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
