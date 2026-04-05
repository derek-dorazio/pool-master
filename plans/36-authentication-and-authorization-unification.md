# Plan 36: Authentication And Authorization Unification

## Purpose

Unify PoolMaster authentication and authorization so the web app and admin app use one trustworthy browser-to-backend authentication model, while still enforcing different authorization rules for:

- member-facing product behavior
- league-scoped commissioner behavior
- platform-admin behavior

This plan turns the findings in [docs/AUTHENTICATION-AUTHORIZATION.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/docs/AUTHENTICATION-AUTHORIZATION.md) into an execution roadmap.

It should also be read alongside [docs/STANDARD-AUTH-MODEL.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/docs/STANDARD-AUTH-MODEL.md), which captures the recommended conventional consumer-site approach for PoolMaster.

It is now also explicitly dependent on [Plan 37](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/37-league-top-level-domain-and-data-simplification.md) for the final domain boundary decisions around leagues, users, billing, and event modeling.

## Why This Plan Exists

PoolMaster currently has an uneven trust model:

- the web app uses a real JWT-based auth path enforced by [packages/core-api/src/plugins/auth-guard.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/plugins/auth-guard.ts)
- the admin app also obtains a JWT, but live admin routes still rely on a placeholder header-based gate in [packages/core-api/src/modules/admin/routes.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/routes.ts)
- the admin browser currently sends `x-admin-user-id` and `x-admin-user-email`, which means browser-supplied identity data is still part of the runtime trust boundary
- the stronger admin plugin in [packages/core-api/src/plugins/admin-auth.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/plugins/admin-auth.ts) exists but is not yet the live enforcement path

That creates avoidable risk:

- two mental models for browser authentication
- weaker admin trust boundaries
- duplicated token/identity handling
- an unclear line between authentication and authorization
- a trust model that is still shaped around the current tenant-owned user boundary

## Goals

1. Use one backend-owned cookie/session authentication model for both web and admin.
2. Support standard local login with `username or email + password`.
3. Support Google login through OpenID Connect.
4. Eliminate `localStorage` access-token storage from both browser apps.
5. Make signed session cookies and backend session validation the single runtime browser trust boundary for both apps.
6. Keep authorization separate from authentication.
7. Remove browser-supplied admin identity headers as a required trust mechanism.
8. Keep member-facing league authorization DB-backed and league-scoped.
9. Move admin enforcement onto real admin context and permissions.
10. Preserve or improve smoke/E2E confidence during rollout.

## Non-Goals

- Do not redesign the entire user/account model beyond what auth unification requires.
- Do not flatten member permissions and admin permissions into one shared permission table.
- Do not introduce an external IdP/SSO migration in the same effort.
- Do not rely on JWT claims alone for sensitive authorization decisions.
- Do not preserve a long-lived hybrid model where both header-based admin identity and real bearer-token auth remain active.
- Do not preserve browser-readable auth tokens in `localStorage`, session storage, or other JavaScript-managed persistence.

## Current-State Summary

Important note:

- the current auth/session model is still shaped around `tenantId` as part of user identity and request context
- if Plan 37 is accepted, auth implementation should target the league-top-level model rather than deepening the tenant-owned-user design
- if Plan 37's league-membership and squad model is accepted, authentication should resolve the user identity only; league membership, commissioner capability, squad co-management, and contest-entry rights should all be derived from database relationships at request time
- current references to tenant context in this plan are transitional/current-state notes, not target-state requirements

### Web app

- login via `POST /api/v1/auth/login`
- JWT access token currently stored in `localStorage`
- access token currently sent as `Authorization: Bearer ...`
- backend validates JWT through the global auth guard
- tenant context derived primarily from JWT `tenantId`
- league and contest authorization enforced through membership and commissioner permission checks

### Admin app

- currently also logs in through `POST /api/v1/auth/login`
- currently stores `admin_access_token`
- still sends:
  - `Authorization`
  - `x-admin-user-id`
  - `x-admin-user-email`
- live admin routes do not yet use the dedicated admin auth plugin as the primary gate
- live admin route access still depends on a placeholder pre-handler that only checks `x-admin-user-id`

### Backend

- shared JWT validation exists and works for member-facing APIs
- tenant resolution exists and should stay explicit
- admin role/permission concepts already exist
- admin runtime enforcement is only partially wired
- refresh tokens already exist server-side and can support a backend-owned session model

## Recommended Target State

### Authentication

Use one backend-owned session model for both apps:

- one login contract
- local login with `username or email + password`
- Google OIDC login
- one session-cookie issuance path
- one refresh/renewal lifecycle owned by the backend
- one browser trust boundary: secure `HttpOnly` cookies
- one canonical request identity model on the backend

Recommended session shape:

- short-lived signed access/session cookie
- refresh cookie stored as `HttpOnly`, `Secure`, and `SameSite`-scoped
- no browser-readable access token persistence
- backend endpoints derive authenticated identity from verified cookie-backed session state

Recommended claim/session identity fields:

- `sub`
- `email`
- scope/context identifiers only if truly required by the final league-top-level design
- `principalType`
- `isAdmin`
- optionally a coarse `adminRole`

The browser should not need to read these values from a token. It should get its session/user shell state from a truthful backend-authenticated identity read such as `/api/v1/auth/me`.

### Identity model

Use one core account identity for each person:

- one account record
- optional local credential
- optional external identities
- optional admin capability

Recommended direction:

- evolve `User` into the shared account identity
- add an `ExternalIdentity` model for Google and future providers
- evolve refresh-token-only semantics into a first-class session model
- link admin capability to the core account identity rather than treating it as a separate browser-auth identity

### Authorization

Authorization remains layered and runtime-backed:

- member routes:
  - authenticated principal
  - league context where required
  - DB-backed league membership and commissioner permission checks
  - squad co-management checks where contest-entry or drafting actions operate on a squad
- admin routes:
  - authenticated principal
  - admin identity resolution
  - DB-backed admin role and permission checks

Recommendation:

- keep claims coarse and stable
- keep fine-grained authorization in the database

### Frontend routing

Redirect behavior should be based on truthful backend-authenticated identity:

- member-only principal -> web app default route
- admin-capable principal -> admin app route or app switcher
- dual-capability principal -> explicit UX decision, but still one trust model

Redirect choice is not the security boundary.

### Cookie/session requirements

The target browser auth model should:

- use `HttpOnly` cookies so JavaScript cannot read auth credentials
- use `Secure` cookies in non-local environments
- choose `SameSite` and cookie domain settings intentionally for:
  - `qa.ultimateofficepoolmanager.com`
  - `qa-admin.ultimateofficepoolmanager.com`
  - production equivalents
- include a CSRF strategy for any state-changing cookie-authenticated routes
- keep the backend as the source of truth for login, logout, refresh, and session revocation

## Decisions To Resolve Up Front

### Decision A: Principal model

Choose one:

- shared principal with optional admin capability
- separate admin records authenticated through the same token model

Recommended decision:

- one authentication contract and token model regardless of storage model
- prefer one core account identity with linked admin capability
- allow separate internal admin records only if they are linked to the core account cleanly
- avoid separate browser trust models

### Decision B: Session and claim shape

Recommended decision:

- cookie-backed session/JWT contains coarse identity and capability only
- no fine-grained league permissions in claims
- no large embedded permission matrices in claims

### Decision C: Cookie scope and CSRF strategy

Choose and lock:

- cookie domain policy across web/admin environments
- `SameSite` policy
- CSRF protection approach for write routes

Recommended decision:

- same backend-owned cookie/session model for both apps
- explicit CSRF handling for state-changing requests
- avoid per-app token storage logic in the browser

### Decision D: Admin login endpoint

Choose one:

- keep `/api/v1/auth/login` as the login entry point for both apps
- or later add a separate admin login endpoint that still returns the same token/session model

Recommended decision:

- keep one session model first
- split login endpoints later only if UX or compliance needs require it

### Decision E: Login identifiers and provider support

Choose and lock:

- whether username is required or optional at account creation
- whether local login accepts:
  - username only
  - email only
  - username or email
- how Google account linking/merge rules work

Recommended decision:

- local login accepts username or verified email
- Google login is supported through OIDC
- external identities link into the same core account system

### Decision F: Session read contract

Recommended decision:

- define one truthful backend-authenticated identity/session read for each app shell
- remove synthetic local-only admin identity assumptions
- avoid duplicate token parsing paths
- avoid frontend token decoding entirely

## Workstreams

### Workstream 1: Auth contract and request context

Define the canonical runtime model:

- cookie/session contract
- coarse claim contract
- local + Google login contract
- backend request auth context
- backend admin context
- frontend session/identity read behavior

### Workstream 1A: Account and identity model normalization

Define the standard account model:

- username/email login rules
- local credential model
- external identity model
- account-to-admin capability linkage
- session model semantics

### Workstream 2: Backend admin enforcement

Replace placeholder admin gating with the real auth pipeline:

- real cookie/session validation
- real admin identity lookup
- real admin permission enforcement

### Workstream 3: Frontend session alignment

Update web/admin clients so they both rely on the same trust boundary and truthful session reads.

### Workstream 4: Migration and rollout

Introduce the new model without breaking QA:

- bounded compatibility where strictly necessary
- explicit rollout ordering
- explicit kill-switch removal criteria

### Workstream 5: Test and deployment verification

Prove the migration through:

- unit tests
- integration tests
- smoke tests
- deployed Playwright checks

## Detailed Execution Phases

### Phase 0: Design lock and contract definition

Deliverables:

- principal model decision
- session/claim decision
- login-identifier decision
- Google OIDC decision
- external identity decision
- session read decision
- migration bridge policy
- standard login-method decision:
  - username or email + password
  - Google OIDC

Exit criteria:

- no unresolved ambiguity about what the final auth contract is
- backend and frontend teams can implement against one documented target

### Phase 1: Backend auth contract normalization

Implementation focus:

- define the standard account and identity model
- normalize username/email credential lookup rules
- define external identity linking rules
- make shared auth context explicit and reusable
- normalize cookie/session validation and renewal
- reduce duplicate token parsing
- define admin capability derivation
- define how `/api/v1/auth/me` and any admin session read should behave

Exit criteria:

- account and provider model are explicit
- request auth context is canonical
- no new code path needs to parse JWT ad hoc
- no frontend code path needs to read auth credentials from browser storage

### Phase 2: Admin backend enforcement migration

Implementation focus:

- wire live admin routes to the real admin auth plugin path
- attach `request.adminContext`
- begin enforcing `requireAdminPermission()` on real admin routes
- keep any temporary bridge tightly bounded and measurable

Exit criteria:

- live admin routes no longer trust browser-supplied admin identity headers as the primary gate
- admin permissions are enforced through real admin context

### Phase 3: Frontend session alignment

Implementation focus:

- remove admin client reliance on `x-admin-user-id` / `x-admin-user-email`
- hydrate admin identity from truthful backend-authenticated state
- reconcile login redirect behavior
- remove `localStorage` token persistence from both apps
- reconcile cookie/session semantics across apps

Exit criteria:

- both apps authenticate through backend-owned cookie/session auth alone
- frontend session state matches backend-authenticated reality

### Phase 4: Compatibility removal and cleanup

Implementation focus:

- remove temporary bridge behavior
- remove dead code paths
- remove stale docs and rules
- ensure generated clients and OpenAPI match the final session contract

Exit criteria:

- no placeholder admin trust logic remains
- docs and tests describe only the real model

### Phase 5: Verification and promotion

Implementation focus:

- expand negative auth coverage
- expand smoke/E2E route verification
- confirm QA rollout and browser behavior

Exit criteria:

- web and admin can both authenticate and reach protected routes in QA
- forbidden/unauthorized cases are proven by tests

## Migration Principles

- prefer one-way migrations over long-lived compatibility layers
- if a bridge is required, give it a clearly bounded removal task in the same plan
- do not ship a state where both the old header-based admin trust boundary and the new cookie/session path are considered equally valid
- keep member-facing authorization DB-backed throughout the migration
- do not put league-scoped permissions into JWT claims
- do not move long-lived auth persistence back into browser-readable storage for convenience

## Testing Strategy

### Unit

- auth context parsing
- admin context attachment
- permission checks
- session hydration from backend-authenticated identity reads
- cookie/CSRF helper behavior where applicable

### Integration

- missing token -> `401`
- malformed token -> `401`
- inactive admin -> `403`
- authenticated non-admin on admin route -> `403`
- admin without required permission -> `403`
- member-facing league permission negative paths remain intact

### Smoke

At minimum after migration:

- web login
- protected member route
- admin login
- protected admin route

### Browser E2E

Build on the existing deployed checks:

- web login + protected member route
- admin login + protected admin route
- add at least one negative/forbidden case when the session setup allows it

## Risks

1. Breaking admin QA flows if backend enforcement changes before admin frontend session handling is ready.
2. Overloading JWT claims with stale authorization state.
3. Accidentally weakening tenant isolation while unifying principal handling.
4. Creating confusing UX for users who can access both product and admin surfaces.
5. Leaving behind an indefinite migration bridge.

## Rollout Order

1. Lock decisions and contract.
2. Normalize backend cookie/session contract.
3. Wire admin backend to real auth context.
4. Update both frontends to remove browser token storage and header dependence.
5. Run integration, smoke, and deployed browser verification in QA.
6. Remove the migration bridge.
7. Close plan with docs/rules updates.

## Acceptance Criteria

- Browser-to-backend authentication uses one backend-owned cookie/session trust model for both web and admin.
- Local login supports username or email plus password.
- Google login is supported through the same core account/session model.
- Neither web nor admin stores access tokens in `localStorage`.
- Live admin routes no longer require `x-admin-user-id` or `x-admin-user-email` as a trust boundary.
- Admin route authorization is enforced through real admin context and permissions.
- Member-facing route authorization remains tenant-aware, DB-backed, and league-scoped.
- Squad-facing contest-entry and drafting authorization remains DB-backed and squad-scoped on top of league membership.
- `/api/v1/auth/me` and related identity/session reads align with the shared auth context model.
- QA smoke and deployed browser checks prove both apps can authenticate and reach protected routes after the migration.

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 36-001 | 0 | Finalize the unified principal decision, cookie/session contract, CSRF strategy, login methods, and session-read strategy in the auth doc and this plan | In Progress | Standard-model review completed in `docs/STANDARD-AUTH-MODEL.md`; final implementation decisions must align with Plan 37's league-top-level model |
| 36-002 | 0 | Document the canonical backend request-auth context and admin-context model that all routes/plugins should use | Not Started | Make this the single source of truth for future implementation |
| 36-003 | 0 | Finalize the core account model changes needed for standard auth: username support, verification/status fields, and normalization rules | Blocked | Blocked on Plan 37 decisions about global `User` and removal of `tenantId` from user identity |
| 36-004 | 0 | Finalize the external identity strategy for Google OIDC and future providers | Blocked | Blocked on the final core account identity shape from Plan 37 |
| 36-005 | 0 | Finalize the session model direction and decide whether to evolve `RefreshToken` into a first-class `AuthSession` concept or introduce a new table | Blocked | Session model should target the post-Plan-37 account/domain boundary |
| 36-006 | 1 | Implement username-or-email local login lookup and normalization rules in the auth module | Not Started | Keep the login UX standard without breaking existing email-first accounts |
| 36-007 | 1 | Add Google OIDC support using the standard authorization-code + PKCE flow and link it into the same core account/session model | Not Started | Do not create a separate browser auth model for Google users |
| 36-008 | 1 | Replace browser-managed refresh/access-token expectations with backend-issued `HttpOnly` session cookies in the auth module | Not Started | Keep the backend responsible for login, refresh, logout, and revocation |
| 36-009 | 1 | Normalize `/api/v1/auth/me` and any adjacent identity reads so verified cookie-backed auth context is reused instead of duplicating token parsing | Not Started | Reduce duplicate token-reading paths before deeper migration |
| 36-010 | 1 | Define the final admin session-read contract the admin app will trust for authenticated identity hydration | Not Started | Could be `/auth/me`, a scoped admin identity endpoint, or a reshaped shared session payload |
| 36-011 | 1 | Link admin capability to the core account model cleanly and decide how `AdminUser` relates to `User` going forward | Blocked | Blocked on Plan 37's identity simplification decisions |
| 36-012 | 2 | Replace the placeholder admin pre-handler in [packages/core-api/src/modules/admin/routes.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/routes.ts) with the real plugin path rooted in [packages/core-api/src/plugins/admin-auth.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/plugins/admin-auth.ts) | Not Started | This is the core runtime trust-boundary change |
| 36-013 | 2 | Attach and consume `request.adminContext` consistently on live admin routes and services | Not Started | Replace ad hoc assumptions with one runtime context model |
| 36-014 | 2 | Apply `requireAdminPermission()` or equivalent permission checks to real admin routes, prioritizing write and high-risk routes first | Not Started | Start with tenant mutation, provider mutation, announcements, migrations, and support actions |
| 36-015 | 2 | Decide whether a short compatibility bridge is needed and, if so, bound it with explicit removal criteria and telemetry/logging | Not Started | The default should be no bridge unless QA migration forces one |
| 36-016 | 3 | Remove the admin browser’s reliance on `x-admin-user-id` and `x-admin-user-email` as required request headers | Not Started | Cookie-backed session should become the only browser trust boundary |
| 36-017 | 3 | Remove web and admin `localStorage` access-token persistence and switch both apps to backend-owned session reads plus cookie-authenticated requests | Not Started | Browsers should no longer manage auth credentials directly |
| 36-018 | 3 | Rework frontend session hydration so app shell identity comes from truthful backend-authenticated state instead of token hydration | Not Started | Eliminate synthetic local-only identity assumptions |
| 36-019 | 3 | Define post-login redirect and app-switch behavior for principals with admin capability | Not Started | UX decision only; not a security boundary |
| 36-020 | 4 | Remove temporary bridge behavior, dead header-based trust logic, obsolete token-storage helpers, and cookie migration compatibility code | Not Started | No long-lived hybrid model should remain |
| 36-021 | 4 | Update OpenAPI, generated clients, docs, and rules to match the final auth/session model | Not Started | Keep generated contracts and docs truthful |
| 36-022 | 5 | Add or adjust integration coverage for shared auth, admin auth, username/email login, Google OIDC callback handling, session-cookie flows, CSRF protections, and permission negative paths | Not Started | Include `401` vs `403` behavior and inactive-admin cases |
| 36-023 | 5 | Promote smoke and deployed browser checks that prove both apps authenticate and reach protected routes through the final model | Not Started | Build on the existing web/admin Playwright lane rather than replacing it |
| 36-024 | 5 | Run the QA rollout, confirm both apps work end to end, and then close the plan with final documentation updates | Not Started | Plan should not be archived until the compatibility bridge is gone and QA verification is complete |

## Dependency Note

Plan 37 is now the upstream domain/data-model plan for:

- global user identity
- league-top-level commercial boundary
- league membership vs squad co-management boundaries
- tenant removal/simplification
- event/season ownership
- admin linkage to core account identity

Plan 36 should proceed in two stages:

1. design/decision work that can happen now
2. implementation work after the Plan 37 boundary decisions are locked
