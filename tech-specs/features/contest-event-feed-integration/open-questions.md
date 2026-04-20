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

- `CEFI-000`
  - The first complete user-facing loop is:
    imported event -> commissioner creates contest -> team creates/edits
    entries and selections.
  - Scoring/results propagation is a backend automation flow, not a normal
    commissioner/member/admin interaction flow.

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

- `CEFI-018`
  - The first member-visible live-event presentation is the leaderboard.
  - Default view emphasizes entries/teams and total score.
  - Expanded view reveals participant-level scoring rows.
  - Contest rules should be accessible from leaderboard context.

- `CEFI-017`
  - First-pass history should expose completed contests by sport and contest
    type within a league.
  - Broader historical summaries are deferred.

- `CEFI-019`
  - First-pass tiered golf entry selection should be group/tier-driven with:
    - one saved participant per required tier/group
    - contest ordering derived from tournament-winning odds
    - supporting world-rank display
    - winner-score tiebreaker input
    - read-only post-lock entry detail

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

- `CEFI-020`
  - Sync-run visibility should use a dedicated lightweight `ProviderSyncRun`
    table/read model with a JSON payload column for first-pass provider-specific
    details.

- `CEFI-021`
  - Leaderboard/history materialization optimization is deferred.
  - First pass may use non-materialized read paths while the UI/behavior is
    being validated.
  - Persisted/cached read-model optimization should be treated as a later
    enhancement feature.

## Current Recommendation

Start with:

- provider-discovered event sync
- explicit readiness states
- first-class seeded contest-template model
- derived contest-field projection
- released-contest frozen field projection
- no extra intermediate release action in the normal commissioner flow
- automatic provider polling and scoring propagation with no normal manual user
  step
- entry-selection persistence aligned to frozen contest selection groups
- leaderboard/history read contracts as explicit first-pass surfaces
- thin sync-run visibility plus a manual sport-sync trigger for operations
- mock-provider evolution around golf-first tournament data

Then split implementation into parallel slices once those contracts are settled.

## Deferred Enhancement Notes

- Materialized or cached leaderboard/history projections are intentionally
  deferred until first-pass UI, scoring behavior, and completion/history flows
  are working cleanly.
