## Objective

Archive the legacy `clients/web` app so it no longer participates in active build, test, coverage, smoke, or CI workflows once `clients/poolmaster` becomes the go-forward app.

The archived app may remain as reference material for planning only.

## Dependencies

- Blocked until [plans/69-poolmaster-webapp-rebuild.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/69-poolmaster-webapp-rebuild.md) has reached the first active-frontend cutover milestone.
- Should coordinate with [plans/68-browser-e2e-reset-for-web-rebuild.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/68-browser-e2e-reset-for-web-rebuild.md) and [plans/70-admin-webapp-removal.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/70-admin-webapp-removal.md) so test and CI references are removed cleanly.

## Direction

- `clients/web` should not be an active implementation target once the new PoolMaster app is underway.
- It may remain as archived/reference material for planning agents to infer use cases, layout ideas, and component ideas.
- Implementation agents should not keep it current with new plans or new backend contracts.
- All active frontend build/test/CI wiring should eventually point only to `clients/poolmaster`.
- This archived-reference allowance does not apply to `clients/admin`; the retired admin app should not be treated as planning or implementation guidance.

## Cutover Criteria

The legacy web app should not be archived until the new PoolMaster app is capable of serving as the active frontend target.

Minimum cutover criteria:

- new app handles auth
- new app handles league list/detail and invitation acceptance
- new app handles contest list/detail
- new app handles entry creation
- new app handles standings/history reads
- new app is wired into active local build/test/CI flow
- new app is ready to become the primary deployed frontend target

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Pending | Define and confirm the cutover point from `clients/web` to `clients/poolmaster` | Use the explicit cutover criteria in this plan rather than an ad hoc judgment |
| Pending | Inventory all active references to `clients/web` | scripts, turbo, CI, smoke/E2E, docs, rules, README files |
| Pending | Remove legacy web app from active build/test/coverage commands | once PoolMaster app has replaced those gates, including legacy Vitest/coverage references |
| Pending | Remove legacy web app from smoke/browser/CI references | no active deployment/test workflow should target it |
| Pending | Archive `clients/web` as reference-only material | move to an explicitly archived location with a README/DEPRECATED note for agents |
| Pending | Update rules, AGENTS guidance, and docs to mark it as archived | make the distinction explicit for agents |
| Pending | Inventory the future of `clients/shared` during cutover | Decide whether it remains useful or should be simplified/absorbed as the single-app architecture lands |

## Validation

- active local and CI frontend gates target `clients/poolmaster`, not `clients/web`
- no active smoke/browser suite targets the archived app
- rules/docs clearly distinguish archived reference material from active implementation targets
