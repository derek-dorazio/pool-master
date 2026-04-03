# Model Change Rules

When a field or API-facing model changes, update every affected layer. Skipping one layer causes runtime drift, generated-client breakage, or stale UI assumptions.

---

## Checklist

### 1. Persistence and Domain

- [ ] Update Prisma schema if the database model changed.
- [ ] Generate a new Prisma migration if required.
- [ ] Update shared domain types/enums/constants.
- [ ] Update repository/service logic and persistence mapping.

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
