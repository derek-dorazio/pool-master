# Plan 29: Webapp and Admin Hardening

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

## Purpose

Finish removing frontend TODO stubs, duplicate client layers, and placeholder interaction flows so both webapps reflect the generated API contract and only expose features that are actually wired.

## Current MVP Interpretation

Keep frontend hardening aligned to the narrowed launch scope:

- prioritize leagues, invites, contest creation, draft-once tournament participation, standings, scoring, and results
- treat bracket, survivor, rich social, and billing-heavy surfaces as deferred unless a fresh planning pass reactivates them
- where a deferred feature still has UI remnants, prefer removing or archiving that surface over polishing it into the MVP

## Review Findings Driving This Plan

1. Several user-facing web features still simulate success locally instead of calling the API.
2. Legacy handwritten API clients still exist alongside the generated client and are still referenced by tests.
3. Some frontend hooks still use local contract extensions/casts instead of shared DTOs.
4. Smoke tests still permit known-bad responses in several flows, which reduces signal after deploy.
5. The admin migrations UI still depends on a fake local view-model cast and a fake cancel interaction instead of the real run contract.

## Scope

- `clients/web/src/features/**/*`
- `clients/web/src/lib/*`
- `clients/admin/src/lib/*`
- smoke/E2E and relevant unit/integration tests

## Goals

- Remove production UI stubs and TODO-success flows.
- Standardize on the generated client and shared DTOs.
- Remove obsolete manual client wrappers and tests built around them.
- Tighten smoke/E2E assertions once backend/QA behavior is stable.

## Priorities

### Priority 1

Remove UI flows that lie about success:

- fake commissioner actions
- fake join/leave flows
- fake settings mutations for destructive or compliance-sensitive actions

### Priority 2

Eliminate contract drift in the client layer:

- migrate away from handwritten API wrappers
- remove local DTO extensions and unsafe casts
- align tests with the generated client and shared contracts

### Priority 3

Increase deployment confidence once the product flows are real:

- tighten smoke assertions
- add browser coverage for the repaired interaction paths

## Implementation Phases

### Phase 1: Remove fake success flows from user-facing UX

- Audit contest, league, and settings features for `setTimeout`, optimistic-only success toasts, and TODO placeholders.
- Decide case by case whether each feature should be wired to a real API now or hidden until the backend exists.
- Prioritize destructive or trust-sensitive flows first, especially account deletion, self-exclusion, and participation changes.

### Phase 2: Repair or gate contest and league interactions

- Replace commissioner control placeholders with real admin/commissioner actions where backend support exists.
- Replace join/leave placeholders with real mutations, or remove the controls from production surfaces until supported.
- Update feature-state handling so loading, error, and permission states reflect actual server responses.

### Phase 3: Repair settings and profile contract usage

- Replace settings TODO flows with real APIs or explicit disabled states that explain the capability is unavailable.
- Audit hooks and feature helpers for local API-shape extensions that should instead be owned by shared DTOs.
- Expand backend/shared contracts as needed rather than preserving frontend-only type patches.

### Phase 4: Consolidate around the generated client

- Identify remaining imports of handwritten API clients in the web and admin apps.
- Remove or isolate the legacy wrappers so the generated client is the default application path.
- Update affected tests to exercise request wiring through MSW or contract-aligned adapters rather than mocking obsolete wrappers.

### Phase 5: Tighten smoke and browser verification

- Review smoke tests that currently allow broken responses or placeholder success envelopes.
- Tighten those assertions after the underlying backend and frontend flows are real and stable.
- Add browser coverage for logout, scoring-template contest creation, and key settings journeys that are now contract critical.

## Acceptance Criteria

- No production web or admin flow claims success without making a real API call or presenting a clearly disabled state.
- Generated-client usage is the default path for application API access in both apps.
- Frontend hooks and feature modules no longer depend on local DTO extensions where the backend contract should own the shape.
- Tests no longer center on mocking the legacy handwritten client layer.
- Smoke and browser coverage assert the repaired end-to-end behavior for the most important user flows.

## Action Plan

| ID | Area | Task | Status | Notes |
|---|---|---|---|---|
| WAH-001 | Contest UX | Replace the fake mutation in [commissioner-controls.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/contests/commissioner-controls.tsx) with real admin/commissioner actions or remove the controls until supported | In Progress | Contest commissioner controls now use the real adjust/recalculate/close/reopen/extend APIs, the contest detail page now has a real contest-entry flow backed by `/api/v1/contests/:contestId/entries` and `/entries/me`, and the draft room/results pages consume a real mode-aware draft-state DTO. Snake, open-selection, tiered, pick'em, and bracket rooms now talk to real backend contracts instead of frontend-only casts and the nonexistent `/drafts/:id/available` endpoint. Contest entry CTAs are mode-aware too now: snake contests open a draft room, while pick'em, bracket, budget, tiered, and open-selection contests use truthful room labels instead of generic draft-only wording. The pre-start contest view now follows that same contract language too, so non-snake contests no longer say `Draft starts in`, `Entries`, or `Enter Contest` generically when the user is actually making predictions or bracket submissions. Draft/results recap copy is mode-aware as well, so pick'em and bracket rooms no longer present everything as a generic snake-draft recap, and the results page now also shows real matchup/region labels from `pickEmEvents` and `bracketMatchups` instead of collapsing those selections into generic rows. Contest-side scoring/comparison pages now follow that mode-aware language too, using prediction/selection terminology for pick'em and bracket contests instead of pretending every breakdown is a generic participant contribution table, and persisted score-detail context now surfaces real matchup/round labels whenever a saved pick or bracket prediction can be tied to the scoring event unambiguously. The full standings page now matches that contract language too, using mode-aware titles and score/entry labels for pick'em and bracket contests instead of presenting them as generic entry tables, and the active contest detail page now mirrors that wording in its `My Entry` card and standings snapshot instead of reverting to generic entry/score labels there. Draft-room commissioner controls are real for the live snake workflow too: actual owners/commissioners can pause, resume, extend, undo, and skip through backend endpoints, skipped turns render honestly in the grid/results, the room now surfaces truthful `draft unavailable` / `contest entry required` states instead of redirecting away or silently no-oping when the user lacks an entry, the bottom draft chat now uses the live contest chat contract instead of a fake send box, and budget-pick rooms now preserve real pricing metadata so the UI can show actual participant prices plus spent/remaining cap instead of flattening that mode into a generic selection flow. Create, pre-start, active detail, room header, and selection-summary panels now also carry forward the real contestant-setup rules from `selectionConfig`, so tiered and budget contests expose pricing, tier assignment, tier counts, and picks-per-tier instead of hiding that configuration after the wizard. Active/completed contest detail pages also now keep showing the real contest-entry contract even before standings roll up, instead of incorrectly implying the user has no entry just because `getMyStandingsEntry` is unavailable. Contest results also now surface persisted single-entry standings honestly instead of incorrectly treating them as unavailable just because there is no runner-up row yet. The backend also seeds pick'em/bracket matchup rows from real `EVENT_FIELD` pool resolution, so those rooms no longer depend on manually inserted matchup data for single-event contests. The contest creation wizard is now back on the core MVP path too: it selects from real ingested events, only offers active MVP selection modes, and submits normalized tier/budget configuration plus event-backed schedule data so new contests provision a real contestant pool instead of stopping at a shell contest record. Remaining contest surfaces still need the same cleanup treatment, especially deeper bracket-specific standings/results/admin flows outside the shared draft room |
| WAH-002 | League UX | Replace fake join/leave flows in [join-leave-flow.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/leagues/join-leave-flow.tsx) with real API calls or gate/hide the feature | In Progress | Discovery open-league join is real, non-open joins are honestly disabled, live league pages now use real member list/self-leave contracts, invite links now land on a real `/join/:inviteCode` acceptance page with auth redirect preservation, and the leftover `join-leave-flow.tsx` utility now calls the real discovery join and `DELETE /leagues/:id/members/me` endpoints instead of using `setTimeout` success stubs. Remaining work is a real approval-request backend flow for non-open leagues |
| WAH-003 | Settings UX | Replace account deletion, self-exclusion, activity/session reminders, and similar settings TODO flows with real APIs or disable them | In Progress | The league settings surface now saves real backend settings, generates invite links on demand, and transfers ownership through the live API; fake rename/archive behavior was removed because no real backend route exists. The compliance/settings lane now uses real consent history and data-export status contracts: cookie preferences default from persisted consent records instead of a fake preference object, consent updates write accepted backend consent types one-by-one, profile SSO state is derived from `authProvider`, `/api/v1/account/data-export` has a real status endpoint, and `/api/v1/account/delete-account` now has a real persisted status read path so the account-deletion card reflects backend state instead of a local request id. Activity limits, session reminders, and self-exclusion surfaces now use real backend contracts too, including persisted active-exclusion display and real session-reminder reads/writes. Social remediation is also reflected in the live contract layer: the web app now consumes DTO-backed social routes for contest chat, direct messages, league recaps, share cards, and the league feed itself instead of frontend-only success flows. League detail no longer ships a fake compose box or fake recent-activity placeholder either: the feed tab now uses the shared real `FeedContainer`, the overview points users to the live league feed instead of pretending posts are unavailable, and the history tab now shows a compact finished-contests summary from the live league results contract rather than a fake season accordion. The authenticated web nav also now hides the deferred billing area, and entitlement fallback prompts no longer funnel users into non-MVP upgrade flows. Remaining settings work is now mostly browser/smoke hardening across those trust-sensitive flows |
| WAH-004 | Client Layer | Remove or quarantine legacy handwritten clients in [clients/web/src/lib/api-client.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/lib/api-client.ts) and [clients/admin/src/lib/api-client.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/admin/src/lib/api-client.ts) | Done | The legacy handwritten client wrappers were deleted from both apps, the generated client is now the default path for contest creation, dashboard contest aggregation, invite/member flows, draft room, standings/results/scoring, and both app-level `lib/api.ts` wrappers, and the only remaining custom app-side helper is a narrow temporary workaround for a generated SDK omission on `GET /api/v1/account/delete-account` |
| WAH-005 | Client Layer | Remove tests that still mock the old manual client layer and migrate them to MSW/generated-client flows where request wiring matters | In Progress | Dashboard hook coverage no longer relies on the fake `/api/v1/activity` or `/api/v1/drafts` endpoints. Active contests and upcoming drafts now aggregate real league/contest routes, recent activity now aggregates real league feed posts through generated-client calls, and the stale login/register/dashboard tests that used the old manual client path were moved onto the generated-client setup. Continue cleaning any remaining legacy-client assumptions in lower-priority tests |
| WAH-006 | DTO Alignment | Eliminate remaining local API-facing extensions/casts like [use-profile.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/settings/hooks/use-profile.ts) where the backend contract should own the shape | Partial | Removed the local cast in [use-migrations-api.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/admin/src/hooks/use-migrations-api.ts) by validating against shared DTO schemas, replaced the fake standings hook shape with shared standings DTO parsing plus new shared scoring DTOs for real score timeline responses, and added real shared DTO-backed compliance/social contracts for consent history, data-export status, conversations, direct messages, contest chat, share cards, and league recaps. The admin cleanup lane also now uses real announcement/template DTO mappings and backend mutations instead of casted shapes or no-op UI behavior; broader cleanup still remains in other hooks and any remaining manual client assumptions |
| WAH-007 | Smoke Tests | Replace the old permissive/seed-dependent smoke layer with MVP-safe deployed black-box flows | In Progress | Legacy API smoke suites were deleted and replaced with [mvp-baseline.smoke.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/api/functional/mvp-baseline.smoke.ts) and [contest-lifecycle.smoke.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/api/functional/contest-lifecycle.smoke.ts). Remaining work is live QA hardening plus a truthful standings/results smoke once the product exposes a self-owned deployed path |
| WAH-008 | Browser Tests | Keep the required deploy-gate browser suite minimal and stable; defer richer browser journeys to a later non-blocking rebuild | In Progress | The required Playwright lane is now intentionally small and limited to stable public/auth sanity checks in [mvp-browser.smoke.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/e2e/mvp-browser.smoke.ts). Higher-value invite/contest/participant browser journeys are deferred to [browser-e2e-high-value.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/testing/browser-e2e-high-value.md) until the codebase and QA data setup are steadier |
| WAH-009 | Admin UX | Remove fake admin migration UI actions and align the pages with the real backend run state | Done | Removed the fake cancel alert, fixed the broken `runId` route param handling, removed the no-op “Run Migration” button, and updated the pages to render real queued/cancelled run state from the backend |
| WAH-010 | Billing UX | Remove the local invoice contract cast in [use-billing.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/billing/hooks/use-billing.ts) and align the invoice page with the real billing response shape | Done | Replaced the `Invoice[]` cast with DTO parsing and explicit mapping from `{ items, total }`; the invoice page now reads the real response shape instead of relying on a broken local assumption. Billing product persistence and paid-plan enablement remain tracked in plan 07 |
