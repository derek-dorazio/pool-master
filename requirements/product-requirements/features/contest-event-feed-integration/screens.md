# Contest Event Feed Integration Screens

## Root Admin Event Operations

Purpose:
- allow root admins to synchronize and monitor event/feed readiness

Primary actions:
- choose sport/provider
- trigger `Sync events now`
- sync or refresh an event
- inspect event readiness and sync outcome

Major states:
- no provider configured
- sync available
- sync in progress
- event imported but not contest-ready
- event contest-eligible
- sync failed / needs attention

Notes:
- this can remain a direct guarded `/manage` route without menu wiring in first
  pass
- the first-pass manual sync should prepare contest-ready event data, not only
  start a shallow schedule sync

## Commissioner Contest Create / Configure

Purpose:
- create a contest from an eligible event and configure the contest rules

Primary actions:
- choose event
- choose seeded template
- optionally open advanced configuration
- review derived contest-field behavior
- create contest

Major states:
- no eligible events available
- default template preselected
- configuration invalid
- ready to create
- created / entry-open

Notes:
- when no imported events are currently eligible, show a truthful empty state
  that explains there is no currently available event for contest setup yet

## Team Contest Entry Surfaces

Purpose:
- let users create and manage entries in team context

Entry points:
- league home
- contest detail
- team home

Primary actions:
- create entry
- rename entry
- edit selections

Major states:
- no entries yet
- one or more open entries
- entry locked
- participant unavailable / invalid selection state

## Tiered Golf Entry Selection

Purpose:
- let users build or edit an entry for a tiered golf contest

Actor visibility / permissions:
- team owners/members
- commissioners when acting with league-scoped authority

Primary actions:
- review tier groups
- select one golfer within each tier
- enter winner-score tiebreaker
- save entry changes

Major states:
- empty selection
- partially complete selection
- valid complete selection
- invalid tier allocation
- locked/read-only entry

Notes:
- first-pass selection UI should be tier-first, not salary-budget-first
- other contest types may require different entry-selection surfaces later
- tiers may use collapsible containers for faster sequential completion
- completed tier selection may collapse and advance focus to the next tier
- default participant ordering should follow contest rank derived from
  tournament-winning odds
- supporting fields such as world rank may be shown for context
- once locked, this surface should read more like a team-scoped leaderboard
  detail view of the entry than an editable form

## Live Leaderboard

Purpose:
- show live contest standings as the primary event-facing member view

Actor visibility / permissions:
- members
- commissioners
- root admin only when entering normal league/member context

Primary actions:
- toggle detail visibility
- view contest rules
- inspect ordered standings

Major states:
- concise leaderboard with entries/teams and total score
- expanded leaderboard with participant rows and participant scores
- no live updates yet / pre-scoring state
- live updates in progress
- final standings

Notes:
- hiding details should hide participant rows only
- ranking order remains winner-to-loser in both concise and expanded modes

## League Contest History

Purpose:
- let league members browse completed contests

Actor visibility / permissions:
- members
- commissioners
- root admin only when entering normal league/member context

Primary actions:
- browse completed contests
- filter or group by sport
- filter or group by contest type
- open a completed contest

Major states:
- no completed contests yet
- completed contest list
- filtered history view
- completed contest detail/final leaderboard

Notes:
- first-pass history is contest-centric
- broader summary statistics such as streaks or aggregate win counts are later
  additions
