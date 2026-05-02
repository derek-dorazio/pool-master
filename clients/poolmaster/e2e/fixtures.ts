import { test as base, type Browser, type Page } from '@playwright/test';
import { authStatePaths } from './auth-state';
import { ensureQALeague, type QALeagueFixture } from './fixture-state';

type RoleFixtures = {
  commissionerPage: Page;
  memberPage: Page;
  rootAdminPage: Page;
  qaLeague: QALeagueFixture;
};

async function createRolePage(
  browser: Browser,
  storageState: string,
  use: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  try {
    await use(page);
  } finally {
    await context.close();
  }
}

export const test = base.extend<RoleFixtures>({
  commissionerPage: async ({ browser }, use) => {
    await createRolePage(browser, authStatePaths.commissioner, use);
  },
  memberPage: async ({ browser }, use) => {
    await createRolePage(browser, authStatePaths.member, use);
  },
  rootAdminPage: async ({ browser }, use) => {
    await createRolePage(browser, authStatePaths.rootAdmin, use);
  },
  qaLeague: async ({ commissionerPage, memberPage }, use) => {
    await use(await ensureQALeague(commissionerPage, memberPage));
  },
});

export { expect } from '@playwright/test';
