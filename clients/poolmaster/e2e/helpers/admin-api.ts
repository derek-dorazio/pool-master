import type { APIRequestContext } from '@playwright/test';
import type { AdminCredentials } from './admin-session';

/**
 * #84 — what every spec's API teardown shares: an admin bearer token, and the best-effort
 * discipline that keeps teardown from ever failing a test. Teardown goes through the API, not
 * the UI, because it is not the thing under test.
 */

export type Log = (message: string) => void;
export type AuthHeaders = Record<string, string>;

/** A bearer token rather than the session cookies, so state-changing calls need no CSRF header. */
export async function adminApiHeaders(
  api: APIRequestContext,
  credentials: AdminCredentials,
): Promise<AuthHeaders | null> {
  const login = await api.post('/api/v1/auth/login', {
    data: { identifier: credentials.identifier, password: credentials.password },
  });
  if (!login.ok()) {
    return null;
  }
  const { tokens } = (await login.json()) as { tokens: { accessToken: string } };
  return { Authorization: `Bearer ${tokens.accessToken}` };
}

/** Runs one removal; a failure is logged as residue and the next removal still runs. */
export async function attempt(log: Log, what: string, remove: () => Promise<void>): Promise<void> {
  try {
    await remove();
  } catch (error) {
    log(`could not remove ${what}; it may remain: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function expectOk(pending: ReturnType<APIRequestContext['get']>, action: string) {
  const response = await pending;
  if (!response.ok()) {
    throw new Error(`${action} failed: ${response.status()} ${await response.text()}`);
  }
  return response;
}
