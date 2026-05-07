# Frontend defect trends

A categorical summary of defects observed in the PoolMaster web app (`clients/poolmaster/`) during the 2026-05-02 cross-stack code review (epic `pool-master-rop`) and the follow-on rule-hardening work, with the root cause for each pattern and the rules / gates that have been or will be introduced to prevent recurrence.

This document is a snapshot for review. The authoritative tracker is Beads (`pool-master-rop.*` defect IDs, `pool-master-rop.71` testing-coverage epic, `pool-master-q8h` rule-hardening epic, `pool-master-7wj` codebase backsweep epic).

---

## Defect categories

Six recurring patterns account for nearly every frontend defect logged so far. Each section names the pattern, lists the specific defects, identifies the root cause, and maps to the rule / gate response.

### 1. SDK bypass — frontend reinvents what the generator already exports

**Pattern.** Frontend code defines its own types, fetch wrappers, or response shapes instead of consuming the generated SDK from `@poolmaster/shared`.

**Defects:**

- `pool-master-rop.65` (closed, PR #9) — `auth-home-page.tsx` hand-defined `PostAuthUser = { isRootAdmin?: boolean | null }` instead of `Pick<GetCurrentUserResponses[200]['user'], 'isRootAdmin'>`. Compile-time drift hidden because the local type was structurally compatible.
- `pool-master-rop.4` (open, P0) — 30+ frontend tests use `vi.mock('@/lib/api', ...)` with hand-rolled `vi.fn()` factories returning hand-shaped fixture payloads. Real request construction, auth-retry, CSRF injection, and trace-id headers never run. MSW is nowhere in the test tree. Tracked under epic `pool-master-rop.71` (test traceability).
- `pool-master-rop.16` (open, P1) — `mock-contest-feed-provider` exports its own SDK with hand-rolled interfaces that no consumer actually uses; the canonical generated SDK is the only one that's wired up. Dead parallel surface.
- `pool-master-rop.23` (open, P1) — Hand-shaped test fixtures duplicate generated DTO shapes; silent contract drift when the generated type changes and the fixture doesn't.

**Root cause.** Two reinforcing factors:

1. **The generator pattern hadn't been codified as a rule with detection.** `react-ui-rules.md §3` already names the issue ("local interfaces duplicating generated response types") but had no automated scanner — it was prose-only enforcement, which agents and humans both ignored under deadline pressure.
2. **Test-writing default was "mock the SDK."** When the canonical fast path is to run `vi.mock('@/lib/api')` instead of standing up MSW, the dependency on the SDK's wiring (interceptors, headers, retry) silently disappears from test coverage. New tests follow the existing pattern; the pattern is broken.

**Rules / gates response:**

- **Existing rule:** `react-ui-rules.md §3` — bans local interfaces duplicating generated response types.
- **Existing rule:** `react-ui-rules.md §7` — bans `vi.mock('@/lib/api')` and equivalents.
- **Existing gate:** `scripts/check-no-mocked-api.mjs` — currently warn-only baseline (CI gate `rules:check:no-mocked-api`). Detects the `vi.mock('@/lib/api')` pattern; baseline freeze prevents new instances while the existing 30+ are remediated under epic `pool-master-rop.71`.
- **Planned rule (`pool-master-q8h.3`):** `react-ui-rules.md §X SDK + types only` — explicit codification with no escape hatches: frontend consumes only `@<projectName>/shared` exports, no hand-rolled fetch / axios / parallel DTOs / own response types / own bindings.
- **Planned gate (`pool-master-q8h.20`):** `scripts/check-no-parallel-api-types.mjs` — flag any `type` or `interface` declaration in `clients/` whose name overlaps with a generated SDK type.
- **Planned gate (`pool-master-q8h.21`):** `scripts/check-no-non-sdk-fetch.mjs` — flag any `fetch(`, `axios.`, `XMLHttpRequest` outside the generated SDK wrapper.
- **Planned reviewer (`pool-master-q8h.10–13`):** **Felix** (frontend-discipline reviewer) — Pass 5 in the multi-pass review flow, always-on for any PR touching `clients/`. SDK / TYPES are explicit finding categories.

---

### 2. Code duplication — same logic implemented in multiple places

**Pattern.** A utility, helper, component, or markup pattern appears in 3+ places, drifting between them. The shared version exists but isn't used; or no shared version exists and the implementations diverge over time.

**Defects:**

- `pool-master-rop.19` (closed, PR #13) — Twelve copies of `extractErrorMessage` despite a shared `lib/errors.ts` with `codeMessages` support. Local copies had drifting fallback strings ("We could not create your league" vs "We could not complete that league action" vs "Something went wrong") and missing `codeMessages` support. Source: `lib/errors.ts:27` already documented this cleanup as `pool-master-dxd.17` in its header comment, but most pages still shipped local copies.
- `pool-master-rop.63` (closed, PR #12) — `WelcomePage` empty / error / loading branches re-implement Tailwind shells instead of using shared `EmptyState` / `ErrorState` / `LoadingState` from `features/shared/ui/state.tsx`.
- `pool-master-rop.62` (in progress, Codex) — `DefinitionList` / `MetricGrid` items use index-as-key. Same fragility pattern repeated across multiple list-rendering call sites.

**Root cause.** Two factors:

1. **No "rule of two" threshold.** Frontend rules don't say "if the same pattern appears twice, extract." Without a documented threshold, the second occurrence looks reasonable; by the third, the pattern is established and extraction feels like make-work.
2. **No scanner watching for the duplication.** Hand-rolled helpers don't advertise their existence to a reviewer scanning a single PR. A scanner enforces the rule globally even when no individual PR reviewer notices it.

**Rules / gates response:**

- **Existing gate:** `scripts/check-no-duplicate-extract-error-message.mjs` — narrow scanner for the `extractErrorMessage` case specifically. Hard-fail in `rules:check`. Born from rop.19; established the pattern of "one scanner per identified duplicate utility."
- **Existing gate:** `scripts/check-shared-ui-controls.mjs` — flags bare `<button>` / `<input>` / `<textarea>` outside `features/shared/ui/`. Forces use of shared UI primitives.
- **Planned rule (`pool-master-q8h.4`):** `react-ui-rules.md §X Component Reuse Threshold` — second time the same markup appears, extract to a component (rule of two). No duplicated page-level layouts.
- **Planned reviewer (Felix, q8h.10):** REUSE finding category — flag duplicated markup / CSS as a Pass 5 finding.

---

### 3. State-management drift — server data mirrored into client state

**Pattern.** Data that came from the API is stored in two places: React Query cache (where the server response naturally lands) AND a Zustand store / local component state. The two diverge over time; refetches overwrite drafts; updates land in one source of truth and miss the other.

**Defects:**

- `pool-master-rop.20` (closed, PR #7) — `useEffect` mirrors server query data into form state on every render. Background refetch overwrites the user's in-progress edits.
- `pool-master-rop.18` / `pool-master-rop.78.11` — Zustand session-store duplicated the TanStack Query `me`-cache. The cleanup slice removes that duplicate and keeps current-user server state in React Query only.

**Root cause.** Frontend rules did not draw a hard line between "server state" (React Query owns) and "client state" (Zustand owns for ephemeral UI; nothing owns server data twice). Without that line, agents reach for `useState` + `useEffect` to "make a copy I can edit" and ship draft-overwrite hazards.

**Rules / gates response:**

- **Existing gate:** `scripts/check-form-query-mirror.mjs` — narrowly catches the rop.20 pattern (useEffect writes from query-like dependencies); currently warn-only baseline.
- **Rule added:** `react-ui-rules.md §5 State Structure Rules` — React Query owns server state; Zustand owns ephemeral UI state ONLY. Server data does not mirror into Zustand or another client store.
- **Planned rule (`pool-master-q8h.2`):** `react-ui-rules.md §X Query Keys + Invalidation` — per-feature `query-keys.ts` factory; mutation invalidation discipline. Stale cache after mutation = CRITICAL.
- **Planned reviewer (Felix, q8h.10):** STATE finding category covers server-data-in-Zustand, fetch loops, missing query invalidation.

---

### 4. Fragility — environment-dependent code with no fallback

**Pattern.** Frontend code calls a browser API or environment-specific function without checking that it's available. Works in modern browsers; throws in non-secure contexts, older WebViews, or test environments.

**Defects:**

- `pool-master-rop.64` (closed, PR #11) — `lib/api.ts` calls `crypto.randomUUID()` directly for `X-Client-Request-Id` header. Throws in non-HTTPS contexts and some test environments without a Web Crypto polyfill. No fallback path. Network call from an insecure context would 500 the entire session.

**Root cause.** The "modern browser only" assumption is invisible until it isn't. No rule prohibits direct calls to environment-dependent APIs; no scanner flags them. Type-checker is silent because the API exists in TypeScript's lib.dom.d.ts at compile time.

**Rules / gates response:**

- **Codified pattern from rop.64:** wrap environment-dependent APIs in feature-detect helpers (`createClientRequestId()` checks `typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'` before falling back). Documented in code comments at `lib/api.ts:39–45` with `// Correlation-only fallback for environments without Web Crypto; not a security identifier.`
- **No scanner today.** This is currently a "review with eyes" pattern. If more instances surface, a follow-up gate would scan for `crypto.`, `navigator.`, `window.`, and other environment APIs in `clients/` outside designated feature-detect helpers.
- **Planned rule (`pool-master-q8h.9`):** `react-ui-rules.md §X Environment Access` — `import.meta.env` accessed only through a `config` module; date/time arithmetic only through a shared timezone-aware utility. Same shape extends to other environment APIs.

---

### 5. Test discipline — tests that don't actually verify behavior

**Pattern.** Tests pass but provide no real signal. They assert on display copy ("the page renders 'Hello'"), they cover only happy paths, they reference no requirement / use case / defect ID, or they mock away the surface they were meant to test.

**Defects:**

- `pool-master-rop.21` (open, P1) — `app.test.tsx` and other frontend tests assert only display copy — no behavior, no UC ID. Pass / fail tells you nothing about whether the feature works.
- `pool-master-rop.22` (open, P1) — Page-level frontend tests cover only happy paths. No test asserts what the page renders when a query errors, when a mutation rejects, when the user lacks permission, or when an optimistic update needs to roll back.
- `pool-master-rop.4` (open, P0) — `vi.mock('@/lib/api')` in 30+ tests removes the SDK's wiring from coverage (also covered under §1 SDK bypass — different lens, same files).
- `pool-master-rop.10` (open, P1, backend) — Same UC/BR/defect-ID gap, but on the backend test side. Listed here for symmetry; backend rule is the same as frontend.
- `pool-master-rop.23` (open, P1) — Hand-shaped test fixtures duplicate generated DTO shapes (also covered under §1; the test angle is "fixtures drift independently of the contract").

**Root cause.** Three reinforcing factors:

1. **Test traceability rule existed in `testing-rules.md §1A` but had no scanner.** Without enforcement, tests landed without UC / BR / defect-ID references. Reading 50+ tests later doesn't reveal what behavior is supposed to be guaranteed.
2. **Negative-path testing wasn't in the slice-completion checklist.** Slice authors verified the happy path locally and called it done; the checklist didn't ask "is the error state covered?"
3. **Module-level SDK mock was the path of least resistance.** Setting up MSW for a single test takes more thinking than `vi.mock('@/lib/api', ...)`. The first test in a module establishes the pattern; subsequent tests follow.

**Rules / gates response:**

- **Existing gate:** `scripts/check-test-traceability.mjs` — flags tests without UC / BR / defect-ID references. Currently warn-only baseline (~772 findings as of PR #12 closeout — the rule-enforcement epic baseline freezes this number, so new tests must reference IDs).
- **Existing gate:** `scripts/check-test-disable-discipline.mjs` — hard-fail (no warn-only) on `it.skip` / `xit` / `it.todo` / `describe.skip` without a `SKIP: pool-master-NNN` marker and a tracking story.
- **Existing gate:** `scripts/check-no-mocked-api.mjs` — see §1 SDK bypass.
- **Existing rule:** `testing-rules.md §1A` (test self-documentation), `§1B` (forbidden application-code patterns), `§1C` (test-disable discipline), `§3` (defect verification protocol — failing-test-before-fix).
- **Existing rule extension:** Slice Completion Checklist in `workflow-rules.md §1` enumerates loading / error / empty / success state coverage as required for user-facing slices.
- **Planned epic (`pool-master-rop.71`):** Test traceability & coverage gaps — the cleanup epic that picks up rop.4 (MSW migration), rop.10 (backend test annotation), rop.21 / rop.22 / rop.23 (frontend test depth + fixture cleanup).

---

### 6. Theming and component fragility

**Pattern.** Visual values (colors, spacing, fonts, border-radius, shadow) are hardcoded in component CSS or inline `style={{}}`. Re-themability is impossible without a global find-and-replace. Layout primitives are repeated rather than extracted.

**Defects:**

- *(none filed yet — this category is anticipated and tracked in the q8h epic, not surfaced as individual defects)*

**Root cause.** No rule constrains where theme values come from. Inline styles look like the simplest path; CSS-variable indirection feels like over-engineering for a page that "isn't going to be themed anyway."

**Rules / gates response:**

- **Existing gate:** `scripts/check-feature-theme-tokens.mjs` — runs as part of `npm run lint` (separate from `rules:check`). Already enforces a partial theme-token pattern.
- **Planned rule (`pool-master-q8h.5`):** `react-ui-rules.md §X CSS Variables and Theming` — all themable values come from CSS variables declared in a single theme file; no hardcoded design-system values; no inline `style={{}}` for theme values (reserved for genuinely dynamic values like animations or computed positions).
- **Planned gate (`pool-master-q8h.19`):** `scripts/check-no-inline-theme-styles.mjs` — flag `style={{ color/background/padding/margin/fontSize/fontFamily/border }}` in `clients/`; allow genuinely dynamic values via an allowlist comment.
- **Planned reviewer (Felix, q8h.10):** THEME finding category — flag inline theme styles, hardcoded design-system values.

---

## Cross-cutting causes

Three meta-patterns explain why the categories above repeat:

1. **Prose rules without scanners decay.** Every defect category had at least one rule already documented in `react-ui-rules.md` or `testing-rules.md` before the cross-stack review. The rules were correct; nothing flagged violations at PR time. The rule-enforcement hardening epic (`pool-master-1y8`) closed in 2026-05-03 added eight scanners turning the most-violated rules into hard CI gates. The q8h epic continues this by adding scanners for the remaining patterns.
2. **First instance establishes the pattern.** Frontend code grows by copy-edit-paste from existing files. When the first page in a feature uses `vi.mock('@/lib/api')` or hardcodes a color, every subsequent page picks the same path. A scanner running at PR time interrupts this propagation; a reviewer reading one PR cannot.
3. **Reviewer roles weren't specialized for frontend.** Riley is a generalist; Sage is security; Archie is architecture. Frontend-specific patterns (SDK adoption, theming, state mirroring, component reuse) had no dedicated reviewer lens, so they slipped through to merge. The q8h epic adds Felix (frontend discipline) and Perry (performance) as Pass 5 / Pass 6 reviewers in the multi-pass review flow.

---

## Roadmap

| Status | Item | Tracked by |
|---|---|---|
| Closed | rop.20 — useEffect form-state overwrite-on-refetch | PR #7 |
| Closed | rop.65 — hand-rolled `PostAuthUser` type | PR #9 |
| Closed | rop.19 — extractErrorMessage duplication (12+ copies) | PR #13 |
| Closed | rop.63 — shared welcome state components | PR #12 |
| Closed | rop.64 — `crypto.randomUUID` fallback | PR #11 |
| In progress | rop.62 — index-as-key in DefinitionList / MetricGrid | Codex (open branch) |
| Open / queued | rop.4 — vi.mock SDK in 30+ tests; MSW migration | Epic `pool-master-rop.71` |
| In progress | rop.78.11 / rop.18 — Zustand session-store / TanStack Query duplication | Phase 4 substrate cleanup |
| Open / queued | rop.21 / rop.22 / rop.23 — frontend test depth + fixture cleanup | Epic `pool-master-rop.71` |
| Planned | §A1–A9 react-ui-rules additions (state mgmt, query keys, SDK only, component reuse, CSS variables, form state, state communication, logging, env access) | Epic `pool-master-q8h` §A (9 stories) |
| Planned | Felix — frontend-discipline reviewer (Pass 5) + wrappers | Epic `pool-master-q8h` §B (4 stories) |
| Planned | Perry — performance reviewer (Pass 6) + wrappers | Epic `pool-master-q8h` §C (4 stories) |
| Planned | Fran self-check checklist update | Epic `pool-master-q8h` §D (1 story) |
| Planned | Optional automation scanners — inline styles, parallel API types, non-SDK fetch | Epic `pool-master-q8h` §E (3 stories) |
| Planned | Backsweep — remediate existing violations of the new §A rules across `clients/poolmaster/` | Epic `pool-master-7wj` (9 sweep stories) |

Companion plan: [`plans/116-frontend-rule-hardening.md`](../plans/116-frontend-rule-hardening.md).

---

## What this document is not

- It is **not** a prioritization plan. Severity / order belongs in the Beads stories themselves.
- It is **not** an enforcement rule. Rules live under [`rules/`](../rules/); gates live under [`scripts/`](../scripts/).
- It is **not** a complete inventory. New defect classes will surface; this is a snapshot for review and discussion.

For the canonical state of any item listed here, run `bd show <id>` against the Beads tracker.
