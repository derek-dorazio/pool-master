# PoolMaster — React UI Rules

These rules govern `clients/web` and `clients/admin`.

The web/admin apps are React 18 + TypeScript applications using:

- Vite
- React Router
- TanStack Query
- Zustand
- React Hook Form
- TailwindCSS
- shadcn/ui
- shared generated `hey-api` SDK from `packages/shared/generated/hey-api`

---

## 1. Core Frontend Standards

- Use functional React components.
- Keep components focused and composable.
- Prefer explicit loading, error, and empty states.
- Avoid `any`.
- Prefer shared types and generated types over local copies.
- Do not add comments unless they explain non-obvious behavior.

---

## 2. No Mock Data in Application Code

This is the top frontend rule.

Banned in hooks, pages, components, stores, and runtime utilities:

- `queryFn: async () => mockData`
- `initialData: mockData`
- `catch { return mockData }`
- local `MOCK_*` or sample arrays used as live app data
- conditional development-only fake API branches

Required behavior:

- Call the real API.
- Let errors propagate.
- Render loading, error, or empty states honestly.

If an endpoint is missing, that is a backend/contract problem to fix, not a reason to add fake frontend data.

---

## 3. API Integration Rules

### Primary Rule

Frontend application code must use the shared generated `hey-api` client from `@/lib/api`.

Examples:

- `import { client, listLeagues } from '@/lib/api'`
- `await listLeagues({ client })`

### Required Patterns

- Use generated SDK functions and generated response/request types first.
- Keep app-specific API code thin:
  - auth token injection
  - base URL configuration
  - very small app-local convenience helpers if truly needed
- If the generated contract is wrong, fix the backend DTO/route schema and regenerate. Do not invent local replacement contracts.

### Banned Patterns

- New manual `fetch()` wrappers for endpoints already covered by the generated client
- New handwritten OpenAPI client adapters when `@/lib/api` already provides the operation
- New local interfaces duplicating generated response types just because the generated contract is inconvenient
- `as any`, `as unknown as`, or manual shape rewriting to bypass generated types
- Continuing to use legacy manual-client helpers when generated SDK operations now exist

### Route Constants Clarification

- Use `API_ROUTES` in tests, smoke suites, and MSW handlers.
- Do not use route constants as the primary runtime path source in React app code if a generated SDK operation exists.

---

## 4. TanStack Query Rules

- Use TanStack Query for server state.
- Query functions should call real generated SDK functions.
- Query keys should be stable arrays.
- Handle invalidation intentionally after mutations.
- Components must handle:
  - loading
  - error
  - empty
  - success

Do not hide broken requests with local fallbacks.

---

## 5. Form and Component Rules

- Use React Hook Form for non-trivial forms.
- Keep validation clear and consistent with backend constraints.
- Prefer reusable page sections/components over giant page files.
- Keep UI state distinct from server state.
- Use Zustand for client-side state only when local component state or query state is insufficient.

---

## 6. Generated Client Rules

The shared generated client is part of the architecture, not an optional helper.

- Import generated SDK functions/types through the app-local API module (`@/lib/api`) unless there is a strong reason to import directly from `@poolmaster/shared/generated/hey-api`.
- Never edit generated files directly.
- After backend contract changes, expect generated method names/types to change and update callers accordingly.
- Remove legacy workarounds as the generated contract improves.

### What Agents Must Not Do

- Do not add a parallel manual API abstraction because “it is easier than fixing OpenAPI.”
- Do not keep obsolete `openapi-fetch` or similar legacy helpers alive for new code paths.
- Do not preserve dead compatibility code for removed endpoints or shapes.
- Do not add new pages/hooks that depend on stale contract assumptions.

---

## 7. Testing Rules for React Apps

- Use Vitest + React Testing Library.
- Use MSW for tests that should exercise request construction and network behavior.
- Keep pure presentation tests simple and hook-free where possible.
- Prefer behavior-oriented tests over implementation-detail tests.

### Banned Test Patterns

- `vi.mock('@/lib/api-client')` or equivalent module-level replacement of the runtime API client for new tests
- assertions that only check copied path strings
- low-value tests that lock in obsolete manual-client behavior

### Acceptable Cleanup

It is acceptable to remove or replace tests when they enforce old architecture, as long as the resulting coverage is higher-signal and aligned with current patterns.

---

## 8. Accessibility and UX

- Use semantic HTML.
- Preserve keyboard accessibility.
- Use accessible shadcn/Radix primitives correctly.
- Provide clear empty and error states.
- Avoid interaction dead-ends and no-op buttons.
- Do not ship UI actions that do nothing.

---

## 9. Stable Automation Selectors

UI surfaces that participate in automation must expose stable machine-oriented selectors. Do not make browser automation depend on changing copy, marketing text, or translated visible labels.

### Required Selector Strategy

- Interactive controls used by smoke/E2E or repeated UI automation must expose a stable selector:
  - prefer `data-testid` for buttons, links, panels, banners, tabs, and cards
  - keep semantic `id` attributes for form inputs and fields
- Page-level anchors should expose stable `data-testid` markers for the main hero, primary CTA, page title, form shell, and other high-value landmarks.
- Reusable features should use consistent selector prefixes by domain, for example:
  - `league-create-submit`
  - `contest-create-hero`
  - `auth-register-email`
  - `draft-room-available-panel`
- New web/admin UI code should add these stable selectors as part of implementation, not later as test-only cleanup.
- If a DOM element may need to be addressed from browser automation or app-side JavaScript, give it a stable selector when the component is created.

### Selector Naming Rules

- Use lowercase kebab-case.
- Prefer domain-oriented names over presentational names.
- Name by product meaning, not current copy text.
- Do not encode translation text in selector names.
- Do not generate random test IDs from props unless the entity itself has a stable identifier.
- Do not generate runtime-random GUIDs/UUIDs for DOM selectors. Tests and automation need stable deterministic selectors that do not change between renders.
- If JavaScript needs to target an element directly, use a stable semantic `id` or stable `data-testid`, not a random identifier.

### Testing Rules

- Browser smoke/E2E should prefer `getByTestId()` or stable input `id` selectors over visible-copy selectors.
- React Testing Library tests should also prefer stable selectors for automation-critical UI paths.
- Only assert visible text when the test is explicitly about copy, localization, accessibility wording, or user-facing content.
- Do not use headings, button text, or link text as the primary selector for automation-critical navigation if a stable machine selector can be provided.
- Treat stable selectors as part of the UI contract for both `clients/web` and `clients/admin`.

### Exceptions

It is acceptable to assert visible copy when:

- verifying the actual content shown to the user is correct
- verifying accessibility names intentionally
- verifying localized strings intentionally

But those tests should still avoid using copy text as the only way to find critical UI elements when a stable selector exists.

---

## 10. Review Checklist for Web/Admin Changes

Before finishing frontend work, verify:

1. Is the page/hook using the generated client rather than a new manual wrapper?
2. Are there any local API-shape interfaces that should be removed?
3. Are loading/error/empty states present?
4. Did the refactor remove stale no-op UI or mock fallbacks?
5. Do tests use MSW where request wiring matters?
6. Do automation-critical UI elements expose stable `data-testid` or `id` selectors?
