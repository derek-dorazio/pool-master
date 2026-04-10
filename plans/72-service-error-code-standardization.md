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
| Pending | Inventory active routes still returning generic application codes | Focus on generic `BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `UNAUTHORIZED` usages where the domain reason is actually known |
| Pending | Define the canonical domain-specific code set for the active product surface | Cover auth/session, leagues/invitations, squads, contests/entries, standings/history, consent, and active root-admin flows |
| Pending | Standardize auth/session error codes | Replace generic auth/CSRF/session codes with stable auth-specific codes where needed |
| Pending | Standardize league and invitation error codes | Cover membership required, invalid invite, exhausted invite, invite revoked, invite expired, permission denials, etc. |
| Pending | Standardize squad error codes | Cover not-league-member, squad-not-found, co-manager lifecycle conflicts, and permission denials |
| Pending | Standardize contest and entry error codes | Cover contest not found, entry locked, membership required, no-manageable-squad, duplicate/limit conflicts, and leave restrictions |
| Pending | Standardize standings/history read error codes | Replace generic not-found/forbidden variants where the domain reason is known |
| Pending | Update functional API suites to assert the new error codes | Revise existing functional tests first, including auth, leagues, squads, contests, and standings/history slices |
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
