## Objective

Build a new web application from scratch at `clients/poolmaster` using the same core technology stack, component library, styling direction, and branding as the legacy web app, but aligned to the new backend domain model and generated SDK contracts.

This app becomes the single go-forward web frontend for PoolMaster.

## Dependencies

- Can start independently.
- Benefits from archived [plans/archive/2026-04-service-and-frontend-baseline/65-error-envelope-and-route-contract-cleanup.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/archive/2026-04-service-and-frontend-baseline/65-error-envelope-and-route-contract-cleanup.md), but is not blocked by it.
- Depends on the historical cleanup recorded in [plans/archive/2026-04-service-and-frontend-baseline/70-admin-webapp-removal.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/archive/2026-04-service-and-frontend-baseline/70-admin-webapp-removal.md) and [plans/archive/2026-04-service-and-frontend-baseline/71-legacy-webapp-archive-and-cutover.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/archive/2026-04-service-and-frontend-baseline/71-legacy-webapp-archive-and-cutover.md).

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
- Do not keep a separate `clients/shared` frontend package; frontend shared contract/types come from `packages/shared` and the generated SDK only.
- Treat [plans/76-league-home-and-league-context-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/76-league-home-and-league-context-user-cases.md) as the companion for the authenticated landing/home route, league selector, default-league routing, and invite-entry behavior.

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| In Progress | Define the initial route map from active use-case plans | Route implementation is now pivoting from the temporary `/leagues` landing to the reviewed `/welcome`, `/league/<leagueCode>`, and `/invite/<inviteCode>` model from Plan 76 |
| In Progress | Decide the single-app auth/session model for member, commissioner, and root-admin flows | Member/commissioner session scaffolding now uses generated SDK auth inside `clients/poolmaster`; alignment audit removed the earlier hardcoded root-admin false path and switched the app to the backend-owned `isRootAdmin` contract, while broader root-admin surface design still remains future work |
| Done | Remove `clients/shared` and standardize on `packages/shared` + generated SDK exports | `clients/shared` was unused placeholder scaffolding and has been removed; frontend contract sharing now comes only from `packages/shared` and the generated SDK |
| In Progress | Scaffold `clients/poolmaster` shell and base stack (69-A) | React, Vite, TypeScript, Tailwind, React Router, TanStack Query, generated SDK re-export, and initial app shell scaffolded; shadcn/component primitives still to be added |
| In Progress | Build auth/session, configured SDK client, query provider, and router shell (69-B) | Session store, auth provider, explicit generated-SDK token wiring, and protected member routing are now scaffolded |
| In Progress | Build layout primitives and role-aware navigation (69-C) | The shell now includes the persistent header, league selector scaffold, logout, and a real global create-league modal launch path; fuller header utilities and final visual design still remain |
| In Progress | Build the first product flow slice (69-D) | Auth preserves deep-link intent, zero-league users route to `/welcome`, the first real create-league modal now routes commissioners into `/league/<leagueCode>`, invite entry is on `/invite/<inviteCode>` with explicit acceptance, and commissioner invite-link generation emits the new public route shape |
| Done | Wire the new app into local build/test commands | Root build, lint, typecheck, and active frontend test commands now target PoolMaster rather than the retired web/admin apps |
| Done | Wire the new app into CI | CI frontend gates, coverage summary, and QA web deployment now target PoolMaster only |
| In Progress | Build the first core product flows | The primitive commissioner/member experience is now partially aligned to the reviewed `/welcome`, `/league/<leagueCode>`, and `/invite/<inviteCode>` model; create-league modal launch + submit is in place, while richer league home, invite-flow polish, and broader commissioner/root-admin flows still remain |
| In Progress | Add PoolMaster-specific frontend tests and reviewed browser E2E flows | frontend test work has started with the create-league modal test plus all three reviewed Plan 76 browser flows: commissioner self-register/create-league, invited new-user register/join, and multi-league bookmark/selector/default-league routing; broader route/component coverage still remains |
| Pending | Update docs/rules/README references | Make PoolMaster the single active web app in repo guidance |

## Validation

- `npx turbo typecheck --force`
- `npx eslint 'clients/poolmaster/src/**/*.{ts,tsx}' --max-warnings 0`
- app-local unit and coverage commands once introduced
- frontend-layer functional test command once introduced
- CI passes with PoolMaster app wired into the frontend gates
