# PoolMaster — Webapp Product Rules

**What the app is, and who can do what.** One role-based web application:
`clients/poolmaster`.

React, Vite and TypeScript implementation rules are [react-ui-rules.md](react-ui-rules.md);
this file does not repeat them. The one-application prohibition itself is
[architecture-rules.md](architecture-rules.md) §1 *One web application*.

---

## 1. Squad, Team, And Participant Are Three Different Things

This is the naming boundary most likely to be got wrong, and getting it wrong produces code
that reads plausibly and means the wrong thing.

| Term | What it is | Where the name appears |
|---|---|---|
| **Squad** | A league member's entrant vehicle. Owns memberships, creates contest entries, receives owner invitations. | Prisma model, domain types, DTOs, SDK operations |
| **Team** | The user-facing label for that same entity. | UI copy, routes, `features/teams/` |
| **Participant** | What gets *selected into* a squad — a golfer, a driver, an NBA team. Carries a `participantType`. | Prisma model, domain types |

**A Participant can itself be a team**, which is exactly why the domain layer does not call a
squad a "team." There is no `Team` model; `features/teams/` calls `*Squad*` SDK operations
throughout.

So: use **Squad** in anything contract-shaped — schema, domain types, DTOs, mappers, route
names, SDK calls. Use **Team** in anything a user reads. Do not introduce "team" into the
contract layer to match the UI, and do not surface "squad" to users to match the schema.

---

## 2. Role Scopes

The same app serves different pages, actions and navigation by role. The scopes are
**not interchangeable** — a commissioner surface is not a root-admin surface with extra
buttons.

- **Member** — authentication and account, league membership and invitations, squad
  ownership, contest browsing, entry creation and management, draft and selection flows,
  standings, scoring and history, notification and consent settings.
- **Commissioner** — everything a member can do, plus what their league owns: league
  settings and invitation controls, squad and owner administration, contest creation and
  configuration, scoring/aggregation/prize rules, contest monitoring and recalculation.
- **Root admin** — platform operations no league participant can perform: provider and sync
  operations, sport-data curation, and account lifecycle. Deliberately described by purpose
  rather than enumerated, because a surface list goes stale every time a page is added.

### The account / league boundary is hard

[ADR-0004](../docs/adr/0004-team-centric-league-account-scope-boundary.md) draws a line this
file will not restate in full, but which governs every permission decision here:

- **Commissioners never touch a user's account.** Not inactivate, not delete, not password
  reset, not root-admin toggle. Those are the user's own actions or a root admin's.
- **League-role actions live on league surfaces**, not on the user page. Promote, demote and
  remove-owner are team-scoped operations.
- **League membership *is* team ownership in that league.** There is no separate
  "remove from league" operation — removing a user's last team removes their membership.

---

## 3. Source Of Functional Truth

Behavior is defined by the backend contract exported through the generated SDK and types,
plus active use-case narrative in `plans/` and the rules in `rules/`.

Where a contract and an older document disagree, the contract wins for *shape* and the
product documents win for *intent* — and a disagreement between them is a finding to raise,
not something to resolve silently in a component.

---

## 4. Product Alignment

- New pages and workflows map back to a documented use case. If the behavior is not
  documented well enough to build, document it rather than building around a guess.
- When a backend change alters functional behavior, update the affected product rules and
  plan narrative in the same effort.
- The app reflects the current domain model and exported contract. If the contract is wrong,
  fix the contract and regenerate — do not compensate in the UI.
