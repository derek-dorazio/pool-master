## Objective

Build a new web application from scratch at `clients/poolmaster` using the same core technology stack, component library, styling direction, and branding as the legacy web app, but aligned to the new backend domain model and generated SDK contracts.

This app becomes the single go-forward web frontend for PoolMaster.

## Direction

- Create `clients/poolmaster` as the only active long-term web app.
- Use the same React/Vite/TypeScript/shadcn/Radix/Tailwind stack.
- Keep branding and overall product identity consistent with the legacy web app.
- Use only exported generated SDK operations and exported TypeScript types as the API contract source of truth.
- Build role-based behavior inside one app for members, commissioners, and root admins.
- Do not spend implementation effort modernizing `clients/web` or `clients/admin` in parallel.

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Pending | Scaffold `clients/poolmaster` with the approved stack | React, Vite, TypeScript, Tailwind, shadcn/ui, React Router, TanStack Query, Zustand, React Hook Form |
| Pending | Wire the new app into local build/test commands | Include dev, build, lint, unit test, coverage, and future frontend functional test commands |
| Pending | Wire the new app into CI | Replace legacy web/admin frontend gates with PoolMaster app gates as the app becomes active |
| Pending | Create shared app infrastructure | auth/session setup, generated SDK client wiring, query client, router shell, layout primitives, role-aware navigation |
| Pending | Define the initial route map from active use-case plans | member, commissioner, and root-admin surfaces in one role-based app |
| Pending | Build the first core product flows | auth, league list/detail, invitation acceptance, contest list/detail, entry creation, standings/history reads |
| Pending | Add PoolMaster-specific frontend tests | unit + frontend-layer functional tests aligned with the new rules |
| Pending | Update docs/rules/README references | Make PoolMaster the single active web app in repo guidance |

## Validation

- `npx turbo typecheck --force`
- `npx eslint 'clients/poolmaster/src/**/*.{ts,tsx}' --max-warnings 0`
- app-local unit and coverage commands once introduced
- frontend-layer functional test command once introduced
- CI passes with PoolMaster app wired into the frontend gates
