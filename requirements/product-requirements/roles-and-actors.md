# Roles And Actors

## Root Admin

Stable role definition:
- rare operational operator for provider, timing, and feed-health exceptions

Important constraints:
- does not normally create or release events manually
- does not normally operate live scoring manually
- should be able to use commissioner/member flows directly in league context
  when exceptional intervention is needed
- is the only actor besides a user's own self-service who may act on that
  user's platform account (toggle root admin, reset password,
  inactivate/delete account)

## Commissioner

Stable role definition:
- league-scoped organizer who is also a participating member

Important constraints:
- should not carry a large day-to-day operations burden
- creates contests quickly, usually from defaults
- uses the same team and entry tools as members
- may use those tools across league teams when administrative intervention is
  needed
- never touches a user's platform account (profile, password,
  inactivate/delete, root-admin toggle) — commissioner authority is strictly
  league-scoped
- role changes for a user within a league (promote to commissioner, demote to
  member, remove as team owner) are actions on that user's team relationship,
  not on their account — see `domain-concepts.md`'s League Membership
  invariant

## Member / Team Owner

Stable role definition:
- participant acting through a team within a league

Important constraints:
- entries are always team-scoped
- members create and edit entries until contest lock
- member experience should not depend on manual commissioner/admin release
  steps after contest creation
- account lifecycle (profile, preferences, password, inactivate/delete) is
  entirely self-service; no commissioner or other member can act on it

## System

Stable role definition:
- automation layer responsible for imports, timing resolution, live updates,
  scoring propagation, and other recurring background work
