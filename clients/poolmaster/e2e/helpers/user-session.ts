import { randomBytes } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { GENERATED_PASSWORD_PREFIX } from './constants';

/**
 * #280 — registering a brand-new user through the sign-in shell's register form. Lifted from the
 * #278 plumbing probe, which proved it first, when the probe was retired: the journey's
 * commissioner and member both register through it.
 */

export type FreshUser = {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
};

/**
 * Fills and submits the register form, which the caller has already opened, and returns the new
 * user's id from the register response. The submit routes client-side (no document navigation),
 * so the response body is still readable when the click resolves.
 */
export async function registerFreshUser(page: Page, user: FreshUser): Promise<string> {
  await page.getByTestId('auth-register-first-name').fill(user.firstName);
  await page.getByTestId('auth-register-last-name').fill(user.lastName);
  await page.getByTestId('auth-register-email').fill(user.email);
  await page.getByTestId('auth-register-username').fill(user.username);
  // Never needed again: teardown deletes this user with the admin token. The prefix is what
  // lets redact-artifacts.ts find it in a trace.
  const password = `${GENERATED_PASSWORD_PREFIX}${randomBytes(12).toString('hex')}`;
  await page.getByTestId('auth-register-password').fill(password);
  await page.getByTestId('auth-register-confirm-password').fill(password);

  const registered = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/auth/register',
    { timeout: 20_000 },
  );
  await page.getByTestId('auth-register-submit').click();
  const response = await registered;
  expect(response.ok(), `POST /api/v1/auth/register answered ${response.status()}`).toBe(true);
  const body = (await response.json()) as { user: { id: string; username: string } };
  expect(body.user.username).toBe(user.username);
  return body.user.id;
}
