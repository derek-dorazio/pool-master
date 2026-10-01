import { test } from '@playwright/test';
import { adminSignInReachManageLogOut, readAdminCredentials } from './helpers/admin-session';

/**
 * #278 — the post-deploy smoke. Selected by `@smoke` for the run against QA, and run
 * pre-merge too so the test itself is proven before it first meets a deploy.
 *
 * Creates no domain data, so it needs no teardown. It is not read-only: sign-in issues a
 * refresh token and log-out revokes it, leaving one revoked token row per run.
 */
test(
  'root admin signs in, reaches the manage hub, and logs out back to the sign-in shell',
  { tag: '@smoke' },
  async ({ page }) => {
    await adminSignInReachManageLogOut(page, readAdminCredentials());
  },
);
