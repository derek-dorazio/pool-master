# Plan 72: Service Error Code Standardization

## Objective

Replace generic transport-only application error codes with stable, descriptive, domain-specific codes across the active service surface, and update functional/integration/contract coverage to assert those codes consistently.

This plan builds on the shared nested error envelope already in place. The remaining gap is semantic quality: too many routes still return generic codes like `BAD_REQUEST`, `FORBIDDEN`, or `NOT_FOUND` even when the backend already knows the exact business failure.

## Desired End State

- Active service routes return the shared error envelope.
- Intentional application failures use stable, descriptive, domain-specific codes.
- Error messages are user-safe and informative.
- `details` is structured when useful.
- Functional API tests assert meaningful error codes for distinct negative-path cases.
- Contract and integration suites validate representative error bodies for the standardized codes.

## Scope

In scope:
- `packages/core-api/src/**` error translation and route error mapping
- shared error-code conventions documented in service/testing rules
- functional API test updates for existing and newly standardized error cases
- representative integration/contract assertions where active routes change

Out of scope:
- changing the shared error envelope shape itself
- archived web/admin behavior
- adding mock-only failure codes not backed by real service logic

## Execution Order

1. Inventory generic active error codes by module
2. Define domain-specific replacements for active route surfaces
3. Update domain/service error classes and handler translation
4. Update route docs/schemas if statuses or error semantics changed
5. Update functional API tests to assert the new codes
6. Update representative integration/contract tests
7. Regenerate and validate OpenAPI/client artifacts

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Done | Inventory active routes still returning generic application codes | Completed first-pass inventory across shared auth/permission layers and the active leagues, squads, contests, standings, history, and root-admin surfaces |
| In Progress | Define the canonical domain-specific code set for the active product surface | First active set now includes `AUTH_*`, `ROOT_ADMIN_*`, `LEAGUE_*`, `CONTEST_*`, `SQUAD_*`, and history-specific not-found codes |
| Done | Standardize auth/session error codes | Shared auth/session and CSRF handling now use specific auth codes instead of generic `UNAUTHORIZED` and `FORBIDDEN` |
| In Progress | Standardize league and invitation error codes | Shared league permission/membership gates are standardized; invitation accept/revoke semantics still need the same treatment |
| In Progress | Standardize squad error codes | Active squad membership/not-found/co-manager conflict cases now use specific codes; remaining generic squad-paths should be reviewed after the next slice |
| In Progress | Standardize contest and entry error codes | Contest not-found, membership-required, lock, limit, and selection-exists cases are standardized; additional contest admin/override paths remain |
| In Progress | Standardize standings/history read error codes | Shared standings session failure and history missing-resource cases are standardized; broader read-path sweep remains |
| In Progress | Update functional API suites to assert the new error codes | Updated existing auth, consent, leagues, contests, squads, and standings/history functional suites to match the new codes |
| Pending | Add or update representative contract/integration assertions for standardized error codes | Keep coverage focused on public service semantics rather than duplicating every functional assertion |
| Pending | Refresh OpenAPI/generated artifacts after route/schema changes | Run `npm run api:refresh` and `npm run api:validate` |

## Guardrails

- Do not invent codes for failures the service cannot actually distinguish.
- Do not collapse distinct domain failures back into `BAD_REQUEST` just because they share HTTP `400`.
- Do not change error messages or codes in tests without first changing the live service behavior.
- Update existing functional API tests when error semantics change; do not leave them asserting stale generic codes.
- Prefer one stable canonical code per business condition across routes rather than route-specific aliases for the same failure.

## Validation

Run the active gates from:

- [rules/workflow-rules.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/rules/workflow-rules.md)
- [rules/testing-rules.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/rules/testing-rules.md)

At minimum for each slice:

- focused eslint
- focused unit/integration/functional tests for touched routes
- `npm run api:refresh`
- `npm run api:validate`
