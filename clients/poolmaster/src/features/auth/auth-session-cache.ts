import type { QueryClient } from '@tanstack/react-query';
import type { InactivateAccountResponses, ReactivateAccountResponses, UpdateAccountPreferencesResponses, UpdateAccountProfileResponses, UserProfileDto } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';

export const AUTH_ME_QUERY_KEY = QueryKeys.auth.me;
export const AUTH_REFRESH_QUERY_KEY = QueryKeys.auth.refresh;

export type AuthSessionUser = UserProfileDto;
export type AuthSessionData = AuthSessionUser | null;
export type AuthSessionUserUpdate =
  | AuthSessionUser
  | UpdateAccountProfileResponses[200]['user']
  | UpdateAccountPreferencesResponses[200]['user']
  | ReactivateAccountResponses[200]['user']
  | InactivateAccountResponses[200]['user'];

// #206 — this used to carry a `withResolvedSessionId` merge, because account responses
// returned a user without the `sessionId` that /auth/me had supplied and a naive
// setQueryData would erase it. No response carries a session id any more, so the cached
// user is whatever the server last returned.
export function setAuthSessionUser(
  queryClient: QueryClient,
  user: AuthSessionUserUpdate,
): AuthSessionUser {
  queryClient.setQueryData<AuthSessionData>(AUTH_ME_QUERY_KEY, user);
  return user;
}

export function clearAuthSession(queryClient: QueryClient): void {
  queryClient.setQueryData<AuthSessionData>(AUTH_ME_QUERY_KEY, null);
  queryClient.removeQueries({ queryKey: AUTH_REFRESH_QUERY_KEY, exact: true });
}
