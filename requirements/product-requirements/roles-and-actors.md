# Roles And Actors

## Root Admin

Stable role definition:
- rare operational operator for provider, timing, and feed-health exceptions

Important constraints:
- does not normally create or release events manually
- does not normally operate live scoring manually
- should be able to use commissioner/member flows directly in league context
  when exceptional intervention is needed

## Commissioner

Stable role definition:
- league-scoped organizer who is also a participating member

Important constraints:
- should not carry a large day-to-day operations burden
- creates contests quickly, usually from defaults
- uses the same team and entry tools as members
- may use those tools across league teams when administrative intervention is
  needed

## Member / Team Owner

Stable role definition:
- participant acting through a team within a league

Important constraints:
- entries are always team-scoped
- members create and edit entries until contest lock
- member experience should not depend on manual commissioner/admin release
  steps after contest creation

## System

Stable role definition:
- automation layer responsible for imports, timing resolution, live updates,
  scoring propagation, and other recurring background work
