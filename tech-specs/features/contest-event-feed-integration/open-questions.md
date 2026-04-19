# Contest Event Feed Integration Technical Open Questions

## Resolved

- `CEFI-001`
  - Events are provider-discovered/imported only.
  - PoolMaster operational control uses event-level `releaseAt` and
    `fieldLocksAt`.

- `CEFI-002`
  - Commissioner contest creation may begin as soon as the event exists.
  - Entry creation/editing may happen before the field is locked, up to contest
    lock.

- `CEFI-003`
  - There is no separate intermediate commissioner release state in the normal
    flow.
  - Contest creation itself makes the contest immediately entry-ready.

- `CEFI-004`
  - Released contests freeze their derived contest-field attributes at release.

- `CEFI-006`
  - Pre-lock participant withdrawal/injury statuses are informational; existing
    entries do not auto-change.

## Blocking

- `CEFI-005`
  - Confirm the first-pass technical shape for template-first contest creation:
    - first-class persisted seeded template model
    - contest instance copy on create
    - schema metadata support for advanced UI

## Non-Blocking

- `CEFI-007`
  - Should mock-provider live progression be modeled as explicit update streams,
    scenario stages, or both?

- `CEFI-009`
  - Which sport-specific participant-matching heuristics stay acceptable before
    a stronger mapping workflow is required?

## Current Recommendation

Start with:

- provider-discovered event sync
- explicit readiness states
- first-class seeded contest-template model
- derived contest-field projection
- released-contest frozen field projection
- no extra intermediate release action in the normal commissioner flow
- mock-provider evolution around golf-first tournament data

Then split implementation into parallel slices once those contracts are settled.
