# Contest Event Feed Integration Open Questions

These question IDs are intended to stay stable as the discussion evolves.

## Resolved Decisions

- `CEFI-001` Event creation authority `(Resolved)`
  - Events are provider-discovered/imported only.
  - Root admin does not manually create event shells or stubs.
  - Root admin controls PoolMaster operational timing through event-level
    `releaseAt` and `fieldLocksAt` datetimes.

- `CEFI-002` Contest eligibility readiness `(Resolved)`
  - Commissioners may create/configure contests as soon as the event exists.
  - Members may create and edit entries before the field is locked.
  - Field lock is not a prerequisite for contest creation or entry creation.

- `CEFI-003` Contest release readiness `(Resolved)`
  - There is no separate intermediate release state in the normal commissioner
    flow.
  - Once the commissioner completes setup and creates the contest, it is
    immediately live and ready for entries.

- `CEFI-004` Contest field freeze boundary `(Resolved)`
  - Once a contest is released, its derived contest field freezes.
  - That freeze includes derived tiers, prices, ordering/rank, and category
    interpretation for that contest.
  - Later provider/event updates may still affect unreleased or newly created
    contests, but not released contests.

- `CEFI-006` Pre-lock participant withdrawal handling `(Resolved)`
  - Existing entries keep their selections if a participant withdraws before
    contest lock.
  - Participant status is shown as informational.
  - Members may replace the selection before lock, but PoolMaster does not
    auto-rewrite entries.

## Blocking Questions

- `CEFI-005` Commissioner override scope
  - Which derived contest-field behaviors may commissioners override before
    release?

## Non-Blocking Questions

- `CEFI-007` Mock provider time progression
  - Should the first-pass mock provider support scripted live progression over
    time, or only named snapshots and update collections?

- `CEFI-008` Event operations UX depth
  - How much operational detail should the first-pass root-admin event screen
    expose versus keeping it as a compact sync/readiness panel?

- `CEFI-009` Future-sport normalization guardrails
  - Which participant-matching heuristics are acceptable by sport family before
    we need a more formal mapping system?

- `CEFI-010` Template metadata source
  - Which seeded metadata must each contest template carry for the normal create
    flow?
  - Current expected set:
    - name
    - description
    - sortOrder
    - isDefault

## Current Recommendations

- `CEFI-R1` Treat provider/imported events as the only event source of truth.
- `CEFI-R2` Resolve global sport or sport+contest-style timing rules into
  event-level `releaseAt` and `fieldLocksAt` datetimes.
- `CEFI-R3` Keep the event field canonical at `SportEventParticipant` and use a
  released-contest frozen field projection when needed to preserve contest
  validity.
- `CEFI-R4` Treat the mock provider as durable non-production infrastructure,
  not as application fallback behavior.
- `CEFI-R5` Add a first-class seeded contest-template model, but defer any
  template-management UI/API.
