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
 * A password for a user a spec registers. The prefix is what lets redact-artifacts.ts find it in
 * a trace.
 */
export function generatePassword(): string {
  return `${GENERATED_PASSWORD_PREFIX}${randomBytes(12).toString('hex')}`;
}

/**
 * Fills and submits the register form, which the caller has already opened, and returns the new
 * user's id from the register response. The submit routes client-side (no document navigation),
 * so the response body is still readable when the click resolves. A spec that signs the user in
 * again later passes the password; otherwise it is never needed again, since teardown deletes
 * the user with the admin token.
 */
export async function registerFreshUser(
  page: Page,
  user: FreshUser,
  password: string = generatePassword(),
): Promise<string> {
  await page.getByTestId('auth-register-first-name').fill(user.firstName);
  await page.getByTestId('auth-register-last-name').fill(user.lastName);
  await page.getByTestId('auth-register-email').fill(user.email);
  await page.getByTestId('auth-register-username').fill(user.username);
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
