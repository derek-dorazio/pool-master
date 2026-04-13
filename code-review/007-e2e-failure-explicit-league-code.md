# Code Review 007 — E2E Failure After Explicit `leagueCode` Contract Change

- **Date:** 2026-04-12
- **Scope:** New `poolmaster-browser-e2e` failure after the two-commit contract change that made `leagueCode` explicit in the create-league API
- **HEAD at review:** `4a5018f`
- **Reviewer:** Code Review Agent

---

## Root Cause

The failure is deterministic and reproduces on every CI run after the first one. It's introduced by the combination of three commits:

| Commit | Change |
|---|---|
| `4c9c2f8` "Align create-league contract to league code workflow" | Server now requires an explicit `leagueCode` in the POST body. `LeagueService.createLeague` checks `leagueRepo.findByCode(input.leagueCode)` and throws `LeagueCodeConflictError` on collision — **no retry, no auto-generation**. |
| `036fb5b` "Update PoolMaster create flow for explicit league code" | Client modal now collects `leagueCode` in the form and seeds it from `suggestLeagueCode(name)` = `name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)`. |
| `eca1a0d` "Implement PoolMaster league creation wizard" | Modal became a 2-step wizard. E2E helpers were updated to press Tab, click Next, then Submit. |

### Why it fails

The E2E tests use **static league-name prefixes** with only a timestamp suffix:

| Test | League name pattern | Suggested `leagueCode` (deterministic) |
|---|---|---|
| 1 | `Playwright League ${timestamp}` | `PLAYWRIGHTLEAGUE` (16 chars, timestamp truncated off) |
| 2 | `Invite League ${timestamp}` | `INVITELEAGUE` |
| 3 | `Alpha League ${timestamp}` | `ALPHALEAGUE` |
| 3 | `Bravo League ${timestamp}` | `BRAVOLEAGUE` |

`suggestLeagueCode` sanitizes and truncates at 16 characters — **before** the timestamp ever appears. So the seeded `leagueCode` is identical across every CI run. The `Tab` press in the E2E helper triggers the `onBlur` handler that seeds the field; the helper then clicks Next and Submit without ever touching the code field, so `hasEditedLeagueCodeRef` stays false and the suggested code is what gets submitted.

- **First CI run after `4c9c2f8`/`036fb5b`/`eca1a0d` landed:** succeeds. The four deterministic codes are now permanently in QA.
- **Every subsequent CI run:** POST `/api/v1/leagues` returns 409 `LEAGUE_CODE_CONFLICT` on the first test, modal displays the error, URL never changes, Playwright times out on `expect(page).toHaveURL(/\/league\/[A-Z0-9]+$/)`.

### Supporting evidence

- `clients/poolmaster/src/features/leagues/create-league-modal.tsx:36-38`: `suggestLeagueCode` does `.slice(0, 16)` — the timestamp in the E2E league names sits well past character 16.
- `clients/poolmaster/e2e/authenticated-landing.e2e.ts:39-43`: helper fills only `create-league-name`, presses Tab, clicks Next, clicks Submit. Never types into `create-league-code`, so `hasEditedLeagueCodeRef.current` stays `false` and the auto-suggested value is submitted.
- `packages/core-api/src/modules/leagues/service.ts:48-51`: server throws `LeagueCodeConflictError` if `leagueCode` is taken. No fallback.

This is exactly the test-data-accumulation failure mode flagged in Review 005 #5 and Review 006 hypothesis 4, but now it is **guaranteed** rather than probabilistic, because the contract change removed the server-side collision retry that had been covering it up.

---

## Fix

The contract change is legitimate — users should choose league codes explicitly. The E2E tests need to be updated to match the new contract by submitting unique codes per run, not relying on the auto-suggestion.

### Recommended patch

```ts
// clients/poolmaster/e2e/authenticated-landing.e2e.ts

async function createLeagueFromWelcome(
  page: Parameters<typeof test>[0]['page'],
  leagueName: string,
  leagueCode: string,
) {
  await page.getByTestId('welcome-create-league').click();
  await expect(page.getByTestId('create-league-modal')).toBeVisible();
  await page.getByTestId('create-league-name').fill(leagueName);
  await page.getByTestId('create-league-code').fill(leagueCode);
  await page.getByTestId('create-league-next').click();
  await page.getByTestId('create-league-submit').click();
}

async function createLeagueFromSelector(
  page: Parameters<typeof test>[0]['page'],
  leagueName: string,
  leagueCode: string,
) {
  await page.getByTestId('league-selector-toggle').click();
  await page.getByTestId('league-selector-create').click();
  await expect(page.getByTestId('create-league-modal')).toBeVisible();
  await page.getByTestId('create-league-name').fill(leagueName);
  await page.getByTestId('create-league-code').fill(leagueCode);
  await page.getByTestId('create-league-next').click();
  await page.getByTestId('create-league-submit').click();
}

// Helper to produce a sanitized 3-16 char A-Z/0-9 code that's unique per test run
function uniqueLeagueCode(prefix: string, timestamp: number): string {
  const base = `${prefix}${timestamp.toString(36)}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return base.slice(0, 16);
}
```

Call sites in each test:

```ts
// Test 1
const leagueCode = uniqueLeagueCode('PLW', timestamp);
await createLeagueFromWelcome(page, leagueName, leagueCode);

// Test 2
const leagueCode = uniqueLeagueCode('INV', timestamp);
await createLeagueFromWelcome(page, leagueName, leagueCode);

// Test 3
const firstCode = uniqueLeagueCode('ALPHA', timestamp);
const secondCode = uniqueLeagueCode('BRAVO', timestamp);
await createLeagueFromWelcome(page, firstLeagueName, firstCode);
await createLeagueFromSelector(page, secondLeagueName, secondCode);
```

`timestamp.toString(36)` gives a compact alphanumeric representation (~8 chars for current epoch millis) that sanitizes cleanly and stays well under 16 chars when prefixed. The prefix keeps each test's leagues identifiable in QA for manual inspection/cleanup.

### Why fill the code field instead of leaving it auto-suggested

- The auto-suggested code is derived deterministically from the name prefix and will always collide for these tests.
- Filling the field trips the `onChange` handler which sets `hasEditedLeagueCodeRef.current = true`, preventing the `onBlur` re-seed from overwriting the test's explicit value.
- This matches real user behavior: a commissioner reviewing the suggestion and either accepting it or customizing it.

---

## Secondary Findings

These are carried-forward concerns from Reviews 005/006 that the deterministic-code regression has now made more urgent:

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| 1 | **High** | `clients/poolmaster/e2e/authenticated-landing.e2e.ts` (full file) | Still no per-test cleanup. Each run permanently consumes league codes in QA. Over time this will exhaust recognizable codes and force increasingly cryptic `uniqueLeagueCode` output. Add an `afterEach` hook that deletes the league via the SDK, or add a test-only backend cleanup endpoint. |
| 2 | **High** | `.github/workflows/ci.yml:820-854` | Still no version probe before E2E runs. Carried from Review 005 #4, Review 006 #3. |
| 3 | **Medium** | `clients/poolmaster/src/features/leagues/create-league-modal.tsx:36-38` | `suggestLeagueCode` produces a pure deterministic function of the name. Two commissioners creating leagues with similar names will collide on their first attempt. Consider appending a short random suffix (e.g., 4 hex chars) on the *suggestion* so the default UX is unique even when names repeat. Commissioner can still edit before submit. |
| 4 | **Medium** | `packages/core-api/src/modules/leagues/service.ts:48-51` | The new contract gives clean 409 semantics, but there's no client-facing hint in the error response about what alternatives are free. A `LEAGUE_CODE_CONFLICT` response with a suggested-alternative field would turn a dead-end into a recoverable UX state. |
| 5 | **Low** | `clients/poolmaster/src/features/leagues/create-league-modal.tsx:143-149` | `handleNextStep` calls `seedLeagueCodeFromName` even when the user has already advanced past step 1 once. Combined with `hasEditedLeagueCodeRef.current` staying true after editing, the re-seed is a no-op — but the call path is subtle. Worth a comment noting why it's safe. |

---

## Pattern Observation

This is the first review in the sequence where the CI failure is **deterministic rather than environmental**. The previous rounds (CSRF, singleton, rollout) were all about timing, state, or deployment races. This one is a mechanical contract/test mismatch that was introduced in the same slice that rewrote the create-league flow.

The commit `eca1a0d` ("Implement PoolMaster league creation wizard") **did update the E2E helpers** to press Tab and click Next — showing the implementer knew the tests needed adjustment for the wizard. But they didn't adjust for the **semantic** change: the auto-suggested code is now user-editable and the backend no longer handles collisions. The E2E tests needed to submit unique codes per run, not rely on the auto-suggestion.

**Tell the implementer:** When a contract changes from "server generates collision-free value" to "client submits explicit value," all test fixtures that previously relied on the server's uniqueness guarantee need to produce unique values themselves. The E2E helpers in `authenticated-landing.e2e.ts` still rely on the old implicit contract and collide on every run after the first.

---

## Summary

- **Cause:** New explicit-`leagueCode` contract + E2E tests using static name prefixes → first run seeds `PLAYWRIGHTLEAGUE`, `INVITELEAGUE`, `ALPHALEAGUE`, `BRAVOLEAGUE` into QA; every subsequent run gets 409 on the first league create.
- **Fix:** Update E2E helpers to accept an explicit `leagueCode` parameter and have each test generate a timestamp-salted code per run. Patch provided above.
- **Follow-ups:** Add per-test cleanup so the QA league table stops growing monotonically; add a CI version probe (carried from Reviews 005/006).
