## Objective

Build a new web application from scratch at `clients/poolmaster` using the same core technology stack, component library, styling direction, and branding as the legacy web app, but aligned to the new backend domain model and generated SDK contracts.

This app becomes the single go-forward web frontend for PoolMaster.

## Dependencies

- Can start independently.
- Benefits from [plans/65-error-envelope-and-route-contract-cleanup.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/65-error-envelope-and-route-contract-cleanup.md), but is not blocked by it.
- Will become the primary dependency for [plans/70-admin-webapp-removal.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/70-admin-webapp-removal.md) and [plans/71-legacy-webapp-archive-and-cutover.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/71-legacy-webapp-archive-and-cutover.md).

## Direction

- Create `clients/poolmaster` as the only active long-term web app.
- Use the same React/Vite/TypeScript/shadcn/Radix/Tailwind stack.
- Keep branding and overall product identity consistent with the legacy web app.
- Use only exported generated SDK operations and exported TypeScript types as the API contract source of truth.
- Build role-based behavior inside one app for members, commissioners, and root admins.
- Do not spend implementation effort modernizing `clients/web` or `clients/admin` in parallel.
- Build any future root-admin UI from scratch inside `clients/poolmaster`; do not use the old admin app as a migration baseline.

## Clarifications

- Preserve the same branding and product identity by reusing the legacy web app’s theme direction where it still fits:
  - Tailwind theme/config
  - color palette
  - typography choices
  - shared visual language and branding assets
- The new app should still use an app-local SDK re-export pattern such as `src/lib/api.ts` for configured client access, auth token wiring, and thin convenience helpers.
- “Frontend-layer functional tests” here means rendered frontend tests that exercise components, routing, forms, query state, and generated-client request wiring through the frontend layer. These are not the same thing as the backend SDK functional API suite from Plans 64/66.
- Add an explicit early design decision for how the single app handles:
  - member and commissioner flows through the normal app-auth model
  - root-admin flows with the current admin-auth model
  - role-aware navigation and session handling inside one app shell
- Inventory `clients/shared` early and decide whether it remains a useful shared frontend package or should be absorbed/simplified as the app landscape reduces to one active webapp.

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| In Progress | Define the initial route map from active use-case plans | Initial route-map skeleton added for member, commissioner, and root-admin surfaces; detailed use-case pages still to be built |
| In Progress | Decide the single-app auth/session model for member, commissioner, and root-admin flows | Member/commissioner session scaffolding now uses generated SDK auth inside `clients/poolmaster`; root-admin remains a reserved mode to formalize once replacement admin pages are built |
| Pending | Inventory and decide the future of `clients/shared` | Keep, simplify, or absorb as the frontend landscape reduces to one active webapp |
| In Progress | Scaffold `clients/poolmaster` shell and base stack (69-A) | React, Vite, TypeScript, Tailwind, React Router, TanStack Query, generated SDK re-export, and initial app shell scaffolded; shadcn/component primitives still to be added |
| In Progress | Build auth/session, configured SDK client, query provider, and router shell (69-B) | Session store, auth provider, explicit generated-SDK token wiring, and protected member routing are now scaffolded |
| In Progress | Build layout primitives and role-aware navigation (69-C) | App shell now hides protected routes while signed out and reflects current session state; commissioner/root-admin navigation remains placeholder-only for now |
| In Progress | Build the first product flow slice (69-D) | Auth entry flow, generated-SDK-backed member league list, league detail, invitation acceptance, commissioner invite send/generation, and first contest list/detail routes are now in place; standings, entry creation, and history reads are the next high-value seams |
| Pending | Wire the new app into local build/test commands | Include dev, build, lint, unit test, coverage, and future frontend functional test commands |
| Pending | Wire the new app into CI | Replace legacy web/admin frontend gates with PoolMaster app gates as the app becomes active |
| Pending | Build the first core product flows | auth, league list/detail, invitation acceptance, contest list/detail, entry creation, standings/history reads |
| Pending | Add PoolMaster-specific frontend tests | unit + frontend-layer functional tests aligned with the new rules |
| Pending | Update docs/rules/README references | Make PoolMaster the single active web app in repo guidance |

## Validation

- `npx turbo typecheck --force`
- `npx eslint 'clients/poolmaster/src/**/*.{ts,tsx}' --max-warnings 0`
- app-local unit and coverage commands once introduced
- frontend-layer functional test command once introduced
- CI passes with PoolMaster app wired into the frontend gates
