import { expect, type Page, type Response } from '@playwright/test';

/**
 * #363 — reading the body of the write a UI submit sends. Lifted from the golden journey's private
 * copy for the squad-management spec; the journey moves onto it once #362, which is editing that
 * file, has landed.
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
const WRITE_TIMEOUT_MS = 20_000;

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
