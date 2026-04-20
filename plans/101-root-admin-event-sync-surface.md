# Plan 101: Root Admin Event Sync Surface

## Purpose

Extend the existing PoolMaster root-admin surface so a root admin can manually
trigger sport-level event sync from the webapp when provider-imported event or
participant data has not loaded yet.

This is an exceptional operational tool, not a normal daily workflow. The goal
is to unblock:

- manual testing
- QA/E2E setup
- occasional troubleshooting when the automatic sync path has not populated
  contest-ready event data yet

## Current Starting Point

- The webapp already has a guarded root-admin page component and now exposes it
  through `/manage`.
- That page currently provides thin provider health and sync-run visibility.
- The backend already exposes a manual sport sync endpoint via
  `syncSportData`.
- The current root-admin web surface does not expose that action.

## Design Constraints

- Reuse the existing admin page instead of introducing a second admin UI.
- Keep the surface thin and operational.
- Do not add normal admin-owned contest/event management behavior.
- Root admin still does not manually author events or participant fields.
- No menu wiring is required in first pass.
- Use `/manage` as the direct guarded route so the operational page is not
  exposed behind an obvious `/root-admin` path.

## Target Outcome

Root admins can open `/manage`, trigger `Sync events now` for a
sport such as golf, and then see provider/sync-run feedback refresh on the same
page.

This should let commissioners and testers proceed once imported events and
participants are loaded, without requiring hidden scripts or database
intervention.

## Scope

- `clients/poolmaster/src/features/root-admin/**/*`
- `clients/poolmaster/src/routes/index.tsx`
- root-admin route guard tests if needed
- backend/shared contract verification only if the existing endpoint needs
  contract changes

## Out of Scope

- rich retry/rerun controls for historical sync runs
- manual event authoring
- participant correction/mapping workflow changes
- commissioner-facing sync controls
- menu/navigation polish

## Implementation Phases

### Phase 1: Confirm Existing Contract Reuse

- Verify the existing `syncSportData` endpoint is root-admin-safe for the
  PoolMaster webapp use case.
- Verify the generated client already exposes the operation cleanly enough for
  frontend use.
- Avoid creating a duplicate admin-only sync endpoint unless contract gaps are
  discovered.

### Phase 2: Extend Root Admin Web Surface

- Add a compact `Sync events now` control to the existing admin page.
- Start with explicit sport selection and a first-pass golf-friendly flow.
- Show pending, success, and failure states clearly.
- Refresh provider health and sync-run queries after the mutation completes.

### Phase 3: Route The Existing Admin Page Through `/manage`

- Use `/manage` for the guarded system-admin entry point.
- Do not add menu wiring in first pass.

### Phase 4: Validate Operational Unblock

- Add frontend unit coverage for the new root-admin sync interaction.
- Add or extend root-admin functional/contract coverage only if current tests
  do not already cover the existing backend endpoint sufficiently.
- Confirm the page can be used to unblock contest-ready event loading for
  manual QA.

## Acceptance Criteria

- A root admin can open a direct admin route and manually trigger sport sync
  from the webapp.
- The action uses the real backend sync contract, not a placeholder flow.
- The page refreshes sync-run/provider visibility after the action.
- Non-root-admin users remain blocked from the surface.
- The feature remains clearly exceptional/operational rather than becoming a
  broader admin console.

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 101-001 | 1 | Verify and document reuse of the existing `syncSportData` contract for the root-admin web flow | Done | The existing generated-client contract is reused directly from the PoolMaster webapp |
| 101-002 | 2 | Add a manual `Sync events now` mutation/control to the existing root-admin page | Done | Added sport selection plus manual sync trigger inside the sync-history section |
| 101-003 | 2 | Refresh provider health and sync-run visibility after sync trigger | Done | The page invalidates/refetches the existing root-admin provider and sync-run queries on success |
| 101-004 | 3 | Route the guarded system-admin page through `/manage` | Done | The direct operational route is now `/manage` instead of `/root-admin` |
| 101-005 | 4 | Add focused frontend coverage for the root-admin sync interaction | Done | Component tests cover the sync history table, filters, and manual sync mutation |
| 101-006 | 4 | Validate that the manual sync flow unblocks event data for manual testing and later richer E2E | In Progress | Code path is implemented and locally validated; manual QA against deployed data is still the real proof |
