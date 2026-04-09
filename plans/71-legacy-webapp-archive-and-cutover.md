## Objective

Archive the legacy `clients/web` app so it no longer participates in active build, test, coverage, smoke, or CI workflows once `clients/poolmaster` becomes the go-forward app.

The archived app may remain as reference material for planning only.

## Direction

- `clients/web` should not be an active implementation target once the new PoolMaster app is underway.
- It may remain as archived/reference material for planning agents to infer use cases, layout ideas, and component ideas.
- Implementation agents should not keep it current with new plans or new backend contracts.
- All active frontend build/test/CI wiring should eventually point only to `clients/poolmaster`.

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Pending | Define the cutover point from `clients/web` to `clients/poolmaster` | Do not archive the old app before the new one is capable of serving as the active frontend target |
| Pending | Inventory all active references to `clients/web` | scripts, turbo, CI, smoke/E2E, docs, rules, README files |
| Pending | Remove legacy web app from active build/test/coverage commands | once PoolMaster app has replaced those gates |
| Pending | Remove legacy web app from smoke/browser/CI references | no active deployment/test workflow should target it |
| Pending | Archive `clients/web` as reference-only material | preserve for planning/reference, not implementation |
| Pending | Update rules and docs to mark it as archived | make the distinction explicit for agents |

## Validation

- active local and CI frontend gates target `clients/poolmaster`, not `clients/web`
- no active smoke/browser suite targets the archived app
- rules/docs clearly distinguish archived reference material from active implementation targets
