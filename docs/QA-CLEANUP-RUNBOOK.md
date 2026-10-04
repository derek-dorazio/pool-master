# QA Cleanup Runbook

This runbook describes the supported cleanup path for QA browser data. Prefer
these product flows over ad hoc SQL so cleanup also exercises the lifecycle
features we depend on in production.

## What QA Holds, And Who Puts It There

Three kinds of data, and only one of them is yours to protect. The classification
and its reasoning live in [Architecture Rules §6](../rules/architecture-rules.md).

| Kind | In QA | Restored by |
|---|---|---|
| **Reference data** — the app is broken without it | the GOLF `sports` row, the `contest_config_templates` rows | **Migrations.** `prisma migrate deploy`, and a reset, put them back. Nothing to do by hand |
| **Fixture data** — makes QA usable by a human | one root admin, `poolmaster-admin` | **`bootstrap-users.mjs`**, from `.github/fixtures/qa-test-users.json`, run by the Reset QA database workflow or Create Test Users |
| **Everything else** | leagues, contests, tours, tournaments, players, other users | Created by whoever made it. All of it is residue once its run is over |

**Do not delete `poolmaster-admin`.** The post-deploy browser journey signs in as
it, and it is the owner's way into the site. Everything else in QA is fair game.

The fixture used to carry a `qa-commissioner` and a `qa-member` as well, for an
e2e design that reused signed-in storage state and a shared `QATESTLEAGUE`
league. #84 and #280 replaced that with the golden journey, which creates a
run-named tour, tournament, league, contest, entry and two users per attempt and
tears them down in `afterAll`. The two fixture users became orphans and came back
on every reset until the fixture was trimmed; `QATESTLEAGUE` no longer exists and
nothing recreates it.

## Reset QA Entirely

Faster than any of the cleanup below when QA is simply dirty, and the right
answer when a migration refuses on QA data. QA holds nothing worth preserving
(plans/129).

1. Actions -> **Reset QA database** -> Run workflow, type `reset qa`.
2. Approve the deployment when it pauses on the `qa-reset` environment.
3. The job prints the container log: the rows it destroyed, and a verification
   that the migration history came back clean.
4. Migrations gate the rollout, so re-run the latest `main` CI run's failed jobs
   to roll the release out again.

The reset wipes everything, re-applies every migration — which restores the
reference data — and runs `bootstrap-users.mjs` for the root admin.

## Clean Up Old Random Browser Leagues

Older browser tests created one-off league names/codes such as `BIRDS...`,
`EAGLES...`, and other Playwright-generated values.

1. Sign in as root admin.
2. Open `Manage` -> `Leagues`.
3. Use column filters to find obvious e2e residue by league name or code.
4. Open each league.
5. Inactivate it if needed.
6. Delete it after it is inactive.

Prefer deleting the whole stale league over deleting subordinate teams or users
one by one. It removes the data at the ownership boundary and keeps account
cleanup from being blocked by league-scoped dependencies.

## Clean Up Teams

> **Stale, not verified.** `Manage -> Teams` does not appear in
> `manage-navigation.ts`; the product's object is a Squad, reached through its
> league. The steps below are kept for their reasoning about ownership
> boundaries, not as a route that exists. Confirm the current surface before
> following them.


Use team cleanup when the league should remain, but a specific team is residue.

1. Sign in as root admin.
2. Open `Manage` -> `Teams`.
3. Use column filters to find the team.
4. Open the team details page.
5. Inactivate the team if it is active.
6. Delete the team after it is inactive.

Team delete is root-admin only, gated on inactive state, and reserved for QA
residue cleanup. Inactivating a team preserves history; deleting it hard-cascades
team-owned data.

## Clean Up Users

Reusable fixture users should stay durable. Clean up old one-off users only when
they are clearly test residue and no longer needed for debugging.

1. Sign in as root admin.
2. Open `Manage` -> `Users`.
3. Use column filters to find the account.
4. Open the user page from the username link.
5. If the account is active, inactivate it first.
6. Delete the account only after league/team dependencies have been removed.

If delete reports that the account still owns or belongs to league-scoped data,
follow the linked league/team in the error message and clean that dependency
first. This guard is expected; it prevents account deletion from silently
orphaning league data.

## Known Cleanup Gap Assessment

No additional product-code gap blocks normal QA cleanup after the reusable
fixture harness. Root admin can clean stale leagues, stale teams, and inactive
accounts through real UI lifecycle flows. The remaining limitation is operational
convenience rather than correctness: there is no bulk cleanup command or bulk UI
action for old residue. Add a separate low-priority story only if manual cleanup
volume becomes painful again.

## Local Test Database Recovery

Local service test data lives in the disposable `poolmaster_test` database. When
an interrupted local run leaves residue, recreate the test database instead of
hand-editing rows:

```bash
npm run db:test:reset
```

Then rerun the desired fresh test command, such as:

```bash
npm run test:service:functional-api:fresh
```
