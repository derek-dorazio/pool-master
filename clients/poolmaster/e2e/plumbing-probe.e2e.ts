import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  adminSignInReachManageLogOut,
  logOut,
  readAdminCredentials,
  type AdminCredentials,
} from './helpers/admin-session';
import { GENERATED_PASSWORD_PREFIX } from './redact-artifacts';

/**
 * #278 — the phase 2 plumbing probe (plans/130). Proves the mechanisms the journey suite
 * rests on, and nothing about the product: a per-run id that keeps every created name
 * unique, a brand-new user registering and writing through the UI, a role switch inside one
 * browser session, and API teardown with the admin token. Pre-merge only; it writes domain
 * data, so it is deliberately untagged and never runs against QA.
 */

type RunData = {
  runId: string;
  username: string;
  email: string;
  leagueName: string;
  leagueCode: string;
};

let admin: AdminCredentials | undefined;
let run: RunData | undefined;

test.afterAll(async ({ playwright }, testInfo) => {
  if (!admin || !run) {
    return;
  }

  const api = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  try {
    await removeRunData(api, admin, run);
  } catch (error) {
    // Teardown is not the thing under test: report what was left, never fail the test.
    console.error(`[teardown ${run.runId}] aborted, run data may remain:`, error);
  } finally {
    await api.dispose();
  }
});

test('a fresh user registers and creates a league after an admin session in the same browser', async ({ page }) => {
  test.setTimeout(90_000);
  const credentials = readAdminCredentials();
  admin = credentials;

  // Inside the test body, not at module load: a retry re-imports this module in a new
  // worker and must get its own id rather than collide with its first attempt.
  const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  run = {
    runId,
    username: `e2e-c-${runId}`,
    // RFC 2606 reserves .invalid, so nothing sent here can reach a real mailbox.
    email: `e2e-c-${runId}@e2e.invalid`,
    leagueName: `E2E Probe ${runId}`,
    leagueCode: `E2E${runId.toUpperCase()}`,
  };
  const created = run;
  console.log(`[probe ${runId}] user=${created.username} league=${created.leagueCode}`);

  await test.step('act one: root admin signs in, reaches /manage, logs out', async () => {
    await adminSignInReachManageLogOut(page, credentials);
  });

  await test.step('act two: a fresh user registers, creates a league, logs out', async () => {
    await page.getByTestId('auth-mode-register').click();
    await page.getByTestId('auth-register-first-name').fill('E2E');
    await page.getByTestId('auth-register-last-name').fill(`Probe ${runId}`);
    await page.getByTestId('auth-register-email').fill(created.email);
    await page.getByTestId('auth-register-username').fill(created.username);
    // Never needed again: teardown deletes this user with the admin token. The prefix is
    // what lets redact-artifacts.ts find it in a trace.
    const userPassword = `${GENERATED_PASSWORD_PREFIX}${randomBytes(12).toString('hex')}`;
    await page.getByTestId('auth-register-password').fill(userPassword);
    await page.getByTestId('auth-register-confirm-password').fill(userPassword);
    await page.getByTestId('auth-register-submit').click();
    await expect(page.getByTestId('authenticated-landing')).toBeVisible();

    await page.getByTestId('welcome-create-league').click();
    // Code before name: leaving the name field suggests a code from it, and that suggestion
    // lands after a fill that moved focus away. Typing the code first marks it user-edited,
    // so no suggestion ever replaces it.
    await page.getByTestId('create-league-code').fill(created.leagueCode);
    await page.getByTestId('create-league-name').fill(created.leagueName);
    await page.getByTestId('create-league-description').fill(`Plumbing probe run ${runId}`);
    await page.getByTestId('create-league-next').click();
    await page.getByTestId('create-league-submit').click();

    await expect(page.getByTestId('league-home')).toBeVisible();
    await expect(page.getByTestId('league-summary-name')).toHaveText(created.leagueName);

    await logOut(page);
  });
});

async function removeRunData(
  api: APIRequestContext,
  credentials: AdminCredentials,
  created: RunData,
): Promise<void> {
  const log = (message: string) => console.log(`[teardown ${created.runId}] ${message}`);

  const login = await api.post('/api/v1/auth/login', {
    data: { identifier: credentials.identifier, password: credentials.password },
  });
  if (!login.ok()) {
    log(`admin login failed (${login.status()}); could not remove league ${created.leagueCode} or user ${created.username}`);
    return;
  }
  const { tokens } = (await login.json()) as { tokens: { accessToken: string } };
  // A bearer token, not the session cookies, so state-changing calls need no CSRF header.
  const headers = { Authorization: `Bearer ${tokens.accessToken}` };

  // The registered user is the league's commissioner, so the league goes first.
  const leagueByCode = `/api/v1/leagues/code/${created.leagueCode}`;
  const league = await api.get(leagueByCode, { headers });
  if (league.status() === 404) {
    log(`league ${created.leagueCode} was never created; nothing to remove`);
  } else if (!league.ok()) {
    log(`could not resolve league ${created.leagueCode} (${league.status()}); it may remain`);
  } else {
    const { league: { id: leagueId } } = (await league.json()) as { league: { id: string } };
    await expectOk(api.post(`/api/v1/leagues/${leagueId}/inactivate`, { headers }), 'inactivate league');
    await expectOk(
      api.delete(`/api/v1/leagues/${leagueId}`, { headers, data: { leagueCode: created.leagueCode } }),
      'delete league',
    );
    const reread = await api.get(leagueByCode, { headers });
    log(reread.status() === 404
      ? `league ${created.leagueCode} removed (re-read 404)`
      : `league ${created.leagueCode} STILL PRESENT after delete (re-read ${reread.status()})`);
  }

  const search = await api.get('/api/v1/users/', { headers, params: { search: created.username } });
  if (!search.ok()) {
    log(`could not search for user ${created.username} (${search.status()}); it may remain`);
    return;
  }
  const { users } = (await search.json()) as { users: { id: string; username: string }[] };
  const user = users.find((candidate) => candidate.username === created.username);
  if (!user) {
    log(`user ${created.username} was never created; nothing to remove`);
    return;
  }
  await expectOk(api.post(`/api/v1/users/${user.id}/disable`, { headers }), 'disable user');
  await expectOk(
    api.delete(`/api/v1/users/${user.id}`, { headers, data: { email: created.email } }),
    'delete user',
  );
  const reread = await api.get(`/api/v1/users/${user.id}`, { headers });
  log(reread.status() === 404
    ? `user ${created.username} removed (re-read 404)`
    : `user ${created.username} STILL PRESENT after delete (re-read ${reread.status()})`);
}

async function expectOk(pending: ReturnType<APIRequestContext['get']>, action: string) {
  const response = await pending;
  if (!response.ok()) {
    throw new Error(`${action} failed: ${response.status()} ${await response.text()}`);
  }
}
