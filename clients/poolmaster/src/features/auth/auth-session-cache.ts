import type { QueryClient } from '@tanstack/react-query';
import type { UserDto } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';

export const AUTH_ME_QUERY_KEY = QueryKeys.auth.me;
export const AUTH_REFRESH_QUERY_KEY = QueryKeys.auth.refresh;

/**
 * The cached session user is the canonical `UserDto` (#202).
 *
 * `AuthSessionUserUpdate` used to be a union of four response-map derivations — the `user`
 * field read out of the update-profile, update-preferences, enable-user and disable-user
 * response maps in turn. That was four spellings of one type, and it coupled this file to the
 * *shape of four response envelopes*. Every user operation now returns `UserResponse`, so the
 * union is `UserDto`.
 */
export type AuthSessionUser = UserDto;
export type AuthSessionData = AuthSessionUser | null;

// #206 — this used to carry a `withResolvedSessionId` merge, because account responses
// returned a user without the `sessionId` that the current-user read had supplied and a naive
// setQueryData would erase it. No response carries a session id any more, so the cached
// user is whatever the server last returned.
export function setAuthSessionUser(
  queryClient: QueryClient,
  user: AuthSessionUser,
): AuthSessionUser {
  queryClient.setQueryData<AuthSessionData>(AUTH_ME_QUERY_KEY, user);
  return user;
}

export function clearAuthSession(queryClient: QueryClient): void {
  queryClient.setQueryData<AuthSessionData>(AUTH_ME_QUERY_KEY, null);
  queryClient.removeQueries({ queryKey: AUTH_REFRESH_QUERY_KEY, exact: true });
}
