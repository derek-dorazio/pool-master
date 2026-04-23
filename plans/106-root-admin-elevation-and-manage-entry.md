# Plan 106: Root Admin Elevation And `/manage` Entry

## Purpose

Make the existing root-admin surface reachable and operable from the PoolMaster
web app for users who already hold the role, and give root admins a safe,
auditable way to grant or revoke the role to other users from `/manage`.

This plan closes three adjacent gaps:

1. Root admins have no in-app entry point to `/manage` today — plan 101
   intentionally deferred menu wiring while the page itself was built.
2. After a successful login, root admins land on `/welcome` alongside regular
   members rather than on the admin surface they actually use.
3. There is no in-app way to promote another user to root admin, or to revoke
   the role, without running a seed script. As a result, root admin is
   currently a seed-only flag in practice.

## Current Starting Point

- `auth.isRootAdmin` is already exposed on the webapp `AuthContextValue`
  (`clients/poolmaster/src/features/auth/auth-provider.tsx`).
- `/manage` is already routed and guarded by `RootAdminRouteGuard`
  (`clients/poolmaster/src/routes/index.tsx`,
  `clients/poolmaster/src/routes/route-guards.tsx`).
- The existing `RootAdminPage` is a sync/ingestion/templates operations
  console. It has no user-management UI.
- Backend admin user management already has search, detail, force-logout,
  disable, and enable (`packages/core-api/src/modules/admin/user-service.ts`,
  `user-handler.ts`, `routes.ts`). It does **not** have a setRootAdmin
  operation.
- Registration cannot grant root admin. `RegisterRequestSchema`
  (`packages/shared/dto/auth.dto.ts`) does not include `isRootAdmin`, and
  `AuthService.register()` writes only `email`, `username`, `passwordHash`,
  `firstName`, `lastName`, `authProvider` into the user row. `isRootAdmin`
  defaults to `false` in Prisma
  (`packages/core-api/prisma/schema.prisma`).
- League/team invitations grant league-scoped roles, not the account-level
  `isRootAdmin` flag, and `member-lifecycle.ts` explicitly preserves root-admin
  users across league cleanup.

## Non-Negotiable Product Rule

**Root admin must never be grantable through registration or any invitation
flow.** The role is system-level and must only be assignable by an existing
root admin, and only through an audited admin surface. The seeded first root
admin stays the bootstrap mechanism. No self-service path, no marketing link,
no invitation code, no registration field may set `isRootAdmin`.

This plan should also add a regression test that confirms posting
`isRootAdmin: true` in a registration body does not produce a root-admin user.

## Design Constraints

- Do not add a second admin UI or a second admin route. Reuse `/manage` and
  the existing `RootAdminPage` per plan 101.
- Respect invitation deep-links: a root admin who clicked an invite link
  before signing in should still land on the invite, not be force-redirected
  to `/manage`. `routeState.from` outranks the admin redirect.
- There must always be at least one root-admin user in the system. Demotion
  of the last remaining root admin must be blocked at the service layer with
  a domain error, not merely disabled in the UI.
- Self-demotion is blocked. A root admin cannot revoke their own role in the
  same request, even if another root admin exists. This keeps the UI and
  service simple and avoids edge cases where a self-demote races a concurrent
  admin-count check.
- Frontend consumes the role-change call via the generated `hey-api` client,
  per `rules/react-ui-rules.md`.
- Every role change writes to `logAdminAction` with before/after state and an
  optional human reason, matching existing admin operations.
- On demotion, revoke the target's refresh tokens so their next request drops
  out of any cached root-admin context, reusing the `forceUserLogout` pattern.

## Scope

### In Scope

- `clients/poolmaster/src/features/auth/auth-home-page.tsx`
- `clients/poolmaster/src/features/app-shell/app-shell.tsx`
- `clients/poolmaster/src/features/account/account-menu.tsx`
- `clients/poolmaster/src/features/root-admin/**/*` (new
  `root-admin-users-panel.tsx` plus stitch into `root-admin-page.tsx`)
- Related vitest files for the four webapp files above.
- `packages/shared/dto/admin/users.dto.ts` (new schema), or the closest
  existing admin-user DTO file if one already owns that namespace.
- `packages/core-api/src/modules/admin/user-service.ts`
- `packages/core-api/src/modules/admin/user-handler.ts`
- `packages/core-api/src/modules/admin/routes.ts`
- OpenAPI spec + regenerated `packages/shared/generated/hey-api`.
- Service unit tests for `setRootAdmin`.
- Functional-API test covering the new route and a registration regression
  test.
- Contract-verification case for the new endpoint
  (`contract-verification-root-admin.integration.ts` or equivalent).

### Out of Scope

- Broader user-admin UX polish (bulk actions, filters beyond what the search
  endpoint already supports, CSV export, etc.).
- Reworking `disableUser` / `enableUser` / `forceUserLogout` ergonomics.
- Changes to league/team invitation mechanics.
- Mobile clients.
- Browser E2E coverage. A follow-on slice can add a Playwright journey for
  the admin elevation path once the unit/functional/contract layers prove the
  behavior.

## Implementation Phases

### Phase 0 — Session prep (not part of product scope, but required for execution)

Work that had to land before the feature slices were executable in the author's
environment. Captured for traceability; safe to prune after the feature ships.

- Rewrote 293 absolute in-repo links across 57 markdown files (plans, rules,
  docs, agents, CLAUDE.md, clients/poolmaster/README.md) from
  `/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/...`
  to per-file relative paths (`./`, `../`, etc.). The OneDrive path was stale;
  the current checkout is `/Users/DDorazio/development/Github-Personal/pool-master`.
  Relative links are now checkout-location-independent.
- Installed missing linux-arm64 native binaries into the Cowork sandbox's
  `node_modules` so turbo and vitest could run:
  `@rolldown/binding-linux-arm64-gnu@1.0.0-rc.12`,
  `@turbo/linux-arm64@2.8.20`,
  `@esbuild/linux-arm64@0.27.4`,
  `@rollup/rollup-linux-arm64-gnu@4.60.0`,
  `lightningcss-linux-arm64-gnu@1.32.0`. The checked-in `node_modules` shipped
  darwin-arm64 binaries only; the Cowork sandbox is linux-arm64 and the
  registry is not reachable from the sandbox proxy, so the tarballs had to be
  fetched from a host with npm registry access.

### Phase 1 — Webapp entry (Slice A)

- Add a `resolvePostAuthDestination(user, routeState)` helper in
  `auth-home-page.tsx`. Use it in `handleLogin`, `handleRegister`, and the
  "already signed in" short-circuit. `routeState.from` still wins; falls
  back to `/manage` for root admins, `/welcome` otherwise.
- Add an optional `isRootAdmin?: boolean` prop to `AccountMenu`. When true,
  render a Manage link to `/manage` above the Profile link, with
  `data-testid="account-menu-manage"`, that closes the menu on click.
- Pass `isRootAdmin={auth.isRootAdmin}` from `AppShell` to `AccountMenu`.
- Update vitest coverage: `auth-home-page.test.tsx` gains two login cases
  (root admin with no `from` → `/manage`; root admin with `from` → `from`
  still wins). `app-shell.test.tsx` asserts the shell forwards
  `auth.isRootAdmin` to the menu. New `account-menu.test.tsx` covers the
  Manage link being conditionally rendered.

### Phase 2 — Backend setRootAdmin contract (Slice B)

- Add `SetUserRootAdminRequestSchema = z.object({ isRootAdmin: z.boolean(),
  reason: z.string().trim().min(1).max(500).optional() })` to
  `packages/shared/dto/admin/users.dto.ts` (create this file if it does not
  already exist; otherwise extend the nearest existing admin-user DTO file).
- Add `UserService.setRootAdmin(userId, nextValue, actorUserId, actorEmail,
  reason?)`:
  - Load target; throw `UserNotFoundError` if missing.
  - If `nextValue === user.isRootAdmin`, log a no-op debug line and return.
  - If target `userId === actorUserId`, throw a new
    `SelfRootAdminChangeError` (maps to 400 `SELF_ROOT_ADMIN_CHANGE`).
  - If demoting and target is the only row with `isRootAdmin: true`, throw
    `LastRootAdminError` (maps to 409 `LAST_ROOT_ADMIN`).
  - Otherwise, in a transaction:
    - `user.update({ data: { isRootAdmin: nextValue } })`.
    - On demote, `refreshToken.updateMany({ where: { userId, revokedAt: null
      }, data: { revokedAt: new Date() } })`.
    - `logAdminAction({ action: 'user.set_root_admin', resourceType: 'USER',
      resourceId: userId, beforeState: { isRootAdmin: !nextValue }, afterState:
      { isRootAdmin: nextValue }, reason, description: <human-readable> })`.
- Add `setRootAdmin` handler to `user-handler.ts` mirroring the `disableUser`
  shape, and register `fastify.post('/users/:userId/root-admin', { schema:
  ..., handler: ... })` in `routes.ts` under the same admin-auth plugin.
- Route schema must use `zodToJsonSchema` per service rules and include
  `operationId`, `summary`, and `tags`.
- `npm run api:refresh` and `npm run api:validate`, then regenerate
  `packages/shared/generated/hey-api` so the webapp can call the new
  operation through the generated SDK.
- Tests:
  - Service unit: promote, demote, self-demotion rejected, last-root-admin
    rejected, no-op, not-found, refresh-tokens-revoked on demote.
  - Functional API: non-admin blocked (403), admin promote, admin demote,
    last-root-admin blocked, audit row present.
  - Contract verification case added to the root-admin verification suite.
  - Registration regression in functional-api: `POST /auth/register` with
    `{ ..., isRootAdmin: true }` returns a user whose `isRootAdmin === false`
    in the response and in the DB.

### Phase 3 — `/manage` user-management panel (Slice C)

- New component
  `clients/poolmaster/src/features/root-admin/root-admin-users-panel.tsx`:
  - Consumes generated `adminListUsers` for search + pagination.
  - Table columns: user (name + username), email, active, root admin.
  - Promote button visible when the target is not a root admin. Demote
    button visible when the target is a root admin; disabled for the current
    authenticated user's own row and visually annotated when the row is the
    only remaining root admin.
  - Confirm dialog for both promote and demote with an optional "reason"
    free-text field that flows through to the audit log.
  - Mutation calls generated `adminSetUserRootAdmin`. On success, invalidate
    the user-list query. On `LAST_ROOT_ADMIN` or
    `SELF_ROOT_ADMIN_CHANGE`, surface an inline error message matching the
    service-level reason.
  - Short copy at the top of the panel: "Root admin is an internal system
    role. It cannot be granted through registration or invitations. Only an
    existing root admin can grant it here, and at least one root admin must
    always remain."
- Stitch the panel into `root-admin-page.tsx` as an additional section. The
  page already groups logical operations into distinct cards — follow the
  same structure.
- Tests (`root-admin-users-panel.test.tsx`): list renders, promote flow,
  demote flow, self-row demote disabled, last-root-admin demote disabled,
  API failure surfaces an error state, reason field is passed on submit.

### Phase 4 — Validate and close

- Run the full pre-push gate set per `rules/workflow-rules.md` §3.
- Reconcile Beads items per the Slice Completion Checklist.
- Do not add browser E2E in this plan. Note it as a candidate follow-up.

## Acceptance Criteria

- A root admin who logs in with no explicit deep-link lands on `/manage`.
- A root admin who signs in via an invitation deep-link still lands on the
  invitation, not `/manage`.
- The signed-in user menu shows a Manage item when and only when the current
  user has `isRootAdmin === true`, and clicking it navigates to `/manage`.
- Non-root-admin users never see the Manage menu item and are redirected away
  from `/manage` by the existing guard.
- A root admin can promote another user from the `/manage` user panel, and
  the change is reflected in the list after a successful response.
- A root admin can demote another root admin from the same panel, with an
  explicit confirmation step.
- Self-demotion is blocked with a 400 `SELF_ROOT_ADMIN_CHANGE` response and a
  clear UI message.
- Demoting the only remaining root admin is blocked with a 409
  `LAST_ROOT_ADMIN` response and a clear UI message.
- Every successful role change writes an audit log row via
  `logAdminAction` with before/after state and optional reason.
- Demotion revokes the target user's refresh tokens.
- Posting `{ ..., isRootAdmin: true }` to `/auth/register` produces a user
  whose `isRootAdmin` is `false` (regression test).
- No endpoint or invitation flow exists by which a user can cause their own
  `isRootAdmin` to become `true` without an existing root admin acting
  through `/admin/users/:userId/root-admin`.

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 106-P01 | 0 | Rewrite stale absolute OneDrive links to per-file relative paths across 57 markdown files | Done | 293 substitutions; `grep -rln '/Users/DDorazio/Library/CloudStorage/'` returns 0 in markdown. `.beads/embeddeddolt/...` and `coverage/**/*.json` intentionally skipped (generated/Dolt-internal). |
| 106-P02 | 0 | Populate linux-arm64 native binaries in Cowork sandbox `node_modules` so turbo/vitest can run | Done | Fetched tarballs for rolldown/turbo/esbuild/rollup/lightningcss linux-arm64-gnu. musl variants intentionally skipped (sandbox is glibc). |
| 106-001 | 1 | Add `resolvePostAuthDestination` helper and route login/register/already-signed-in through it | Done | `auth-home-page.tsx`: exported helper; `routeState.from` wins, then `/manage` for root admin, then `/welcome`. Login + register success logs include computed destination and `isRootAdmin`. |
| 106-002 | 1 | Add optional `isRootAdmin` prop and conditional Manage link to `AccountMenu` | Done | `account-menu.tsx`: `isRootAdmin?: boolean` prop (default false); Manage link with `data-testid="account-menu-manage"` renders above Profile only when true; closes the menu on click. |
| 106-003 | 1 | Thread `auth.isRootAdmin` from `AppShell` into `AccountMenu` | Done | `app-shell.tsx`: passes `isRootAdmin={auth.isRootAdmin}` alongside existing `userName` and `onLogout` props. |
| 106-004 | 1 | Extend vitest coverage for Slice A | Done | `auth-home-page.test.tsx`: two new cases (root admin no-from → `/manage`; root admin with `from` → invite still wins). `app-shell.test.tsx`: mocked menu surfaces `isRootAdmin`; two new cases assert forwarding. New `account-menu.test.tsx`: four cases covering hidden/shown/closed-on-click. |
| 106-005 | 2 | Add `SetUserRootAdminRequestSchema` DTO | Not Started | `packages/shared/dto/admin/users.dto.ts` (new or nearest) |
| 106-006 | 2 | Add `UserService.setRootAdmin` with guards, audit, and refresh-token revoke | Not Started | `packages/core-api/src/modules/admin/user-service.ts` |
| 106-007 | 2 | Add `setRootAdmin` handler + route with zodToJsonSchema | Not Started | `user-handler.ts`, `routes.ts` |
| 106-008 | 2 | `api:refresh` + `api:validate` and regenerate `hey-api` client | Not Started | Must run both before frontend consumes the new SDK method |
| 106-009 | 2 | Service unit tests for setRootAdmin | Not Started | promote, demote, self-demote, last-root-admin, no-op, not-found, tokens revoked |
| 106-010 | 2 | Functional API + contract-verification coverage for new route | Not Started | root-admin FAPI suite + contract-verification-root-admin |
| 106-011 | 2 | Register regression: isRootAdmin=true smuggle attempt ignored | Not Started | functional-api under auth suite |
| 106-012 | 3 | Build `root-admin-users-panel.tsx` with search, promote, demote, confirm, reason | Not Started | uses generated `adminListUsers` and new `adminSetUserRootAdmin` |
| 106-013 | 3 | Stitch users panel into `root-admin-page.tsx` | Not Started | match existing card structure |
| 106-014 | 3 | Vitest coverage for users panel | Not Started | list, promote, demote, self-disabled, last-root-admin disabled, error surfacing |
| 106-015A | 4 | Slice A pre-push gate set (non-DB) | Done | In Cowork sandbox: `npx turbo typecheck --force` 5/5 workspaces; `npx eslint ... --max-warnings 0` exit 0; `npx vitest run` 120/120 across 31 files; `npx jest --config tests/jest.config.js --forceExit` 519/519 across 55 suites. FAPI not applicable to a UI-only slice. |
| 106-015B | 4 | Slice B pre-push gate set (DB + non-DB) | Not Started | Slice B requires DB; run on a host with Postgres: `db:test:reset`, `test:service:integration:fresh`, `test:service:functional-api:fresh`, plus non-DB gates. Sandbox cannot reach any Postgres (no outbound TCP/DNS). |
| 106-015C | 4 | Slice C pre-push gate set (non-DB) | Not Started | Same shape as 015A once Slice C lands. |
| 106-016 | 4 | Reconcile Beads items and update this plan with file-level handoff notes | Not Started | per Slice Completion Checklist. Slice A Beads child should be closed; epic stays open until B and C close. |

## Beads Seed Commands

The `bd` CLI is not available in the author's working sandbox. Paste these
into a shell where Beads is installed to seed the epic and child items for
this plan. Adjust titles/priorities as needed once they land.

```bash
bd create --type epic --priority 1 --labels plan-106,root-admin,webapp \
  "Plan 106: Root admin elevation and /manage entry"

bd create --type task --priority 1 --labels plan-106,webapp \
  "106-A: Login redirect + Manage menu item for root admins"

bd create --type task --priority 1 --labels plan-106,backend,contract \
  "106-B: Backend setRootAdmin contract + service + route + tests"

bd create --type task --priority 1 --labels plan-106,webapp,root-admin \
  "106-C: /manage user-management panel for promote/demote"

bd create --type task --priority 2 --labels plan-106,workflow \
  "106-D: Pre-push gate run and plan/Beads reconciliation"
```

After the epic and four children exist, link the children as `blocks`/
`blockedBy` (C blocked by B, D blocked by A/B/C) and close the matching
action-plan rows as each slice lands.

## Session Handoff — Slice A Delivered

**Status:** Slice A (Phase 1) implementation and validation complete and
ready to commit.

**Files changed for Slice A:**

- `clients/poolmaster/src/features/auth/auth-home-page.tsx` — new exported
  `resolvePostAuthDestination(user, routeState)`; consumed in `handleLogin`,
  `handleRegister`, and the already-signed-in `<Navigate>` short-circuit.
- `clients/poolmaster/src/features/auth/auth-home-page.test.tsx` — adds
  `/manage` route to the harness; two new login cases for root admin.
- `clients/poolmaster/src/features/account/account-menu.tsx` — new
  `isRootAdmin?: boolean` prop; conditional Manage link with
  `data-testid="account-menu-manage"`.
- `clients/poolmaster/src/features/account/account-menu.test.tsx` — new file,
  four cases.
- `clients/poolmaster/src/features/app-shell/app-shell.tsx` — forwards
  `auth.isRootAdmin` to `AccountMenu`.
- `clients/poolmaster/src/features/app-shell/app-shell.test.tsx` — mocked
  menu surfaces the flag; two new forwarding assertions.

**Gates (re-run before push if environment changes):**

- `npx turbo typecheck --force` — 5/5 workspaces clean
- `npx eslint 'packages/*/src/**/*.ts' 'clients/*/src/**/*.{ts,tsx}' --max-warnings 0` — exit 0
- `npx vitest run` (clients/poolmaster) — 120/120 across 31 files
- `npx jest --config tests/jest.config.js --forceExit` — 519/519 across 55 suites
- `npm run test:service:functional-api` — not applicable (no backend change)

**Next session pickup:**

Begin Slice B in `packages/core-api/src/modules/admin/` and
`packages/shared/dto/`. Refer to the Action Plan rows 106-005 through 106-011
and the design constraints above. Slice B will need DB-backed validation
(integration + FAPI) on a host with Postgres; the Cowork sandbox cannot
reach any Postgres and should not be used for those gates.

## Open Follow-Ups

- Add a Playwright journey that proves the admin elevation path end to end.
- Consider whether Manage should also appear in the primary nav bar for root
  admins rather than only the account menu. Current plan keeps it in the
  account menu to match existing patterns and minimize visual surface area.
