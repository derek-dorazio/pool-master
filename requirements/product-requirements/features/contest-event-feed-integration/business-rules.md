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
- `BR-101C` `(Confirmed)` Root-admin routes and functions are exceptional
  operational tools, not the normal way the product runs day to day.
- `BR-102` `(Confirmed)` Commissioners create and configure contests for their
  leagues, and contest creation immediately makes the contest live for entries.
- `BR-102A` `(Confirmed)` Commissioners should have minimal recurring duties
  after contest creation beyond occasional league administration.
- `BR-103` `(Confirmed)` Team owners/members act in the context of a team when
  creating contest entries.
- `BR-103A` `(Confirmed)` Commissioners are also members and should use the
  same team and entry tools as members for ongoing play.
- `BR-103B` `(Confirmed)` When needed for league administration, commissioners
  may use those same team and entry tools across teams within their league
  scope.
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
- `BR-202A` `(Confirmed)` After contest lock, entries become frozen and
  read-only.
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
- `BR-209A` `(Confirmed)` If no eligible imported events are currently
  available for contest creation, the commissioner flow should show a truthful
  empty state rather than implying a missing manual admin step.
- `BR-210` `(Confirmed)` There is no normal admin, commissioner, or member user
  flow for live scoring updates; backend ingestion/scoring jobs update event
  data, entry scores, and leaderboard order automatically.
- `BR-211` `(Confirmed)` If an admin role surfaces in scoring later, it is
  operational only, such as rerunning or repairing broken provider feeds, not
  manually entering or editing stats/results.
- `BR-212` `(Confirmed)` In the first pass, live provider updates are treated
  as latest-truth overwrites for the affected event and participants.
- `BR-213` `(Confirmed)` PoolMaster does not need first-pass audit logging for
  every stat change before accepting repeated live provider updates.
- `BR-214` `(Confirmed)` The first-pass admin feed-health surface should be
  read-only and focused on sync-run visibility such as datetime and status.
- `BR-215` `(Confirmed)` Retry/rerun controls for sync runs may be deferred
  until real provider delta/latest-data behavior is better understood.
- `BR-216` `(Confirmed)` The leaderboard is the primary member-visible live
  event view.
- `BR-217` `(Confirmed)` The default leaderboard presentation should emphasize
  entries/teams and total score ordered from winner to loser.
- `BR-218` `(Confirmed)` Expanded leaderboard details may reveal participant
  rows and participant scores without changing the leaderboard ordering.
- `BR-219` `(Confirmed)` Contest rules should be viewable from the live-event
  leaderboard context.
- `BR-220` `(Confirmed)` Leaderboards and participant drill-down are universal
  contest concepts across sports, even though exact visible details vary by
  sport.
- `BR-221` `(Confirmed)` First-pass history focuses on completed contests
  within the league, grouped or filterable by sport and contest type.
- `BR-222` `(Confirmed)` Broader historical summaries such as win counts or
  streaks are deferred until after completed-contest history is working.
- `BR-223` `(Confirmed)` Entry-selection UI is contest-type-specific rather
  than universal.
- `BR-224` `(Confirmed)` First-pass entry-selection design should target tiered
  golf contests.
- `BR-225` `(Confirmed)` In first-pass tiered golf contests, default tier
  grouping and ordering should be derived from tournament-winning odds rather
  than world rank.
- `BR-226` `(Confirmed)` Supporting participant information such as world rank
  may be shown in the tiered golf entry UI without replacing the default odds-
  based tier source.
- `BR-227` `(Confirmed)` The first-pass tiered golf entry flow should support
  sequential tier-by-tier selection, optional tier collapse after selection,
  and a winner-score tiebreaker input before final entry submission.
- `BR-228` `(Confirmed)` After contest lock, a team's entry view should present
  like a leaderboard/detail view of that entry rather than an editable draft
  form.

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
