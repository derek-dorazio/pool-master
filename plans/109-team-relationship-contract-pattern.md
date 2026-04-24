# Plan 109: Team Relationship Contract Pattern

**Beads epic:** `pool-master-083` — see `bd show pool-master-083` for live slice state. This plan is the narrative companion; task tracking lives in Beads.

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

The original authority-contract design assumed no persistence schema change was
required. During later `/manage/teams` refinement we confirmed one important
drift item that should be corrected before this pattern propagates further:

- Team currently uses `status: ACTIVE | INACTIVE`
- League and User use `isActive: boolean`

That drift is now considered a **required backend refactor** for the Team lane,
not a nice-to-have cleanup.

### Required backend normalization

Before more Team-scoped admin/list contract work lands, normalize Team lifecycle
to the same active/inactive shape used by League and User:

- Prisma model: `Squad.status` -> `Squad.isActive`
- shared domain model: remove Team lifecycle `status` in favor of `isActive`
- Team DTOs: expose `isActive`, not Team lifecycle `status`
- mappers/services/routes/tests: consume `isActive`
- migration script: map `ACTIVE` -> `true`, `INACTIVE` -> `false`

This refactor should happen in the same backend/model slice that finalizes the
admin Team search contract so `/manage/teams` does not spread the old Team
`status` naming into new grid/list contracts.

### Remaining authority-contract work

Beyond that required lifecycle normalization, this plan remains primarily:

- DTO contract work
- mapper updates
- authorization behavior updates
- OpenAPI/generated client refresh
- frontend authority-hook cleanup
- tests/docs

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

4. **Should Team keep lifecycle `status` while League/User use `isActive`?**
   - No.
   - Normalize Team lifecycle to `isActive` before the `/manage/teams`
     contract/UI spreads the old naming further.
   - Migration should map `ACTIVE` to `true` and `INACTIVE` to `false`.

No additional product questions are required before drafting implementation
slices.

## Deferred Work

- Decide whether contest-entry DTOs also need their own additive
  relationship shape or can truthfully compose from Team context alone.
- Decide whether the same pattern should later extend to other requester-scoped
  surfaces beyond Team and League.
- Revisit `memberType` enum expansion only if PoolMaster introduces true
  non-owner Team participation semantics.
