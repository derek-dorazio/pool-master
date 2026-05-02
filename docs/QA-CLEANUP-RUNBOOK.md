# QA Cleanup Runbook

This runbook describes the supported cleanup path for QA browser data. Prefer
these product flows over ad hoc SQL so cleanup also exercises the lifecycle
features we depend on in production.

## Fixture Data Policy

The deployed browser e2e lane uses durable fixture users and one reusable league:

- Root admin: `poolmaster-admin`
- Commissioner: `qa-commissioner`
- Member: `qa-member`
- Shared league code: `QATESTLEAGUE`
- Shared league display name: `QA-TEST-LEAGUE`

Do not delete these users during normal cleanup. The Playwright setup project
can recreate `QATESTLEAGUE` if it is missing, but keeping it stable avoids
unnecessary churn. Use the shared league for repeatable browser smoke coverage,
and use deterministic contest or entry names for future workflow fixtures.

## Reset The Shared QA League

Use this only when `QATESTLEAGUE` becomes too dirty to inspect or debug.

1. Sign in as the root-admin fixture.
2. Open `Manage` from the account menu.
3. Open `Leagues`.
4. Filter the league code column for `QATESTLEAGUE`.
5. Open the league.
6. If the league is active, use `Inactivate league`.
7. Use `Delete league`, type the exact league code, and confirm.
8. Run the browser e2e lane again. The setup project will recreate the league
   and repair commissioner/member access.

League delete is the preferred hard cleanup path because it cascades through
league-owned contests, teams, memberships, invitations, and related history.

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
