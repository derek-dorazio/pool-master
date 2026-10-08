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

  it('rule: client observability attaches stable trace id and unique request id to outbound requests', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
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
      const { getUser } = await import('./api');

      await getUser({ path: { userId: 'me' } });

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

  it('pool-master-rop.64 falls back to a client request id when crypto.randomUUID is unavailable', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ user: null }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    vi.stubGlobal('crypto', {});
    vi.stubGlobal('fetch', fetchSpy);

    try {
      const { getUser } = await import('./api');

      await getUser({ path: { userId: 'me' } });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const request = fetchSpy.mock.calls[0]?.[0];
      expect(request).toBeInstanceOf(Request);
      expect((request as Request).headers.get('X-Client-Request-Id')).toMatch(/^pm-\d+-[a-f0-9]+$/);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('rule: SDK API base URL config prefers VITE_API_BASE_URL over the browser origin', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test');

    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ user: null }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    vi.stubGlobal('fetch', fetchSpy);

    try {
      const { getUser } = await import('./api');

      await getUser({ path: { userId: 'me' } });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const request = fetchSpy.mock.calls[0]?.[0];
      expect(request).toBeInstanceOf(Request);
      expect(new URL((request as Request).url).origin).toBe('https://api.example.test');
      expect((request as Request).url).toContain('/api/v1/users/me');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('pool-master-dxd.23 normalizes a trailing slash in VITE_API_BASE_URL before configuring the SDK', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/');

    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ user: null }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    vi.stubGlobal('fetch', fetchSpy);

    try {
      const { getUser, resolveBaseUrl } = await import('./api');

      expect(resolveBaseUrl()).toBe('https://api.example.test');
      await getUser({ path: { userId: 'me' } });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const request = fetchSpy.mock.calls[0]?.[0];
      expect(request).toBeInstanceOf(Request);
      expect((request as Request).url).toBe('https://api.example.test/api/v1/users/me');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('pool-master-dxd.26 attaches the CSRF token cookie to mutating requests', async () => {
    document.cookie = `poolmaster_csrf=${encodeURIComponent('csrf-token-123')}; path=/`;
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
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
            users: [],
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
      const { listUsers } = await import('./api');

      const response = await listUsers({
        query: {
          search: 'Commis',
        },
      });

      expect(response.data?.users).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(new URL(fetchCallUrl(fetchSpy.mock.calls[1]?.[0])).pathname).toBe('/api/v1/auth/refresh');
      expect(new URL(fetchCallUrl(fetchSpy.mock.calls[2]?.[0])).pathname).toBe('/api/v1/users/');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('refreshes once when several requests find the access session expired at the same time, and retries them all', async () => {
    // The refresh token rotates: the server accepts it once and refuses any later refresh
    // that still carries it. Requests that 401 together all carry the same old cookie, so
    // only one refresh may go out for them; a second would be refused and its request lost.
    let sessionValid = false;
    let refreshCalls = 0;
    const json = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const fetchSpy = vi.fn((input: RequestInfo | URL) => Promise.resolve(respond(input)));
    function respond(input: RequestInfo | URL): Response {
      const pathname = new URL(fetchCallUrl(input)).pathname;
      if (pathname === '/api/v1/auth/refresh') {
        refreshCalls += 1;
        if (refreshCalls > 1) {
          return json({ error: { code: 'INVALID_REFRESH_TOKEN', message: 'Invalid or expired refresh token' } }, 401);
        }
        sessionValid = true;
        return json({ accessToken: 'access-2', refreshToken: 'refresh-2', csrfToken: 'csrf-2', expiresIn: 900 }, 200);
      }
      if (!sessionValid) {
        return json({ error: { code: 'AUTH_ACCESS_TOKEN_INVALID', message: 'Invalid or expired access token' } }, 401);
      }
      return json({ leagues: [] }, 200);
    }

    vi.stubGlobal('fetch', fetchSpy);

    try {
      const { listLeagues } = await import('./api');

      const responses = await Promise.all([listLeagues(), listLeagues(), listLeagues()]);

      expect(responses.map((response) => response.data?.leagues)).toEqual([[], [], []]);
      expect(refreshCalls).toBe(1);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
