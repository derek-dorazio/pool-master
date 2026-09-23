---
name: add-frontend-feature
description: Building a feature in clients/poolmaster — generated SDK usage, query-key factories, mutation cache behavior, state ownership, forms, theme tokens, and selectors. Use for any React work in the PoolMaster web app.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Write, Bash]
---

# Building a frontend feature

The contract is the **generated hey-api SDK and its exported types**, imported through
`@/lib/api`. Not the backend source. If the SDK does not describe what you need, the gap is
in the contract documentation and belongs in a backend change — not in a locally invented
shape.

Detail lives in `rules/react-ui-rules.md` (§3 API integration, §4 TanStack Query, §5 state /
effect / form), `rules/ux-rules.md`, and `rules/poolmaster-webapp-rules.md`. This file is the
order of operations and the traps.

## Before you start

If the feature needs a contract change that does not exist yet, **the exported SDK has to
land first.** Building against an intended-but-unexported contract means rewriting when it
arrives, and it hides whether the contract is actually right.

## Self-check before review

Walk the changed surface against these. Each maps to a section of `react-ui-rules.md`, and
several are scanner-enforced, so a miss fails CI rather than review.

- **State ownership** — TanStack Query owns server state; local state owns local UI state;
  React Hook Form owns non-trivial form drafts. Redux is not introduced.
- **SDK and types** — generated operations and types through `@/lib/api`. No handwritten
  fetch wrappers, no parallel DTOs, no shapes derived by reading backend source.
- **Query keys and mutations** — keys come from the query-key factory. Every mutation
  explicitly invalidates, updates cache, or navigates away. "The next render will refetch"
  is not one of those three.
- **Component reuse** — repeated markup and helpers get extracted or routed to shared UI
  primitives. No bare `<button>`/`<input>`/`<textarea>` where a shared primitive exists.
- **Theme discipline** — semantic theme tokens and CSS variables. No inline theme styles,
  no raw color literals.
- **Forms** — more than two fields, or conditional validation, means React Hook Form
  submitting through a React Query mutation.
- **State communication** — loading, error, empty, pending and success states are visible
  and honest. An endpoint that is missing or broken surfaces as an error state; it is never
  papered over with fallback data.
- **Logging, env, time** — shared logger, config and time utilities. Not `console.log`, not
  direct `import.meta.env`, not ad hoc date arithmetic.
- **Tests and selectors** — request wiring tested with MSW against generated contract
  shapes; automation-critical controls expose stable selectors per `react-ui-rules.md` §9.

## Two traps worth naming

- **Server data into form state.** Initialize form drafts from server data once per entity
  identity, not on every query-result object change. Memo deps keyed on narrow fields
  (`data?.id`, `data?.name`) rather than the whole `data` object are deliberate — see
  `react-ui-rules.md` §5 *Server Data Form-State Hazard*, and #157, where a lint rule
  demands the opposite and is wrong.
- **Error handling.** Throw through the shared `ApiError` / `throwApiError` helper in
  `clients/poolmaster/src/lib/errors.ts`, and read messages back through
  `extractErrorMessage`. Do not fork a local copy of that helper —
  `check-no-duplicate-extract-error-message` exists because it has happened.

## UX defaults

Make ordinary layout, hierarchy and state-communication decisions yourself rather than
escalating them. Bias toward consumer-product conventions over enterprise-admin patterns
unless the reviewed plan says otherwise. Escalate product *questions* — what the feature
should do — not conventional UX details.
