import { readAppEnv } from './config';

const ACCESS_COOKIE = 'poolmaster_access';
const REFRESH_COOKIE = 'poolmaster_refresh';
const CSRF_COOKIE = 'poolmaster_csrf';
const ACCESS_MAX_AGE_SECONDS = 15 * 60;
const REFRESH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
  maxAge?: number;
};

/**
 * Environments that may serve session cookies without the `Secure` attribute.
 *
 * This list is the EXCEPTION, not the rule: anything not named here gets `Secure`.
 * That direction is deliberate — the previous version tested
 * `process.env.NODE_ENV === 'production'`, and Terraform sets `NODE_ENV` to
 * `var.environment`, which `infrastructure/terraform/variables.tf` validates to
 * `qa` | `staging` | `prod`. The string `'production'` is therefore never present in
 * any deployed environment, so the check was false everywhere and the three session
 * cookies shipped without `Secure` (#182).
 *
 * Listing the insecure environments instead of the secure ones means adding a new
 * deployment target cannot silently reintroduce that: an unrecognised environment
 * name fails closed, with `Secure` on.
 */
const INSECURE_COOKIE_ENVIRONMENTS: ReadonlySet<string> = new Set([
  'development',
  'test',
  'local',
]);

function isSecureCookieEnvironment(): boolean {
  return !INSECURE_COOKIE_ENVIRONMENTS.has(readAppEnv().toLowerCase());
}

function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.httpOnly ?? false) {
    parts.push('HttpOnly');
  }
  if (options.secure ?? isSecureCookieEnvironment()) {
    parts.push('Secure');
  }
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }
  return cookieHeader.split(';').reduce<Record<string, string>>((accumulator, part) => {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey) {
      return accumulator;
    }
    accumulator[rawKey] = decodeURIComponent(rest.join('='));
    return accumulator;
  }, {});
}

export function readAccessCookie(cookieHeader?: string): string | undefined {
  return parseCookies(cookieHeader)[ACCESS_COOKIE];
}

export function readRefreshCookie(cookieHeader?: string): string | undefined {
  return parseCookies(cookieHeader)[REFRESH_COOKIE];
}

export function readCsrfCookie(cookieHeader?: string): string | undefined {
  return parseCookies(cookieHeader)[CSRF_COOKIE];
}

export function createSessionCookieHeaders(tokens: {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}): string[] {
  return [
    serializeCookie(ACCESS_COOKIE, tokens.accessToken, {
      httpOnly: true,
      maxAge: ACCESS_MAX_AGE_SECONDS,
    }),
    serializeCookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      maxAge: REFRESH_MAX_AGE_SECONDS,
    }),
    serializeCookie(CSRF_COOKIE, tokens.csrfToken, {
      httpOnly: false,
      maxAge: REFRESH_MAX_AGE_SECONDS,
    }),
  ];
}

export function createClearedSessionCookieHeaders(): string[] {
  return [
    serializeCookie(ACCESS_COOKIE, '', { httpOnly: true, maxAge: 0 }),
    serializeCookie(REFRESH_COOKIE, '', { httpOnly: true, maxAge: 0 }),
    serializeCookie(CSRF_COOKIE, '', { httpOnly: false, maxAge: 0 }),
  ];
}

export function isStateChangingMethod(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}
