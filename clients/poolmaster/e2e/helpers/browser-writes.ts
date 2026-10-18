import { expect, type Page, type Response } from '@playwright/test';

/**
 * #363, #370 — reading the body of the write a UI submit sends, shared by the golden journey and
 * the squad-management spec.
 */

// The generated SDK sends collection routes with a trailing slash (`/api/v1/events/`), so
// paths compare without one.
const trimSlash = (path: string) => path.replace(/\/+$/, '');

export function isCall(response: Response, method: string, path: string): boolean {
  return (
    response.request().method() === method &&
    trimSlash(new URL(response.url()).pathname) === trimSlash(path)
  );
}

// A write that never answers fails its own step quickly instead of at the test timeout.
export const WRITE_TIMEOUT_MS = 20_000;

/**
 * Clicks a submit and returns the body of the write it sent, failing on a non-2xx.
 *
 * Safe only for a submit whose follow-up routing is client-side. A `waitForResponse` handle does
 * not survive a document navigation: once one lands, Chromium has discarded the body and
 * `.json()` fails. A submit that triggers a real navigation must read server state with
 * `page.request` instead.
 */
export async function submitAndRead<T = unknown>(
  page: Page,
  submitTestId: string,
  method: string,
  path: string,
): Promise<T> {
  const responded = page.waitForResponse((response) => isCall(response, method, path), {
    timeout: WRITE_TIMEOUT_MS,
  });
  await page.getByTestId(submitTestId).click();
  const response = await responded;
  expect(response.ok(), `${method} ${path} answered ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

/** The CSRF token the session issued, which a state-changing request has to echo in a header. */
export async function readCsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === 'poolmaster_csrf');
  if (!csrf) {
    throw new Error('the session carries no poolmaster_csrf cookie, so no write can be signed');
  }
  return csrf.value;
}
