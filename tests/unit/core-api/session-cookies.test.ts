/**
 * #182 — session cookies shipped without `Secure` in every deployed environment.
 *
 * The old check was `process.env.NODE_ENV === 'production'`. Terraform sets
 * `NODE_ENV` to `var.environment`, which variables.tf validates to `qa | staging |
 * prod` — so `'production'` never appeared anywhere and the comparison was false
 * in every deployment.
 *
 * These cases assert against the values the infrastructure ACTUALLY sets. A test
 * written against a plausible-looking `'production'` would have passed while the
 * defect shipped, which is precisely how this survived.
 */

import {
  createSessionCookieHeaders,
  createClearedSessionCookieHeaders,
  parseCookies,
  readAccessCookie,
} from '../../../packages/core-api/src/core/session-cookies';

const TOKENS = {
  accessToken: 'access-token-value',
  refreshToken: 'refresh-token-value',
  csrfToken: 'csrf-token-value',
};

const ORIGINAL_ENV = process.env.POOLMASTER_ENVIRONMENT;

afterEach(() => {
  process.env.POOLMASTER_ENVIRONMENT = ORIGINAL_ENV;
});

function headersFor(environment: string): string[] {
  process.env.POOLMASTER_ENVIRONMENT = environment;
  return createSessionCookieHeaders(TOKENS);
}

describe('#182: session cookie Secure attribute', () => {
  // The value Terraform sets today. variables.tf defaults var.environment to "qa"
  // and the only live environment is QA, so this is the case that was broken.
  it.each(['ci', 'qa', 'staging', 'prod'])(
    'rule: sets Secure on all three session cookies in %s',
    (environment) => {
      const headers = headersFor(environment);
      expect(headers).toHaveLength(3);
      for (const header of headers) {
        expect(header).toContain('Secure');
      }
    },
  );

  it('rule: an unrecognised environment name refuses to build cookies rather than guess', () => {
    // Adding a deployment target must not silently reintroduce #182.
    expect(() => headersFor('some-new-environment')).toThrow(/not a known environment/);
  });

  it('rule: sets Secure in prod even though NODE_ENV is "production", the value Terraform sets', () => {
    process.env.NODE_ENV = 'production';
    try {
      for (const header of headersFor('prod')) {
        expect(header).toContain('Secure');
      }
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  it.each(['development', 'test'])(
    'rule: omits Secure in %s, so local HTTP development still works',
    (environment) => {
      for (const header of headersFor(environment)) {
        expect(header).not.toContain('Secure');
      }
    },
  );

  it('rule: environment matching is case-insensitive', () => {
    for (const header of headersFor('Development')) {
      expect(header).not.toContain('Secure');
    }
  });

  it('rule: cleared cookies carry Secure in a deployed environment too', () => {
    process.env.POOLMASTER_ENVIRONMENT = 'qa';
    for (const header of createClearedSessionCookieHeaders()) {
      expect(header).toContain('Secure');
    }
  });

  it('rule: HttpOnly stays on the token cookies and off the CSRF cookie', () => {
    const [access, refresh, csrf] = headersFor('qa');
    expect(access).toContain('HttpOnly');
    expect(refresh).toContain('HttpOnly');
    expect(csrf).not.toContain('HttpOnly');
  });
});

describe('reading the session cookies from a request', () => {
  it('reads the session cookie when another cookie on the request is not valid percent-encoding', () => {
    const header = 'site_tracker=%E0%A4%A; poolmaster_access=token%2Fvalue';

    expect(readAccessCookie(header)).toBe('token/value');
  });

  it('keeps a cookie whose value is not valid percent-encoding as it was sent, instead of throwing', () => {
    expect(parseCookies('discount=100%; theme=dark')).toEqual({ discount: '100%', theme: 'dark' });
  });

  it('keeps an equals sign inside a cookie value and skips an empty segment', () => {
    expect(parseCookies('a=b=c;; d=e')).toEqual({ a: 'b=c', d: 'e' });
  });
});
