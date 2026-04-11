# Code Review 002 — Invite-Aware Auth Entry Flow

- **Date:** 2026-04-11
- **Scope:** `ef28e77` (Tighten invite-aware auth entry flow)
- **Files changed:**
  - `clients/poolmaster/src/features/auth/auth-home-page.tsx` (modified)
  - `clients/poolmaster/src/features/leagues/invitation-context-card.tsx` (new)
  - `clients/poolmaster/src/features/leagues/join-league-page.tsx` (modified)
  - `plans/76-league-home-and-league-context-user-cases.md` (modified)
- **Reviewer:** Code Review Agent

---

## Summary

This commit adds invite-context awareness to the auth entry page and extracts an `InvitationContextCard` reusable component. When a user arrives at the auth page via an invite deep-link, the page fetches the invitation preview and adapts its heading, copy, and calls-to-action to match the invite flow. The join-league page now surfaces separate "Sign in" and "Create account" actions that pass `authMode` state to the auth page, and both pages use the shared `InvitationContextCard`.

Overall this is a well-structured slice. The invite preview integration is clean, the component extraction reduces duplication, and the `authMode` state passing is a sensible UX improvement. The findings below are mostly about gaps carried forward from Review 001 and a few new issues.

---

## Findings

| # | Severity | File | Location | Finding | Rule Reference |
|---|----------|------|----------|---------|----------------|
| 1 | **High** | `auth-home-page.tsx` | Lines 59-61 | `location.state` is cast with `as { authMode?: unknown } \| null` — same unsafe casting pattern used for `from` on line 69. If a different route passes unexpected state, this silently produces wrong results. Consider a shared Zod schema or type guard for route state to validate both `from` and `authMode` in one place. | react-ui-rules S1: "Avoid `any`"; general type safety |
| 2 | **Medium** | `auth-home-page.tsx` | Lines 73-84 | The `invitePreviewQuery` fires on the auth page (unauthenticated) and also fires on `join-league-page.tsx:34` with a different query key (`['poolmaster', 'auth', 'invite-preview', inviteCode]` vs `['poolmaster', 'invitation-preview', inviteCode]`). Same endpoint, two different cache entries. If one fetches stale data, they will disagree. Query keys for the same resource should be consistent. | react-ui-rules S4: "Query keys should be stable arrays" |
| 3 | **Medium** | `auth-home-page.tsx` | Lines 177-191 | Invite context card renders when `inviteContext` is truthy, but the error state (line 185) is nested *inside* the `inviteContext` truthy branch. If the preview query errors, `inviteContext` is `null` (line 85: `invitePreviewQuery.data ?? null`), so the error div is unreachable. The error message for a failed invite preview will never display. | react-ui-rules S4: "Handle loading, error, empty, success" |
| 4 | **Medium** | `auth-home-page.tsx` | Lines 64-65 | `serverError` and `isSubmitting` are managed as local state but React Hook Form already provides `formState.isSubmitting`. This was flagged in Review 001 #5 area. The duplication persists and the local `isSubmitting` is not reset if the component re-renders during a mutation (e.g., tab switch while submitting). | react-ui-rules S5: "Avoid redundant, duplicate state" |
| 5 | **Medium** | `auth-home-page.tsx` | Line 232 | Server error message div still lacks `role="alert"`. Carried forward from Review 001 #6. | react-ui-rules S8 |
| 6 | **Medium** | `join-league-page.tsx` | Lines 34, 43 | `invitationQuery` is still `enabled: Boolean(inviteCode)` without gating on `isAuthenticated`. For the unauthenticated branch (line 78), the query fires, likely gets a 401, and then the page renders the redirect message. Gating with `enabled: Boolean(inviteCode) && isAuthenticated` for the accept-flow query and keeping a separate unauthenticated preview query would be cleaner. Carried forward from Review 001 #10. | — |
| 7 | **Medium** | `join-league-page.tsx` | Lines 47-63 | `acceptMutation` still has no `queryClient.invalidateQueries({ queryKey: ['poolmaster', 'leagues'] })` in `onSuccess`. After accepting, the league selector in `AppShell` won't show the new league until a manual refetch. Carried forward from Review 001 #11. | react-ui-rules S4: "Mutation Cache Behavior Must Be Explicit" |
| 8 | **Medium** | `join-league-page.tsx` | Lines 148, 96-112 | Accept button (line 148) and navigation links still lack `data-testid` selectors. Carried forward from Review 001 #13. | react-ui-rules S9 |
| 9 | **Low** | `invitation-context-card.tsx` | Full file | Clean extraction with `data-testid="invitation-context-card"`. One minor gap: the invite code is displayed as raw text without any visual distinction (e.g., monospace or code styling), which could make it hard to identify as a machine identifier vs. regular copy. | — |
| 10 | **Low** | `invitation-context-card.tsx` | Lines 26-27 | `title` is rendered in a plain `<div>` with muted styling. Semantically it acts as a label for the card section but has no heading level or ARIA role. Not a blocker, but adding `role="heading"` with an appropriate `aria-level` or using a semantic element would improve screen reader navigation. | react-ui-rules S8 |
| 11 | **Low** | `auth-home-page.tsx` | Line 380 | The "Back to invitation" / "Continue to welcome" link at the bottom of the form area uses `inviteContext` to decide its destination and label. But if the invite preview fails (finding #3), `inviteContext` is null, so the link says "Continue to welcome" even though the user arrived via an invite flow. The `destination` variable (line 68) still holds the invite path, so the link could use `inviteCode` instead of `inviteContext` for the destination/label decision. | — |

---

## What This Commit Fixes From Review 001

- **New `InvitationContextCard` component** reduces code duplication for invite preview display across `auth-home-page.tsx` and `join-league-page.tsx`.
- **`authMode` state passing** from join-league-page to auth page means invited users can land directly on the register tab — a good UX improvement.
- **Plan 76 updated** with current implementation status for invite-aware auth entry.

## Carried Forward From Review 001

The following findings from Review 001 remain unaddressed in this commit:

| Review 001 # | Summary | Status |
|---|---|---|
| #4 | Auth provider `useEffect` loop risk | Still open |
| #5 | Password validation divergence between login/register | Still open |
| #6 | Server error missing `role="alert"` | Still open (this review #5) |
| #10 | Invite query fires regardless of auth state | Still open (this review #6) |
| #11 | Missing cache invalidation on invite accept | Still open (this review #7) |
| #13 | Missing `data-testid` on join-league interactive elements | Still open (this review #8) |

---

## Top Priorities

1. **#3 — Unreachable error state:** The invite preview error message on the auth page can never render. Either move the error check outside the `inviteContext` truthy branch, or check `invitePreviewQuery.isError` independently.
2. **#2 — Inconsistent query keys:** Same `getInvitationPreview` endpoint cached under two different keys will cause stale data disagreements.
3. **#7 — Missing cache invalidation (carried forward):** Invite acceptance still doesn't invalidate the leagues query.
4. **#6 — Unauthenticated query firing (carried forward):** Wasted 401 request on the join page for unauthenticated users.

---

## Follow-Up Disposition

### Fixed

- `#1` Route-state parsing now goes through a shared parser instead of ad hoc casting.
- `#2` Auth and invite pages now use the same invitation-preview query key helper.
- `#3` The auth-page invite-preview error state is now reachable even when no preview data was returned.
- `#4` `auth-home-page.tsx` no longer carries a duplicate local `isSubmitting` flag.
- `#5` Auth-page server errors now use `role="alert"`.
- `#7` Invite acceptance now invalidates the leagues query before redirecting.
- `#8` Join-league navigation links and the accept button now have automation selectors.
- `#9` Invite codes now render with monospace styling.
- `#10` The invitation card title now uses a semantic heading element.
- `#11` The footer link on the auth page now keys off invite intent, not only successful preview data.

### Disagree

| Finding | Reasoning |
| --- | --- |
| `#6` Invitation preview is intentionally public. | The reviewed product flow requires users to see league-scoped invite context before authentication, so leaving the preview query enabled without auth is the correct behavior rather than wasted work. |
