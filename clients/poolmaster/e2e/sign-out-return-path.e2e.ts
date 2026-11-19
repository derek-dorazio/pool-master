import { expect, test, type APIRequestContext } from '@playwright/test';
import { adminApiHeaders, attempt, type Log } from './helpers/admin-api';
import { logOut, readAdminCredentials, type AdminCredentials } from './helpers/admin-session';
import { removeUser, type JourneyUser } from './helpers/journey-teardown';
import { e2eEmail, e2eLeagueCode, e2eUsername, newRunId } from './helpers/test-marker';
import { registerFreshUser } from './helpers/user-session';

/**
 * The page an account signs out of stays that account's. A member signs out while on a league
 * page; the root admin signs in next in the same tab and lands on Manage, not on the member's
 * league shell with "We couldn't load this league".
 *
 * Untagged, so it runs pre-merge against the local stack only and never writes to QA. It
 * registers one member, whom `afterAll` removes through the API whatever the outcome. The
 * league in the address is never created: the member route guard reacts to the path, not to the
 * league, so a code nothing uses shows the defect without creating any league data.
 */

let admin: AdminCredentials | undefined;
const members: JourneyUser[] = [];

test.afterAll(async ({ playwright }, testInfo) => {
  if (!admin || members.length === 0) {
    return;
  }

  let api: APIRequestContext | undefined;
  try {
    api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
    const log: Log = (message) => console.log(`[teardown sign-out-return-path] ${message}`);
    const headers = await adminApiHeaders(api, admin);
    if (!headers) {
      log(`admin login failed; users left: ${members.map((member) => member.username).join(', ')}`);
      return;
    }
    const requestContext = api;
    for (const member of members) {
      await attempt(log, `user ${member.username}`, () => removeUser(requestContext, headers, member, log));
    }
  } catch (error) {
    // Teardown is not the thing under test: report what was left, never fail the test.
    console.error('[teardown sign-out-return-path] could not run; the member may remain:', error);
  } finally {
    await api?.dispose();
  }
});

test('a root admin who signs in after a member signed out on a league page lands on Manage, not on that league', async ({ page }) => {
  const credentials = readAdminCredentials();
  admin = credentials;
  const runId = newRunId();
  const member: JourneyUser = {
    username: e2eUsername('rp', runId),
    // RFC 2606 reserves .invalid, so nothing sent here can reach a real mailbox.
    email: e2eEmail('rp', runId),
    firstName: 'E2E',
    lastName: `Member ${runId}`,
  };
  // Recorded before the first write, so a failure while registering is still torn down.
  members.push(member);
  const leaguePath = `/league/${e2eLeagueCode('R', runId)}`;

  await test.step('a member registers, opens a league page and signs out', async () => {
    await page.goto('/');
    await page.getByTestId('auth-mode-register').click();
    await registerFreshUser(page, member);
    await expect(page.getByTestId('account-menu-trigger')).toBeVisible();
    await page.goto(leaguePath);
    await expect(page).toHaveURL(new RegExp(`${leaguePath}$`));
    await logOut(page);
  });

  await test.step('the root admin signs in next and lands on Manage', async () => {
    // Typed into the sign-in form sign-out left on screen, as a person would: `adminSignIn`
    // reloads `/` first, which drops the return path this test is about.
    await page.getByTestId('auth-login-identifier').fill(credentials.identifier);
    await page.getByTestId('auth-login-password').fill(credentials.password);
    await page.getByTestId('auth-login-submit').click();
    await expect(page).toHaveURL(/\/manage\/sports(\?.*)?$/);
    await expect(page.getByTestId('root-admin-sports-page')).toBeVisible();
  });
});
