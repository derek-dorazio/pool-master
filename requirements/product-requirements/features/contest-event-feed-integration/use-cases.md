# Contest Event Feed Integration Use Cases

## AE-001: PoolMaster imports a new event from a provider

Actor:
- System

Preconditions:
- a provider is configured and enabled
- the target event exists in the provider source

Trigger:
- a provider import runs or a root-admin retry/refresh is triggered

Main flow:
1. PoolMaster imports the event and participant field.
2. PoolMaster creates or matches normalized participants.
3. PoolMaster resolves `releaseAt` and `fieldLocksAt` from the applicable
   defaults.
4. PoolMaster marks the event with its current readiness state.

Expected outcomes:
- the event becomes visible for contest operations only when the minimum
  readiness requirements are met
- event and field data are traceable to provider imports

## AE-002: Root admin refreshes an imported event

Actor:
- Root Admin

Preconditions:
- the event already exists in PoolMaster

Trigger:
- root admin re-syncs the event manually or an automated refresh runs

Main flow:
1. PoolMaster requests fresh provider data for the event.
2. PoolMaster updates event metadata, field membership, and downstream source
   snapshots.
3. PoolMaster recalculates event readiness and any affected contest-readiness
   projections.
4. PoolMaster honors the event-level `fieldLocksAt` policy when deciding
   whether new field changes should still affect unreleased contests.

Expected outcomes:
- event state stays current without forcing commissioners to recreate contests
- root-admin action remains exceptional rather than routine

## MP-001: Mock provider exposes a golf tournament and its field

Actor:
- Mock Sports Data Provider

Preconditions:
- a named golf scenario exists

Trigger:
- PoolMaster requests event and field data from the provider

Main flow:
1. Provider returns event metadata.
2. Provider returns participant field data for the event.
3. Provider returns odds, ranking, and later result/update snapshots.

Expected outcomes:
- the same provider contract can support local, QA, and deployed non-production
  product usage

## CC-001: Commissioner creates a contest for a synced event

Actor:
- Commissioner

Preconditions:
- the event is contest-eligible
- commissioner belongs to the league

Trigger:
- commissioner starts contest creation from league context

Main flow:
1. Commissioner chooses an eligible event.
2. PoolMaster preselects the default seeded contest template for the sport and
   contest style.
3. Commissioner accepts the default template or chooses another seeded
   template.
4. Commissioner may optionally open advanced configuration to override the
   seeded template values.
5. PoolMaster validates the requested configuration against the event field.
6. PoolMaster creates the contest immediately in an entry-ready state.

Expected outcomes:
- commissioners can begin contest setup as soon as the event exists
- the common path remains quick and template-driven

## CC-002: Commissioner reviews derived contest field behavior during creation

Actor:
- Commissioner

Preconditions:
- commissioner is reviewing the selected template and derived field behavior
  during contest creation

Trigger:
- commissioner opens contest configuration details

Main flow:
1. PoolMaster shows the selected seeded template label and description.
2. PoolMaster shows how the event field will be interpreted for the contest.
3. Commissioner reviews tier/category/price/ranking behavior according to the
   contest mode.
4. Commissioner adjusts allowed advanced configuration inputs only if needed.
5. PoolMaster re-derives the contest field behavior for the pending create
   request.

Expected outcomes:
- commissioners understand the effect of their configuration before teams enter
- most contests can be created without field-by-field manual editing

## CC-003: Commissioner creates a contest that is immediately ready for team entries

Actor:
- Commissioner

Preconditions:
- contest configuration is valid

Trigger:
- commissioner completes contest creation

Main flow:
1. PoolMaster validates the configuration.
2. PoolMaster freezes the contest's derived field interpretation for that new
   contest.
3. PoolMaster creates the contest in an entry-ready state.
4. League members can now create entries for their teams.

Expected outcomes:
- no extra intermediate commissioner release step is required in the normal
  flow
- teams can enter as soon as the contest is created

## TE-001: Team owner creates an entry for an open contest

Actor:
- Team Owner / league member acting in team context

Preconditions:
- an eligible team exists
- contest is open for entries

Trigger:
- user chooses `Create entry` from league, contest, or team context

Main flow:
1. User starts entry creation in the context of their team.
2. PoolMaster creates the entry with a default unique name.
3. PoolMaster returns the user to the contest/team context with the new entry.

Expected outcomes:
- entries always belong to an existing team
- the same flow works for the first entry and later entries

## TE-002: Team owner edits an open entry using the contest field

Actor:
- Team Owner

Preconditions:
- the entry exists
- the contest is still editable/open

Trigger:
- user opens the entry to make selections or rename it

Main flow:
1. PoolMaster shows the contest-ready field for that contest.
2. User selects from the field according to contest rules.
3. PoolMaster validates the selections against the contest field rules.
4. PoolMaster saves the entry changes.

Expected outcomes:
- entries use the contest-derived field, not a generic participant catalog
- already-selected participants remain on the entry unless the member changes
  them, even if their informational status later changes before contest lock

## TE-003: Commissioner uses the same entry tools as a member

Actor:
- Commissioner

Preconditions:
- commissioner has league-scoped authority over the relevant team or contest

Trigger:
- commissioner needs to help with a team, entry, or co-owner administrative
  action

Main flow:
1. Commissioner opens the same team or contest context used by members.
2. PoolMaster applies the same entry/team tools with broader league-scoped
   authority.
3. Commissioner completes the needed administrative action without switching to
   a separate high-friction operational flow.

Expected outcomes:
- commissioner support actions reuse the same core participation tools
- the product avoids unnecessary parallel commissioner-only workflows

## AS-001: Event updates automatically affect scoring and leaderboards

Actor:
- System

Preconditions:
- the contest is tied to an imported event

Trigger:
- a provider sync updates the event or participant field

Main flow:
1. PoolMaster polls the provider for event updates on a scheduled cadence.
2. PoolMaster updates event and event-participant data.
3. PoolMaster identifies impacted contests and entries.
4. PoolMaster recalculates entry scores and refreshes leaderboard order.

Expected outcomes:
- scoring and standings update automatically from provider data
- there is no normal commissioner/member/admin interaction required for live
  scoring updates
- admin involvement, if needed later, is limited to operational reruns or feed
  repair
