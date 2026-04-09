## Objective

Completely remove the separate admin webapp from the repository’s active build, test, and CI surface.

The long-term product direction is one role-based web app, not a separate admin frontend.

## Dependencies

- Can proceed independently of feature parity in the new PoolMaster app.
- Root-admin browser features will be rebuilt from scratch in the new PoolMaster app when needed; the old admin app is not a transition target.

## Direction

- Remove `clients/admin` as an active application target.
- Remove its build/test/coverage/Playwright/CI hooks.
- Remove repo rules and documentation that treat it as an active maintained app.
- Do not keep the old admin app around as a migration path or implementation reference.
- Any root-admin functionality needed later should be rebuilt from scratch inside the single PoolMaster web app.
- Archive only if needed for historical source retention; do not treat archived admin code as planning or implementation guidance.

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Pending | Inventory all `clients/admin` build/test/CI references | package scripts, turbo config, CI jobs, docs, rules, README files |
| Pending | Remove admin app from local quality gates | typecheck, lint, test, coverage commands |
| Pending | Remove admin app from CI workflows | build/test/package/deploy/browser references, coverage artifacts, and summaries |
| Pending | Remove admin-specific contract and browser test references | Clean up any admin-only contract or browser test wiring that should not survive the app retirement |
| Pending | Remove or archive `clients/admin` source so it is no longer an active or discoverable implementation target | If archived for history, mark it clearly as non-authoritative and non-reference material for agents |
| Pending | Review and document deployed admin infrastructure impact | Note S3/CloudFront/DNS or other deployment targets that should be retired or deprecated |
| Pending | Update docs and rules | ensure the repo no longer describes admin as an active separate app |
| Pending | Add follow-up note for root-admin UI rebuild | point future admin-facing work at the single PoolMaster app built from scratch |

## Validation

- no active script or CI job references `clients/admin`
- no active rule or README treats admin as a maintained separate app
- repo build/test flow remains green without admin app participation
