import type { APIRequestContext, Page } from '@playwright/test';
import { readCsrfToken } from './browser-writes';
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

/**
 * The tier and pricing profile ids a sport league a spec creates through the API names: the tier
 * profile its sport's leagues name, by name, and Standard pricing.
 */
export async function sportLeagueProfileIds(
  api: APIRequestContext,
  headers: AuthHeaders,
  tierProfileName: string,
): Promise<{ tierProfileId: string; pricingProfileId: string }> {
  const [tierList, pricingList] = await Promise.all([
    expectOk(api.get('/api/v1/tier-profiles/', { headers }), 'list tier profiles'),
    expectOk(api.get('/api/v1/pricing-profiles/', { headers }), 'list pricing profiles'),
  ]);
  const { tierProfiles } = (await tierList.json()) as { tierProfiles: Array<{ id: string; name: string }> };
  const { pricingProfiles } = (await pricingList.json()) as { pricingProfiles: Array<{ id: string; name: string }> };
  const tierProfileId = tierProfiles.find((profile) => profile.name === tierProfileName)?.id;
  const pricingProfileId = pricingProfiles.find((profile) => profile.name === 'Standard')?.id;
  if (!tierProfileId || !pricingProfileId) {
    throw new Error(`the "${tierProfileName}" tier profile or the Standard pricing profile is missing`);
  }
  return { tierProfileId, pricingProfileId };
}

/**
 * Creates a sport league for a journey through the API, signed as the browser's root admin. A
 * league is added by migration (the `add-sport` skill), so the web app has no page that makes
 * one; the create route stays only for these journeys until they run on seeded leagues.
 */
export async function createJourneySportLeague(
  page: Page,
  league: { sport: string; name: string; tierProfileName: string },
): Promise<string> {
  const headers = { 'x-csrf-token': await readCsrfToken(page) };
  const profiles = await sportLeagueProfileIds(page.request, headers, league.tierProfileName);
  const response = await expectOk(
    page.request.post('/api/v1/sport-leagues/', { headers, data: { sport: league.sport, name: league.name, ...profiles } }),
    `create sport league ${league.name}`,
  );
  const { sportLeague } = (await response.json()) as { sportLeague: { id: string } };
  return sportLeague.id;
}
