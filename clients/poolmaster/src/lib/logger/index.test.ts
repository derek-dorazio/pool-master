import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_ME_QUERY_KEY,
  clearAuthSession,
  type AuthSessionData,
} from '@/features/auth/auth-session-cache';
import { queryClient } from '@/lib/query-client';
import { getLogger, logger } from './index';

describe('pool-master-dxd.24: logger accessor naming', () => {
  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('exports getLogger for singleton access without pretending to be a React hook', () => {
    expect(getLogger()).toBe(logger);
  });

  it('pool-master-rop.78.11 resolves logger auth context from the query cache', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    queryClient.setQueryData<AuthSessionData>(AUTH_ME_QUERY_KEY, {
      id: 'user-1',
      username: 'derek',
      email: 'derek@example.com',
      firstName: 'Derek',
      lastName: 'Dorazio',
      isActive: true,
      isRootAdmin: false,
      createdAt: '2026-04-22T00:00:00.000Z',
      sessionId: 'session-1',
    });

    logger.warn({ action: 'test.authContext' }, 'with cached auth context');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'test.authContext',
        sessionId: 'session-1',
        userId: 'user-1',
      }),
    );

    clearAuthSession(queryClient);
    logger.warn({ action: 'test.authContextCleared' }, 'with cleared auth context');

    expect(warnSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'test.authContextCleared',
        sessionId: null,
        userId: null,
      }),
    );
  });
});
