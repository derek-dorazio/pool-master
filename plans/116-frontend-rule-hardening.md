# Plan 116: Frontend rule hardening + new reviewer personas

## Summary

Address the dominant frontend pain pattern in PoolMaster: Fran reinvents
wheels (own types, own fetch wrappers, duplicated markup/CSS, ad-hoc
state management) because the rules don't enforce the desired patterns.
Layer two new reviewer personas on top so violations surface at PR time
even when Fran's self-check misses them.

## Why this exists

Diagnostic pattern from the existing PoolMaster web app:

- Generated SDK and types are exported from `@<projectName>/shared`, but
  Fran has been writing parallel hand-rolled types and bypassing the SDK
  with direct fetch calls in places.
- The same HTML structure and CSS appears in dozens of pages instead of
  being extracted into reusable React components.
- Hardcoded colors, spacing, and font sizes appear in component styles
  instead of CSS variables, making themability impossible.
- State management is a mix of React Query, Zustand, and inline `useState`
  fetch loops with no rule saying which goes where. Forms vary between
  `useState`, react-hook-form, and Zustand drafts.
- Riley is a generalist; security gets Sage; architecture gets Archie.
  Frontend has no dedicated reviewer lens, so frontend-specific
  violations slip through every pass.
- Performance reviews (N+1 queries, missing indexes, full table scans,
  blocking I/O on the request path, bundle-size regressions) are
  also an unfilled lens.

## Companion epic

Beads epic: see this plan's parent. Categories below map 1:1 to story
groups under the epic.

## Categories

### §A. Fran rule additions (`rules/react-ui-rules.md`)

Add new rule sections that codify the desired patterns. Each section is
one rule edit, independently reviewable:

- **A1. State-management discipline** — React Query owns server state;
  Zustand owns ephemeral UI state; no `useState`/`useEffect` fetch loops;
  no Redux. Server data does not get mirrored into Zustand.
- **A2. Query keys + mutation invalidation** — per-feature
  `query-keys.ts` factory; mutations list every invalidated key; no
  inline literal queryKey arrays after this lands.
- **A3. SDK + types only** — frontend consumes only
  `@<projectName>/shared` exports; no hand-rolled fetch/axios/parallel
  DTOs/own response types/own bindings to API endpoints.
- **A4. Component reuse threshold** — second time the same markup
  appears, extract to a component (rule of two). No duplicated
  page-level layouts.
- **A5. CSS variables and theming** — all themable values (color,
  spacing, font, border-radius, shadow) come from CSS variables
  declared in one theme file. No hardcoded design-system values in
  component styles. No inline `style={{}}` for theme values; reserved
  for genuinely dynamic values (animations, computed positions).
- **A6. Form state** — `react-hook-form` for any form with > 2 fields;
  Zod schemas re-used from `@<projectName>/shared` where possible;
  submit handler calls a React Query mutation; success either
  invalidates the relevant query or calls `setQueryData`.
- **A7. State communication** — explicit loading/error/empty/success
  states in every data-rendering page per `ux-rules.md`. No
  spinners-by-default; no hidden empty states.
- **A8. Frontend logging discipline** — use the shared `logger`,
  never `console.log`. Logger context reads current-user state from the
  React Query auth cache.
- **A9. Environment + date/time** — `import.meta.env` accessed only
  through a `config` module; date/time arithmetic only through a
  shared timezone-aware utility.

### §B. Felix — frontend-discipline reviewer

- **B1. `personas/felix.md`** — playbook with findings categories
  (SDK, TYPES, REUSE, THEME, STATE, FORM, A11Y), severity calibration,
  trigger conditions, and review post template.
- **B2. Tool wrappers** — `.claude/agents/felix.md` thin pointer +
  `.codex/agents/felix.toml` thin pointer.
- **B3. Workflow integration** — add Felix Pass 5 (always-on for any PR
  touching `clients/`) to `rules/workflow-rules.md §6` review-pass
  table.
- **B4. Doc surfacing** — update `AGENTS.md` and `docs/PERSONA-FLOW.md`
  to list Felix and describe Pass 5.

### §C. Perry — performance reviewer

- **C1. `personas/perry.md`** — playbook with findings categories
  (NPLUSONE, INDEX, BLOCKING, PAYLOAD, BUNDLE, RENDER), severity
  calibration, trigger conditions.
- **C2. Tool wrappers** — `.claude/agents/perry.md` thin pointer +
  `.codex/agents/perry.toml` thin pointer.
- **C3. Workflow integration** — add Perry Pass 6 (conditional on PR
  touching Prisma queries, route handlers, list-rendering components,
  new dependencies, or hot-loop code) to `rules/workflow-rules.md §6`.
- **C4. Doc surfacing** — update `AGENTS.md` and `docs/PERSONA-FLOW.md`.

### §D. Fran self-check update

- **D1. `personas/fran.md`** — extend the implementer self-check
  (Pass 1 / pre-PR checklist) to include the new §A rules so violations
  are caught before opening the PR, not just at Pass 5.

### §E. Optional automation (defer if too heavy)

- **E1. Scanner: `style={{}}` with theme-coded values** — node script
  in `scripts/check-no-inline-theme-styles.mjs`, wired into
  `npm run rules:check` on `clients/`.
- **E2. Scanner: parallel API types** — flag any `type` or `interface`
  declaration in `clients/` whose name overlaps with a generated SDK
  type.
- **E3. Scanner: non-SDK fetch calls** — flag any `fetch(`, `axios.`,
  or `XMLHttpRequest` in `clients/` outside of the generated SDK
  wrapper.

## Order of operations

1. **§A first** — rule edits are foundation; they protect against
   backsliding even before reviewers run. A1 (state management)
   highest priority since it's the largest current gap.
2. **§D second** — once rules exist, update Fran's self-check so
   implementation-time discipline matches.
3. **§B third** — Felix is the highest-ROI reviewer (frontend is the
   leakiest surface).
4. **§C fourth** — Perry adds a complementary lens but is lower
   priority than frontend hygiene given the current pain pattern.
5. **§E last (optional)** — automation reduces reviewer burden but is
   not blocking. Consider after a few PR cycles to see which patterns
   reviewers are catching most often.

## Dependencies

Depends on: PR #10 multi-pass review flow merged (DONE — landed
2026-05-04). Felix and Perry slot into the same Pass-N pattern.

Unblocks: ability to confidently open frontend feature epics without
expecting Fran-style regression on the same anti-patterns.

## Deferred

- Bundle-size budget enforcement in CI (Perry recommends; not
  enforced this epic).
- Automated a11y scanning (axe-core) — possible future Felix
  sub-check.
- Internationalization rule additions — defer until i18n is a
  product requirement.
- Storybook / component-library extraction — possible follow-up
  epic once §A4 lands and reuse patterns surface.

## Acceptance

- All §A rule sections committed to `rules/react-ui-rules.md` and
  cross-referenced from `personas/fran.md`.
- `personas/felix.md` + wrappers exist; Felix is callable as a Claude
  subagent and Codex subagent.
- `personas/perry.md` + wrappers exist; Perry is callable as a Claude
  subagent and Codex subagent.
- `rules/workflow-rules.md §6` review-pass table includes Pass 5
  (Felix) and Pass 6 (Perry) with trigger conditions.
- `AGENTS.md` and `docs/PERSONA-FLOW.md` surface both new reviewers.
- When the epic closes, this plan is deleted per
  `rules/workflow-rules.md §0`; durable patterns live in `rules/`.

## Open questions

- Should Felix's "no inline theme styles" rule apply retroactively
  (sweep clients/poolmaster) or only to new code? Recommend
  forward-only with a tracked tech-debt epic for backsweep, otherwise
  this becomes a big-bang rewrite.
- Does Perry need access to the database to check actual query plans,
  or is static analysis (Prisma usage + index review) sufficient?
  Recommend static for v1; database-aware later.
