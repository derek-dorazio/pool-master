# Code Review 005 — `poolmaster-browser-e2e` CI Failure & CSRF Flow Hardening

- **Date:** 2026-04-12
- **Scope:** Root cause of the new `poolmaster-browser-e2e` CI failure; structural hardening of the E2E lane and the CSRF auth flow that ships with it
- **HEAD at review:** `55846a4`
- **Failing job:** `.github/workflows/ci.yml:820` `poolmaster-browser-e2e` (runs after `migrate-qa`, against `https://qa.ultimateofficepoolmanager.com`)
- **Reviewer:** Architect Agent

---

## Summary

The `poolmaster-browser-e2e` job runs the Playwright suite against the live QA environment immediately after `migrate-qa` completes. The most recent change to ship into QA before this failure is `4833e15` ("Fix QA browser auth CSRF flow"), which added a **client-side** `document.cookie` write of the `poolmaster_csrf` token on top of an existing **server-side** `Set-Cookie` of the same cookie name. The two writes use different attribute sets (path, domain, secure, samesite). This is the most likely cause of the E2E failure: state-changing requests (POST `/api/v1/leagues`, POST `/api/v1/invitations/accept`) get a 403 from the auth guard's `csrfHeader !== csrfCookie` check, league creation fails, and the URL never matches `/league/[A-Z0-9]+` so the test times out.

There is also a deeper structural problem: the E2E lane targets a single shared QA environment with no test-data isolation, no service-rollout health gate, and no version probe. Even after the immediate CSRF issue is fixed, this lane will continue to fail intermittently on rollout races and accumulating test data.

---

## Part A — Why the E2E Likely Failed

### Hypothesis 1 (HIGHEST ~60%) — CSRF cookie attribute conflict introduced by `4833e15`

The backend already sets the CSRF cookie with `httpOnly: false` on every login/register/refresh response:

```
packages/core-api/src/core/session-cookies.ts:75
serializeCookie(CSRF_COOKIE, tokens.csrfToken, { httpOnly: false, maxAge: REFRESH_MAX_AGE_SECONDS })
```

So `poolmaster_csrf` is already JS-readable from `document.cookie`. The client-side write added in `4833e15` is therefore not strictly necessary — it is a workaround layered on top of a working server-set cookie:

```
clients/poolmaster/src/lib/cookies.ts:19
const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
if (window.location.protocol === 'https:') parts.push('Secure');
```

Two failure modes from this:

- **Attribute mismatch creating two cookies with the same name.** If the backend's `serializeCookie` defaults to a different `Path` or sets a `Domain` (e.g., `.qa.ultimateofficepoolmanager.com`), and the client writes without Domain, the browser keeps both as separate cookies. The Cookie header on subsequent requests sends both, ordered by RFC 6265 specificity (longest path first). The interceptor in `clients/poolmaster/src/lib/api.ts:23` reads only the *first* matching cookie via `readCookie`, which is non-deterministic relative to which value the server compares against.
- **Encoding mismatch.** The client uses `encodeURIComponent(value)` on write and `decodeURIComponent` on read. The server uses standard cookie serialization. If the CSRF token contains characters that round-trip differently (UUID v4 should not, but the encoding wrappers add risk if the format ever changes), the header value the client sends will not match what the server stored.

Either path produces `403 AUTH_CSRF_INVALID` from `packages/core-api/src/plugins/auth-guard.ts:85` on the league create POST, and the E2E test fails the URL assertion.

### Hypothesis 2 (~20%) — Service rollout race after `migrate-qa`

`poolmaster-browser-e2e` declares `needs: migrate-qa` but does **not** depend on any service-stable / health-probe step. The publish-images job's "Post-Migration Diagnostics" section runs inside `migrate-qa` and waits on ECS service stability, but there is no version probe asserting that the QA URL is actually serving the new image. The E2E starts as soon as `migrate-qa` exits, regardless of whether the ALB is still routing some traffic to old tasks during a rolling deploy. A request that lands on an old task may use a different CSRF cookie format, different validation, or may not have the `league_code` column logic at all.

### Hypothesis 3 (~10%) — Tests rely on a shared QA database with no cleanup

Every E2E run creates real users, real leagues, real invitations against the QA RDS. Over time:
- The league selector list grows unboundedly for any account that gets reused (it doesn't, since each test uses a fresh `Date.now()` email — but the global league list grows)
- Leftover data from a partial failed run (e.g., a registered user but no created league) can collide with assumptions in subsequent runs
- The QA database is the same one the migration repair has been operating on; if any of the league names in there sanitize to colliding 8-char prefixes, the unique constraint can fire even on a healthy migration

There is no `afterEach` cleanup in the test file. There is no test-only ECS service or test-only schema.

### Hypothesis 4 (~5%) — Selector or copy mismatch

The E2E test uses 14+ `data-testid` selectors. I verified the major ones (`league-generate-invite-link`, `league-invite-link`, `invite-create-account`, `invite-accept`, `league-selector-toggle`, `league-selector-create`, `league-selector-option-`, `app-logout`) all exist somewhere under `clients/poolmaster/src`. Low likelihood of a missing selector unless a recent commit renamed one without updating tests.

### Hypothesis 5 (~5%) — Auth response contract mismatch

`persistCsrfToken(response.data.tokens.csrfToken)` reads from a nested path. If the OpenAPI / generated SDK ever moved `csrfToken` to a different field (e.g., `response.data.csrfToken` directly), the function silently no-ops because of the `if (!csrfToken) return;` guard. The client cookie write then doesn't happen, and the test relies entirely on the server's `Set-Cookie`. If hypothesis 1 is *not* the issue, this is the failure path.

### How to Confirm

The Playwright HTML report is uploaded as an artifact (`ci.yml:838-846`). Pull `clients/poolmaster/playwright-report/**` from the failed run and look for:
- The actual error: timeout on `expect(page).toHaveURL(/\/league\/...)`, or earlier?
- The HAR / network log: status code on the failing POST `/api/v1/leagues` (403? 500? 404?)
- The trace viewer: the `Set-Cookie` header on the register response, and the `Cookie` header on the subsequent league-create request

Without that data, this analysis is the best-guess ranked list. The implementer agent should not push another fix until the report is read.

---

## Part B — Findings

### Critical

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| 1 | **Critical** | `clients/poolmaster/src/features/auth/auth-home-page.tsx:34-40`, `auth-provider.tsx:18-24` | Client-side `persistCsrfToken` writes a cookie that the server already sets with `httpOnly: false`. This is a redundant write with conflicting attributes (no `Domain`, fixed `Path=/`, `SameSite=Lax`, `Secure` only if HTTPS) compared to the server's `serializeCookie` defaults. The conflict can produce two cookies with the same name or one cookie with the wrong attributes for the request domain. Either silently breaks state-changing requests with `AUTH_CSRF_INVALID`. |
| 2 | **Critical** | `.github/workflows/ci.yml:820-854` | The E2E job runs against shared QA with no service-rollout health gate, no version probe, no ephemeral environment, and no test-data cleanup. Every fix to a brittle E2E here is downstream of this structural problem. |

### High

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| 3 | **High** | `clients/poolmaster/src/lib/cookies.ts:19-32` | `writeCookie` does not accept a `Domain` parameter. If the API and webapp are ever served from different subdomains (e.g., `api.qa.*` and `qa.*`), the client-side write cannot match the server's domain-scoped cookie. The server should be the only writer. |
| 4 | **High** | `.github/workflows/ci.yml:820` | `needs: migrate-qa` is the only dependency. If the QA core-api ECS service is still rolling out when the E2E starts, the test hits an inconsistent mix of old and new tasks. There is no explicit "wait for service stable + version matches expected SHA" gate. |
| 5 | **High** | `clients/poolmaster/e2e/authenticated-landing.e2e.ts` (full file) | Tests create real users/leagues/invitations on shared QA with no cleanup hook. A partial-failure run leaves orphaned records. Email uniqueness is `Date.now()` only — fine for serial runs but fragile if Playwright is ever parallelized. |

### Medium

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| 6 | **Medium** | `clients/poolmaster/playwright.config.ts` | `retries: process.env.CI ? 1 : 0`. Auto-retry on QA can mask real flakiness (e.g., rollout races) and leave duplicate test data in QA. Retries should either be removed or paired with per-test cleanup. |
| 7 | **Medium** | `clients/poolmaster/src/features/auth/auth-home-page.tsx:121-125, 145-149` | `persistCsrfToken` is called *after* `setSession(response.data.user)` in some paths and *before* it in others (check both login and register handlers). Order matters because `setSession` triggers re-renders that may fire a refetch using the old CSRF cookie. |
| 8 | **Medium** | `clients/poolmaster/src/features/auth/auth-provider.tsx:80-99` | The `clearCookie('poolmaster_csrf')` calls assume the client owns the cookie's lifecycle. The server-set cookie can only be reliably cleared by a server response with `Set-Cookie: ...; Max-Age=0; Path=...; Domain=...` matching the original attributes. Client-side `Max-Age=0` write may leave the server-set cookie alive, producing stale CSRF on subsequent logins. |
| 9 | **Medium** | `.github/workflows/ci.yml:847-854` | The E2E summary step always echoes "Status: executed" regardless of pass/fail. The job's actual exit status is captured by GH Actions, but a hard-coded "executed" string in the summary is misleading and conflicts with the artifact upload that happens `if: always()`. |

---

## Part C — Recommended Hardening

### Immediate (today, to unblock the lane)

1. **Revert the client-side CSRF write in `4833e15`.** Confirm the server's `Set-Cookie` for `poolmaster_csrf` is reaching the browser in QA. If it isn't, the fix is on the server (set the correct `Domain`, `Path`, `SameSite`, `Secure` for the QA domain), not in the client. The interceptor in `lib/api.ts:23` already reads the cookie correctly.
2. **Pull the failed Playwright report and inspect the actual network trace** before any further code change. The report is in the `poolmaster-browser-e2e` artifact. Look at the failing POST's status code and the `Cookie` / `X-CSRF-Token` headers.
3. **Add a CI version-probe step** before E2E runs: `curl https://qa.ultimateofficepoolmanager.com/api/v1/version` (or equivalent) and assert the returned image SHA matches `${{ steps.tags.outputs.sha_tag }}` from `publish-images`. Loop until match or timeout. This catches rollout races without dressing them up as test flakes.

### Short-term (this week)

4. **Make the server the single source of truth for `poolmaster_csrf`.** Remove `persistCsrfToken` and `clearCookie('poolmaster_csrf')` from the client. If the server cookie isn't reaching the browser in production, fix the cookie configuration in `packages/core-api/src/core/session-cookies.ts` — set explicit `path`, `sameSite`, `secure`, and `domain` (when configured via env) so it matches the deployment.
5. **Add a per-test cleanup hook** to the E2E suite. After each test, call a backend test-only endpoint (gated by `NODE_ENV !== 'production'` or a dedicated QA-test secret header) that purges the user/leagues created during the test. If a test-only endpoint isn't acceptable for QA, use the SDK to delete the league as the commissioner before logout.
6. **Drop `retries: 1` on CI.** Either the test passes deterministically or the underlying flake is a real bug. A retry budget hides the rollout-race class of failure that this lane will keep producing.
7. **Replace `Date.now()` with a per-test UUID** for email/league names. `Date.now()` granularity is enough for serial runs but breaks the moment anything is parallelized.

### Medium-term (next sprint)

8. **Move the deploy-gate E2E off shared QA.** Either:
   - **Ephemeral preview environments per PR/main commit** (cleanest; matches modern web app deploy patterns), or
   - **A dedicated `poolmaster-e2e` ECS service + RDS schema** that's always reset before the E2E run (matches the disposable test DB pattern that exists for backend tests).
9. **Move the test-data cleanup responsibility to the test harness, not the test bodies.** Use Playwright's `test.beforeEach` / `test.afterEach` fixtures with shared API helpers, so individual test bodies stay focused on user-facing behavior.
10. **Add a `version` endpoint** if one doesn't exist: `GET /api/v1/version` returns `{ commitSha, builtAt }`. Used by the CI version-probe, by smoke checks, and by the webapp's "About" surface. This is the cheapest possible insurance against rollout races.

### Long-term (architectural)

11. **Decide explicitly whether the deploy-gate E2E should validate "the deployed code is healthy" or "the QA environment is healthy."** They are different things. The first wants ephemeral environments and aggressive cleanup. The second wants smoke-style touch-points, not full user journeys. Mixing them produces the current lane: heavy enough to be slow, fragile enough to flake, and shared enough to corrupt itself over time.

---

## Patterns the Implementer Agent Is Repeating

These echo Review 004's findings about the migration loop, applied to the auth/E2E lane:

1. **Adding client-side workarounds for what is a server configuration problem.** The CSRF cookie should be set correctly by the server; if it isn't, fix the server. Don't write the same cookie name from two places with different attributes.
2. **Shipping a fix straight to QA without inspecting the actual failure.** The Playwright report is the load-bearing evidence. Without it, every fix is guesswork.
3. **Treating CI retries as a hardening mechanism.** A retry hides the race; it does not fix it.
4. **No exit criteria for the E2E lane.** The lane has been failing repeatedly across the migration incident and now this CSRF incident. If it keeps producing false signals, it has a structural problem that no individual fix addresses.

---

## Tell the Implementer Agent

> Stop adding client-side code on top of working server behavior. The backend already sets `poolmaster_csrf` with `httpOnly: false`. The browser already reads it. The interceptor already attaches it as `X-CSRF-Token`. Your `persistCsrfToken` write is layering a second cookie with conflicting attributes on top of the server's, and that is the most likely cause of the E2E failure. Pull the Playwright report from the failed run, look at the actual `Cookie` and `X-CSRF-Token` headers on the failing POST, and confirm before you push anything else. If the server cookie isn't reaching the browser, fix `packages/core-api/src/core/session-cookies.ts`, not the client.

---

## Review Disposition

| Area | Disposition | Reasoning |
|---|---|---|
| Pull the Playwright artifact before further changes | **Agree** | This is the right debugging discipline. The failed artifact clearly showed `Missing or invalid CSRF token` on the create-league path, and it gave us the concrete failure symptom instead of leaving us to guess from the timeout alone. |
| Client-side `persistCsrfToken` is probably the main root cause | **Partially agree** | The client-side cookie write is redundant and architecturally weaker than letting the server own the CSRF cookie. But this review predates commit `7c56436`, which fixed a separate confirmed bug: the CSRF interceptor had been attached to a custom Hey API client instance while the generated SDK calls were using the generated singleton client. That meant the `X-CSRF-Token` header was never actually being sent on generated SDK mutations. So the review identifies a real risk, but it does not account for the later confirmed integration bug. |
| Revert client-side CSRF persistence and make the server the single source of truth | **Leaning agree** | This is still the cleaner end state. The current client-side cookie helpers are not something we want to normalize as the long-term pattern. If the browser lane still fails after the singleton-client fix, this should be the next change. |
| Add a CI version probe before browser E2E | **Agree** | This is good hardening regardless of the CSRF issue. It helps us distinguish rollout-race failures from application failures and should become part of the deploy-gate browser flow. |
| Shared QA makes this lane structurally fragile | **Agree** | That risk is real. Shared QA means rollout timing and accumulating test data can both create noise. We should track a follow-up to move toward a more isolated browser target. |
| The implementer was only adding client-side workarounds for a server problem | **Partially disagree** | That criticism fits `4833e15`, but not the later singleton-client fix. `7c56436` was not a workaround; it corrected a real integration defect in how the generated SDK client was configured. |
