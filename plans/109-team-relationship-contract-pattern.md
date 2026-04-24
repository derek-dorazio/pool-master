## Purpose

Create the dedicated design and execution plan for applying the new
requester-scoped relationship contract pattern to team-scoped PoolMaster
surfaces.

This plan exists because the older team/ownership plans already define
truthful Team behavior, ownership semantics, and lifecycle rules, but they do
not yet define the new requester-scoped relationship contract we want on Team
surfaces:

- target-relative relationship state uses `teamRelationship`
- global platform override uses `isRootAdmin`
- access checks and UI gating derive from `teamRelationship` plus
  `isRootAdmin`

This plan is the durable handoff for the later backend + frontend execution
lane. It is not the implementation slice itself.

## Relationship To Existing Plans

- [95-team-identity-and-ownership-execution.md](./95-team-identity-and-ownership-execution.md)
  remains the source for truthful Team identity, ownership, invite, and
  lifecycle semantics.
- [107-webapp-navigation-reorganization.md](./107-webapp-navigation-reorganization.md)
  remains the source for where team-scoped actions live in the IA:
  - Team Home
  - Teams and Owners
  - My Entries
- [108-manage-hub-decomposition.md](./108-manage-hub-decomposition.md)
  remains the source for root-admin `/manage` decomposition.

This plan adds the **contract truth layer** for team-scoped requester
authority. It should not redefine the product semantics already locked in the
 plans above.

## Summary

The current Team contract is still too implicit:

- `SquadDto` only exposes members and lifecycle state
- frontend authority is still inferred from mixed league membership +
  ownership context
- root-admin parity on team surfaces is partly a frontend assumption rather
  than a first-class backend-emitted truth

The new team contract should mirror the league **relationship** pattern we just
locked:

- `teamRelationship` describes who the requester is relative to the Team
- `isRootAdmin` remains a separate global platform flag
- TypeScript/Zod comments must explicitly warn future agents not to use
  relationship data as a generic permission matrix

## Locked Decisions

### 1. Team-scoped relationship uses `teamRelationship`

All Team-page access checks, control visibility, action enablement, and route
truth should derive from:

- `teamRelationship`
- `isRootAdmin`

This is relationship data, not a generic permissions list.

### 2. Team does not need a separate descriptive membership-type field yet

Unlike League, Team does not currently have a meaningful descriptive requester
state beyond "is an owner" or "is not an owner."

That means a first-pass Team `memberType` or `ownerType` field would be
redundant with `teamRelationship.owner` and would invite accidental misuse.

So the locked direction is:

- **do not add** Team `memberType`
- **do not add** Team `ownerType`
- rely on `teamRelationship` plus `isRootAdmin`

If PoolMaster later introduces richer Team participation semantics than
ownership, a descriptive Team field can be added in a future additive slice.

### 3. First-pass Team `teamRelationship` flags are:

- `leagueMember`
- `owner`
- `commissioner`

These are requester-scoped booleans relative to the target Team.

`isRootAdmin` stays separate because it is a global platform flag, not a
Team-relative relationship.

### 4. `teamRelationship` is required

All Team summary/detail responses used by authenticated Team surfaces should
emit `teamRelationship` as a required field.

Do not make frontend consumers fall back to mixed interpretation paths.

### 5. Scope includes Team-derived entry-management authority

This pattern should cover Team-owned entry workflows when the authority
question is:

- "can this requester act on this Team's entries?"

Examples:

- My Entries create/rename actions when they are Team-derived
- Team-owned entry-management affordances
- Team Home → My Entries handoff rules when authority depends on Team context

### 6. Scope does not automatically include contest-wide read-only visibility

Contest-wide read-only visibility, leaderboard exposure, and public contest row
behavior remain separate unless a later plan explicitly folds them into the
same authority model.

This plan is not redefining contest-wide read rules.

## Contract Model

### From

Today Team authority is implicit and scattered:

- Team DTOs expose owners/members but no requester-scoped authority signal
- frontend computes authority from a mix of:
  - league commissioner role
  - whether the user appears in the Team owners list
  - global root-admin state
- root-admin Team parity is partly a UI convention instead of a backend-emitted
  contract truth

### To

Team responses used by Team-scoped surfaces should expose:

- `teamRelationship`
- `isRootAdmin`

Meaning:

- `teamRelationship` answers:
  - "who is the requester relative to this Team?"
- `isRootAdmin` answers:
  - "does the requester have the global platform override?"

## Proposed DTO Shape

### Team requester-scoped authority

```ts
export const TeamRelationshipDtoSchema = z.object({
  leagueMember: z.boolean().describe(
    'Whether the current requester is an active member of the Team’s parent league.'
  ),
  owner: z.boolean().describe(
    'Whether the current requester is an active owner of this Team.'
  ),
  commissioner: z.boolean().describe(
    'Whether the current requester has commissioner authority in the Team’s parent league.'
  ),
}).describe(
  'Requester-scoped relationship to the target Team. This is relative relationship context, not a generic permission matrix.'
);
```

### Team summary/detail extension

```ts
teamRelationship: TeamRelationshipDtoSchema,
isRootAdmin: z.boolean().describe(
  'Whether the current requester has platform-level root-admin authority. This is global platform state, not Team relationship data.'
),
```

## Truthful Examples

### 1. Team owner, not commissioner, not root admin

```json
{
  "teamRelationship": {
    "leagueMember": true,
    "owner": true,
    "commissioner": false
  },
  "isRootAdmin": false
}
```

### 2. Commissioner viewing a Team they do not own

```json
{
  "teamRelationship": {
    "leagueMember": true,
    "owner": false,
    "commissioner": true
  },
  "isRootAdmin": false
}
```

### 3. Root admin viewing a Team they do not own and in whose league they are
not a member

```json
{
  "teamRelationship": {
    "leagueMember": false,
    "owner": false,
    "commissioner": false
  },
  "isRootAdmin": true
}
```

### 4. Commissioner who is also an owner of this Team

```json
{
  "teamRelationship": {
    "leagueMember": true,
    "owner": true,
    "commissioner": true
  },
  "isRootAdmin": false
}
```

## Team Surfaces Covered By This Pattern

### In scope

- Team Home authority and lifecycle controls
- Teams and Owners per-owner actions
- owner/co-owner invitation management
- Remove Owner / Promote to Commissioner / Demote to Member actions where the
  Team surface hosts them
- Inactivate Team / Delete Team surface gating
- Team-derived entry-management actions where authority is derived from the
  Team context

### Explicitly not automatic scope

- contest-wide read-only row visibility
- leaderboard visibility rules
- non-self contest row clickability

Those rules may depend on contest state rather than Team authority and should
remain separate unless explicitly unified later.

## Backend Behavior Implications

### 1. Root-admin Team authority must become backend truth

If Team surfaces allow root-admin actions, backend authorization must support
that explicitly.

Do not leave root-admin Team authority as a frontend-only assumption.

### 2. Team authorization should use relationship truth, not inferred local checks

Permission hooks/services should evaluate:

- league membership
- Team ownership
- league commissioner authority
- root-admin override

without inventing redundant descriptive Team membership fields.

### 3. Team-derived entry-management may need additive contract work

If a Team-derived entry surface cannot truthfully infer requester authority
from the Team response already loaded on the page, add an explicit contract
field rather than relying on frontend guesswork.

That follow-on should remain additive and should reuse the same naming model:

- resource-relative `*Relationship`
- separate `isRootAdmin`

## Frontend Behavior Implications

### 1. `useTeamAuthority` should read contract truth

`useTeamAuthority` should stop being a purely inferred helper over mixed local
signals and should instead derive from backend-emitted Team relationship truth
plus `isRootAdmin`.

### 2. Team surface gating should migrate away from ad hoc ownership checks

Examples of fragile patterns to retire:

- `members.some((member) => member.userId === auth.userId)`
- `league.role === 'COMMISSIONER'`
- `auth.isRootAdmin` layered directly onto Team UI without Team DTO support

### 3. Comments must be strong enough to prevent misuse

Where these types are introduced, add explicit comments in both:

- Zod `.describe(...)`
- nearby TypeScript type declarations when present

Required comment intent:

- `teamRelationship` is requester-relative relationship context, not a generic
  permission matrix
- `isRootAdmin` is a global platform flag, not Team relationship data
- `teamRelationship.commissioner` may be true only when
  `teamRelationship.leagueMember` is also true
- Team intentionally has no separate descriptive `memberType` field in the
  first pass because ownership is already expressed by
  `teamRelationship.owner`

## Data Model Changes

No persistence schema change is required purely for this authority-contract
pattern.

This is primarily:

- DTO contract work
- mapper updates
- authorization behavior updates
- OpenAPI/generated client refresh
- frontend authority-hook cleanup
- tests/docs

If implementation uncovers a real persistence-model gap, that should be
handled as a separate additive model slice rather than being smuggled into the
authority-plan assumptions.

## Non-Obvious Questions Now Locked

These were the only non-obvious modeling questions worth explicitly locking in
this plan:

1. **Should Team follow the same requester-scoped relationship direction as league?**
   - Yes.
   - `teamRelationship` = relationship truth for Team surfaces
   - `isRootAdmin` remains separate as global platform state
   - unlike League, Team does not currently need a separate descriptive
     membership-type field

2. **Should Team authority stay hook-inferred on the frontend?**
   - No.
   - The hook should become a consumer of backend-emitted authority truth.

3. **Does Team scope include entries?**
   - Yes, when the authority question is Team-derived.
   - No, not automatically for all contest-wide read-only behavior.

No additional product questions are required before drafting implementation
slices.

## Deferred Work

- Decide whether contest-entry DTOs also need their own additive
  relationship shape or can truthfully compose from Team context alone.
- Decide whether the same pattern should later extend to other requester-scoped
  surfaces beyond Team and League.
- Revisit `memberType` enum expansion only if PoolMaster introduces true
  non-owner Team participation semantics.

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 109-001 | 1 | Lock the Team authority contract design and naming | Done | This plan locks Team `teamRelationship` plus separate `isRootAdmin` as the Team contract truth, intentionally omits a redundant Team `memberType`/`ownerType` field in the first pass, and uses `leagueMember/owner/commissioner` as the initial Team relationship flags. |
| 109-002 | 1 | Audit current Team DTOs, mappers, and permission hooks against the locked model | Done | Audited `SquadDto`, squad mapper output, squad service permission helpers, Team Home, Teams and Owners, and squad owner-invitation flows to identify the remaining implicit root-admin/owner/commissioner checks. |
| 109-003 | 2 | Add Team `teamRelationship` + `isRootAdmin` DTOs, mapper output, and OpenAPI/client refresh | Done | Added `TeamRelationshipDtoSchema` to `packages/shared/dto/squads.dto.ts`, extended `SquadDto`, updated the squad mapper, refreshed `packages/shared/generated/openapi.json`, and regenerated the Hey API client types/sdk. |
| 109-004 | 2 | Patch backend Team authorization to make owner/commissioner/root-admin checks truthful | Done | Squad list/get/update/inactivate/add/remove flows and owner-invitation management now thread root-admin-aware Team viewer context through the backend instead of relying on frontend-only assumptions. |
| 109-005 | 3 | Refactor frontend Team authority consumers to read backend-emitted contract truth | Done | Team Home and Teams and Owners now read `teamRelationship` plus `isRootAdmin` from squad responses instead of recomputing authority from mixed league-role and owner-array heuristics. |
| 109-006 | 3 | Decide and implement the Team-derived entry authority propagation pattern | Done | The first-pass decision is to compose Team-derived entry behavior from the Team response already loaded on the page; no additive entry relationship contract was needed in this slice. |
| 109-007 | 4 | Add unit, contract, functional, and frontend verification for the Team authority pattern | Done | Added root-admin-specific squad and owner-invitation unit coverage, updated Team frontend tests for the new Team contract, refreshed contract verification via the squad DTO schemas, and extended functional API coverage to assert Team relationship truth. |
| 109-008 | 4 | Reconcile Plan 107 references, Beads, and close Team authority drift | Done | Plan 107/108 already pointed at the Team relationship contract. This slice reconciles the Team implementation tracker items so the shipped Team contract matches the narrative plans and Beads state. |
