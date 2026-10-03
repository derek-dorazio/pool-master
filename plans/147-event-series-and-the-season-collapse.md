# Plan 147 — EventSeries, and collapsing Season into the event

**Tracking issues:** slice 1 is **#314**, slice 2 is **#315**. The owner elected to run both in
one session rather than sequence them, so that the migration order and the backfill are decided
by one agent holding the whole picture.

**Supersedes #307.** That issue asked whether `LeagueEvent` deserves a lifecycle; decision 9
answers it, and slice 1 implements it.

## Purpose

The sport catalog has a diamond. `SportEvent` carries two optional parents, `seasonId` and
`leagueEventId`, and both reach `SportLeague` independently:

```
                 SportLeague
                /           \
          Season             LeagueEvent
                \           /
                 SportEvent
```

Nothing in the schema stops an event whose `Season` belongs to the PGA Tour from pointing at a
`LeagueEvent` belonging to a different tour. The current write path is safe by convention —
`createEvent` derives the league event's tour *from* `season.sportLeagueId`
(`events/service.ts:105`) — but that is one function's discipline, not an invariant.

The names make it worse. `LeagueEvent` and `SportEvent` give no hint which is the recurring
thing and which is the occurrence, and `LeagueEvent` is named after `SportLeague` while the
product has an unrelated `League`. Three collisions in two names.

This plan replaces the diamond with a tree and deletes `Season`.

## Target

```
Sport  ("GOLF")
  │
  └──1:N──>  SportLeague                the tour — "PGA Tour"
                │                        isActive, currentEventYear Int?
                │
                └──1:N──>  EventSeries          ← renamed from LeagueEvent
                             │                    the recurring tournament — "The Masters"
                             │                    @@unique([sportLeagueId, name])
                             │
                             └──1:N──>  SportEvent        one edition — "the 2026 Masters"
                                          eventSeriesId  required
                                          eventYear      Int
                                          startDate, endDate, status,
                                          releaseAt, fieldLocksAt, rounds
                                          @@unique([eventSeriesId, eventYear])
                                              │
                                              ├──> SportEventRound
                                              ├──> SportEventParticipant   field, finish position
                                              ├──> SportEventTier
                                              └──> Contest                 the product attaches here
```

`Season` is deleted. `SportEvent.seasonId` and `SportLeague.currentSeasonId` go with it.

## Decisions, and why

### 1. The instance's only parent is its series

Of the two parents, the recurring identity is the more useful and more stable relation, and it
is the one `cloneSeason` already leans on. So `SportEvent.eventSeriesId` survives and
`seasonId` goes.

### 2. `Season` is deleted rather than kept

Measured before deciding: `Season.startDate` and `Season.endDate` are read in exactly two
places — `cloneSeason` shifts them forward, and the mapper serialises them for display. Nothing
filters, validates or groups by them. `name` is display only. Season was a label with a year on
it.

### 3. The year lives on the event as `eventYear Int`

**Not an enum.** An enum needs a migration every December, cannot express ranges or arithmetic,
and has no clean member for a cross-year season.

**Named `eventYear`, meaning the branded year.** The 2026 PDC World Championship starts in
December 2025 and is called the 2026 championship by everyone who would search for it.
`startDate` carries the real dates; `eventYear` carries the name the edition is known by. A
column called `year` invites someone to populate it with the year an event finished.

`eventYear` also travels better than `year`: in a DTO payload or a query string the field
arrives without its model name, and `eventYear=2026` is self-describing where `year=2026` is not.

### 4. Why a single year is enough — the question that nearly blocked this

An NBA *season* spans two calendar years, so a bare year is ambiguous for season-shaped data.
But PoolMaster does not model season-long contests. It models tournaments and events — a
golf major, an F1 race, the US Open. Those almost never cross a year boundary, and the rare ones
that do (the Sydney–Hobart, the darts World Championship) are *branded* with the later year,
which is exactly what `eventYear` records.

If PoolMaster ever adds season-long contests, this decision must be revisited: that is the case
where a `(label, start, end)` triple genuinely needs an owner, and that owner is the Season
object this plan deletes.

### 5. `@@unique([eventSeriesId, eventYear])`

This is what makes `eventYear` *enforce* "there is one 2026 Masters" rather than merely describe
it, and it is the direct replacement for Season's `@@unique([sportLeagueId, year])`.

Checked for cases it would wrongly forbid: a golf major, an F1 Grand Prix and a tennis major
each run once per edition. The only counterexample found is the Australian Open happening twice
in 1977, a historical oddity. Where two runnings of the same thing in one year do occur they are
almost always branded differently, which makes them two series.

### 6. `currentSeasonId` becomes `currentEventYear Int?` on `SportLeague`

It backs a live "Set as current" action (`season-service.ts:67,97,108`) and an `isCurrent` flag,
which becomes `sportLeague.currentEventYear === event.eventYear`.

**This trades a foreign key for a service-level check.** `currentSeasonId` is a real FK, so the
database guaranteed the target existed; a plain `Int?` accepts `1823`. The replacement check
belongs in the "set as current" operation: refuse a year with no events for that league. That is
a business rule rather than a referential one, so this is arguably where it belonged — but it
must actually be implemented, or the column silently accepts nonsense.

It also sheds a constraint that never meant anything. `currentSeasonId` is `@unique` because
Prisma requires it on the owning side of a 1:1, which incidentally asserted "no two leagues
share a current season" — true today only because seasons are per-league. Two leagues may both
have `currentEventYear = 2026`.

### 7. No denormalised `sportLeagueId` on `SportEvent`

"All 2026 PGA events" needs `eventYear` plus a hop through `EventSeries` to filter by league.
That join is accepted rather than denormalised away, because it is not the hot path: the common
read is *upcoming* events, which is date-ordered and not year-filtered.

`SportEvent` already has `@@index([startDate, endDate])`, which serves the hot path. The index
set needs nothing added beyond decision 5's uniqueness constraint.

### 8. `eventSeriesId` is required

Nullable today, commented *"null for a one-off event."* Required from now on: a one-off is a
series with exactly one edition. The write path needs no change — `findOrCreate` already
materialises a series from the event's name — and it keeps the invariant simple: every event has
a lineage, even if that lineage is one.

### 9. `EventSeries` gets `isActive`, which answers #307

#307 asked whether `LeagueEvent` deserves a lifecycle, since it was the only object in the
cluster with none — no delete, no inactivate, not even a column to express retirement. As
`EventSeries` in a clean tree it is plainly a dimension, a sibling of nothing and a parent of
editions, so it takes `isActive` like `SportLeague` does. **#307 closes with this plan rather
than on its own.**

### 10. Names: `EventSeries` renamed, `SportEvent` kept

`EventSeries` vs `SportEvent` is unambiguous — one is plainly the recurring thing, one plainly
the occurrence — so renaming one model buys the whole clarity win.

`SportEvent` → `EventEdition` was considered and deliberately not done. It would orphan five
child names that embed `SportEvent` (`SportEventRound`, `SportEventParticipant`,
`SportEventTier`, `SportEventParticipantGolfRound`, `SportEventParticipantGolfStanding`),
turning a one-model rename into a six-model sweep. If it is ever wanted it is a separate,
purely mechanical slice.

A bare `Event` was rejected outright: `packages/shared/events/` already holds an event bus
(`event-bus`, `base`, `draft`, `contest`), so `Event` would collide with domain-event
vocabulary in the same repository. The HTTP surface keeps saying `/api/v1/events`,
`listEvents`, `createEvent` — model names and route vocabulary need not match, and leaving the
routes alone keeps this out of the public contract.

## Slices

### Slice 1 — rename `LeagueEvent` to `EventSeries`

Independent of every decision above that concerns `Season`. Shippable immediately.

- `model LeagueEvent` → `EventSeries`; table `league_events` → `event_series`
- `SportEvent.leagueEventId` → `eventSeriesId` (still nullable in this slice)
- `LeagueEventRepository` → `EventSeriesRepository`; `PrismaLeagueEventRepository` →
  `PrismaEventSeriesRepository`
- Add `isActive` to `EventSeries` (decision 9), defaulting true
- DTO field `leagueEventId` → `eventSeriesId`, then regenerate the SDK

Footprint, measured: **21 hand-written files** and 3 generated artifacts.

| Area | Files |
|---|---|
| schema + migration | `schema.prisma`, one new migration |
| adapters / ports | `prisma-sport-catalog-repositories.ts`, `adapters/index.ts` |
| service / wiring / mapper | `events/service.ts`, `events/wiring.ts`, `sport-events.mapper.ts` |
| shared contract | `dto/events.dto.ts`, `domain/sport-catalog-types.ts`, `domain/contest-management-types.ts` |
| generated | `generated/api-types.ts`, `generated/hey-api/types.gen.ts`, `generated/openapi.json` |
| tests + fixtures | 5 webapp test files, 4 service test files, `tests/support/in-memory-sport-events.ts` |

**Why a contract rename is low-risk here:** nothing reads `leagueEventId`. Every occurrence is a
write, a mapper passthrough, a generated type or a test fixture — no query filters on it and no
UI renders it. A field rename cannot break a behaviour that does not exist. `api:check` and
`api:validate` gate the regeneration.

The migration is two `ALTER TABLE ... RENAME`s and a column rename. No data moves.

### Slice 2 — collapse `Season`

Gated on slice 1. The expensive half: **~103 files mention Season** (23 core-api, 33 shared
mostly generated, 31 webapp, 16 tests), plus a backfill, plus the e2e journey's act 1, which
creates a season through the UI and must be rewritten in the same slice.

#### Migration order is load-bearing

**`Season` is the only path from a `SportEvent` to its `SportLeague`.** Drop it first and an
event with a null `eventSeriesId` can never be assigned one, because there is no way left to
learn which tour it belongs to. So:

1. Add `SportEvent.eventYear Int?` (nullable) and `SportLeague.currentEventYear Int?`
2. Backfill `eventYear` from `season.year` for every event with a `seasonId`
3. Backfill `eventSeriesId` for every event still null, deriving the tour from
   `season.sportLeagueId` and the name from `event.name`
4. Backfill `currentEventYear` from `currentSeason.year`
5. Make `eventYear` and `eventSeriesId` NOT NULL
6. Add `@@unique([eventSeriesId, eventYear])`
7. Drop `SportEvent.seasonId`, drop `SportLeague.currentSeasonId`, drop `seasons`

#### Two pre-flight queries, before writing any migration

Step 6 can fail on existing data and step 3 can be impossible. Both are cheap to check and
expensive to discover halfway through a deploy.

```sql
-- (a) Would the new uniqueness constraint reject current data?
--     Nothing today stops two events of the same series sharing a year.
SELECT league_event_id, EXTRACT(YEAR FROM start_date) AS yr, COUNT(*)
FROM sport_events
WHERE league_event_id IS NOT NULL
GROUP BY 1, 2 HAVING COUNT(*) > 1;

-- (b) Events with no season have no path to a league, so step 3 cannot assign them a series.
SELECT id, name, provider_id, start_date
FROM sport_events
WHERE season_id IS NULL;
```

Run both against QA and locally. If (a) returns rows, decide per row whether they are genuinely
two series or a duplicate to merge. If (b) returns rows, they need either a manual series
assignment or deletion — and that is a decision for the owner, not the implementing session.

#### Also in slice 2

- `cloneSeason` loses its object. It becomes "clone every event of year N to year N+1 for this
  league" — still one operation, now query-shaped rather than object-shaped.
- The "set as current" check from decision 6.
- `golden-journey.e2e.ts` act 1 creates a season through the golf admin UI; that step and the
  season admin pages go away together.

## Verification

- The diamond is gone: `SportEvent` has exactly one parent in the schema, and no code path can
  produce an event whose series belongs to a different league than the event does.
- `@@unique([eventSeriesId, eventYear])` exists and rejects a second edition of one series in
  one year, proved by a functional test that attempts it.
- "Set as current" refuses a year with no events for that league.
- The e2e journey passes without creating a season.
- Both pre-flight queries return zero rows on QA before the migration runs, or their rows are
  resolved by a documented decision.

## Revisit if

PoolMaster adds season-long contests. Decision 4 is the load-bearing assumption, and a
season-long contest is exactly the case where the `(label, start, end)` triple needs an owner
again.
