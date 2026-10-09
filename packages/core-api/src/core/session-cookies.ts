import { AppEnvironment, readAppEnv } from './config';

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
 * This list is the EXCEPTION, not the rule: every other environment gets `Secure`. The
 * check used to be `process.env.NODE_ENV === 'production'`, which was false in every
 * deployment because Terraform set `NODE_ENV` to `qa` | `staging` | `prod`, so the three
 * session cookies shipped without `Secure` (#182). Naming the insecure environments means
 * adding a deployment target cannot reintroduce that.
 */
const INSECURE_COOKIE_ENVIRONMENTS: ReadonlySet<AppEnvironment> = new Set([
  AppEnvironment.DEVELOPMENT,
  AppEnvironment.TEST,
]);

function isSecureCookieEnvironment(): boolean {
  return !INSECURE_COOKIE_ENVIRONMENTS.has(readAppEnv());
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
    accumulator[rawKey] = decodeCookieValue(rest.join('='));
    return accumulator;
  }, {});
}

/**
 * The request's Cookie header carries every cookie the browser holds for the host, not only
 * ours, and nothing obliges another site's cookie to be valid percent-encoding. Letting
 * `decodeURIComponent` throw on one of them turned every cookie-session request into a 500,
 * so a value that does not decode is kept as it was sent.
 */
function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
