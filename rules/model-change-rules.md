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
- [ ] **Webapp tests** (`clients/web/src/**/*.test.*`) — update mock data, verify rendering if user-facing.
- [ ] **Admin tests** (`clients/admin/src/**/*.test.*`) — update mock data, verify rendering if admin-facing.
- [ ] **Smoke tests** (`tests/api/functional/*.smoke.ts`) — add field to API flow tests if part of critical path.

### Templates (only if field affects scoring or draft config)

- [ ] **Scoring templates** (`packages/core-api/src/modules/scoring/templates/`) — update if field changes scoring behavior.
- [ ] **Selection templates** (`packages/core-api/src/modules/drafts/templates/`) — update if field changes draft/selection config.

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
| Scoring templates | `packages/core-api/src/modules/scoring/templates/` |
| Selection templates | `packages/core-api/src/modules/drafts/templates/` |
