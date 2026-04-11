# Code Review 001 — PoolMaster Webapp Full Review

- **Date:** 2026-04-11
- **Scope:** `clients/poolmaster/src/` — all application source files
- **HEAD at review:** `c381c3d` (Implement create league modal flow)
- **Reviewer:** Code Review Agent

---

## Summary

Full review of the PoolMaster React webapp covering all 22 source files under `clients/poolmaster/src/`. The codebase is generally well-structured: it uses the generated hey-api client correctly, follows the DTO-driven contract model, and the recent create-league modal aligns with the Plan 75 decisions. The main gaps are modal accessibility, auth effect stability, missing cache invalidation on invite accept, absent frontend tests, and missing `data-testid` selectors on several interactive elements.

---

## Findings

| # | Severity | File | Location | Finding | Rule Reference |
|---|----------|------|----------|---------|----------------|
| 1 | **High** | `features/leagues/create-league-modal.tsx` | Lines 98-212 | Modal has no focus trap, no Escape key handler, and no backdrop-click dismiss. `role="dialog"` and `aria-modal="true"` are present but without actual focus containment they are decorative. Should use a proper dialog primitive (shadcn `Dialog` / Radix) per the stack. | react-ui-rules S8: "Use accessible shadcn/Radix primitives correctly" |
| 2 | **High** | `features/leagues/create-league-modal.tsx` | Lines 152-194 | Form fields are not disabled while mutation is pending — only the submit button is. User can edit the form during submission, creating confusing UX and potential double-submit via Enter key. | react-ui-rules S5: "Pending UI Is Required" |
| 3 | **Medium** | `features/leagues/create-league-modal.tsx` | Lines 158-172 | Visibility radio buttons use CSS `has-[:checked]` for selection styling with `sr-only` inputs. No `aria-describedby` linking the description text to the radio. Accessible name is only the label text, not the description. | react-ui-rules S8 |
| 4 | **High** | `features/auth/auth-provider.tsx` | Lines 51-66 | `useEffect` dependency array references `meQuery` object, which changes identity on every render. This creates a risk of infinite re-render loops or excessive refetch cycles. The refresh logic mixes imperative refetch calls inside an effect that watches query state — a fragile pattern. | react-ui-rules S5: "Use Effect Only For External Synchronization" |
| 5 | **Medium** | `features/auth/auth-home-page.tsx` | Lines 15-19 | Password validation for register form overrides the shared `LoginRequestSchema.shape.password` with a local `z.string().min(8)` + confirmPassword. Login form uses `z.string().min(1)`. The validation rules diverge from whatever the backend enforces — validation should mirror backend constraints. | react-ui-rules S5: "Keep validation clear and consistent with backend constraints" |
| 6 | **Medium** | `features/auth/auth-home-page.tsx` | Line 186 area | Server error messages rendered without `role="alert"` — screen readers will not announce them. | react-ui-rules S8 |
| 7 | **Medium** | `features/leagues/leagues-page.tsx` | Lines 23-36 | `leaguesQuery` is duplicated here and in `app-shell.tsx` with the same query key. React Query deduplicates the fetch, but the pattern is confusing — the shell already has the data and could pass it down or let the page read from cache intentionally. | react-ui-rules S5: "Avoid redundant, duplicate state" |
| 8 | **Medium** | `features/leagues/leagues-page.tsx` | Lines 38, 49, 64 | `data-testid="authenticated-landing"` is reused on three different conditional branches (loading, error, empty). Test selectors should be unique per meaningful UI state. | react-ui-rules S9: "Selector Naming Rules" |
| 9 | **Medium** | `features/leagues/league-detail-page.tsx` | Lines 57, 70, 74-87 | `leagueId` derived from `leagueQuery.data?.id ?? ''`, then used as `enabled: Boolean(leagueId)` for `contestsQuery` and `membersQuery`. If `leagueQuery` is slow or errors, dependent queries silently stay disabled. No user-visible indication of this partial loading. | react-ui-rules S4: "Handle loading, error, empty, success" |
| 10 | **Medium** | `features/leagues/join-league-page.tsx` | Line 42 | Query enabled when `inviteCode` exists regardless of auth state. The query fires, fails for unauthenticated users, then the page renders a redirect-to-login message. Gating `enabled` on auth state would avoid the wasted request and error flash. | — |
| 11 | **Medium** | `features/leagues/join-league-page.tsx` | Lines 54-60 | No query invalidation for `['poolmaster', 'leagues']` after accepting an invite. The `AppShell` league selector will not show the newly joined league until the next window focus or manual refresh. | react-ui-rules S4: "Mutation Cache Behavior Must Be Explicit" |
| 12 | **Medium** | `features/leagues/league-detail-page.tsx` | Lines 270-340 | Invite link input, copy button, invite-by-email button, and member list all lack `data-testid` selectors. These are interactive automation-critical elements. | react-ui-rules S9 |
| 13 | **Medium** | `features/leagues/join-league-page.tsx` | Lines 148, 98-107 | Accept-invite button and navigation links lack `data-testid`. | react-ui-rules S9 |
| 14 | **Medium** | `features/app-shell/league-selector.tsx` | Full file | No `data-testid` on the summary toggle, individual league items, or the "Create league" action inside the selector dropdown. | react-ui-rules S9 |
| 15 | **Low** | `features/contests/contest-detail-page.tsx` | Lines 108-113, 141-158 | Back link, leaderboard entries, and leaderboard section lack `data-testid`. Truncated entry IDs (`slice(0,8)`) have no tooltip or expand affordance. | react-ui-rules S9, S8 |
| 16 | **Medium** | `routes/index.tsx` | Full file | No catch-all / 404 route defined. Unmatched URLs render blank inside the shell. Should have a `{ path: '*', element: <NotFoundPage /> }` at minimum. | react-ui-rules S8: "Provide clear empty and error states" |
| 17 | **Low** | `routes/index.tsx` | Lines 11-14 | `LegacyJoinInviteRedirect` is defined inline in the router file. Fine for a single redirect, but if more legacy redirects accumulate they should move to `route-guards.tsx`. | — |
| 18 | **Low** | `features/app-shell/app-shell.tsx` | Lines 72-100 | Multiple disabled nav buttons ("Contests", "Notifications", "Help", etc.) with no tooltip or `title` explaining why they are disabled. Users and screen readers get no context. | react-ui-rules S8: "Avoid interaction dead-ends and no-op buttons" |
| 19 | **Low** | `features/app-shell/app-shell.tsx` | Lines 122-150 | Navigation items use `<button>` elements that call `navigate()`. Semantic `<a>` or `<NavLink>` would be more appropriate for navigation and provide native browser behaviors (open in new tab, etc.). | react-ui-rules S8: "Use semantic HTML" |
| 20 | **Low** | `lib/api.ts` | Lines 10-20 | CSRF cookie extraction uses string split logic (`split('; ')` then `split('=')`) — does not handle edge cases like `=` in cookie values. Not a bug today but fragile. | — |
| 21 | **Low** | `features/leagues/league-routing.ts` | Lines 20-25 | Same fragile cookie parsing pattern for `RECENT_LEAGUE_COOKIE`. | — |
| 22 | **Medium** | `app.test.tsx` | Full file | Only one test exists for the entire webapp — a basic render check. No frontend-layer tests for the create-league flow, league detail, join flow, or auth flows. | testing-rules S2, react-ui-rules S7: "Required Frontend Test Layers" |

---

## Plan Alignment Notes

- **Plan 75 (League Creation Wizard Discovery):** All tasks marked Done. Implementation matches resolved decisions — name + visibility fields, single-step modal, success routes to `/league/<leagueCode>`, `sport` correctly deferred. No violations.
- **Plan 69 (Webapp Rebuild):** Row "Add PoolMaster-specific frontend tests" is still Pending, which aligns with finding #22.
- **Plan 76 (League Home Use Cases):** Implementation status section was updated to reflect current state. Legacy `/join/<inviteCode>` redirect and recent-league cookie on invite accept are now in place.

---

## Top Priorities

1. **#1 — Modal accessibility:** Replace the hand-rolled dialog with shadcn `Dialog` (Radix-based) to get focus trapping, Escape-to-close, and backdrop dismiss for free. This is the most user-facing regression risk.
2. **#4 — Auth effect loop risk:** Stabilize the `useEffect` dependency or restructure the refresh logic to avoid re-render storms.
3. **#11 — Missing cache invalidation on invite accept:** Users who accept an invite will not see the league appear in the selector until a manual refresh.
4. **#22 — No frontend tests:** The plan explicitly calls this out as pending, but the create-league modal flow is complex enough to warrant at least one MSW-backed integration test before more features layer on top.
5. **#16 — Missing 404 route:** Easy fix, high polish impact.

---

## Follow-Up Disposition

### Fixed

- `#1` Modal accessibility moved to Radix `Dialog`, which now provides Escape handling, overlay dismissal, and focus containment.
- `#2` Create-league form fields and close/cancel controls are disabled while the mutation is pending.
- `#3` Visibility options now link description text through `aria-describedby`.
- `#4` Auth refresh logic no longer depends on the full query objects and now guards refresh retries with a ref.
- `#6` Auth error messages now use `role="alert"`.
- `#8` Welcome-page state selectors now include unique state-specific test IDs.
- `#11` Invite acceptance now invalidates `['poolmaster', 'leagues']`.
- `#12` Commissioner invite controls and member rows now have automation selectors.
- `#13` Invite action buttons now have automation selectors.
- `#14` League selector toggle, options, and create-league action now have automation selectors.
- `#15` Contest back-link and leaderboard elements now have selectors, and truncated entry IDs expose the full value with `title`.
- `#16` A catch-all not-found route now exists.
- `#18` Disabled shell actions now explain themselves with `title` text.
- `#20` CSRF cookie parsing now uses a shared helper.
- `#21` Recent-league cookie parsing now uses the same shared helper.
- `#22` The webapp no longer has only one frontend test; a create-league modal test was added.

### Disagree

| Finding | Reasoning |
| --- | --- |
| `#5` Login validation should not enforce register-time password-creation rules. | Registration already mirrors the backend contract through `RegisterRequestSchema.shape.password`; login intentionally accepts any non-empty password so existing users are not blocked by stricter creation-time constraints. |
| `#7` Reusing `useQuery` with the same `['poolmaster', 'leagues']` key in both the shell and the welcome page is intentional. | This is shared server-state access through React Query, not duplicated local state, and it avoids prop-drilling the app shell into route content. |
| `#9` The dependent contest/member queries in league detail are already gated correctly and render their own loading/error states in the lower sections. | That behavior is intentional rather than a hidden partial-failure path. |
| `#10` Invitation preview is a public endpoint by design. | Fetching it before authentication is correct for the reviewed invite flow because users need league-scoped context before sign-in or registration. |
| `#17` The inline `LegacyJoinInviteRedirect` is still small and clear enough to keep in the router file for now. | It remains a one-line route concern and has not grown into a broader redirect layer yet. |
| `#19` The disabled shell navigation items are placeholders for routes that do not exist yet. | Keeping them as disabled buttons is intentional until those destinations become real links. |
