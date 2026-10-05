/**
 * The auth context and the `useAuth` hook that reads it.
 *
 * Split out of `auth-provider.tsx` for `react-refresh/only-export-components`
 * (#345 Phase 0, from #167): that module exports the `AuthProvider` component, so
 * the hook exported beside it broke Fast Refresh for the provider -- and since the
 * provider wraps the whole app, every edit to it forced a full reload.
 *
 * The context object has to live here rather than stay in `auth-provider.tsx`:
 * the provider and the hook must close over the SAME context instance, so it
 * belongs in the module they both import rather than in either one of them.
 */
import { createContext, useContext } from 'react';
import type { AuthSessionData } from './auth-session-cache';

export type AuthContextValue = {
  isAuthenticated: boolean;
  isLoading: boolean;
  isRootAdmin: boolean;
  user: AuthSessionData;
  clearSession: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }
  return value;
}
