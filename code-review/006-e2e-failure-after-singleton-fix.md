# Code Review 006 — E2E Failure After Singleton CSRF Fix (`7c56436`)

- **Date:** 2026-04-12
- **Scope:** New `poolmaster-browser-e2e` failure after `7c56436` ("Use configured Hey API singleton in PoolMaster") successfully addressed the original CSRF interceptor wiring bug
- **HEAD at review:** `7c56436`
- **Reviewer:** Architect Agent

---

## Context

Commit `7c56436` corrected a real defect identified after Review 005: the CSRF interceptor was attached to a custom client created by `createClient(...)` and exported as `client` from `lib/api.ts`, while every generated SDK function silently used the default singleton imported from `client.gen.ts`. Result: `X-CSRF-Token` was **never** sent on any mutation, regardless of which cookies the browser had. The fix attaches the interceptor (and the `baseUrl` + `credentials: 'include'` config) to the singleton itself.

This was the right fix. The original "create league returns 403" symptom should be gone.

The user reports the E2E is failing **again with a different failure**. Without the Playwright HTML report from the failed run, this analysis ranks the most likely new failure modes in order. **No further code change should ship until the report is read.**

---

## Part A — Most Likely New Failure Modes (Ranked)

### Hypothesis 1 (~30%) — Stale `invitationQuery` cache across the auth boundary in test 2

`tests[1] 'invited new user registers, joins the league, and can log out'` runs this sequence:

1. Visit `/invite/<code>` unauthenticated → `JoinLeaguePage` fires `invitationQuery` with key `['poolmaster', 'invitation-preview', inviteCode]`
2. The query may succeed (preview is public) or 401 depending on server config
3. Click `invite-create-account` → navigate to `/` with `state.authMode = 'register'`, `state.from = '/invite/<code>'`
4. `AuthHomePage` *also* fires its own invite preview query with key `['poolmaster', 'auth', 'invite-preview', inviteCode]` (different key per Review 002 finding #2)
5. User registers → server sets cookies → navigate back to `/invite/<code>`
6. `JoinLeaguePage` re-renders. Same query key as step 1. **TanStack Query returns the cached result from step 1, which was fetched without auth.**
7. If the cached result is missing the `inviteAccept`-required state, the test never sees the `invite-accept` button or fails on `expect(page.getByTestId('invite-accept')).toBeVisible()`

This was already flagged in Review 002 as finding #2 (inconsistent query keys). The disposition agreed with the underlying risk. With CSRF now actually working, test 2 progresses past the previously-blocking POST and hits this latent cache bug.

### Hypothesis 2 (~25%) — Service rollout race carried forward from Review 005 #4

`poolmaster-browser-e2e` still declares only `needs: migrate-qa`. There is no version probe asserting the QA URL is serving the just-deployed image SHA. With `7c56436` containing only client-side changes, the **webapp** is the artifact that needs to be live in QA — not the API container. If S3 + CloudFront cache invalidation is racing with the test start, the browser may load the **previous** webapp bundle (the one without the singleton fix), and the original CSRF symptom returns. It looks like a flake but it's a deploy timing bug.

### Hypothesis 3 (~15%) — Bootstrap auth-provider race triggered by the now-active interceptor

`auth-provider.tsx:32-52` mounts two queries on every page load:
- `meQuery` → GET `/api/v1/auth/me`
- `refreshQuery` (lazy, `enabled: false`) → POST `/api/v1/auth/refresh`

On a fresh `page.goto('/')` in Playwright:
1. `meQuery` fires with no session cookie → 401 → triggers the refresh effect
2. `refreshQuery.refetch()` posts to `/api/v1/auth/refresh`
3. **Now-active interceptor reads `poolmaster_csrf` cookie** — there is no cookie on a fresh page → no header set
4. If the refresh endpoint is non-public and CSRF-required, server returns 403, refresh is treated as failure → `clearSessionState()`. Fine, expected.
5. But if the refresh endpoint is **public** (no CSRF), it proceeds; the response sets cookies including a new CSRF, `persistCsrfToken` writes it again. Two writes (server + client) may produce duplicate cookies with different attributes, recreating Review 005 hypothesis 1 *for the very first request after refresh*.

Net result: the first state-changing request after a fresh page load may pick up an attribute-mismatched cookie pair on the very first refresh boundary, and the auth-guard returns 403.

### Hypothesis 4 (~15%) — Test data accumulation finally crossing a threshold in QA

Every E2E run since the lane was added has been creating real users + leagues against the same QA RDS. With CSRF previously broken, league creation was failing → less data was actually being persisted. **Now that CSRF works, every retry across every previous failed run is now successfully persisting data.** The cumulative dataset that just landed in QA across recent green-on-create runs may now include:

- Many leagues with names beginning with `Playwright`, `Invite`, `Alpha`, `Bravo` → first 8 chars of `generateLeagueCode` collide
- The retry loop in `LeagueService.generateLeagueCode` (`packages/core-api/src/modules/leagues/service.ts:148-154`) tries 10 candidates of form `${normalizedBase.slice(0,12)}${4-hex-suffix}`. 4 hex chars = 16 bits = 65,536 keyspace. Birthday collision risk grows with prior leagues. After enough accumulation, the loop exhausts and throws.
- Effect: POST `/api/v1/leagues` returns 500. Modal shows error. URL never matches `/league/[A-Z0-9]+`. Test times out.

### Hypothesis 5 (~10%) — Logout + clear-cookie attribute mismatch leaves stale CSRF for the next test phase

`auth-provider.tsx:115-119` `clearSession`:
```ts
await logoutUser().catch(() => undefined);
clearCookie('poolmaster_csrf');
clearSessionState();
```

The server's logout response sets `Set-Cookie: poolmaster_csrf=; Max-Age=0` with whatever attributes the original cookie had. `clearCookie` then writes `Max-Age=0` from the client with **different** attributes (no Domain). If the server cookie had `Domain=.qa.ultimateofficepoolmanager.com` and the client write doesn't, the server cookie persists at the parent domain and the client write only clears at the leaf. The next request after logout sends the stale cookie, the server's auth-guard rejects with `AUTH_CSRF_INVALID` (no valid session, but cookie present), and tests that exercise the post-logout flow fail.

Test 2 logs out the commissioner before the invited member registers; test 3 logs out then logs back in. Either is a candidate.

### Hypothesis 6 (~5%) — Different test failing now (test 1 passes, test 2 or 3 fails)

The original failure was almost certainly on test 1 (the simplest path, hitting the create-league POST). With `7c56436` resolving the singleton issue, test 1 may now pass and the lane is failing on test 2 or 3 — a **new** failure in absolute terms but a downstream one we hadn't yet exercised.

---

## Confirmation Required

The Playwright HTML report and trace are uploaded as the `poolmaster-browser-e2e` artifact (CI workflow line 838-846). Pull it and report:

1. **Which test failed?** (The hypotheses above narrow significantly based on whether it's test 1, 2, or 3.)
2. **What was the failing assertion?** (URL timeout? Visibility check? Status code?)
3. **What was the network trace at the failure point?** Specifically:
   - Status code on the failing request
   - `Cookie:` header sent
   - `X-CSRF-Token:` header sent (or missing)
   - Response body
4. **What's in the QA `leagues` table right now?** `SELECT COUNT(*), COUNT(DISTINCT LEFT(league_code, 8)) FROM leagues;` — settles hypothesis 4.

Anything less and the next fix is another guess.

---

## Part B — Findings Specific to the New Failure Class

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| 1 | **High** | `clients/poolmaster/src/features/auth/auth-home-page.tsx:73-84` and `features/leagues/join-league-page.tsx:34-45` | `getInvitationPreview` is fetched under two different query keys for the same resource (`['poolmaster', 'auth', 'invite-preview', code]` vs `['poolmaster', 'invitation-preview', code]`). The `JoinLeaguePage` cache for an unauthenticated visit persists across the auth boundary and is not refetched after registration. (Carried from Review 002 #2; now load-bearing.) |
| 2 | **High** | `clients/poolmaster/src/features/auth/auth-provider.tsx:115-119` | `clearSession` writes `clearCookie` from the client *after* the server's logout response has already set `Set-Cookie: poolmaster_csrf=; Max-Age=0`. The two writes may not have matching attributes (no `Domain` on the client write), leaving stale cookies at the parent domain. The server should be the only writer; the client should not also try to clear. |
| 3 | **High** | `.github/workflows/ci.yml:820-854` | `poolmaster-browser-e2e` still has no version probe before running. Webapp deploys to S3 + CloudFront have a propagation window; without verifying the served bundle matches the expected SHA, the test can race the deploy. (Carried from Review 005 #4.) |
| 4 | **Medium** | `clients/poolmaster/e2e/authenticated-landing.e2e.ts` | No per-test data cleanup. With CSRF now working, league creation persists every run's data. League name prefixes (`Playwright`, `Invite`, `Alpha`, `Bravo`) collide on the first 8 chars used by `generateLeagueCode`, increasing retry-loop pressure over time. (Carried from Review 005 #5.) |
| 5 | **Medium** | `clients/poolmaster/src/features/auth/auth-provider.tsx:54-108` | The bootstrap `meQuery` → `refreshQuery` cascade now fires the *active* CSRF interceptor on `refreshToken`. If the refresh endpoint requires CSRF and the user has no cookie (fresh page load), refresh fails 403. If it doesn't require CSRF, the post-refresh response sets a new cookie and `persistCsrfToken` writes it again, creating a duplicate. Either way, the refresh path is now a new code path that wasn't actually exercised before `7c56436`. |
| 6 | **Medium** | `clients/poolmaster/src/lib/api.ts:18-29` | The interceptor is unconditionally added on module load. There is no de-duplication. If module is ever evaluated twice (HMR in dev, bundle splitting edge cases), the interceptor stacks and the CSRF header is set twice. Less likely in production, but worth a `if (!alreadyAttached)` guard. |

---

## Part C — Recommended Action

### Stop coding. Read the report.

Three of the six hypotheses (1, 4, 5) are only distinguishable by reading the actual failure. The other three (2, 3, 6) are downstream concerns that should be addressed regardless. The failure mode determines whether the immediate fix is in the client, in the test, or in CI.

**Concrete next steps in order:**

1. Pull the `poolmaster-browser-e2e` artifact from the failed CI run. Open `playwright-report/index.html`. Identify the failing test, line, and network trace.
2. Run the QA SQL probe in "Confirmation Required" above.
3. Based on the actual failure:
   - **If test 2 fails on `invite-accept` visibility** → Hypothesis 1, fix: unify the two `getInvitationPreview` query keys, OR add `staleTime: 0` + `refetchOnMount: 'always'` to the JoinLeaguePage query, OR invalidate the key on auth state change.
   - **If create-league still 403s** → Hypothesis 2 (rollout race) — webapp bundle hasn't propagated. Add the CI version probe and re-run.
   - **If create-league returns 500 with collision-related error** → Hypothesis 4. Reset QA data or change `generateLeagueCode` to use higher-entropy random codes (8+ hex chars instead of 4).
   - **If logout/login flow fails** → Hypothesis 5. Make the server the sole owner of the CSRF cookie lifecycle; remove `clearCookie('poolmaster_csrf')` and `persistCsrfToken` calls from the client.

### Hardening that ships regardless of the failure

- **Unify the `getInvitationPreview` query key** between `auth-home-page.tsx` and `join-league-page.tsx`. There is one resource; there should be one cache entry.
- **Add the CI version probe** (Review 005 #3): `curl https://qa.ultimateofficepoolmanager.com/version.json` (or whatever endpoint exposes the deployed SHA), assert it matches the expected SHA, loop with timeout. Remove `retries: 1` from `playwright.config.ts` once this is in.
- **Stop having the client write CSRF cookies.** The server already sets the cookie with `httpOnly: false`; the browser already reads it; the (now-active) interceptor reads it from `document.cookie`. The client-side `persistCsrfToken` and `clearCookie('poolmaster_csrf')` calls were a band-aid. With the singleton wired correctly, they are now actively risky (duplicate cookies, attribute mismatches).
- **Add per-test cleanup** for the E2E suite. With CSRF working, every run's data now persists; without cleanup the QA DB grows unboundedly and `generateLeagueCode` collisions get more likely over time.
- **Idempotency guard on the interceptor** (`lib/api.ts`): track whether already attached so HMR or repeated module evaluation doesn't stack handlers.

---

## Patterns the Implementer Agent Is Still Repeating

Echoing Review 004 and Review 005:

1. **Shipping fixes without reading the failure evidence.** Three rounds of CSRF guesses, then the singleton fix landed and worked — but the next round of failures is now being chased without the artifact. The pattern is the same: assume, push, observe.
2. **Layering client-side workarounds on server-managed state.** The `persistCsrfToken` and `clearCookie` calls were added when the singleton bug was making the cookie-based flow look broken. With the real bug now fixed, the workarounds remain — and they introduce their own risk.
3. **Each fix surfaces the next bug because the lane has no isolation.** Tests share QA, share a database, share an ECS service, share state across runs. Every fix advances the symptom; no fix removes the structural fragility.

---

## Tell the Implementer Agent

> The singleton fix in `7c56436` was correct and addressed a real defect. Do not roll it back. The lane is failing again on a different bug. **Do not push another patch until you have the Playwright report from the failed run and the answers to the four questions in "Confirmation Required."** Most likely candidates are: (1) the `JoinLeaguePage` invitation query is cached from before authentication and never refetched, (2) the webapp bundle on QA is the pre-`7c56436` build because of S3/CloudFront propagation, or (3) the now-persisting league data is colliding in `generateLeagueCode`. Each has a different fix. Stop guessing. Pull the artifact.

---

## Review Disposition

| Area | Disposition | Reasoning |
|---|---|---|
| Read the Playwright artifact before another code change | **Agree** | This review was right about process. The trace from run `24309634314` gave the decisive signal: the failing request was `GET /api/v1/invitations/:inviteCode`, and it returned `401` in QA. |
| Singleton-client fix in `7c56436` was the right fix | **Agree** | That was a real integration defect and should not be rolled back. The first and third browser flows passed after that change, which is consistent with the original create-league CSRF failure being resolved. |
| Stale invitation-preview cache was the most likely next failure | **Disagree** | The artifact ruled this out for the failing run. `JoinLeaguePage` never received preview data at all because the public preview endpoint was incorrectly treated as authenticated by the global auth guard. |
| Version-probe and shared-QA hardening are still worth doing | **Agree** | Even though the immediate root cause was the auth guard, the rollout/version-probe advice remains valuable and is being implemented as part of the current hardening slice. |
