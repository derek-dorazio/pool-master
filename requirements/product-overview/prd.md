# PRD

## Product Goal

Build a sports contest platform that feels fun, lightweight, and largely
self-operating. PoolMaster should use real-world sports data to create events,
derive contest opportunities, support fast commissioner setup, enable rich team
entry participation, and update scoring/leaderboards automatically as live data
changes.

## Core Product Principles

- `PRD-001` Real-world sports schedules and provider feeds are the primary
  source of truth for events and participants.
- `PRD-002` Normal product flows should be frictionless, automated, and driven
  by real-world data plus seeded configuration defaults.
- `PRD-003` Root admin exists to resolve infrequent operational issues, not to
  perform day-to-day product steps.
- `PRD-004` Commissioners should have minimal recurring duties after contest
  creation; the product should optimize for quick setup and easy play.
- `PRD-005` Commissioners are also members. They should use the same team and
  entry tools as members, while retaining broader league-scoped authority when
  administrative intervention is needed.
- `PRD-006` Contest setup should default from seeded templates so the common
  path requires very little manual configuration.
- `PRD-007` Live scoring and results updates should happen automatically in the
  backend without normal commissioner/member/admin interaction.

## First Pass Product Loop

1. A provider exposes a sporting event and participant field.
2. PoolMaster imports the event and participants and resolves operational
   timing such as `releaseAt` and `fieldLocksAt` from default relative rules.
3. A commissioner creates a contest quickly from a seeded template.
4. Teams create one or more entries and make selections against the contest's
   frozen field interpretation.
5. Backend jobs poll provider updates and refresh participant stats, entry
   scores, and leaderboard ordering.
6. The contest completes, final standings are shown, and winners are visible.

## First Pass Delivery Focus

- complete one full end-to-end contest lifecycle before broadening to more
  sports
- first end-to-end target is:
  entry creation -> live scoring -> contest completion -> winners -> completed
  contest history
- first sport family remains golf
- first entry-selection UI should be tiered golf
- future budget-based contests should use PoolMaster-derived participant prices
  rather than provider-sourced budget values
- additional sports should follow after the full contest lifecycle and history
  loop is working cleanly

## First Pass Product Boundaries

- No routine manual root-admin release workflow for events.
- No routine commissioner release workflow after contest creation.
- No routine manual scoring or results workflow.
- No first-pass UI for managing contest templates; templates are seeded product
  data.
- Mock provider infrastructure is valid in QA and other non-production
  environments, but not as production fallback behavior.

## Desired Experience

### Root Admin

- Rarely needed during normal operation.
- Monitors provider health, retries failed syncs, and handles unusual timing or
  feed issues only when automation needs help.
- Can enter league context and use the same practical tools available to a
  commissioner when exceptional intervention is required.

### Commissioner

- Creates contests quickly with smart defaults.
- Rarely performs contest-specific duties after creation.
- Uses the same member/team/entry surfaces as everyone else for ongoing play.
- Can act across league teams when needed for support or league operations.

### Member / Team Owner

- Joins leagues, manages their team, creates entries, and edits selections
  until contest lock.
- Sees live leaderboard changes driven by automated provider updates.
- Can browse completed contests within league history.
