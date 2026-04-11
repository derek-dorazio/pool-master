# Model Change Rules

When a field or API-facing model changes, update every affected layer. Skipping one layer causes runtime drift, generated-client breakage, or stale UI assumptions.

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

### 1. Persistence and Domain

- [ ] Update Prisma schema if the database model changed.
- [ ] Generate a new Prisma migration if required.
- [ ] Update shared domain types/enums/constants.
- [ ] Update repository/service logic and persistence mapping.
- [ ] Rename files, types, functions, and modules so they reflect the new domain model rather than retired terminology.
- [ ] Remove retired associations and legacy compatibility fields instead of preserving them by default.
- [ ] Do not introduce mixed old/new terminology in the same slice.

### 2. DTO and API Contract

- [ ] Update or add the DTO Zod schema in `packages/shared/dto/`.
- [ ] Update the backend mapper in `packages/core-api/src/mappers/`.
- [ ] Update route request/response schemas in `routes.ts` using `zodToJsonSchema()`.
- [ ] Ensure `operationId`, `summary`, and `tags` remain correct.
- [ ] Run `npm run api:refresh`.
- [ ] Run `npm run api:validate`.

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
