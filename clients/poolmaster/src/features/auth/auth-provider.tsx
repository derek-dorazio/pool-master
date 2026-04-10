import { ReactNode, createContext, useContext, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCurrentUser, logoutUser, refreshToken } from '@/lib/api';
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
  const user = useSessionStore((state) => state.user);
  const setSession = useSessionStore((state) => state.setSession);
  const clearSessionState = useSessionStore((state) => state.clearSession);

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

    setSession(meQuery.data);
  }, [meQuery.data, setSession]);

  useEffect(() => {
    if (!meQuery.error) {
      return;
    }
    refreshQuery.refetch()
      .then(async (result) => {
        if (result.data) {
          await meQuery.refetch();
          return;
        }
        clearSessionState();
      })
      .catch(() => {
        clearSessionState();
      });
  }, [clearSessionState, meQuery, meQuery.error, refreshQuery]);

  const value: AuthContextValue = {
    isAuthenticated: Boolean(user),
    isLoading: meQuery.isLoading || refreshQuery.isFetching,
    isRootAdmin: user?.isRootAdmin ?? false,
    user,
    clearSession: async () => {
      await logoutUser().catch(() => undefined);
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
