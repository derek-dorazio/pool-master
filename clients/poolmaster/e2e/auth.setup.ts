import fs from 'node:fs/promises';
import { expect, test as setup, type Page } from '@playwright/test';
import { authStateDir, authStatePaths } from './auth-state';
import { qaUsers, type QARole } from './qa-users';
import { registerUser, type E2EUser } from './poolmaster-e2e-helpers';

const authenticatedRoots = [
  '[data-testid="authenticated-landing"]',
  '[data-testid="league-home"]',
  '[data-testid="root-admin-manage-hub-page"]',
  '[data-testid="root-admin-manage-layout"]',
].join(', ');

async function expectAuthenticatedShell(page: Page) {
  await expect(page.locator(authenticatedRoots).first()).toBeVisible({ timeout: 15_000 });
}

async function signIn(page: Page, user: E2EUser): Promise<boolean> {
  await page.goto('/');
  await expect(page.getByTestId('auth-login-identifier')).toBeVisible();
  await page.getByTestId('auth-login-identifier').fill(user.username);
  await page.getByTestId('auth-login-password').fill(user.password);
  await page.getByTestId('auth-login-submit').click();

  return expectAuthenticatedShell(page)
    .then(() => true)
    .catch(() => false);
}

async function registerFixtureUser(page: Page, user: E2EUser) {
  await registerUser(page, user);
  await expectAuthenticatedShell(page);
}

async function saveRoleStorage(page: Page, role: QARole) {
  await page.context().storageState({ path: authStatePaths[role] });
}

for (const [role, user] of Object.entries(qaUsers) as Array<[QARole, (typeof qaUsers)[QARole]]>) {
  setup(`pool-master-xw5.2: ${role} fixture account has reusable auth state`, async ({ page }) => {
    await fs.mkdir(authStateDir, { recursive: true });

    const signedIn = await signIn(page, user);
    if (!signedIn && user.canSelfRegister) {
      await registerFixtureUser(page, user);
    } else if (!signedIn) {
      throw new Error(
        `QA ${role} fixture could not sign in. Run the QA bootstrap for ${user.username} before browser e2e.`,
      );
    }

    await saveRoleStorage(page, role);
  });
}
