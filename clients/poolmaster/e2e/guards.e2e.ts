import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';

/**
 * #84 — the unauthenticated surface: the router guards and the error states a visitor without
 * a session can reach. Credential-free and data-free, so it is safe anywhere and runs both
 * pre-merge and post-deploy. The not-found case is why it is tagged rather than local-only:
 * against QA it depends on CloudFront rewriting an unknown path to index.html, a deploy-only
 * failure no local run can see.
 *
 * Every value it types is generated per test, so nothing here names a real account or code.
 */

const unique = () => randomBytes(6).toString('hex');

test.describe('unauthenticated guards', { tag: '@smoke' }, () => {
  test('a protected member route sends a visitor without a session to sign-in', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.getByTestId('auth-login-identifier')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('a root-admin route sends a visitor without a session to sign-in', async ({ page }) => {
    await page.goto('/manage');
    await expect(page.getByTestId('auth-login-identifier')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('sign-in with credentials that match no account surfaces an error and stays signed out', async ({ page }) => {
    await page.goto('/');
    // A username no run ever registers, so no real account accrues failed attempts.
    await page.getByTestId('auth-login-identifier').fill(`e2e-nobody-${unique()}`);
    await page.getByTestId('auth-login-password').fill(`not-a-password-${unique()}`);
    await page.getByTestId('auth-login-submit').click();
    await expect(page.getByTestId('auth-server-error')).toBeVisible();
    await expect(page.getByTestId('auth-login-identifier')).toBeVisible();
  });

  test('an invite link with an unknown code shows the dead-link page, whose Sign in leads to sign-in', async ({ page }) => {
    await page.goto(`/invite/E2E-NO-SUCH-${unique().toUpperCase()}`);
    // A code that matches no invitation is a dead link: its status page shows before any
    // sign-in hand-off, and its one action takes a signed-out visitor to sign-in.
    const deadLink = page.getByTestId('invitation-status-page');
    await expect(deadLink).toBeVisible();
    await expect(deadLink).toHaveAttribute('data-kind', 'notFound');
    await page.getByTestId('invitation-status-action').click();
    await expect(page.getByTestId('auth-login-identifier')).toBeVisible();
  });

  test('an unknown path renders the not-found page rather than a blank or server error', async ({ page }) => {
    await page.goto(`/e2e-no-such-page-${unique()}`);
    await expect(page.getByTestId('not-found-page')).toBeVisible();
  });
});
