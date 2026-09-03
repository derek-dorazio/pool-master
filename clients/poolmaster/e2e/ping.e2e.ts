import { expect, test } from '@playwright/test';

/**
 * pool-master-303 — the entire browser e2e suite, by design. Phase 1 of
 * plans/130-e2e-browser-suite-evaluation.md deleted the previous suite
 * because every spec depended on pre-existing, shared, mutated-in-place QA
 * data (a fixed league code, fixed fixture users). This test has zero data
 * dependency: it proves the deployed bundle boots and routes to the
 * unauthenticated sign-in shell, nothing more. Phase 2 (deferred, see the
 * plan) designs whatever comes after this.
 */
test('pool-master-303: the deployed app boots and renders the sign-in shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('auth-login-identifier')).toBeVisible();
});
