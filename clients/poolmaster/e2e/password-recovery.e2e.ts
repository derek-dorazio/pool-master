import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { adminApiHeaders } from './helpers/admin-api';
import { logOut, readAdminCredentials } from './helpers/admin-session';
import { removeUser, type JourneyUser } from './helpers/journey-teardown';
import { waitForMailText } from './helpers/mailpit';
import { generatePassword, registerFreshUser } from './helpers/user-session';

/**
 * #848 — "Forgot password?" end to end (plans/password-recovery.md): a person who forgot their
 * password asks for a link, opens it from the email, chooses a new password and signs in with it.
 * The email is read from the local stack's Mailpit, so this spec is untagged and never runs
 * against QA.
 */

const RESET_SUBJECT = 'Reset your Primetime Commissioner password';
const CHANGED_SUBJECT = 'Your Primetime Commissioner password was changed';

test.use({ actionTimeout: 20_000 });

const created: JourneyUser[] = [];

test.afterAll(async ({ playwright }, testInfo) => {
  if (created.length === 0) return;
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const headers = await adminApiHeaders(api, readAdminCredentials());
    if (!headers) {
      console.error('[teardown] admin sign-in failed; the recovery spec\'s users may remain');
      return;
    }
    for (const user of created) {
      // Teardown is not the thing under test: report what was left, never fail the test.
      await removeUser(api, headers, user, (message) => console.log(`[teardown] ${message}`))
        .catch((error: unknown) => console.error(`[teardown] could not remove ${user.username}:`, error));
    }
  } finally {
    await api.dispose();
  }
});

test('a person who forgot their password resets it from the emailed link and signs in with the new one', async ({ page }) => {
  test.setTimeout(120_000);
  const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const user: JourneyUser = {
    username: `e2e-pr-${runId}`,
    // RFC 2606 reserves .invalid; the local stack's Mailpit catches it, nothing real is sent.
    email: `e2e-pr-${runId}@e2e.invalid`,
    firstName: 'E2E',
    lastName: `Recovery ${runId}`,
  };
  created.push(user);
  const newPassword = generatePassword();

  await test.step('a fresh user registers and signs out', async () => {
    await page.goto('/');
    await page.getByTestId('auth-mode-register').click();
    await registerFreshUser(page, user);
    await expect(page.getByTestId('authenticated-landing')).toBeVisible();
    await logOut(page);
  });

  await test.step('they ask for a reset link from the sign in form', async () => {
    await page.getByTestId('auth-forgot-password').click();
    await page.getByTestId('forgot-password-identifier').fill(user.email);
    await page.getByTestId('forgot-password-submit').click();
    await expect(page.getByTestId('forgot-password-sent')).toBeVisible();
  });

  let token = '';
  await test.step('the reset email carries a one-time link', async () => {
    const text = await waitForMailText(user.email, RESET_SUBJECT);
    token = /\/reset-password#token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';
    expect(token, 'reset link in the email').not.toBe('');
  });

  await test.step('the link sets a new password and sends them to sign in', async () => {
    await page.goto(`/reset-password#token=${token}`);
    await page.getByTestId('reset-password-new').fill(newPassword);
    await page.getByTestId('reset-password-confirm').fill(newPassword);
    await page.getByTestId('reset-password-submit').click();
    await expect(page.getByTestId('reset-password-done')).toBeVisible();
    await expect(page).toHaveURL(/\/reset-password$/);
  });

  await test.step('a "password was changed" email follows, with a way back to recovery', async () => {
    const text = await waitForMailText(user.email, CHANGED_SUBJECT);
    expect(text).toContain(`account (${user.username}) was changed on`);
    expect(text).toContain('/forgot-password');
  });

  await test.step('the new password signs in', async () => {
    await page.getByTestId('reset-password-sign-in').click();
    await page.getByTestId('auth-login-identifier').fill(user.username);
    await page.getByTestId('auth-login-password').fill(newPassword);
    await page.getByTestId('auth-login-submit').click();
    await expect(page.getByTestId('authenticated-landing')).toBeVisible();
  });

  await test.step('the used link is dead', async () => {
    await page.goto(`/reset-password#token=${token}`);
    await page.getByTestId('reset-password-new').fill(newPassword);
    await page.getByTestId('reset-password-confirm').fill(newPassword);
    await page.getByTestId('reset-password-submit').click();
    await expect(page.getByTestId('reset-password-link-invalid')).toBeVisible();
  });
});
