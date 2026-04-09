# PoolMaster — Webapp Functional Rules

These rules define the product and functional expectations for the single go-forward PoolMaster web application.

This file is intentionally separate from the React technology rules. It describes **what the app is**, **which app is active**, and **how role-based behavior should work**.

For React/Vite/TypeScript implementation rules, see [react-ui-rules.md](react-ui-rules.md).

---

## 1. Single-Webapp Direction

PoolMaster will have one active web application:

- `clients/poolmaster`

There should not be two parallel long-lived web frontends for the same product scope.

Implications:

- Do not split member, commissioner, and root-admin behavior into separate React apps.
- Do not modernize `clients/admin` as a separate long-term application.
- Do not keep `clients/web` as an active implementation target once the new PoolMaster app work begins.

---

## 2. Role-Based Product Model

The PoolMaster web app is role-based.

The same app may expose different pages, actions, and navigation depending on the signed-in user’s role and context.

### Member

Members may access member-facing functionality such as:

- authentication and account flows
- league membership and invitation acceptance
- squad management where allowed
- contest browsing
- entry creation and entry management
- draft/selection flows
- standings, scoring, and history reads
- notification and consent/account essentials

### Commissioner

Commissioners may access both member-facing functionality and league-owned management functionality such as:

- league settings and invitation controls
- squad/member administration where the use cases allow it
- contest creation and contest configuration
- scoring-rule, aggregation-rule, and prize-rule configuration
- contest monitoring and recalculation actions

### Root Admin

Root admins may access platform-level functionality inside the same app, limited to the root-admin surfaces that remain active in the backend.

Do not assume commissioner pages and root-admin pages are interchangeable. They are different scopes within the same app.

---

## 3. Source Of Functional Truth

The active source of truth for PoolMaster web behavior is:

- active use-case plans in `plans/`
- active rules in `rules/`
- active backend contracts exported through the generated SDK/types

Do not use old frontend code as the main definition of behavior if it conflicts with:

- the backend refactor decisions
- current use-case documents
- current generated contracts

---

## 4. Archived-App Policy

### `clients/web`

The old web app may be retained only as archived/reference material during the transition.

Allowed uses:

- planning/reference for potential page layouts
- feature discovery
- component and interaction ideas

Not allowed:

- treating it as the active delivery target
- keeping it in sync with new implementation plans
- patching it just to satisfy builds, tests, or CI after the new app becomes active

### `clients/admin`

The separate admin app is not part of the long-term product direction and should be removed rather than rebuilt as a second frontend.

---

## 5. Contract And Type Discipline

The PoolMaster web app must stay tightly aligned with exported backend contracts.

### Required

- use the exported generated `hey-api` client
- use exported generated/request/response/domain types first
- derive view-model data only when there is a clear UI need
- keep derived shapes narrow and local to the UI concern

### Not Allowed

- alternative local copies of backend DTOs
- hand-maintained parallel API object models
- fake/mocked runtime API responses in application code
- app-local contract drift because the generated types are inconvenient

If the backend contract is wrong, fix the backend contract and regenerate.

---

## 6. Frontend Testing Strategy

The PoolMaster web app should not repeat the backend drift problems by relying on disconnected test layers.

The expected strategy is:

1. **Unit tests**
- pure UI logic
- hooks/selectors with local logic
- isolated component behavior where appropriate

2. **Frontend-layer functional tests**
- rendered app flows through routing, forms, queries, and generated-client boundaries
- important CRUD and user-journey coverage at the UI layer
- strong coverage of real member/commissioner/root-admin flows

3. **Small browser E2E suite later**
- a small number of comprehensive post-deploy journeys
- rebuilt from scratch once the new PoolMaster app is implemented

Do not lean on browser E2E as the only meaningful frontend confidence layer.

---

## 7. Required Product Alignment Rules

- The active app must reflect the current backend domain model and exported contracts.
- When backend plans change functional behavior, update PoolMaster web plans and rules in the same overall effort.
- New pages and workflows should map back to documented use cases rather than being invented from old frontend assumptions.
- If a needed frontend behavior is not documented clearly enough, document it before building around guesses.

---

## 8. Review Checklist For Product-Scope Web Work

Before treating PoolMaster web work as ready, verify:

1. Is the work in `clients/poolmaster`, not a legacy app?
2. Does it reflect the active backend contract rather than an older frontend assumption?
3. Is the feature scoped correctly by member, commissioner, or root-admin access?
4. Are loading, empty, and error states honest rather than hidden by fake data?
5. Are tests covering both local component logic and important frontend-layer flows?
