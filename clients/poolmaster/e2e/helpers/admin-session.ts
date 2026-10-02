import { expect, type Page } from '@playwright/test';

/**
 * #278 — the sign-in sequence every spec that acts as the root admin shares: the post-deploy
 * smoke and the journey. One copy, so there are no selectors to drift.
 */

const ADMIN_PASSWORD_ENV = 'POOLMASTER_E2E_ADMIN_PASSWORD';
const ADMIN_IDENTIFIER_ENV = 'POOLMASTER_E2E_ADMIN_IDENTIFIER';
// A username, not a credential: the sign-in field accepts username or email, and the
// username keeps the admin's personal address out of the repository. Keep the secret a
// username too: auth-login-identifier is a plain-text field, so whatever is typed there shows
// in screenshots, video and the trace filmstrip, which redaction cannot scrub.
const DEFAULT_ADMIN_IDENTIFIER = 'poolmaster-admin';

export type AdminCredentials = {
  identifier: string;
  password: string;
};

export function readAdminIdentifier(): string {
  return process.env[ADMIN_IDENTIFIER_ENV] || DEFAULT_ADMIN_IDENTIFIER;
}

/**
 * Read at the start of a test, not at module load, so `playwright test --list` still works
 * without secrets. A missing password fails here, naming the secret, rather than as a
 * login-form timeout thirty seconds later.
 */
export function readAdminCredentials(): AdminCredentials {
  const password = process.env[ADMIN_PASSWORD_ENV];
  if (!password) {
    throw new Error(
      `${ADMIN_PASSWORD_ENV} is not set. The root-admin password has no default; supply it from the ${ADMIN_PASSWORD_ENV} secret.`,
    );
  }

  return {
    identifier: readAdminIdentifier(),
    password,
  };
}

export async function logOut(page: Page): Promise<void> {
  await page.getByTestId('account-menu-trigger').click();
  await page.getByTestId('account-menu-logout').click();
  await expect(page.getByTestId('auth-login-identifier')).toBeVisible();
}

export async function adminSignIn(page: Page, credentials: AdminCredentials): Promise<void> {
  await page.goto('/');
  await page.getByTestId('auth-login-identifier').fill(credentials.identifier);
  await page.getByTestId('auth-login-password').fill(credentials.password);
  await page.getByTestId('auth-login-submit').click();
  // Signed in before navigating, so the next goto is a fresh load that has to restore the
  // session from cookies rather than racing the login request.
  await expect(page.getByTestId('account-menu-trigger')).toBeVisible();
}

export async function adminSignInReachManageLogOut(
  page: Page,
  credentials: AdminCredentials,
): Promise<void> {
  await adminSignIn(page, credentials);

  await page.goto('/manage');
  await expect(page.getByTestId('root-admin-manage-hub-page')).toBeVisible();

  await logOut(page);
}
