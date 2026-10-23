import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { adminApiHeaders } from './helpers/admin-api';
import { readAdminCredentials } from './helpers/admin-session';
import { removeLeague, removeUser, type JourneyUser } from './helpers/journey-teardown';
import { registerFreshUser } from './helpers/user-session';

/**
 * #929 — the app on a phone's browser: a commissioner signs up, creates a league and starts a
 * contest at iPhone width, and no page along the way runs wider than the screen. A page wider
 * than the screen makes Safari and Chrome zoom the whole page out or scroll it sideways, which is
 * what the signed-in header and the create-contest sport picker did before. Form fields must be
 * at least 16px, or iOS Safari zooms in on every field the person taps.
 *
 * Chromium with a phone's viewport, touch and user agent stands in for both phone browsers: the
 * suite installs Chromium only, and page width is decided by the CSS, not the engine.
 */

/** An iPhone 13 / 14: the most common phone width in the US. */
const PHONE_WIDTH = 390;

test.use({
  viewport: { width: PHONE_WIDTH, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  actionTimeout: 20_000,
});

/** Each attempt's league and commissioner, recorded as the test creates them, for teardown. */
const created: { leagueCode: string; commissioner: JourneyUser }[] = [];

test.afterAll(async ({ playwright }, testInfo) => {
  if (created.length === 0) return;
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  const log = (message: string) => console.log(`[teardown] ${message}`);
  try {
    const headers = await adminApiHeaders(api, readAdminCredentials());
    if (!headers) {
      console.error('[teardown] admin sign-in failed; the phone layout spec\'s leagues and users may remain');
      return;
    }
    for (const { leagueCode, commissioner } of created) {
      // Teardown is not the thing under test: report what was left, never fail the test.
      await removeLeague(api, headers, leagueCode, log)
        .catch((error: unknown) => console.error(`[teardown] could not remove league ${leagueCode}:`, error));
      await removeUser(api, headers, commissioner, log)
        .catch((error: unknown) => console.error(`[teardown] could not remove ${commissioner.username}:`, error));
    }
  } finally {
    await api.dispose();
  }
});

/** The page's layout width; on a phone the browser widens it to fit content wider than the screen. */
async function expectFitsPhone(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, `${page.url()} is ${width}px wide on a ${PHONE_WIDTH}px phone`).toBeLessThanOrEqual(PHONE_WIDTH);
}

/** Every visible text field, select and text box: under 16px, iOS Safari zooms in when it is tapped. */
async function expectNoZoomingFields(page: Page) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('input, select, textarea')]
      .filter((field) => !['checkbox', 'radio', 'hidden', 'file'].includes((field as HTMLInputElement).type))
      .filter((field) => field.getClientRects().length > 0)
      .filter((field) => Number.parseFloat(getComputedStyle(field).fontSize) < 16)
      .map((field) => field.getAttribute('data-testid') ?? (field.id || field.tagName)),
  );
  expect(small, `fields under 16px on ${page.url()}`).toEqual([]);
}

test('a commissioner signs up, creates a league and starts a contest on a phone without any page running wider than the screen', async ({ page }) => {
  test.setTimeout(120_000);
  const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const commissioner: JourneyUser = {
    username: `e2e-ph-${runId}`,
    email: `e2e-ph-${runId}@e2e.invalid`,
    firstName: 'E2E',
    lastName: `Phone ${runId}`,
  };
  // League codes stop at 16 characters, and the run id is about 13.
  const leagueCode = `PH${runId.toUpperCase()}`;
  created.push({ leagueCode, commissioner });

  await test.step('the sign-in page fits the phone and its fields do not zoom', async () => {
    await page.goto('/');
    await page.getByTestId('auth-mode-register').click();
    await expectFitsPhone(page);
    await expectNoZoomingFields(page);
    await registerFreshUser(page, commissioner);
    await expect(page.getByTestId('authenticated-landing')).toBeVisible();
    await expectFitsPhone(page);
  });

  await test.step('creating a league fits the phone, and so does the league home with its header', async () => {
    await page.getByTestId('welcome-create-league').click();
    await expectNoZoomingFields(page);
    await page.getByTestId('create-league-code').fill(leagueCode);
    await page.getByTestId('create-league-name').fill(`Phone ${runId}`);
    await page.getByTestId('create-league-next').click();
    await page.getByTestId('create-league-submit').click();
    await expect(page.getByTestId('league-home')).toBeVisible();
    await expect(page.getByTestId('league-selector-toggle')).toBeVisible();
    await expectFitsPhone(page);
  });

  await test.step('the Commissioner tools button stays on screen and opens the create-contest page, which fits the phone', async () => {
    await expect(page.getByTestId('league-menu-commissioner-tools')).toBeInViewport();
    await page.getByTestId('league-menu-commissioner-tools').click();
    await page.getByTestId('commissioner-tools-menu-contests').click();
    await page.getByTestId('manage-contests-create-link').click();
    await expect(page.getByTestId('create-contest-page')).toBeVisible();
    await expectFitsPhone(page);
    await expectNoZoomingFields(page);
  });
});
