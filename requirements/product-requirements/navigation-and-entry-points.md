# Navigation And Entry Points

## Global Level

Above any single league sits the global level: the header league switcher
(dropdown) and the account area. The switcher is the **only** way to move
between leagues — there is no separate "My Leagues" list/grid page. It also
carries `Create league` and `Join league`.

Post-authentication landing is always a league's **League Home**, resolved
from the user's recent/default league (cookie-backed) — never an
intermediate league-picker page. A user with zero leagues is a
transitional/defensive case only (see `roles-and-actors.md` and
`domain-concepts.md`'s League Membership invariant); it lands on a
zero-league fallback page, not on a normal main-journey destination.

The account area is the canonical **User page** (`/users/:myId`),
account-scope only — see `domain-concepts.md`.

## League Context — MY vs LEAGUE

Inside a league, the top nav expresses two distinct scopes:

- **My Team** — scoped to the signed-in user in this league: their team,
  their entries, their history. Editable by default. Landing page is Team
  Home, resolved to the signed-in user's own team.
- **League** — scoped to the whole league: teams, contests, league identity.
  Read-only for members by default; commissioners get inline edit
  affordances on the same pages via an authority hook rather than a separate
  admin page. Landing page is League Home.

Do not mix MY and LEAGUE data on the same page or tile. The edit-authority
boundary ("I can edit my team; I cannot edit others'") is also the scope
boundary — conflating them makes the save/commit model and permissions
harder to reason about.

## Team Context

Team Home is the single canonical page for any team, reached either through
My Team (the signed-in user's own team) or by clicking a team row from the
league's team list. Authority (owner, commissioner, viewer) is resolved on
that one page, not through a separate route — see
`rules/react-ui-rules.md`'s List → Home pattern.

## Contest Context

Contest Home is the same nav destination before and after an event,
rendered differently by contest state (entries list pre-event; leaderboard
post-event) rather than as two separate pages or menu items. This keeps the
menu stable across a contest's lifecycle.

## History Context

League history is contest-centric: browse completed contests by sport and
contest type. A user's own entry history for a league lives under My Team;
the league-wide completed-contest archive lives under League.

## Daily-Use Surfaces vs. Commissioner Admin

Two kinds of surfaces exist inside a league:

- **Daily-use surfaces** — used by members and commissioners alike,
  frequently. Commissioner privilege is expressed inline via an authority
  hook on the same page (Team Home, Contest Home, the league's team list,
  League Home), never by routing to a separate admin page.
- **Commissioner-only admin surfaces** — dedicated pages for tasks that
  would clutter daily-use surfaces: creating a contest, editing a contest's
  mutable configuration. These are visible only to commissioners but live
  inline in the League menu, not in a separate admin sub-cluster, while the
  number of such items stays small (roughly ≤4-5 today). If that grows, a
  dedicated commissioner sub-cluster becomes worth revisiting.

Deciding which bucket a new commissioner-only feature belongs in: a simple
per-entity edit (rename a team, invite a co-owner) is inline-authority-gated
on the existing daily-use page. Complex configuration, a creation flow, or
multi-step setup gets its own dedicated page.

League-level admin content (identity, join code, activate/inactivate, email
invites) lives on League Home itself, authority-gated — there is no separate
"League Settings" page.

## Role Behavior

- root admin should not require a separate day-to-day navigation universe for
  routine product use
- commissioners should use the same team and contest surfaces as members for
  most ongoing play behavior
- specialized admin-only routes should stay focused on exceptional operational
  concerns such as provider or sync issues
- a dedicated direct root-admin route is acceptable for those operational
  concerns even if it is not part of the normal menu structure
