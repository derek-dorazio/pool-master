# PoolMaster — Webapp Product Rules

**What the app is, and who can do what.** One role-based web application:
`clients/poolmaster`.

React, Vite and TypeScript implementation rules are [react-ui-rules.md](react-ui-rules.md);
this file does not repeat them. The one-application prohibition itself is
[architecture-rules.md](architecture-rules.md) §1 *One web application*.

---

## 1. A Squad Is Shown By Its Name

Screens never need a word for a **Squad**. A squad is shown by its own name ("Derek's Great
Golf Guys"); copy about the viewer's own squad speaks to the viewer ("You don't have an entry
in this contest yet", a **Yours** chip, "Entries per member"); and picking is always for a
contest entry, never for a squad: "Pick 8 teams for your entry", "Derek's Great Golf Guys
picked Duke".

On screen, **team** then means only a sport participant: the sport vocabulary's word for a
basketball or football participant (Duke, the Chiefs). **Squad** is never shown either; it is
the contract word.

Keep that boundary in both directions: use **Squad** in anything contract-shaped — schema,
domain types, DTOs, mappers, route names, SDK calls — and never introduce "team" into the
contract layer. `features/teams/` predates this rule and calls `*Squad*` SDK operations
throughout.

The entity relationships behind this — and the vocabulary for the rest of the domain — are
[domain-model-concepts.md](domain-model-concepts.md). This file states only the UI-label
rule.

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

This line governs every permission decision here:

- **Commissioners never touch a user's account.** Not inactivate, not delete, not password
  reset, not root-admin toggle. Those are the user's own actions or a root admin's.
- **League-role actions live on league surfaces**, not on the user page. Promote, demote and
  remove-owner sit on Commissioner tools › Members (Manage) and on the viewer's own page. Account
  actions sit on account surfaces only: the user's own on their user page, a root admin's on
  that user's page in Manage (Manage › Users).
- **League membership *is* team ownership in that league.** There is no separate
  "remove from league" operation — `domain-model-concepts.md` §3 *League Membership Is Team
  Ownership*.

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
