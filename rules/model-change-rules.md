# Model Change Rules

When a field or API-facing model changes, update every affected layer for every
affected entity and DTO. Skipping one layer causes runtime drift,
generated-client breakage, stale API docs, or stale UI assumptions.

---

## Checklist

## Definition Of Done For Backend Model Slices

A backend slice that changes the domain model is not done until all applicable layers for that slice are updated together:

- schema
- migration
- ORM/entity mapping
- DTOs
- route schemas
- OpenAPI refresh/validate
- unit tests
- DB integration tests
- contract-verification tests
- functional API tests
- browser E2E or MSW-backed frontend tests when the changed model is on an
  active client flow

Do not mark a backend slice done if any of those applicable layers are still
intentionally stale.

Model-change slices must also update the supporting test infrastructure that
depends on the model shape, including:

- factories and builders
- repository mocks
- fixture creators
- route setup helpers
- SDK/client setup helpers

If a model change leaves any affected suite failing because those test-support
layers are still shaped like the old model, the slice remains `In Progress`.

## Ownership And Handoff Rules

- Frontend agents must not directly implement backend-owned model or shared
  contract changes as a convenience while doing UI work.
- When frontend work reveals a possible model or shared-contract change, route
  the question through the `data-modeler` persona first so the impact is
  classified before implementation continues.
- Backend developers own the implementation of approved model/shared changes,
  including regeneration of the exported SDK/types used by frontend.
- Contract documentation gaps exposed by frontend questions are backend-owned
  defects. The backend developer must fix the documented contract, not merely
  explain the answer out-of-band.

### 1. Persistence and Domain

- [ ] Update Prisma schema if the database model changed.
- [ ] Generate a new Prisma migration if required.
- [ ] Update shared domain types/enums/constants.
- [ ] Update repository/service logic and persistence mapping.
- [ ] Rename files, types, functions, and modules so they reflect the new domain model rather than retired terminology.
- [ ] Remove retired associations and legacy compatibility fields instead of preserving them by default.
- [ ] Do not introduce mixed old/new terminology in the same slice.

### 2. DTO and API Contract

- [ ] Explicitly review whether each domain-model change also requires DTO
  changes. Default assumption: yes, DTOs and route contracts should stay in
  sync with the active domain and product model unless there is a deliberate,
  documented boundary reason not to.
- [ ] Update or add the DTO Zod schema in `packages/shared/dto/`.
- [ ] Update the backend mapper in `packages/core-api/src/mappers/`.
- [ ] Update route request/response schemas in `routes.ts` using `zodToJsonSchema()`.
- [ ] Ensure `operationId`, `summary`, and `tags` remain correct.
- [ ] Add or refresh descriptions where field/object/endpoint meaning is not
  obvious from names alone.
- [ ] Remove DTO/request fields that are no longer part of the active domain or
  approved product model. Do not leave retired fields in place just because the
  handler currently ignores them.
- [ ] If a DTO intentionally differs from the domain model, document why in the
  active plan notes or code comments instead of leaving the mismatch implicit.
- [ ] Run `npm run api:refresh`.
- [ ] Run `npm run api:validate`.
- [ ] Confirm the regenerated OpenAPI and generated SDK/types no longer expose
  removed properties.

### 3. Generated Client Consumers

- [ ] Update PoolMaster app code to match the regenerated `hey-api` contract.
- [ ] Remove any local API-shape interfaces or casts that the generated contract now makes unnecessary.
- [ ] Do not patch generated-client issues with local fake types if the backend contract is wrong.

### 4. Frontend Surfaces

- [ ] Update React hooks/pages/components that read or write the changed field.
- [ ] Update any active root-admin UI inside PoolMaster if relevant.
- [ ] Ensure loading/error/empty states still behave correctly.
- [ ] Remove dead UI for removed endpoints or fields.

### 5. Tests

- [ ] Update backend unit/data-integration tests.
- [ ] Update contract-verification suites.
- [ ] Update functional tests if the changed field/shape is on a critical path.
- [ ] Update browser E2E or MSW handlers if request/response shape changed and those layers are active for the affected flow.
- [ ] Update factories, repository mocks, builders, fixture setup, and other test-support code that still assumes the retired model shape.
- [ ] Remove or replace stale tests that were enforcing old architecture.
- [ ] Add DB-backed CRUD coverage for new or materially redesigned domain objects, including `findById`.
- [ ] Add use-case-driven tests that prove the backend supports the documented workflows for the changed domain area.

### 5A. Test-Impact Rule For Model Changes

- Any persisted field addition, removal, rename, or semantics change must
  trigger an impact sweep across unit, data integration, contract
  verification, FAPI, and active browser/MSW tests.
- Treat failing test suites caused by stale model assumptions as part of the
  production slice, not post-merge cleanup.
- Do not push a model change while knowingly leaving broken mocks, factories,
  or DB-backed tests that still reflect the old model.
- If the affected suite list is not obvious, document the expected impacted
  files in the plan notes before marking the task `Done`.

---

## Migration Rules For Backend Model Cleanup

- Prefer a clean target schema over preserving obsolete table structures.
- Do not contort the schema to preserve legacy naming or associations when the product model has clearly changed.
- Keep migration files, ORM models, DTOs, and route contracts consistent with the new domain model names in the same slice.
- For risky data migrations and repair scripts, add explicit verification of the
  intended end state before marking the migration applied in metadata.
- If a migration fix fails twice in a real environment, stop incremental
  patching and inspect the live database state before authoring another code
  change. At minimum, inspect:
  - `_prisma_migrations` rows for the target migration
  - duplicates/nulls in the affected data
  - expected indexes/constraints
- Do not keep editing a migration repair path without confirming that the code
  path still runs for the target database state.

---

## Seed Data Rules

- The only acceptable baseline seed target is the minimal bootstrap required to operate the system, currently the root admin user.
- Integration, functional, and E2E tests must create and destroy the data they need rather than relying on ambient seeded contest/member/provider state.

---

## Frontend-Specific Rules

For PoolMaster web:

- Prefer generated `hey-api` types/functions from `@/lib/api`.
- Do not introduce new local interfaces just because the generated type changed.
- Do not keep legacy `openapi-fetch` helpers, old wrappers, or path-copying tests alive for new work.

If a generated type is wrong:

1. fix DTO
2. fix route schema
3. regenerate
4. update callers

Do not reverse that order.

---

## Contract Integrity Rules

- Every API-facing model change is also an OpenAPI change unless proven otherwise.
- If the handler returns a different envelope than before, treat it as a contract change.
- The generated client is downstream of the backend contract. Fix the source, not just the consumer.
- Contract sweeps must validate field-level correctness, not only descriptions.
  A well-documented stale field is still a bug.
- This rule applies repo-wide, not just to the feature currently being designed.
  Every active entity/DTO pair must stay aligned with the current domain and
  approved product behavior.

---

## Common Mistakes to Avoid

| Mistake | Consequence |
|---|---|
| Updating Prisma but not DTOs | backend and frontend drift |
| Updating DTOs but not route schemas | exported OpenAPI is wrong |
| Updating backend contract but not regenerating | stale generated client |
| Keeping local frontend response types | frontend silently diverges from backend |
| Preserving tests for deleted wrappers or endpoints | bad architecture becomes sticky |
| Leaving no-op UI after endpoint removal | broken user experience and stale browser tests |
