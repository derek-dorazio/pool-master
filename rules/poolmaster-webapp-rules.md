# PoolMaster — Webapp Product Rules

**What the app is, and who can do what.** One role-based web application:
`clients/poolmaster`.

React, Vite and TypeScript implementation rules are [react-ui-rules.md](react-ui-rules.md);
this file does not repeat them. The one-application prohibition itself is
[architecture-rules.md](architecture-rules.md) §1 *One web application*.

---

## 1. "Team" Is A UI Label, Not A Domain Term

The user-facing name for a **Squad** is **Team**. There is no `Team` model —
`features/teams/` calls `*Squad*` SDK operations throughout.

Keep that boundary in both directions: use **Squad** in anything contract-shaped — schema,
domain types, DTOs, mappers, route names, SDK calls — and **Team** only in what a user
reads. Do not introduce "team" into the contract layer to match the UI, and do not surface
"squad" to users to match the schema.

The reason the domain layer avoids "team" is that the word is overloaded in this product:
a league member's entrant vehicle is called a team in the UI, and an event *participant* may
itself be a team (an NBA team) rather than an individual. Squad disambiguates the first.

The entity relationships behind this — and the vocabulary for the rest of the domain — belong
in [domain-model-conventions-rules.md](domain-model-conventions-rules.md), not here. This
file states only the UI-label rule.

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
