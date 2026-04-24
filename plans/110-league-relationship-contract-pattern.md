# Plan 110: League Relationship Contract Pattern

**Beads epic:** `pool-master-lz9` — see `bd show pool-master-lz9` for live slice state. This plan is the narrative companion; task tracking lives in Beads.

## Purpose

Create the dedicated design and execution plan for applying the new
requester-scoped relationship contract pattern to league-scoped PoolMaster
surfaces.

This plan exists to capture the league-side decisions we locked during the
relationship-model review so the implementation lane does not depend on chat
memory alone.

## Summary

League surfaces need a truthful contract split between:

- requester-relative relationship to the target league
- global platform override status

The old shape is too ambiguous because league DTOs currently expose `role`,
which encourages two different misuses:

- treating descriptive membership state as permission truth
- faking commissioner semantics for non-member root admins

The new league contract should expose:

- `leagueRelationship`
- `isRootAdmin`

and frontend/backend access checks should derive from those fields rather than
from descriptive membership role alone.

## Locked Decisions

### 1. League relationship uses `leagueRelationship`

All league-page access checks, control visibility, action enablement, and
route truth should derive from:

- `leagueRelationship`
- `isRootAdmin`

This is relationship data, not a generic permission matrix.

### 2. League still keeps a descriptive `memberType`

Unlike Team, League does have a meaningful descriptive requester state beyond
simple yes/no ownership.

So league keeps:

- `memberType`

where `memberType` is descriptive-only context for the requester’s actual
league membership type.

### 3. League `memberType` values are:

- `COMMISSIONER`
- `MEMBER`
- `null` for non-members

`memberType` must not be used for access checks.

### 4. League `leagueRelationship` flags are:

- `leagueMember`
- `commissioner`

These are requester-scoped booleans relative to the target league.

### 5. `isRootAdmin` stays separate

`isRootAdmin` remains a separate global platform flag because it is not a
league-relative relationship.

### 6. `leagueRelationship` is required

All league summary/detail responses used by authenticated league surfaces
should emit `leagueRelationship` as a required field.

### 7. `memberType` is explicit for non-members

For non-members, `memberType` should be `null`, not omitted.

## Contract Model

### From

Today league responses effectively expose:

- `role`

That is not enough once root-admin non-members can truthfully operate on league
surfaces.

### To

League responses used by league-scoped surfaces should expose:

- `memberType`
- `leagueRelationship`
- `isRootAdmin`

Meaning:

- `memberType` answers:
  - "what is the requester’s actual membership type in this league, if any?"
- `leagueRelationship` answers:
  - "what is the requester’s relationship to this league?"
- `isRootAdmin` answers:
  - "does the requester have the global platform override?"

## Proposed DTO Shape

```ts
export const LeagueRelationshipDtoSchema = z.object({
  leagueMember: z.boolean().describe(
    'Whether the current requester is an active member of this league.'
  ),
  commissioner: z.boolean().describe(
    'Whether the current requester is an active commissioner of this league.'
  ),
}).describe(
  'Requester-scoped relationship to the target league. This is relationship context, not a generic permission matrix.'
);
```

League summary/detail extension:

```ts
memberType: z.enum(['COMMISSIONER', 'MEMBER']).nullable().describe(
  'Describes the requester’s actual league membership type when they are a member. This field is descriptive only and must not be used for authorization checks.'
),
leagueRelationship: LeagueRelationshipDtoSchema,
isRootAdmin: z.boolean().describe(
  'Whether the current requester has platform-level root-admin authority. This is global platform state, not league relationship data.'
),
```

## Truthful Examples

### 1. Member

```json
{
  "memberType": "MEMBER",
  "leagueRelationship": {
    "leagueMember": true,
    "commissioner": false
  },
  "isRootAdmin": false
}
```

### 2. Commissioner

```json
{
  "memberType": "COMMISSIONER",
  "leagueRelationship": {
    "leagueMember": true,
    "commissioner": true
  },
  "isRootAdmin": false
}
```

### 3. Root admin who is not a league member

```json
{
  "memberType": null,
  "leagueRelationship": {
    "leagueMember": false,
    "commissioner": false
  },
  "isRootAdmin": true
}
```

## Backend Behavior Implications

### 1. Root-admin league authority must become backend truth

If root admins can view/manage league surfaces without membership, backend
authorization must support that explicitly.

### 2. League authorization should stop relying on `memberType`

Permission hooks/services should evaluate:

- league membership
- league commissioner status
- root-admin override

without using descriptive `memberType` as the access-control source.

## Frontend Behavior Implications

### 1. `useLeagueAuthority` should read contract truth

`useLeagueAuthority` should derive from:

- `leagueRelationship`
- `isRootAdmin`

rather than from mixed `role` + global auth inference.

### 2. Comments must prevent future misuse

Required comment intent:

- `leagueRelationship` is requester-relative relationship context, not a
  generic permission matrix
- `memberType` is descriptive only
- `isRootAdmin` is global platform state, not league relationship data

## Data Model Changes

No persistence schema change is required purely for this relationship-contract
pattern.

This is primarily:

- DTO contract work
- mapper updates
- authorization behavior updates
- OpenAPI/generated client refresh
- frontend authority-hook cleanup
- tests/docs

## Non-Obvious Questions Now Locked

1. **Should league use relationship data instead of role for access checks?**
   - Yes.
   - `leagueRelationship` plus `isRootAdmin` is the contract truth.

2. **Should league keep a descriptive membership field?**
   - Yes.
   - `memberType` remains useful on league surfaces and is not redundant.

3. **Should `leagueMember` be spelled out instead of plain `member`?**
   - Yes.
   - The extra verbosity keeps naming consistent across League, Team, and
     Team-owned resources.

