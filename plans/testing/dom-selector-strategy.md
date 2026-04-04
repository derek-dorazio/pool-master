# DOM Selector Strategy

> **Planning Note (2026-04-04):** Re-analyze the active smoke/E2E and UI test suites before broad selector churn. Prioritize high-value, automation-critical surfaces first.

## Purpose

Standardize stable DOM selectors for UI automation so tests and agents do not depend on changing visible copy, translated strings, or marketing headings to find elements.

## Problem

Several recent browser failures came from tests selecting DOM nodes by user-facing copy such as:

- landing-page hero headings
- CTA labels
- registration button text
- navigation link text

Those strings are product copy, not stable automation contracts. They change for branding, localization, UX iteration, and content refinement.

## Strategy

### 1. Stable Selector Contract

Automation-critical UI elements must expose stable selectors:

- `data-testid` for buttons, links, cards, sections, tabs, banners, dialogs, and repeated workflow surfaces
- semantic `id` for form fields and direct inputs
- these selectors should be added when new UI is created, not bolted on after tests fail

### 2. Preferred Selector Order

For browser automation and workflow-oriented UI tests:

1. `data-testid`
2. stable field `id`
3. other stable structural selectors only if the first two are not reasonable
4. visible text only when intentionally validating copy

Random GUID/UUID DOM identifiers are explicitly not the strategy. Automation needs deterministic selectors that remain stable across renders, environments, and runs.

### 3. Naming Convention

- lowercase kebab-case
- domain-first naming
- based on product meaning, not current button label

Examples:

- `landing-hero-heading`
- `landing-primary-cta`
- `auth-register-email`
- `auth-register-submit`
- `league-create-submit`
- `league-members-invite-button`
- `contest-create-submit`
- `contest-detail-summary-card`
- `draft-room-available-panel`

### 4. Scope Priorities

Start with:

1. deploy-gate browser smoke
2. smoke-adjacent public auth pages
3. core MVP create/join/contest/draft surfaces
4. repeated RTL workflow tests

Do not churn the entire UI at once.

## Implementation Phases

### Phase 1: Required CI Flows

- add stable selectors to all currently deployed browser smoke pages
- update Playwright to use them exclusively where practical

### Phase 2: Core MVP Paths

- registration/login
- league creation and membership
- contest creation
- contest entry
- draft/selection room
- standings/results/detail

### Phase 3: RTL Cleanup

- replace brittle `getByText()` navigation/control selectors in automation-heavy component/page tests
- keep copy assertions only where the copy itself matters

## Rules

- Do not add selectors only in tests; add them in production UI where the automation contract belongs.
- Do not use selector names that depend on localization text.
- Do not use unstable positional selectors like `.nth(0)` when a stable selector can be added.
- Do not generate runtime-random GUIDs/UUIDs for DOM selection.
- Keep selectors additive and low-risk; do not redesign components just to add test IDs.

## Acceptance Criteria

- Browser smoke/E2E no longer depends on visible marketing or CTA copy for core navigation
- Core MVP workflow surfaces expose stable selectors
- RTL tests use copy assertions intentionally rather than by default
- Selector naming is consistent enough for future agents to extend without guessing
