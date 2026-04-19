# Contest Event Feed Integration Business Rules

## Product Rules

- `BR-001` `(Confirmed)` A contest entry always belongs to an existing team.
- `BR-002` `(Confirmed)` A contest always belongs to a specific imported
  `SportEvent`.
- `BR-003` `(Confirmed)` The event field is owned at the
  `SportEventParticipant` layer, not by ad hoc contest-local participant pools.
- `BR-004` `(Confirmed)` The contest selection field is derived from the event
  field plus contest configuration.
- `BR-004A` `(Confirmed)` Contest creation should be template-first, with
  seeded reusable contest configuration templates for sport and contest style.
- `BR-004B` `(Confirmed)` Seeded contest templates are product data, not a
  first-pass commissioner or root-admin management workflow.
- `BR-005` `(Confirmed)` The mock sports data provider is valid non-production
  infrastructure and may hold durable scenario data outside the app database.
- `BR-006` `(Confirmed)` Automated test data inside app/backend test suites
  remains ephemeral and created/destroyed by the tests themselves.

## Permission Rules

- `BR-101` `(Confirmed)` Root admin owns provider configuration and operational
  event sync controls in the first pass.
- `BR-101A` `(Confirmed)` Root admin does not manually author sporting events;
  events are provider-discovered/imported from real-world schedules.
- `BR-101B` `(Confirmed)` Root admin does not normally release events manually;
  event availability is driven by imported events plus default event-relative
  `releaseAt` and `fieldLocksAt` timing rules.
- `BR-102` `(Confirmed)` Commissioners create and configure contests for their
  leagues, and contest creation immediately makes the contest live for entries.
- `BR-103` `(Confirmed)` Team owners/members act in the context of a team when
  creating contest entries.
- `BR-104` `(Inferred)` Commissioners should not manually author the real-world
  event field; they configure contest behavior on top of imported event data.
- `BR-105` `(Confirmed)` Root admin does not manage contest templates through a
  first-pass UI/API surface; template lifecycle is handled through seed data and
  later migrations if needed.

## Lifecycle Rules

- `BR-201` `(Confirmed)` Contest lifecycle is downstream of event/feed timing,
  not primarily commissioner-driven.
- `BR-201A` `(Confirmed)` Each imported event has PoolMaster operational
  datetimes `releaseAt` and `fieldLocksAt`.
- `BR-201B` `(Confirmed)` `releaseAt` and `fieldLocksAt` default from global
  sport or sport+contest-style rules and resolve into event-specific datetime
  stamps.
- `BR-201C` `(Confirmed)` Root-admin override of `releaseAt` and
  `fieldLocksAt` is an advanced path and should rarely be needed in normal
  operations.
- `BR-202` `(Confirmed)` Team entries are editable only while the contest is
  still open/editable.
- `BR-203` `(Confirmed)` Commissioners may create/configure contests as soon as
  the event exists.
- `BR-204` `(Confirmed)` Members may create and edit entries before the contest
  lock even if the event field has not yet locked.
- `BR-205` `(Confirmed)` Released contests freeze their derived contest field.
- `BR-206` `(Confirmed)` Event/provider updates after contest release do not
  re-derive tiers, prices, ordering, or category assignments for that released
  contest.
- `BR-207` `(Confirmed)` Unreleased or newly created contests may continue to
  use newer eligible event data until they are released.
- `BR-208` `(Confirmed)` There is no separate commissioner release step in the
  normal flow; once the commissioner completes setup and creates the contest,
  the contest is immediately live and ready for entries.
- `BR-209` `(Confirmed)` In the normal flow, commissioners choose among seeded
  templates and only use advanced configuration when they intentionally want to
  override defaults.
- `BR-210` `(Confirmed)` There is no normal admin, commissioner, or member user
  flow for live scoring updates; backend ingestion/scoring jobs update event
  data, entry scores, and leaderboard order automatically.
- `BR-211` `(Confirmed)` If an admin role surfaces in scoring later, it is
  operational only, such as rerunning or repairing broken provider feeds, not
  manually entering or editing stats/results.

## Validation Rules

- `BR-301` `(Confirmed)` PoolMaster should create normalized participants per
  sport and match/import event-field members into that participant catalog.
- `BR-302` `(Inferred)` When imported participants cannot be matched safely,
  PoolMaster should surface that as an admin operational issue rather than
  silently degrading contest behavior.
- `BR-303` `(Confirmed)` Entry selection must validate against contest-specific
  field rules, not just against the broad participant catalog.
- `BR-304` `(Confirmed)` Each entry must have a unique entry name.
- `BR-305` `(Confirmed)` If a participant withdraws or becomes unavailable
  before contest lock, existing entries keep their current selections unless
  the member changes them.
- `BR-306` `(Confirmed)` Participant statuses such as withdrawn or injured are
  informational for entry owners; PoolMaster does not auto-rewrite entries
  before contest lock.
