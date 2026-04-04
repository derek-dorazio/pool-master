/**
 * Browser E2E MVP flows.
 *
 * These replace the old shallow public-page smoke suites with two real
 * browser journeys:
 * - commissioner creates a league, invites a member, and the member joins
 * - commissioner creates a league and creates a live contest from ingested data
 */

import type { Page } from '@playwright/test';
import {
  test,
  expect,
  createRuntimeErrorTracker,
  assertNoErrors,
  assertNoErrorBoundary,
} from './fixtures';

const PASSWORD = 'JourneyPass123!';
const DOB = {
  month: '1',
  day: '1',
  year: String(new Date().getFullYear() - 20),
};

function uniqueName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function completeRegistration(
  page: Page,
  details: { email: string; displayName: string },
) {
  await expect(page.locator('#email')).toBeVisible();
  await page.locator('#email').fill(details.email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#confirmPassword').fill(PASSWORD);
  await page.getByRole('button', { name: /^Next$/ }).click();

  await expect(page.locator('#displayName')).toBeVisible();
  await page.locator('#displayName').fill(details.displayName);
  await page.getByRole('button', { name: /^Next$/ }).click();

  await page.locator('#dobMonth').selectOption(DOB.month);
  await page.locator('#dobDay').selectOption(DOB.day);
  await page.locator('#dobYear').selectOption(DOB.year);
  await page.getByRole('button', { name: /^Next$/ }).click();

  const checkboxes = page.getByRole('checkbox');
  await checkboxes.nth(0).click();
  await checkboxes.nth(1).click();
  await page.getByRole('button', { name: /^Next$/ }).click();

  await expect(page.getByRole('button', { name: /^Create Account$/ })).toBeVisible();
  await page.getByRole('button', { name: /^Create Account$/ }).click();
}

async function createLeague(page: Page, leagueName: string) {
  await page.goto('/leagues/create');
  await expect(page.getByRole('heading', { name: /Create League/i })).toBeVisible();

  await page.locator('#name').fill(leagueName);
  await page.locator('#description').fill(`Browser MVP league for ${leagueName}.`);
  await page.getByRole('button', { name: /^Next$/ }).click();
  await page.getByRole('button', { name: /^Next$/ }).click();
  await page.getByRole('button', { name: /^Create League$/ }).click();

  await expect(page).toHaveURL(/\/leagues\/[^/]+$/);
  await expect(page.getByRole('heading', { name: leagueName })).toBeVisible();

  const match = page.url().match(/\/leagues\/([^/]+)$/);
  if (!match?.[1]) {
    throw new Error('League creation did not navigate to a league detail page.');
  }

  return match[1];
}

function sectionButtons(page: Page, heading: string) {
  return page.getByRole('heading', { name: heading }).locator('xpath=..').getByRole('button');
}

async function createContestFromLiveSetup(page: Page, contestName: string) {
  const sportCandidates = [
    'Golf',
    'Tennis',
    'NCAA',
    'NBA',
    'NFL',
    'Soccer',
    'F1',
    'NASCAR',
    'Horse Racing',
  ];

  const selectEventSection = sectionButtons(page, 'Select Event');
  const selectionTemplateSection = sectionButtons(page, 'Selection Template');
  const scoringTemplateSection = sectionButtons(page, 'Scoring Template');

  for (const sport of sportCandidates) {
    const sportButton = page.getByRole('button', { name: new RegExp(`\\b${sport}\\b`, 'i') }).first();
    if (await sportButton.count() === 0) {
      continue;
    }

    await sportButton.click();

    try {
      await expect.poll(async () => selectEventSection.count(), { timeout: 8_000 }).toBeGreaterThan(0);
    } catch {
      continue;
    }

    await page.locator('#name').fill(contestName);
    await selectEventSection.first().click();
    await page.getByRole('button', { name: /^Next$/ }).click();

    try {
      await expect.poll(async () => selectionTemplateSection.count(), { timeout: 8_000 }).toBeGreaterThan(0);
    } catch {
      await page.getByRole('button', { name: /^Back$/ }).click();
      continue;
    }

    await selectionTemplateSection.first().click();
    await page.getByRole('button', { name: /^Next$/ }).click();

    try {
      await expect.poll(async () => scoringTemplateSection.count(), { timeout: 8_000 }).toBeGreaterThan(0);
    } catch {
      await page.getByRole('button', { name: /^Back$/ }).click();
      continue;
    }

    await scoringTemplateSection.first().click();
    await page.getByRole('button', { name: /^Next$/ }).click();

    await expect(page.getByText('Contestant Setup')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Create Contest$/ })).toBeVisible();
    await page.getByRole('button', { name: /^Create Contest$/ }).click();
    await expect(page).toHaveURL(/\/contests\/[^/]+$/);
    await expect(page.getByRole('heading', { name: contestName })).toBeVisible();
    return;
  }

  throw new Error('No supported sport had both ingested events and live selection/scoring templates.');
}

test.describe('Browser MVP journeys', () => {
  test('commissioner can create a league, invite a member, and see the member join', async ({ page, browser, pageErrors }) => {
    const leagueName = uniqueName('Browser Invite League');
    const commissionerName = uniqueName('Commissioner');
    const memberName = uniqueName('Member');
    const commissionerEmail = `${uniqueName('commish')}@e2e.test`;
    const memberEmail = `${uniqueName('member')}@e2e.test`;

    await page.goto('/register');
    await completeRegistration(page, { email: commissionerEmail, displayName: commissionerName });
    await expect(page).toHaveURL(/\/dashboard$/);

    const leagueId = await createLeague(page, leagueName);

    await page.getByRole('link', { name: /^Invite Members$/ }).click();
    await expect(page).toHaveURL(/\/leagues\/[^/]+\/members$/);

    await page.getByRole('button', { name: /^Invite Member$/ }).click();
    const inviteLinkInput = page.locator('input[readonly]').first();
    await expect.poll(async () => inviteLinkInput.inputValue(), { timeout: 8_000 }).toContain('/join/');
    const inviteLink = await inviteLinkInput.inputValue();

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    const memberErrors = createRuntimeErrorTracker(memberPage);

    try {
      await memberPage.goto(inviteLink);
      await expect(memberPage.getByRole('heading', { name: /Join League/i })).toBeVisible();
      await memberPage.getByRole('link', { name: /Create Account/i }).click();
      await completeRegistration(memberPage, { email: memberEmail, displayName: memberName });

      await expect(memberPage).toHaveURL(new RegExp(`/leagues/${leagueId}$`));
      await expect(memberPage.getByRole('heading', { name: leagueName })).toBeVisible();

      await page.goto(`/leagues/${leagueId}/members`);
      await expect(page.getByText(memberName)).toBeVisible();

      await assertNoErrorBoundary(page);
      await assertNoErrors(pageErrors);
      await assertNoErrorBoundary(memberPage);
      await assertNoErrors(memberErrors);
    } finally {
      await memberContext.close();
    }
  });

  test('commissioner can create a live contest from ingested MVP data', async ({ page, pageErrors }) => {
    const leagueName = uniqueName('Browser Contest League');
    const contestName = uniqueName('Browser MVP Contest');
    const commissionerEmail = `${uniqueName('contest-commish')}@e2e.test`;
    const commissionerName = uniqueName('Contest Commissioner');

    await page.goto('/register');
    await completeRegistration(page, { email: commissionerEmail, displayName: commissionerName });
    await expect(page).toHaveURL(/\/dashboard$/);

    await createLeague(page, leagueName);

    await page.getByRole('link', { name: /^Create Contest$/ }).first().click();
    await expect(page).toHaveURL(/\/contests\/create$/);

    await page.getByRole('button', { name: leagueName }).click();
    await createContestFromLiveSetup(page, contestName);

    await expect(page.getByText('Contestant Setup')).toBeVisible();
    await expect(page.getByText(/Selection Type:/i)).toBeVisible();

    await assertNoErrorBoundary(page);
    await assertNoErrors(pageErrors);
  });
});
