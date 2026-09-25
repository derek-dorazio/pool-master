import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  AUTH_ME_QUERY_KEY,
  AUTH_REFRESH_QUERY_KEY,
  clearAuthSession,
  setAuthSessionUser,
  type AuthSessionUser,
} from './auth-session-cache';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function buildUser(overrides?: Partial<AuthSessionUser>): AuthSessionUser {
  return {
    id: 'user-1',
    username: 'derek',
    email: 'derek@example.com',
    firstName: 'Derek',
    lastName: 'Dorazio',
    isActive: true,
    isRootAdmin: false,
    createdAt: '2026-04-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('pool-master-rop.78.11 auth session cache', () => {
  // #206 — this used to assert that a `sessionId` absent from an account response was
  // preserved from the previously cached user. No response carries a session id now, so
  // the behaviour under test is the plain replacement that remains.
  it('pool-master-rop.78.11 caches the user an account update returns', () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(AUTH_ME_QUERY_KEY, buildUser());

    const updatedUser = setAuthSessionUser(queryClient, buildUser({ firstName: 'Dee' }));

    expect(updatedUser.firstName).toBe('Dee');
    expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)).toMatchObject({
      id: 'user-1',
      firstName: 'Dee',
    });
  });

  it('pool-master-rop.78.11 clears auth server-state without a Zustand mirror', () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(AUTH_ME_QUERY_KEY, buildUser());
    queryClient.setQueryData(AUTH_REFRESH_QUERY_KEY, { expiresIn: 900 });

    clearAuthSession(queryClient);

    expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toBeNull();
    expect(queryClient.getQueryData(AUTH_REFRESH_QUERY_KEY)).toBeUndefined();
  });
});
