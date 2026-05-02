import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClientTraceIdForTests } from './logger';

function fetchCallUrl(callArg: unknown) {
  if (callArg instanceof Request) {
    return callArg.url;
  }
  return String(callArg);
}

describe('poolmaster API client correlation headers', () => {
  beforeEach(() => {
    vi.resetModules();
    resetClientTraceIdForTests();
    window.sessionStorage.clear();
    document.cookie = 'poolmaster_csrf=; Max-Age=0; path=/';
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

  it('pool-master-dxd.23 normalizes a trailing slash in VITE_API_BASE_URL before configuring the SDK', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/');

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
      const { getCurrentUser, resolveBaseUrl } = await import('./api');

      expect(resolveBaseUrl()).toBe('https://api.example.test');
      await getCurrentUser();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const request = fetchSpy.mock.calls[0]?.[0];
      expect(request).toBeInstanceOf(Request);
      expect((request as Request).url).toBe('https://api.example.test/api/v1/auth/me');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('pool-master-dxd.26 attaches the CSRF token cookie to mutating requests', async () => {
    document.cookie = `poolmaster_csrf=${encodeURIComponent('csrf-token-123')}; path=/`;
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ league: { id: 'league-1' } }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    vi.stubGlobal('fetch', fetchSpy);

    try {
      const { createLeague } = await import('./api');

      await createLeague({
        body: {
          name: 'CSRF League',
          leagueCode: 'CSRF123',
        },
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const request = fetchSpy.mock.calls[0]?.[0];
      expect(request).toBeInstanceOf(Request);
      expect((request as Request).method).toBe('POST');
      expect((request as Request).headers.get('X-CSRF-Token')).toBe('csrf-token-123');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      document.cookie = 'poolmaster_csrf=; Max-Age=0; path=/';
    }
  });

  it('pool-master-1rq refreshes and retries league requests when the access session expires', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'AUTH_SESSION_REQUIRED',
              message: 'Authenticated session required',
            },
          }),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: 'access-2',
            refreshToken: 'refresh-2',
            csrfToken: 'csrf-2',
            sessionId: 'session-2',
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ leagues: [] }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );

    vi.stubGlobal('fetch', fetchSpy);

    try {
      const { listLeagues } = await import('./api');

      const response = await listLeagues();

      expect(response.data?.leagues).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(new URL(fetchCallUrl(fetchSpy.mock.calls[1]?.[0])).pathname).toBe('/api/v1/auth/refresh');
      expect(new URL(fetchCallUrl(fetchSpy.mock.calls[2]?.[0])).pathname).toBe('/api/v1/leagues/');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('pool-master-h61 refreshes and retries root-admin requests when the root-admin access session expires', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'ROOT_ADMIN_SESSION_REQUIRED',
              message: 'Authenticated root-admin session required',
            },
          }),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: 'access-2',
            refreshToken: 'refresh-2',
            csrfToken: 'csrf-2',
            sessionId: 'session-2',
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [],
            page: 1,
            pageSize: 25,
            total: 0,
            totalPages: 1,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );

    vi.stubGlobal('fetch', fetchSpy);

    try {
      const { adminListUsers } = await import('./api');

      const response = await adminListUsers({
        query: {
          search: 'Commis',
          page: 1,
          pageSize: 25,
        },
      });

      expect(response.data?.items).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(new URL(fetchCallUrl(fetchSpy.mock.calls[1]?.[0])).pathname).toBe('/api/v1/auth/refresh');
      expect(new URL(fetchCallUrl(fetchSpy.mock.calls[2]?.[0])).pathname).toBe('/api/v1/admin/users');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
