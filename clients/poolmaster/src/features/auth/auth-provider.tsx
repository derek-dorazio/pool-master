import { ReactNode, createContext, useContext, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCurrentUser, logoutUser, setApiAccessToken } from '@/lib/api';
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
  const mode = useSessionStore((state) => state.mode);
  const tokens = useSessionStore((state) => state.tokens);
  const user = useSessionStore((state) => state.user);
  const setMemberSession = useSessionStore((state) => state.setMemberSession);
  const clearSessionState = useSessionStore((state) => state.clearSession);

  const meQuery = useQuery({
    queryKey: ['poolmaster', 'auth', 'me', tokens?.accessToken],
    queryFn: async () => {
      const response = await getCurrentUser({
        headers: tokens?.accessToken
          ? {
              Authorization: `Bearer ${tokens.accessToken}`,
            }
          : undefined,
      });
      if (!response.data?.user) {
        throw new Error('Current user profile is missing from the auth response.');
      }
      return response.data.user;
    },
    enabled: Boolean(tokens?.accessToken && mode === 'member'),
    retry: false,
  });

  useEffect(() => {
    setApiAccessToken(tokens?.accessToken ?? null);
  }, [tokens?.accessToken]);

  useEffect(() => {
    if (!meQuery.data || !tokens) {
      return;
    }

    setMemberSession({
      tokens,
      user: {
        id: meQuery.data.id,
        email: meQuery.data.email,
        displayName: meQuery.data.displayName,
      },
    });
  }, [meQuery.data, setMemberSession, tokens]);

  useEffect(() => {
    if (!tokens?.accessToken) {
      return;
    }

    if (meQuery.error) {
      clearSessionState();
    }
  }, [clearSessionState, meQuery.error, tokens?.accessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: Boolean(tokens?.accessToken && user),
      isLoading: Boolean(tokens?.accessToken) && meQuery.isLoading,
      isRootAdmin: false,
      user,
      clearSession: async () => {
        if (tokens?.refreshToken) {
          await logoutUser({
            body: {
              refreshToken: tokens.refreshToken,
            },
            headers: tokens.accessToken
              ? {
                  Authorization: `Bearer ${tokens.accessToken}`,
                }
              : undefined,
          }).catch(() => undefined);
        }
        setApiAccessToken(null);
        clearSessionState();
      },
    }),
    [clearSessionState, meQuery.isLoading, mode, tokens?.accessToken, tokens?.refreshToken, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }
  return value;
}
