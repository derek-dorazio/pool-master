# Model Change Rules

When a data model field is added, modified, or removed, it creates a cascade of required changes across the full stack. **You MUST follow this checklist for every model change.** Skipping layers causes runtime errors (Prisma P2022, TypeScript mismatches, test failures, UI crashes).

---

## Checklist

Every model change requires updating these layers **in order**:

### Backend (always required)

- [ ] **Prisma schema** (`packages/core-api/prisma/schema.prisma`) — add/modify field with `@map()`, `@default()`, `@db.*` type
- [ ] **Migration** (`packages/core-api/prisma/migrations/`) — run `npx prisma migrate dev --name <description>` to generate SQL. Use `IF NOT EXISTS` for safety. **Never modify existing migrations.**
- [ ] **Domain types** (`packages/shared/domain/types.ts`) — update the interface to match the schema. Use proper TypeScript types, not `any`.
- [ ] **Enums** (`packages/shared/domain/enums.ts`) — add enum if the field has restricted values. Use `as const` pattern.
- [ ] **Repository adapter** (`packages/core-api/src/adapters/prisma-*-repository.ts`) — update `mapTo*()`, `create()`, `update()` methods.
- [ ] **Service layer** (`packages/core-api/src/modules/*/service.ts`) — update `Create*Input`, `Update*Input` interfaces. Add validation.
- [ ] **Route handler** (`packages/core-api/src/modules/*/handler.ts`) — extract field from `request.body`, pass to service.
- [ ] **Route schema** (`packages/core-api/src/modules/*/routes.ts`) — add field to JSON schema with type, format, enum, required.
- [ ] **Seed data** (`packages/core-api/prisma/seed.ts`) — add field to seeded records.

### Frontend — Webapp (required if field is user-facing or returned from API)

- [ ] **Hooks** (`clients/web/src/features/*/hooks/*.ts`) — update response interface and mock data fallback.
- [ ] **Components/pages** (`clients/web/src/pages/*.tsx`, `clients/web/src/features/*/*.tsx`) — render, edit, or conditionally display the field.
- [ ] **i18n** (`clients/web/src/locales/en/*.json`) — add translation keys for labels, placeholders, help text.

### Frontend — Admin App (required if field is relevant to admin workflows)

- [ ] **Hooks** (`clients/admin/src/hooks/*.ts`) — update response interface and mock data fallback.
- [ ] **Pages** (`clients/admin/src/pages/*.tsx`) — update tables, detail views, forms.

### Tests (always required)

- [ ] **Test factories** (`tests/factories/`) — add field with sensible default, accept overrides.
- [ ] **Backend unit tests** (`tests/unit/`) — verify field in service create/update/get, validation.
- [ ] **Backend integration tests** (`tests/integration/`) — verify field persists and retrieves end-to-end.
- [ ] **Schema validation test** (`tests/integration/core-api/schema-validation.integration.ts`) — if adding a NEW model, add a create+read+delete test. If modifying an existing model, verify the existing test still passes (it will fail on schema drift automatically).
- [ ] **API contract tests** (`tests/integration/core-api/api-contracts-web.integration.ts`) — if the field changes an API response shape, update the contract assertions. If adding a new endpoint, add a contract test.
- [ ] **Admin contract tests** (`tests/integration/core-api/api-contracts-admin.integration.ts`) — same as above for admin endpoints.
- [ ] **Webapp tests** (`clients/web/src/**/*.test.*`) — update mock data, verify rendering if user-facing.
- [ ] **Admin tests** (`clients/admin/src/**/*.test.*`) — update mock data, verify rendering if admin-facing.
- [ ] **Smoke tests** (`tests/api/functional/*.smoke.ts`) — add field to API flow tests if part of critical path.

### Enum & Constant Changes (required when adding/removing enum values)

- [ ] **Domain enums** (`packages/shared/domain/enums.ts`) — add/remove value using `as const` pattern.
- [ ] **Route JSON schemas** — update hardcoded `enum: [...]` arrays in all affected route files to match.
- [ ] **Enum consistency test** (`tests/unit/shared/enum-consistency.test.ts`) — will catch route↔enum drift automatically. Run to verify.
- [ ] **Template consistency test** (`tests/unit/shared/template-consistency.test.ts`) — will catch template↔enum drift. Run to verify.
- [ ] **Frontend constants** — if webapp/admin has hardcoded copies of enum values (e.g., sport filter lists), update those too.

### Event Type Changes (required when adding/modifying event types)

- [ ] **Event definitions** (`packages/shared/events/*.ts`) — add/modify the event type constant.
- [ ] **Publishers** — update any `eventBus.publish('event.type', ...)` calls.
- [ ] **Subscribers** — update any `eventBus.subscribe('event.type', ...)` calls.
- [ ] **EventBus contract test** (`tests/unit/shared/event-bus-contracts.test.ts`) — will catch naming convention violations and duplicate types. Run to verify.

### Templates (only if field affects scoring or draft config)

- [ ] **Scoring templates** (`packages/core-api/src/modules/scoring/templates/`) — update if field changes scoring behavior. Template consistency and Zod validation tests will catch invalid values.
- [ ] **Selection templates** (`packages/core-api/src/modules/drafts/templates/`) — update if field changes draft/selection config.
- [ ] **Scoring config validation test** (`tests/unit/shared/scoring-config-validation.test.ts`) — will catch templates that violate the Zod schema. Run to verify.

---

## Rules

### Migrations

- **Always create a new migration** for schema changes — never edit existing migrations.
- Run `npx prisma migrate dev --name <description>` to generate the migration.
- Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for safety (idempotent).
- For new tables, use `CREATE TABLE IF NOT EXISTS`.
- **The QA database migration runs in CI** (`migrate-qa` job). If you add a migration, it will be applied automatically.
- **Never delete columns in migrations** without confirming data loss is acceptable.
- For renaming columns: add new column → migrate data → remove old column (3-step process across releases).

### Domain Types

- Domain types in `packages/shared/domain/types.ts` must match the Prisma schema.
- Optional Prisma fields (`String?`) → optional TypeScript fields (`field?: string`).
- JSON Prisma fields (`Json`) → typed TypeScript fields (`scoringRules: ScoringRulesConfig`), not `Record<string, unknown>`.
- Never use `any` in domain types.

### Null vs Undefined

- **Database NULL** maps to TypeScript `undefined` (not `null`).
- Repository adapters convert: `row.field ?? undefined`.
- API responses omit undefined fields (JSON serialization drops them).
- Frontend hooks treat missing fields as `undefined`.

### API Schema Validation

- Every field accepted by an API endpoint must be in the route's JSON schema.
- Use `required: [...]` array to mark mandatory fields.
- Use `enum: [...]` for restricted values — must match the domain enum values.
- Use `format: 'uuid'` for ID fields, `format: 'date-time'` for timestamps.

### Frontend Mock Data

- Every hook has mock data as a fallback when the backend is unavailable.
- **Mock data must include the new field** — otherwise the UI breaks when the backend returns it.
- Mock data types must match the hook's TypeScript interface.
- When updating mock data, also update the corresponding test mock data.

### Test Coverage

- **Never skip tests for model changes.** Every field must have:
  - A unit test verifying it's accepted in creation
  - A unit test verifying it's returned in retrieval
  - An integration test verifying database persistence
- Update test factories to include the field with a default value.
- Frontend tests: update mock return values in hook mocks.

---

## Common Mistakes

| Mistake | Consequence | Prevention |
|---|---|---|
| Schema change without migration | Prisma P2022 "column does not exist" on QA/prod | Always run `prisma migrate dev` |
| Domain type not updated | TypeScript errors in services/handlers | Update types.ts immediately after schema |
| Adapter not updated | Field not persisted or returned | Update mapTo*() and create() |
| JSON schema missing field | API silently drops the field from request | Add to route schema properties |
| Mock data not updated | Frontend tests pass but UI crashes with real data | Update mock data in hooks AND tests |
| Missing migration for existing environments | QA smoke tests fail with P2022 | CI runs `prisma migrate deploy` automatically |
| Enum values not matching | API returns values frontend doesn't handle | Use shared enums from `enums.ts` everywhere |
| Test factory not updated | Tests use stale data shapes | Update factory defaults for every field change |
| New model without schema validation test | Schema drift hides until runtime P2022 | Add create+read+delete test to `schema-validation.integration.ts` |
| API response shape changed without contract test update | Webapp crashes on unexpected response | Update `api-contracts-web.integration.ts` assertions |
| Handler wrapping changed (e.g., `{ league }` → bare) | Frontend hooks destructure incorrectly | Contract tests catch this automatically |
| Enum value added but route schema not updated | API rejects valid requests with 400 | Enum consistency test catches this — update route `enum: [...]` arrays |
| Enum value removed but route schema still accepts it | Invalid values reach the service layer | Enum consistency test catches this |
| Event type string typo in publisher or subscriber | Events silently dropped, notifications never sent | EventBus contract test catches naming violations |
| Scoring template uses invalid enum value | Template rejected at runtime by Zod | Template consistency + scoring config validation tests catch this |
| Frontend sport filter list out of date | Users can't filter/create for new sports | Keep frontend constants in sync with `enums.ts` |

---

## Quick Reference: File Locations

| Layer | Files |
|---|---|
| Prisma schema | `packages/core-api/prisma/schema.prisma` |
| Migrations | `packages/core-api/prisma/migrations/` |
| Domain types | `packages/shared/domain/types.ts` |
| Enums | `packages/shared/domain/enums.ts` |
| Adapters | `packages/core-api/src/adapters/prisma-*-repository.ts` |
| Services | `packages/core-api/src/modules/*/service.ts` |
| Handlers | `packages/core-api/src/modules/*/handler.ts` |
| Routes | `packages/core-api/src/modules/*/routes.ts` |
| Seed data | `packages/core-api/prisma/seed.ts` |
| Webapp hooks | `clients/web/src/features/*/hooks/*.ts` |
| Webapp pages | `clients/web/src/pages/**/*.tsx` |
| Webapp i18n | `clients/web/src/locales/en/*.json` |
| Admin hooks | `clients/admin/src/hooks/*.ts` |
| Admin pages | `clients/admin/src/pages/**/*.tsx` |
| Test factories | `tests/factories/` |
| Unit tests | `tests/unit/` |
| Integration tests | `tests/integration/` |
| Webapp tests | `clients/web/src/**/*.test.*` |
| Admin tests | `clients/admin/src/**/*.test.*` |
| Smoke tests | `tests/api/functional/*.smoke.ts` |
| Schema validation | `tests/integration/core-api/schema-validation.integration.ts` |
| API contracts (webapp) | `tests/integration/core-api/api-contracts-web.integration.ts` |
| API contracts (admin) | `tests/integration/core-api/api-contracts-admin.integration.ts` |
| Enum consistency | `tests/unit/shared/enum-consistency.test.ts` |
| EventBus contracts | `tests/unit/shared/event-bus-contracts.test.ts` |
| Template consistency | `tests/unit/shared/template-consistency.test.ts` |
| Scoring config validation | `tests/unit/shared/scoring-config-validation.test.ts` |
| Scoring templates | `packages/core-api/src/modules/scoring/templates/` |
| Selection templates | `packages/core-api/src/modules/drafts/templates/` |
