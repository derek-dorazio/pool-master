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

- `CEFI-011`
  - Field labels, descriptions, help text, categories, and similar advanced UI
    metadata remain global to the configuration definition/template layer.
  - That UI metadata is not copied into contest instances.

- `CEFI-012`
  - The frozen released-contest field is contest-specific and must be persisted
    per contest.

- `CEFI-013`
  - `ContestConfigTemplate` should be a first-class persisted seeded model with:
    - scope fields (`sport`, `eventType`, `contestType`, `configMode`)
    - template-selection metadata (`name`, `description`, `sortOrder`,
      `isDefault`, `active`)
    - `configJson`
    - `templateKey`
    - `schemaVersion`

- `CEFI-014`
  - Global timing defaults should live in a persisted seeded timing-policy
    source, while `SportEvent.releaseAt` and `SportEvent.fieldLocksAt` remain
    the resolved operational timestamps.

- `CEFI-015`
  - Contest creation should store `templateId` and `templateVersion` on the
    contest instance and copy template values into `ContestConfiguration` before
    applying any advanced overrides.

- `CEFI-016`
  - The frozen released-contest field should use normalized projection tables as
    the primary runtime model, with optional JSON snapshot support only if later
    needed for audit/debug.

## Blocking

- None at the current technical-refinement level. The remaining items are
  implementation tasks and follow-on cleanup, not unresolved core design
  decisions.

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
