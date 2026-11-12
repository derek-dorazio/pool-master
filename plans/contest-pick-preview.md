# Preview picks page while creating a contest (#1612)

Part of the UI cleanup pass (#1538). A commissioner setting up or editing a contest opens
**Preview picks page** beside the form buttons and sees the member pick screen for the setup
as it stands in the form, unsaved: tiers or budget as set, the event's real field or games and
lines, the bracket from its starting round. A ribbon reads "Preview · this is what members pick
from. Nothing is saved." Picks can be tapped to try the feel; nothing is stored.

## Why it needs the server

The pick screens are already presentational after #1579: the roster lineup section draws a
`SelectionStateResponse`, the pick'em week draws a `GamePicksResponse`, and the bracket board
draws the rounds built from one. Both responses are assembled on the server from a saved
contest, a saved entry and its stored picks: tier sizes from `picksPerTier` and `tiersUsed`,
budget lines and the lineup summary, a bracket's later games from the picks before them, pick'em
lines and tie picks from the sport. Building them again in the browser from an unsaved form
would compute the same thing twice, which the codebase does not do.

So the preview asks the server for the same two views, built from the form's rules instead of a
stored contest, and from the picks the commissioner has tapped so far instead of stored ones.
Both endpoints read only: they create no contest, entry or pick, and say so in their contract.

## Shape

- `POST /contests/preview/selection-state` takes the league, the event, the rules
  (`ContestRules`, the union the create form already sends) and the trial picks (field row
  ids). It answers a `SelectionStateResponse` with no entries: the groups as members see them,
  the trial picks marked, and the lineup summary for them. Tiered and budget.
- `POST /contests/preview/game-picks` takes the league, the event, the rules and the trial
  game picks. It answers a `GamePicksResponse` with no entry: the event's games (a bracket's
  from its starting round), lines when picked against the spread, and each later bracket game
  holding the teams the trial picks put there. Pick'em, bracket and survivor.
- Both are POST because the rules and picks are a body; neither writes. Commissioners of the
  league only (root admins bypass), as creating a contest is. Each gets a pinned query-count
  test.
- In the service, the room and the week are assembled today from a context read off a stored
  contest. The change splits that read from the assembly: the stored path reads its context as
  now, the preview path builds the same context from the request, and both hand it to the one
  assembly. No second copy of the rules.

## The web side

- A **Preview picks page** button on Create contest and Edit contest opens a large dialog (full
  screen on a phone) holding the screen for the setup's selection type, in a preview mode:
  no submit bar, no entry name, picks held in the dialog's own state and sent with each read.
- The button is disabled with a (?) saying why while the event's field is not available (not
  released, bracket not set). Random draw (players are dealt, members pick nothing) and squares
  (boxes on one game's grid, not a pick screen) are disabled with that reason. Each type is
  listed in the PR.
- The golf picks look stays exactly as it is.

## Plan gates

The preview checks no plan gate, on purpose. No plan feature gates a format: every plan offers
every selection type. The plan limit that touches contest setup is the number of sport leagues a
league may play each year, and Create contest enforces it when the contest is created. A preview
creates nothing, so it uses up no sport league and has nothing to refuse. If a format is ever
gated by plan, the gate belongs on the form and on contest creation, and the preview should not
be what refuses it.

## Where it lands

The endpoints and the service split change `packages/`, which a UI batch refuses, so they go
to `main` as their own PR first. The dialog and button are web only and go into the UI batch cut
after that, right after #1620.
