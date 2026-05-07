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
    sessionId: 'session-1',
    ...overrides,
  };
}

describe('pool-master-rop.78.11 auth session cache', () => {
  it('pool-master-rop.78.11 preserves the cached session id when account updates omit it', () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(AUTH_ME_QUERY_KEY, buildUser({ sessionId: 'session-1' }));

    const updatedUser = setAuthSessionUser(queryClient, buildUser({
      firstName: 'Dee',
      sessionId: undefined,
    }));

    expect(updatedUser.sessionId).toBe('session-1');
    expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)).toMatchObject({
      firstName: 'Dee',
      sessionId: 'session-1',
    });
  });

  it('pool-master-rop.78.11 clears auth server-state without a Zustand mirror', () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(AUTH_ME_QUERY_KEY, buildUser());
    queryClient.setQueryData(AUTH_REFRESH_QUERY_KEY, { sessionId: 'session-1' });

    clearAuthSession(queryClient);

    expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toBeNull();
    expect(queryClient.getQueryData(AUTH_REFRESH_QUERY_KEY)).toBeUndefined();
  });
});
