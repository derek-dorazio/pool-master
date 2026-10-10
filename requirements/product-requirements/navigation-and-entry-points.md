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

## League Context — the league menu

Inside a league, one menu under the app bar serves every member: **Home**,
**Contests**, **My team** and **Teams**. Home is the landing page. My team is
scoped to the signed-in user (their team, their entries, their history);
Home, Contests and Teams are scoped to the whole league and are read-only for
members.

Do not mix MY and LEAGUE data in the same section. The edit-authority boundary
("I can edit my team; I cannot edit others'") is also the scope boundary —
conflating them makes the save/commit model and permissions harder to reason
about. League Home is a summary page and may show a card for each, linking to
the page that owns it.

## Team Context

My team is the signed-in user's own team, and the only member page where a
team can be changed: Edit team (name and icon on one page), its owners, and
Leave league. Every other team has a read-only page, reached from a row of the
league's Teams directory; a link to the viewer's own team opens My team.
Commissioners manage any team from Commissioner tools › Teams › Manage team,
never from the member pages.

## Contest Context

Contest Home is the same nav destination before and after an event,
rendered differently by contest state (entries list pre-event; leaderboard
post-event) rather than as two separate pages or menu items. This keeps the
menu stable across a contest's lifecycle.

## History Context

League history is contest-centric: browse completed contests by sport and
contest type. A user's own entry history for a league lives under My Team;
the league-wide completed-contest archive lives under League.

## Member Pages vs. Commissioner Tools

A commissioner acts as a member most of the time, so the two are kept apart:

- **Member pages** — the league menu above. No commissioner-only control
  appears on them; a commissioner sees exactly what a member sees there.
- **Commissioner tools** — a separate area, opened from a button at the end of
  the league menu that only commissioners (and root admins looking at the
  league) see. It has its own header, a way back to the league, and a side menu
  of tools: league settings (identity, description, lifecycle), and over time
  teams and owners, invites, and contest setup.

Every function in either area is a full page with its own address, so Back and
links work. Dialogs are only for confirming a destructive or irreversible
action. The layout rules behind this are `rules/ux-rules.md` §12 *League Pages
and Commissioner Tools*.

## Role Behavior

- root admin should not require a separate day-to-day navigation universe for
  routine product use
- commissioners should use the same team and contest surfaces as members for
  most ongoing play behavior
- specialized admin-only routes should stay focused on exceptional operational
  concerns such as provider or sync issues
- a dedicated direct root-admin route is acceptable for those operational
  concerns even if it is not part of the normal menu structure
