import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClientTraceIdForTests } from './logger';

describe('poolmaster API client correlation headers', () => {
  beforeEach(() => {
    vi.resetModules();
    resetClientTraceIdForTests();
    window.sessionStorage.clear();
  });

  it('attaches stable client trace id and unique client request id to outbound requests', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: null }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');

    try {
      const { getCurrentUser } = await import('./api');

      await getCurrentUser();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const request = fetchSpy.mock.calls[0]?.[0];
      expect(request).toBeInstanceOf(Request);
      expect((request as Request).headers.get('X-Client-Trace-Id')).toBe('11111111-1111-4111-8111-111111111111');
      expect((request as Request).headers.get('X-Client-Request-Id')).toBe('22222222-2222-4222-8222-222222222222');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('prefers an explicit VITE_API_BASE_URL over the browser origin', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test');

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: null }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    vi.stubGlobal('fetch', fetchSpy);

    try {
      const { getCurrentUser } = await import('./api');

      await getCurrentUser();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const request = fetchSpy.mock.calls[0]?.[0];
      expect(request).toBeInstanceOf(Request);
      expect(new URL((request as Request).url).origin).toBe('https://api.example.test');
      expect((request as Request).url).toContain('/api/v1/auth/me');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
