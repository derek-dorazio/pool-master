## Objective

Completely remove the separate admin webapp from the repository’s active build, test, and CI surface.

The long-term product direction is one role-based web app, not a separate admin frontend.

## Direction

- Remove `clients/admin` as an active application target.
- Remove its build/test/coverage/Playwright/CI hooks.
- Remove repo rules and documentation that treat it as an active maintained app.
- Any remaining root-admin functionality should later live inside the single PoolMaster web app.

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Pending | Inventory all `clients/admin` build/test/CI references | package scripts, turbo config, CI jobs, docs, rules, README files |
| Pending | Remove admin app from local quality gates | typecheck, lint, test, coverage commands |
| Pending | Remove admin app from CI workflows | build/test/package/deploy/browser references |
| Pending | Remove or archive `clients/admin` source | based on the chosen archival/removal approach |
| Pending | Update docs and rules | ensure the repo no longer describes admin as an active separate app |
| Pending | Add follow-up note for root-admin UI migration | point future admin-facing work at the single PoolMaster app |

## Validation

- no active script or CI job references `clients/admin`
- no active rule or README treats admin as a maintained separate app
- repo build/test flow remains green without admin app participation
