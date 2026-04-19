# Contest Event Feed Integration Screens

## Root Admin Event Operations

Purpose:
- allow root admins to synchronize and monitor event/feed readiness

Primary actions:
- choose sport/provider
- sync or refresh an event
- inspect event readiness and sync outcome

Major states:
- no provider configured
- sync available
- sync in progress
- event imported but not contest-ready
- event contest-eligible
- sync failed / needs attention

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
