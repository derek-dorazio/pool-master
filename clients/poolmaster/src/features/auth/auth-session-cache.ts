import type { QueryClient } from '@tanstack/react-query';
import type {
  GetCurrentUserResponses,
  InactivateAccountResponses,
  ReactivateAccountResponses,
  UpdateAccountPreferencesResponses,
  UpdateAccountProfileResponses,
} from '@/lib/api';

export const AUTH_ME_QUERY_KEY = ['poolmaster', 'auth', 'me'] as const;
export const AUTH_REFRESH_QUERY_KEY = ['poolmaster', 'auth', 'refresh'] as const;

export type AuthSessionUser = GetCurrentUserResponses[200]['user'];
export type AuthSessionData = AuthSessionUser | null;
export type AuthSessionUserUpdate =
  | AuthSessionUser
  | UpdateAccountProfileResponses[200]['user']
  | UpdateAccountPreferencesResponses[200]['user']
  | ReactivateAccountResponses[200]['user']
  | InactivateAccountResponses[200]['user'];

function withResolvedSessionId(
  user: AuthSessionUserUpdate,
  previousUser: AuthSessionData | undefined,
): AuthSessionUser {
  return {
    ...user,
    sessionId: user.sessionId ?? previousUser?.sessionId ?? null,
  };
}

export function setAuthSessionUser(
  queryClient: QueryClient,
  user: AuthSessionUserUpdate,
): AuthSessionUser {
  const resolvedUser = withResolvedSessionId(
    user,
    queryClient.getQueryData<AuthSessionData>(AUTH_ME_QUERY_KEY),
  );
  queryClient.setQueryData<AuthSessionData>(AUTH_ME_QUERY_KEY, resolvedUser);
  return resolvedUser;
}

export function clearAuthSession(queryClient: QueryClient): void {
  queryClient.setQueryData<AuthSessionData>(AUTH_ME_QUERY_KEY, null);
  queryClient.removeQueries({ queryKey: AUTH_REFRESH_QUERY_KEY, exact: true });
}
