# Model Change Rules

When a field or API-facing model changes, update every affected layer. Skipping one layer causes runtime drift, generated-client breakage, or stale UI assumptions.

---

## Checklist

## Definition Of Done For Backend Refactor Slices

On `codex-backend-refactor-lane`, a backend slice that changes the domain model
is not done until all applicable layers for that slice are updated together:

- schema
- migration
- ORM/entity mapping
- DTOs
- route schemas
- OpenAPI refresh/validate
- unit tests
- DB integration tests

Do not mark a backend slice done if any of those applicable layers are still
intentionally stale.

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

- [ ] Update web/admin app code to match the regenerated `hey-api` contract.
- [ ] Remove any local API-shape interfaces or casts that the generated contract now makes unnecessary.
- [ ] Do not patch generated-client issues with local fake types if the backend contract is wrong.

Backend-first refactor branch exception:

- On `codex-backend-refactor-lane`, do not update web/admin consumers just to keep them aligned during the backend redesign unless the user explicitly asks for that phase of work.
- On that branch, the required output is a clean regenerated backend contract that downstream app rebuild work can consume later.
- Do not add endpoint aliases unless backward compatibility is explicitly requested.

### 4. Frontend Surfaces

- [ ] Update React hooks/pages/components that read or write the changed field.
- [ ] Update admin hooks/pages if relevant.
- [ ] Ensure loading/error/empty states still behave correctly.
- [ ] Remove dead UI for removed endpoints or fields.

### 5. Tests

- [ ] Update backend unit/integration tests.
- [ ] Update contract tests.
- [ ] Update smoke tests if the changed field/shape is on a critical path.
- [ ] Update browser E2E or MSW handlers if request/response shape changed.
- [ ] Remove or replace stale tests that were enforcing old architecture.
- [ ] Add DB-backed CRUD coverage for new or materially redesigned domain objects, including `findById`.
- [ ] Add use-case-driven tests that prove the backend supports the documented workflows for the changed domain area.

---

## Migration Rules For The Backend-First Refactor

- Prefer a clean target schema over preserving obsolete table structures.
- When the branch is intentionally rebuilding the domain model from first principles, do not contort the schema to preserve legacy naming or associations.
- A schema reset / fresh baseline migration is acceptable for this refactor lane when it simplifies the new model and no real legacy-data preservation requirement has been established.
- Keep migration files, ORM models, DTOs, and route contracts consistent with the new domain model names in the same slice.

---

## Seed Data Rules For The Backend-First Refactor

- Do not preserve broad application seed catalogs during this refactor.
- The only acceptable baseline seed target is the minimal bootstrap required to operate the system, currently the root admin user.
- Integration, smoke, and E2E tests must create and destroy the data they need rather than relying on ambient seeded contest/member/provider state.

---

## Frontend-Specific Rules

For web/admin:

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
