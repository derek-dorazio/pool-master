# PoolMaster — Webapp Product Rules

**What the app is, and who can do what.** One role-based web application:
`clients/poolmaster`.

React, Vite and TypeScript implementation rules are [react-ui-rules.md](react-ui-rules.md);
this file does not repeat them. The one-application prohibition itself is
[architecture-rules.md](architecture-rules.md) §1 *One web application*.

---

## 1. A Squad Is a Team On Screen

On screen a **Squad** is a **team**: "My team", "Your team", "Edit team", "Create your team",
a "Team" column. A specific team is still shown by its own name ("Derek's Great Golf Guys"),
and the viewer's own team is "My team" wherever the screen names it in general — the league
menu's tab is that fixed label, never the team's name, so it reads the same for every member.
Copy says "team" plainly rather than talking around it ("the name you play under", "choose
your name in this league"). Picking is always for a contest entry, never for a team: "Pick 8
golfers for your entry", "Derek's Great Golf Guys picked Duke".

**Squad is never shown.** It is the contract word: use it in anything contract-shaped — schema,
domain types, DTOs, mappers, route names, SDK calls — and never introduce "team" into the
contract layer (`domain-model-conventions-rules.md` §12 *Squad, never team, in the contract
layer*). `features/teams/` is the screen side and calls `*Squad*` SDK operations throughout.

**A sport's teams share the word.** A basketball or football participant (Duke, the Chiefs) is
shown by its name; where copy needs a generic word for one, the sport vocabulary's word
("team") stays when the sentence can only mean a sport team — one picked, playing a game,
scoring or covering a spread. Where a sentence could be read as either kind of team, reword
it: name the sport's teams by what they are in that sentence (the field, the picks, both
sides) rather than leave "team" to mean two things on one screen.

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
  "remove from league" operation — `domain-model-concepts.md` §3 *League Membership Is Squad
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
