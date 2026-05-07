# League / Contest / Scoring substrate redesign — Phase 2 design plan

**Beads epic:** `pool-master-rop.78`
**Phase:** 2 (Design) of 4 (Investigate → Design → Review → Implement)
**Phase 1 deliverable:** [`docs/league-contest-substrate-audit.md`](../docs/league-contest-substrate-audit.md)
**Author:** Archie (lead) with Dom (domain) + Brad (service / scoring) — design distilled from the rop.78 substrate-audit conversation
**Status:** Phase 2 deliverable. **Phase 3 (user review) is the explicit gate** before Phase 4 implementation slices spawn.

---

## 1. Purpose

This plan replaces the existing league/contest/scoring substrate with a strongly-typed, sport-polymorphic data model that eliminates the JSON-blob, mapper-less-route, and decoupled-write-path defects identified in Phase 1.

The redesign is grounded in two anchors:

- **Phase 1 audit** (`docs/league-contest-substrate-audit.md`) — found 24 `JsonObjectSchema` sites at audit time (now 23 after PR #21), routes emitting domain objects without mappers, dual rank-assignment paths that disagree under load, no per-contest scoring lock, and provider-feed `ProviderStatEvent`s unvalidated at the bus boundary.
- **Rules landed by PR #22** (`rop-1xz`) — strongly-typed end-to-end principle; one canonical DTO per entity; discriminated unions are physical not nullable-conditional; make-impossible-states-unrepresentable at the storage layer; open-ended additive substrate design; no-data clean reworks; validity matrices in code.

Every design decision below cites those anchors. Where the design conversation locked an answer, the answer is stated and the rationale is one sentence. Where Phase 4 still owes an implementation choice, that's flagged in §17.

This is the heart of the product. The substrate is the foundation that every contest type, sport, and pool format builds on. Getting it right unlocks every future epic; getting it wrong forces an even bigger redesign later.

---

## 2. Governing principles

Pulled from PR #22's rules and the audit's findings. Every section below complies with these.

1. **Strongly typed end-to-end.** Prisma schema, service-layer interfaces, shared Zod DTOs, generated SDK, and frontend consumers all agree on the same shape for the same entity. `Json` columns and `z.record(z.unknown())` are forbidden where the application code already knows the shape. Opaque shapes are acceptable only at integration boundaries pre-normalization.

2. **One canonical DTO per entity.** No per-page variants. Permission-driven thin variants are supplementary, not replacements.

3. **Discriminated unions are physical.** Sport-specific detail and contest-type-specific contributions live in separate tables on the discriminator axis. Schema-as-documentation: every column applies to every row.

4. **Make impossible states unrepresentable at storage.** Constraints, FKs, NOT NULL, unique indexes — schema enforces what it can.

5. **Open-ended additive substrate.** New sports, new contest types, new event formats are added by additive table creation, never by altering existing tables.

6. **No-data clean rework.** No production deployment with persistent data; no backfill scripts, no compatibility shims, no zombie tables.

7. **Validity matrices in code.** Small enumerated compatibility matrices live as TypeScript const maps with compile-time exhaustiveness checking.

8. **Office pools only.** PoolMaster is not fantasy / DFS / sportsbook / prop bets. Models do not extend to absorb those product spaces.

---

## 3. Scope

### 3.1 In scope (Phase 4 implementation)

- Substrate redesign for **golf-roster** (the current product target — tiered golf tournaments with roster-style entry picks).
- All schema-level work: Prisma migration, DTOs, mappers, generated SDK regeneration.
- Provider adapter normalization for the **mock-feed** and **PGA Tour** adapters (the two that produce golf-roster data today).
- Per-(category × contestFormat) contribution table for golf-roster.
- Frontend consumption of the new shapes for the existing golf-roster surfaces.
- FAPI scenario for the live-scoring pipeline (covers `pool-master-rop.15`).

### 3.2 Designed-for, built-later (future epics, not Phase 4)

These are designed in §6, §8, and §11 so the substrate can absorb them additively. Implementation lives in separate epics.

| Sport | Pool format(s) | Why deferred |
|---|---|---|
| Tennis Grand Slam (Wimbledon, US Open) | ROSTER | No active product target |
| NCAA Tournament basketball | ROSTER (knockout pool), BRACKET | No active product target |
| NFL season | PICKEM_CONFIDENCE, SURVIVOR | No active product target |
| FIFA World Cup / UEFA Euros soccer | ROSTER (knockout), BRACKET | No active product target |
| F1 / NASCAR | ROSTER (per-race or season), PREDICT_TOP_N | No active product target |

### 3.3 Categorically out of scope

Per the rule landed in `requirements/product-requirements/domain-concepts.md`:

- Season-long fantasy sports
- DFS (DraftKings / FanDuel)
- Sportsbook (moneyline / spread / parlays)
- Prop bets

### 3.4 Deferred — possible future scope (different substrate)

- **Squares pools** (Super Bowl 100-square grid). Office pool, but a different substrate (grid + cell + score-digit, not participant + pick). If/when added, it's an additive substrate epic, not absorbed by this redesign.

---

## 4. Reference model — typed entity hierarchy

The substrate has two halves connected by a single FK.

```
                         REAL-WORLD SIDE                              POOL-APP SIDE
                         ────────────────                             ─────────────

                              Sport                                       Contest
                                │                                            │
                                ▼                                            ▼
                           SportEvent ◄──────────M:N─────────► ContestSportEvent
                                │                                            │
                                ▼                                            ▼
                       SportEventParticipant ◄──FK── ContestEntryPick    ContestEntry
                                │                          │                  │
                                ▼                          ▼                  ▼
                  SportEventParticipant<Category>Detail   ContestEntryPick<Category><ContestFormat>Contribution
                  (per-category, sport-polymorphic)       (per-(category × contestFormat))
```

### 4.1 Real-world side

| Table | Purpose | Notable fields |
|---|---|---|
| `Sport` | Granular: one row per pool target (e.g., "PGA Masters", "NCAA Tournament", "F1 World Championship"). Display name + structural metadata. | `name` (display), `category` (`GOLF` / `BASKETBALL` / `NFL` / `F1` / `NASCAR` / `TENNIS` / `SOCCER`), `tournamentFormat` (`STROKE_PLAY_TOURNAMENT` / `KNOCKOUT_BRACKET` / `SERIES_PLAYOFF` / `ROUND_ROBIN_SEASON` / `WEEKLY_GAMES_SEASON` / `TIME_TRIAL_RACE` / `SEASON_OF_RACES` / `GROUP_STAGE_KNOCKOUT` / `MATCH_PLAY`) |
| `Participant` | Canonical per-sport identity (e.g., Tiger Woods, the persistent golfer entity). Spans many events. Stable display fields and external IDs only — no per-event mutable data lives here. | `sportId` FK, `name`, external provider IDs |
| `SportEvent` | A specific instance of competition: "PGA Masters 2026", "NCAA Tournament 2026", "Monaco GP 2026". | `sportId` FK, `name`, `startsAt`, `endsAt`, `status` (workflow enum), sport-event-level config (e.g., `parForRound: number` for golf events) |
| `SportEventParticipant` | A real-world entity in one event: Tiger Woods in The Masters 2026. The same `Participant` competing in two events produces two `SportEventParticipant` rows with different per-event data. | `sportEventId` FK, `participantId` FK → `Participant`, `worldRanking?` (per-event snapshot from provider), `oddsToWin?` (per-event from provider), `seedNumber?` (event-relative seed) |
| `SportEventParticipant<Category>Detail` | Per-category detail child of `SportEventParticipant`. Different relational shape per category. Cardinality varies: golf has up to 4 rows per golfer per event, NCAA basketball has 1–6 rows per team, F1 has 1 row per driver per race. | See §6 for per-category specs |

The `worldRanking` / `oddsToWin` fields land on `SportEventParticipant`, not on `Sport.name`-level entities — provider feeds emit these per event, not per season. (Phase 1 audit §6 + design conversation: `ParticipantSeasonRecord` was a Codex misinterpretation; dropped in this redesign.)

### 4.2 Pool-app side

| Table | Purpose | Notable fields |
|---|---|---|
| `Contest` | A pool. Sport-scoped, contest-type-scoped, league-scoped. | `leagueId`, `sportId`, `contestFormat` (enum: `ROSTER` / `BRACKET` / `PICKEM_CONFIDENCE` / `SURVIVOR` / `PREDICT_TOP_N`), `selectionConfig` (per-contestFormat typed config), `scoringConfig` (per-contestFormat typed scoring rules), `status` (workflow), `lockedAt`, `closedAt` |
| `ContestSportEvent` | M:N join from `Contest` to `SportEvent`. Golf-tournament-roster contests have 1 row (one tournament); NFL weekly pick'em contests have 16 rows (one per week's games); F1 season-long contests have ~22 rows (one per race). | `contestId`, `sportEventId` |
| `ContestEntry` | A user's submission to a contest. Owned by a squad (PoolMaster team). | `contestId`, `squadId`, `name` (entry display name), `totalScore: Decimal` (aggregate), `rank: Int?`, `tiebreakerValue: Int?` (entry-level tiebreaker; bracket pools use this) |
| `ContestEntryPick` | A pick on an entry — references a `SportEventParticipant`. **Unified across contest types**; optional metadata fields disambiguate. | `contestEntryId`, `sportEventParticipantId`, `contestFormat` (denormalized from parent `Contest.contestFormat`; enables partial-index uniqueness — see §7.1), `period?` (week / draft round / bracket round), `slot?` (matchup index / draft pick order / predicted position), `tier?` (selection tier), `cost?` (budget cost), `isAutoPicked: Boolean` |
| `ContestEntryPick<Category><ContestFormat>Contribution` | Per-(category × contestFormat) contribution detail. The bridge between a pick, a real-world result, and contest scoring rules. | See §8 for per-combo specs |

### 4.3 Why `ContestEntryPick` is unified

The current schema has only one active pick table — `RosterPick` (`roster_picks`); earlier-considered tables (`contest_picks`, `bracket_predictions`, `draft_picks`) were dropped in pre-redesign migrations. `DraftSession` + `DraftPickHistory` exist as a separate snake-draft mechanism (22 active call sites) and are **out of scope for this redesign** — future snake-draft contest types may fold into `ContestEntryPick`, but Phase 4 leaves them alone.

The unification claim in the redesign is forward-looking: once the substrate ships, future contest types (BRACKET, PICKEM_CONFIDENCE, SURVIVOR, PREDICT_TOP_N) populate `ContestEntryPick` directly via optional metadata, rather than each adding its own pick table. The pre-redesign zombie tables that "would have collapsed" never actually existed when the redesign begins; the principle is "any new contest type uses the unified table from day one."

| Contest type | `period` | `slot` | `tier` | `cost` | Notes |
|---|---|---|---|---|---|
| ROSTER (tiered golf) | — | — | filled | — | One pick per tier per entry |
| ROSTER (budget golf) | — | — | — | filled | Sum of costs ≤ contest budget |
| ROSTER (NCAA knockout pool) | — | — | — | — | N picks per entry, no extras |
| BRACKET (NCAA Tournament) | filled (= round) | filled (= matchup index) | — | — | 63 picks per entry |
| PICKEM_CONFIDENCE (NFL weekly) | — | filled (= confidence rank) | — | — | One pick per game in the week |
| SURVIVOR (NFL season) | filled (= week) | — | — | — | One pick per week per entry |
| PREDICT_TOP_N (F1 podium) | — | filled (= predicted position) | — | — | 3 picks per entry |

The columns `period`, `slot`, `tier`, `cost` are nullable at the schema level because each contest type uses a different subset. Their meaning is documented per `Contest.contestFormat` — but unlike the discriminated-union anti-pattern, every populated value is interpretable on its own (the picks aren't lying about the data shape; they're correctly representing optional metadata).

### 4.4 Why per-`<Category><ContestFormat>` contribution tables

Decided in design conversation: option (b) — one contribution table per (category × contestFormat) combo. The data shapes for, e.g., `BasketballRoster` (per-game played, with upset bonus) and `BasketballBracket` (per-matchup predicted, with round weight) share only `id, pick_id, contribution` — splitting on both axes is the only way every column applies to every row.

This is more tables (~14 once all sports/contests ship) but every column is meaningful. See §8 for per-combo specs.

---

## 5. Naming convention

Per `rules/domain-model-conventions-rules.md §10`: no bare noun used for two distinct concepts. The rule is collision-driven, not strict-prefix.

- `Sport` — uniquely the sport concept; no other "sport" entity exists in the domain.
- `SportEvent` — distinct from the in-process event-bus "event"; the prefix prevents that overload.
- `Participant` (bare) — **acceptable as the per-sport canonical entity** (e.g., Tiger Woods, the persistent golfer entity). The pool-app side uses `Pick`, not "Participant" — so there's no domain collision and no rename is required.
- `SportEventParticipant` — the per-event row (Tiger Woods in The Masters 2026), with `participantId` FK back to the canonical `Participant`. Each event materializes its own row with per-event data (`worldRanking`, `oddsToWin`, `seedNumber`).
- `Contest`, `ContestEntry`, `ContestEntryPick` — pool-app side, prefix-disambiguated where collision is possible.
- `Pick` (bare) — discouraged in entity names; always prefixed (e.g., `ContestEntryPick`).

Per-`<Category>` tables on the real-world side: `SportEventParticipantGolfRound`, `SportEventParticipantBasketballGame`, etc.

Per-`<Category><ContestFormat>` tables on the pool-app side: `ContestEntryPickGolfRosterContribution`, `ContestEntryPickBasketballBracketContribution`, etc.

The verbosity is the price of unambiguous schema-as-documentation. Bare names that have only one referent in the domain (`Participant` is the canonical per-sport entity; nothing else is named "participant") stay unprefixed.

---

## 6. Sport detail configuration

Per-category detail tables on the real-world side. Different categories have different relational shapes; that's intentional and matches sport reality.

### 6.1 Golf — `SportEventParticipantGolfRound` (in scope, Phase 4)

Cumulative scoring; sum of rounds is the participant's tournament total; lowest total wins.

```
SportEventParticipantGolfRound {
  id                              UUID  PK
  sportEventParticipantId         UUID  FK → SportEventParticipant
  round                           Int   1..N (4 for standard PGA tournament)
  strokes                         Int   actual stroke count for the round
  scoreToPar                      Int   relative-to-par for the round (negative = under par)
  status                          Enum  PENDING | IN_PROGRESS | COMPLETED | DNF | DSQ
  completedAt                     DateTime?

  UNIQUE (sportEventParticipantId, round)
}
```

`Event.parForRound: Int` lives on `SportEvent` (e.g., 72 for The Masters). `scoreToPar` could be derived from `strokes - parForRound`, but storing it separately matches what providers emit and avoids re-computation on every read.

### 6.2 Tennis — `SportEventParticipantTennisMatch` (designed, deferred)

Per-match-played; rows accumulate as the player advances through rounds.

```
SportEventParticipantTennisMatch {
  id                              UUID  PK
  sportEventParticipantId         UUID  FK
  roundReached                    Enum  R128 | R64 | R32 | R16 | QF | SF | F
  matchResult                     Enum  WIN | LOSS | WALKOVER | RETIRE
  setsWon                         Int
  setsLost                        Int
  opponentSportEventParticipantId UUID  FK → SportEventParticipant
  playedAt                        DateTime?

  UNIQUE (sportEventParticipantId, roundReached)
}
```

### 6.3 Basketball — `SportEventParticipantBasketballGame` (designed, deferred)

Per-game played; cardinality 1–6 for NCAA Tournament (eliminated in R64 = 1 row; NCG winner = 6 rows).

```
SportEventParticipantBasketballGame {
  id                              UUID  PK
  sportEventParticipantId         UUID  FK
  round                           Enum  R64 | R32 | S16 | E8 | F4 | NCG  (or other tournament-specific)
  result                          Enum  WIN | LOSS
  score                           Int
  opponentScore                   Int
  opponentSportEventParticipantId UUID  FK
  isUpset                         Boolean   (computed at scoring time from seed differential)
  playedAt                        DateTime?

  UNIQUE (sportEventParticipantId, round)
}
```

### 6.4 F1 — `SportEventParticipantF1Result` (designed, deferred)

One row per driver per race.

```
SportEventParticipantF1Result {
  id                              UUID  PK
  sportEventParticipantId         UUID  FK
  finalPosition                   Int?   1..N; null if DNF
  didFinish                       Boolean
  lapsCompleted                   Int
  fastestLap                      Boolean   awarded fastest-lap bonus
  status                          Enum  FINISHED | DNF | DSQ
  finishedAt                      DateTime?

  UNIQUE (sportEventParticipantId)   -- one finish per driver per race
}
```

### 6.5 NASCAR — `SportEventParticipantNascarResult` (designed, deferred)

NASCAR adds stage points to F1's basic shape.

```
SportEventParticipantNascarResult {
  id                              UUID  PK
  sportEventParticipantId         UUID  FK
  finalPosition                   Int?
  didFinish                       Boolean
  finishPoints                    Int
  stage1Points                    Int
  stage2Points                    Int
  lapsLed                         Int
  status                          Enum
  finishedAt                      DateTime?

  UNIQUE (sportEventParticipantId)
}
```

### 6.6 NFL — `SportEventParticipantNflGame` (designed, deferred)

Each NFL game is one `SportEvent` with 2 `SportEventParticipant` rows (home + away).

```
SportEventParticipantNflGame {
  id                              UUID  PK
  sportEventParticipantId         UUID  FK
  isHomeTeam                      Boolean
  finalScore                      Int
  didWin                          Boolean
  pointSpread                     Decimal?    -- pre-game spread, persisted for ATS scoring
  didCoverSpread                  Boolean?    -- computed post-game
  playedAt                        DateTime?

  UNIQUE (sportEventParticipantId)
}
```

### 6.7 Soccer — `SportEventParticipantSoccerMatch` (designed, deferred)

```
SportEventParticipantSoccerMatch {
  id                              UUID  PK
  sportEventParticipantId         UUID  FK
  round                           Enum  GROUP | R16 | QF | SF | F
  matchResult                     Enum  WIN | DRAW | LOSS
  goalsFor                        Int
  goalsAgainst                    Int
  isUpset                         Boolean
  opponentSportEventParticipantId UUID  FK
  playedAt                        DateTime?

  UNIQUE (sportEventParticipantId, round, opponentSportEventParticipantId)
}
```

---

## 7. Pick model

The `ContestEntryPick` table defined in §4.2 is the single pick shape across all contest types. Optional metadata (`period`, `slot`, `tier`, `cost`) is populated per the `Contest.contestFormat` mapping in §4.3.

`isAutoPicked: Boolean` covers cases where a snake draft auto-picks a participant for an entry that missed its draft window; useful for entry-level UX ("you have 2 auto-picks; review and adjust before lock").

### 7.1 Constraints on `ContestEntryPick`

`ContestEntryPick.contestFormat` is denormalized from `Contest.contestFormat` via the parent `ContestEntry`. This is safe because `Contest.contestFormat` is immutable post-creation (changing it would invalidate every pick anyway). The denormalization is what makes contest-type-specific partial unique indexes implementable — Postgres partial indexes can predicate on local columns but not on joined parent columns.

Per-contest-type partial unique indexes (all predicate on local columns):

```sql
-- ROSTER: no double-picking the same participant
CREATE UNIQUE INDEX uq_pick_roster_participant
  ON contest_entry_picks (contest_entry_id, sport_event_participant_id)
  WHERE contest_type = 'ROSTER';

-- BRACKET / PICKEM_CONFIDENCE: no two picks on the same matchup / confidence rank
CREATE UNIQUE INDEX uq_pick_period_slot
  ON contest_entry_picks (contest_entry_id, period, slot)
  WHERE contest_type IN ('BRACKET', 'PICKEM_CONFIDENCE');

-- PREDICT_TOP_N: no two picks for the same predicted position
CREATE UNIQUE INDEX uq_pick_predicted_position
  ON contest_entry_picks (contest_entry_id, slot)
  WHERE contest_type = 'PREDICT_TOP_N';

-- SURVIVOR: one pick per week per entry
CREATE UNIQUE INDEX uq_pick_survivor_week
  ON contest_entry_picks (contest_entry_id, period)
  WHERE contest_type = 'SURVIVOR';
```

**Consistency guarantee on the denormalized column:**
- Service-layer enforcement at insert time: pick-creation always reads `Contest.contestFormat` from the parent contest and writes it to the pick row. No insert path bypasses this.
- A check-constraint test asserts `ContestEntryPick.contestFormat` matches `Contest.contestFormat` for every pick (Phase 4 implementation slice's contract test).
- A migration-time consistency check covers the rename of `roster_picks` → `contest_entry_picks` (every existing roster_picks row gets `contestFormat = 'ROSTER'`).

This satisfies the "make impossible states unrepresentable at storage" principle: the database directly enforces no double-picks per (contest type, entry).

---

## 8. Contribution model

Per-(category × contestFormat) tables. Phase 4 ships the golf-roster one; the rest are designed-but-deferred.

### 8.1 `ContestEntryPickGolfRosterContribution` (in scope, Phase 4)

```
ContestEntryPickGolfRosterContribution {
  id                              UUID  PK
  contestEntryPickId              UUID  FK → ContestEntryPick
  round                           Int   1..N (matches GolfRound.round)
  strokes                         Int   from SportEventParticipantGolfRound
  scoreToPar                      Int
  contribution                    Decimal   -- always equal to scoreToPar for golf-roster, but persisted explicitly
  contributedAt                   DateTime  -- when scoring engine wrote this row

  UNIQUE (contestEntryPickId, round)
}
```

For golf-roster: `contribution = scoreToPar`. The contest's total = `SUM(contribution)` across all picks across all rounds. Lowest total wins.

### 8.2 Designed, deferred (specs)

| Table | Notable columns |
|---|---|
| `ContestEntryPickTennisRosterContribution` | `roundReached`, `matchResult`, `advancementBonus?`, `contribution` |
| `ContestEntryPickBasketballRosterContribution` | `round`, `gameResult`, `isUpset`, `basePoints`, `bonusPoints`, `contribution` |
| `ContestEntryPickBasketballBracketContribution` | `round`, `matchupSlot`, `isCorrect`, `pointsPerRound`, `contribution` |
| `ContestEntryPickFootballPickemConfidenceContribution` | `confidenceRank`, `gameResult`, `isCorrect`, `contribution` |
| `ContestEntryPickFootballSurvivorContribution` | `week`, `gameResult`, `isCorrect`, `contribution` (entry eliminated when first incorrect) |
| `ContestEntryPickSoccerRosterContribution` | `round`, `matchResult`, `goalsFor`, `goalsAgainst`, `isUpset`, `basePoints`, `bonusPoints`, `contribution` |
| `ContestEntryPickF1RosterContribution` | `raceEventId` (FK to SportEvent), `finalPosition`, `didFinish`, `positionPoints`, `fastestLapBonus`, `contribution` |
| `ContestEntryPickF1PredictTopNContribution` | `predictedPosition`, `actualPosition`, `isExactMatch`, `isInTopN`, `exactPoints`, `inTopNPoints`, `contribution` |
| `ContestEntryPickNascarRosterContribution` | `raceEventId`, `finalPosition`, `didFinish`, `finishPoints`, `stage1Points`, `stage2Points`, `contribution` |

Each table follows the common shape:
- `id, contestEntryPickId, contribution, contributedAt`
- 3–6 columns specific to (category × contestFormat) scoring outcome

The aggregate `ContestEntry.totalScore = SUM(contribution)` across all this entry's contribution rows (regardless of which contribution table they live in — the read pattern is `JOIN ContestEntryPick → SUM contribution by entry` per contest's contribution table).

---

## 9. Validity matrix — `tournamentFormat × contestFormat`

Per `rules/architecture-rules.md §2 / "Validity / Compatibility Matrices Source of Truth"`: code-side typed const map.

```ts
// packages/shared/domain/contest-validity.ts
export const VALID_CONTEST_FORMATS_BY_TOURNAMENT_FORMAT: Record<TournamentFormat, ContestFormat[]> = {
  STROKE_PLAY_TOURNAMENT: ['ROSTER'],
  KNOCKOUT_BRACKET:       ['ROSTER', 'BRACKET'],
  SERIES_PLAYOFF:         ['ROSTER'],
  ROUND_ROBIN_SEASON:     ['PICKEM_CONFIDENCE', 'SURVIVOR'],
  WEEKLY_GAMES_SEASON:    ['PICKEM_CONFIDENCE', 'SURVIVOR'],
  TIME_TRIAL_RACE:        ['ROSTER', 'PREDICT_TOP_N'],
  SEASON_OF_RACES:        ['ROSTER'],
  GROUP_STAGE_KNOCKOUT:   ['ROSTER', 'BRACKET'],
  MATCH_PLAY:             ['ROSTER'],
};
```

TypeScript exhaustiveness check: adding a new `TournamentFormat` enum value without updating the map fails the build. Used by:
- Contest-creation API validation (rejects invalid combinations at insert time using persisted `Sport.tournamentFormat` when available, then separately rejects catalog-valid combinations whose configuration/scoring contracts are not implemented yet)
- Contest-creation UI (only shows valid pool formats given the chosen sport; legacy sport-only event payloads use `DEFAULT_TOURNAMENT_FORMAT_BY_SPORT` until event contracts expose `tournamentFormat`)
- Tests

For Phase 4 (golf-roster only), the only creation-supported cell is `STROKE_PLAY_TOURNAMENT × ROSTER`. The full matrix lands in code as future-work-ready scaffolding; cells for unbuilt combos are valid in the domain catalog but remain rejected by create/update paths until the matching configuration, scoring, and UI contracts ship.

---

## 10. Provider adapter normalization

The seam between provider feeds and the typed substrate. Phase 4 normalizes the two adapters that produce golf-roster data; the rest are future-work specs.

### 10.1 Current state (audit Phase 1)

- All adapters return `ProviderStatEvent[]` with `{ statKey: string, statValue: number, round?, rawData? }`. The `statKey` is unvalidated.
- `score-publisher.ts:13` publishes `stat.received` events on the bus carrying the `ProviderStatEvent` payload.
- `stat-event-consumer.ts:119` consumes them and re-reads `SportEventParticipantSourceData.normalizedData` (an opaque JSON column) to compute scores.
- Critical defect: `normalizedData` is written by the **participant-sync** feed, not the **live-score** feed. Live data never reaches scoring. This is `pool-master-rop.1`.

### 10.2 Redesign — typed normalization at the adapter boundary

Each adapter's `getLiveScores(...)` returns a per-category typed result, not a generic `ProviderStatEvent[]`:

```ts
// packages/core-api/src/modules/ingestion/adapters/provider-interface.ts (redesigned)

export interface ProviderAdapter {
  getLiveScores(eventId: string): Promise<LiveScoreResult>;
  // ... other methods
}

export type LiveScoreResult =
  | { category: 'GOLF';       rounds:  GolfRoundUpdate[] }
  | { category: 'BASKETBALL'; games:   BasketballGameUpdate[] }
  | { category: 'F1';         results: F1ResultUpdate[] }
  | { category: 'NFL';        games:   NflGameUpdate[] }
  | { category: 'NASCAR';     results: NascarResultUpdate[] }
  | { category: 'TENNIS';     matches: TennisMatchUpdate[] }
  | { category: 'SOCCER';     matches: SoccerMatchUpdate[] };

export interface GolfRoundUpdate {
  sportEventParticipantId: string;
  round: number;
  strokes: number;
  scoreToPar: number;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'DNF' | 'DSQ';
  completedAt?: string;
}
```

Each adapter implements a single category's `LiveScoreResult` (mock-feed and pga-tour return `category: 'GOLF'`; openf1 returns `category: 'F1'`; etc.).

### 10.3 Bus boundary validation (resolves Q10)

`score-publisher.ts:publishLiveScoreUpdate(...)` — the redesigned single entry-point:

```ts
export async function publishLiveScoreUpdate(result: LiveScoreResult): Promise<void> {
  // Zod-validated by category; typed per-category schemas live in shared/dto
  const validated = LiveScoreResultSchema.parse(result);

  // Persist to the per-category detail table
  switch (validated.category) {
    case 'GOLF':
      await persistGolfRounds(validated.rounds);
      break;
    case 'BASKETBALL':
      await persistBasketballGames(validated.games);
      break;
    // ...
  }

  // Emit typed event for the scoring consumer
  eventBus.publish('live_score.persisted', { category: validated.category, /* ... */ });
}
```

Malformed adapter payloads fail Zod validation at the bus boundary, not at scoring time. No more silent crashes from unexpected `statKey` values.

### 10.4 Single canonical store (resolves rop.1)

`SportEventParticipantSourceData` is **dropped**. Each per-category detail table is the single canonical store for that category's per-participant performance. Both feeds — live-score and participant-sync — write to the same table:

- Live-score feed: writes to `SportEventParticipantGolfRound` etc. as scoring updates arrive
- Participant-sync feed: writes the same tables when post-event detail confirms (e.g., final round results published next morning)

The scoring consumer reads from the per-category detail table; both feeds converge on it.

### 10.5 Mock-feed-provider SDK strategy (Q9 / rop.16)

**Decision: delete the hand-rolled SDK** (`mock-contest-feed-provider/sdk/...`) and consume the generated SDK in `mock-contest-feed-adapter.ts`. The mock-feed exists to exercise the same code path real adapters use; maintaining a parallel SDK creates the very drift we're eliminating elsewhere.

Phase 4 slice covers this; it folds `pool-master-rop.16` into the substrate redesign.

---

## 11. Scoring rule functions

Per-(category × contestFormat) pure functions. Signature:

```ts
type ScoringRuleFunction<
  Detail extends SportEventParticipant<Category>Detail,
  Rules extends ContestScoringConfig,
  Contribution extends ContestEntryPick<Category><ContestFormat>Contribution
> = (input: {
  pick: ContestEntryPick;
  detail: Detail[];      // per-participant detail rows
  rules: Rules;          // contest's scoring config
}) => Contribution[];   // contribution rows to persist
```

### 11.1 Golf-roster (Phase 4)

```ts
function scoreGolfRoster(input: {
  pick: ContestEntryPick;
  detail: SportEventParticipantGolfRound[];
  rules: GolfRosterScoringConfig;  // { roundsCount: 'ALL' | { topN: number } | { specificRounds: number[] } }
}): ContestEntryPickGolfRosterContribution[] {
  const eligible = applyRoundsRule(input.detail, input.rules.roundsCount);
  return eligible.map(round => ({
    contestEntryPickId: input.pick.id,
    round: round.round,
    strokes: round.strokes,
    scoreToPar: round.scoreToPar,
    contribution: round.scoreToPar,
    contributedAt: new Date(),
  }));
}
```

`GolfRosterScoringConfig.roundsCount` covers the variations:
- `'ALL'` — sum all 4 rounds
- `{ topN: 2 }` — sum the best 2 rounds (drops worst)
- `{ specificRounds: [3, 4] }` — weekend rounds only

### 11.2 Designed-deferred (specs)

| Function | Inputs | Output |
|---|---|---|
| `scoreBasketballRoster(...)` | pick + games + `BasketballRosterScoringConfig { basePoints, upsetBonus, ... }` | `BasketballRosterContribution[]` |
| `scoreBasketballBracket(...)` | pick + actual matchup outcomes + `BracketScoringConfig { pointsPerRound: { R64: 1, R32: 2, ... } }` | `BasketballBracketContribution[]` |
| `scoreFootballPickemConfidence(...)` | pick + game result + confidence rank | `FootballPickemConfidenceContribution[]` |
| `scoreF1Roster(...)` | pick + race results + `F1RosterScoringConfig { positionPoints: number[], fastestLapBonus }` | `F1RosterContribution[]` |
| `scoreF1PredictTopN(...)` | pick + final positions + `F1PredictTopNScoringConfig { exactMatchPoints, inTopNPoints, topN }` | `F1PredictTopNContribution[]` |

Each function is pure: same inputs → same outputs; safe to retry; safe to recompute. The scoring-engine harness at `packages/core-api/src/modules/scoring/` invokes the right function based on `Contest.sport.category × Contest.contestFormat` and persists the returned contributions.

### 11.3 Recalc + rollup unification (resolves Q5)

**Decision: kill the periodic rollup; rely on stat-event-driven updates for all entries.**

The redesigned single write path:

```
LiveScoreResult arrives
    → publishLiveScoreUpdate (validated, persisted to detail table)
    → live_score.persisted event
    → for each affected entry: invoke per-(category × contestFormat) scoring rule function
    → persist contributions
    → recompute Entry.totalScore = SUM(contributions)
    → rerank Entries in the affected Contest by totalScore + tiebreakerValue
    → publish standings.updated
```

No periodic rollup. The full-recalculation path stays for explicit triggers (admin override, contest reopen) but is no longer a parallel update mechanism that races with stat-event scoring.

### 11.4 Per-contest scoring lock (resolves Q4)

**Decision: per-contest pessimistic advisory lock** (Postgres `pg_try_advisory_xact_lock(contestId-derived-int)`).

When a stat event triggers scoring for a contest, the consumer:
1. Acquires the advisory lock for that contest in a transaction
2. Performs the score → contribution → rerank cycle
3. Releases the lock at transaction commit

Concurrent stat events for the same contest serialize; events for different contests run in parallel. Lock granularity is per-contest, which matches contention reality (a single contest can have ~50–100 entries; a stat event typically affects all of them).

### 11.5 Transaction boundary (resolves Q6)

**Decision: one transaction per (contest, stat event)** — all entries' scoring + the rerank happen in one atomic block. Partial failures roll back; the next stat event retries from a known-good state.

### 11.6 Debouncing / batching stat events (resolves Q7)

**Decision: no batching at the consumer.** A single stat event for one participant fires N entry recomputations (where N = entries that picked that participant). For golf-roster contests, N is small (~50–100); the per-event latency is acceptable.

If profiling shows otherwise, batching can be added later — but the substrate doesn't bake it in. Premature batching is worse than no batching; the simpler shape ships first.

---

## 12. DTO surface

Per `domain-model-conventions-rules.md §8`: one canonical DTO per entity; permission-driven thin variants only.

### 12.1 Canonical entity DTOs

| Entity | DTO schema | Used by |
|---|---|---|
| `Sport` | `SportDtoSchema` | Sport list, contest creation form |
| `SportEvent` | `SportEventDtoSchema` | Event detail, contest creation form |
| `SportEventParticipant` | `SportEventParticipantDtoSchema` (with full `worldRanking`, `oddsToWin`) | Pre-event participant browse |
| `Contest` | `ContestDtoSchema` | Contest list, detail, dashboard — same shape everywhere |
| `ContestEntry` | `ContestEntryDtoSchema` (full picks, scores, contributions) | Owner detail (pre-event-live), all members (post-event-live) |
| `ContestEntryPick` | `ContestEntryPickDtoSchema` | Embedded in `ContestEntryDtoSchema` |

Per-category detail and per-(category × contestFormat) contribution shapes are exposed via discriminated unions in their parent DTO:

```ts
export const ContestEntryPickDtoSchema = z.object({
  id: z.string(),
  sportEventParticipantId: z.string(),
  period: z.number().nullable(),
  slot: z.number().nullable(),
  tier: z.string().nullable(),
  cost: z.number().nullable(),
  isAutoPicked: z.boolean(),
  contributions: z.discriminatedUnion('contributionType', [
    GolfRosterContributionDtoSchema,
    BasketballRosterContributionDtoSchema,
    BasketballBracketContributionDtoSchema,
    // ... per-(category × contestFormat)
  ]),
});
```

Frontend type-narrows on `contributionType` to render the right UI.

### 12.2 Permission-driven thin variant — `ContestEntryThinDtoSchema`

```ts
export const ContestEntryThinDtoSchema = z.object({
  id: z.string(),
  contestId: z.string(),
  squadId: z.string(),
  squadName: z.string(),
  name: z.string(),
});
```

Used by:
- The "all entries" list view pre-event-live (other-team entries hidden — only owner sees full detail)
- The leaderboard list once the event goes live (full detail shows on row-click; the row itself uses thin)

Once `Event.status >= LIVE`, all members see `ContestEntryDto` for everyone — the thin variant becomes optional. The thin/full split is **permission-driven**, not view-driven, per the rule.

### 12.3 Mutation inputs

Per the rule: derived from canonical schema via `.pick()` / `.omit()` / `.partial()`.

```ts
export const CreateContestBodySchema = ContestDtoSchema.omit({
  id: true,
  status: true,
  totalScore: true,
  rank: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateContestBody = z.infer<typeof CreateContestBodySchema>;
```

### 12.4 Mapper layer

Every route applies a mapper. No more domain-object-emit-raw.

```
packages/core-api/src/mappers/
    sports.mapper.ts                            ← new (was lacking)
    sport-events.mapper.ts                      ← new
    sport-event-participants.mapper.ts          ← new
    contests.mapper.ts                          ← reshape
    contest-entries.mapper.ts                   ← new
    contest-entry-picks.mapper.ts               ← new
    contest-entry-pick-<category>-<contestFormat>-contribution.mapper.ts  ← per combo, new
```

---

## 13. Migration plan

One Prisma migration. Per `rules/model-change-rules.md` "No-Data Clean Reworks" rule.

### 13.1 Current schema state — what actually exists

Verified against `packages/core-api/prisma/schema.prisma` at the time of this plan:

- `roster_picks` (model `RosterPick`) — the only active pick table
- `draft_sessions` (model `DraftSession`) + `draft_pick_histories` (model `DraftPickHistory`) — separate snake-draft mechanism, 22 active call sites; **out of scope for this redesign**
- `contest_picks`, `bracket_predictions`, `draft_picks` — already dropped in earlier migrations; **not present in current schema** (the original audit / earlier draft of this plan referred to them as "zombies to drop"; that was incorrect)
- `participants` — canonical per-sport identity
- `sport_event_participants` — per-event row
- `sport_event_participant_source_data` — opaque JSON storage to be replaced by per-category detail tables
- `participant_season_records` — Codex misinterpretation per design conversation; per-event ranking/odds belong on `SportEventParticipant`
- `sports` — has `stat_schema` JSON column to drop

### 13.2 Drops

- `participant_season_records` (data not used; per-event ranking/odds move to `sport_event_participants`)
- `sport_event_participant_source_data` (replaced by per-category detail tables — `sport_event_participant_golf_round` etc.)
- `participants.metadata` (column drop — per-event metadata now lives on `sport_event_participants`)
- `sports.stat_schema` (column drop)

`draft_sessions` + `draft_pick_histories` are **NOT dropped**. They support snake-draft contest types whose redesign is deferred to a future epic. If/when snake-draft contests are built under the new substrate, that future epic decides whether to fold them into `ContestEntryPick` or keep them as a separate mechanism.

### 13.3 Reshape

- `roster_picks` → renamed to `contest_entry_picks`; add columns: `contest_type` (enum, NOT NULL — denormalized from parent contest, see §7.1), `period?`, `slot?`, `tier?`, `cost?`, `is_auto_picked: Boolean`. Existing rows backfilled with `contest_type = 'ROSTER'` (every roster_pick is by definition a ROSTER pick).
- `sport_event_participants` — add `world_ranking?`, `odds_to_win?`, `seed_number?` columns. Table name stays the same.
- `sports` — add `category` and `tournament_format` enum columns. Table name stays the same.

### 13.4 Adds (new tables)

- `contest_sport_events` (M:N join `Contest` ↔ `SportEvent`)
- `sport_event_participant_golf_round`
- `contest_entry_pick_golf_roster_contribution`

### 13.5 Migration ordering

Single migration file; statements ordered so every FK references an already-existing table:

1. Create new enums (`SportCategory`, `TournamentFormat`, expanded `ContestFormat` if new variants are introduced).
2. Add columns to existing tables (`sports.category`, `sports.tournament_format`; `sport_event_participants.world_ranking`, `.odds_to_win`, `.seed_number`).
3. **Rename `roster_picks` → `contest_entry_picks`** + add new columns (`contest_type` NOT NULL with backfill default 'ROSTER', `period`, `slot`, `tier`, `cost`, `is_auto_picked`). This must precede any new table that FKs to it.
4. Create per-contest-type partial unique indexes on `contest_entry_picks` (per §7.1).
5. Create `contest_sport_events`, `sport_event_participant_golf_round` (no FK to `contest_entry_picks`).
6. Create `contest_entry_pick_golf_roster_contribution` (FK to `contest_entry_picks` — table now exists under that name from step 3).
7. Drop `participants.metadata` column.
8. Drop `sports.stat_schema` column.
9. Drop `participant_season_records` table.
10. Drop `sport_event_participant_source_data` table.

No backfill of cross-table data. Dev/test databases reseed; CI runs the migration on a fresh DB each test run. The single non-trivial backfill (`contest_entry_picks.contest_type = 'ROSTER'` for existing roster_picks rows) is a literal default applied during the rename in step 3.

---

## 14. Frontend implications

### 14.1 TanStack Query key factory (resolves Q12 / pool-master-q8h.A2)

Per the audit's call for a centralized `query-keys.ts` factory:

```ts
// clients/poolmaster/src/lib/query-keys.ts
export const QueryKeys = {
  sports: {
    all: () => ['poolmaster', 'sports'] as const,
    byId: (id: string) => ['poolmaster', 'sports', id] as const,
  },
  sportEvents: {
    all: () => ['poolmaster', 'sport-events'] as const,
    byId: (id: string) => ['poolmaster', 'sport-events', id] as const,
    bySport: (sportId: string) => ['poolmaster', 'sport-events', { sportId }] as const,
  },
  contests: {
    byLeague: (leagueCode: string) => ['poolmaster', 'leagues', leagueCode, 'contests'] as const,
    detail: (contestId: string) => ['poolmaster', 'contests', contestId] as const,
  },
  contestEntries: {
    byContest: (contestId: string) => ['poolmaster', 'contests', contestId, 'entries'] as const,
    detail: (entryId: string) => ['poolmaster', 'contest-entries', entryId] as const,
  },
  // ...
};
```

Replaces the 68 inline `queryKey` shapes the audit found.

### 14.2 Cache-invalidation contract (resolves Q13)

**Decision: hook-wrapper enforcement.** Every mutation hook declares the keys it invalidates:

```ts
const useSubmitEntry = createMutationHook({
  mutation: (body) => submitEntry(body),
  invalidates: (body) => [
    QueryKeys.contests.detail(body.contestId),
    QueryKeys.contestEntries.byContest(body.contestId),
  ],
});
```

The wrapper invalidates declared keys on success. Tests assert `invalidates` returns the expected key list. Keeps the contract visible at every mutation site without adding a runtime registry.

### 14.3 Zustand vs React Query split (resolves Q11)

**Decision (already audit-recommended):** React Query owns server data; Zustand owns ephemeral UI state only.

- `session-store` Zustand state currently mirrors the `getCurrentUser` React Query cache. Phase 4 slice removes the duplicate; consumers read from the React Query cache directly.
- Filter state, modal-open state, draft form values can live in Zustand; nothing that originates from the server does.

### 14.4 Sport-polymorphic rendering pattern

The frontend reads `Contest.sport.category` and `Contest.contestFormat` to choose the right contribution-row component.

```tsx
function ContributionRow({ contribution }: { contribution: ContributionUnion }) {
  switch (contribution.contributionType) {
    case 'GOLF_ROSTER':
      return <GolfRosterContributionRow contribution={contribution} />;
    case 'BASKETBALL_ROSTER':
      return <BasketballRosterContributionRow contribution={contribution} />;
    // ... per (category × contestFormat)
    default:
      return assertNever(contribution);
  }
}
```

TypeScript exhaustiveness check at the `default` case forces every new (category × contestFormat) combo to be handled before the build passes.

### 14.5 Entry list ↔ Leaderboard transition

Pre-event-live: `/league/:code/contests/:id` shows the entries list (thin DTOs) with the current user's full entry detail expanded.

Once `Contest.firstEventStartedAt < now` (event live): same route renders the Leaderboard view — full DTOs for all entries, sorted by `totalScore + tiebreakerValue`.

The component switches based on event state; the route is stable. Deep links to `/league/:code/contests/:id` resolve correctly regardless of contest lifecycle.

---

## 15. Test surface

### 15.1 FAPI scenario for live-scoring (resolves Q15 / rop.15)

Single FAPI scenario that exercises the full pipeline:

1. Fixture: golf tournament `SportEvent` with 4 `SportEventParticipant`s; one `Contest` with `contestFormat: ROSTER`, 2 `ContestEntry`s each with 2 `ContestEntryPick`s.
2. Mock-feed adapter emits `LiveScoreResult` with `category: 'GOLF'`, 4 `GolfRoundUpdate`s for round 1.
3. Assert: persisted `SportEventParticipantGolfRound` rows match the input.
4. Assert: `live_score.persisted` event fired.
5. Assert: scoring consumer wrote `ContestEntryPickGolfRosterContribution` rows.
6. Assert: `ContestEntry.totalScore` updated.
7. Assert: standings rerank correct.
8. Assert: `standings.updated` event fired with the rerank payload.

This is the regression detector the audit flagged as missing. Lives at `tests/functional/live-scoring-golf-roster.functional.ts`.

### 15.2 Per-scoring-rule unit tests

One file per scoring rule function. Tests cover:
- Empty detail → empty contributions
- Single round → single contribution
- Full tournament → full contribution set with correct sum
- Edge cases per scoring rule (DNF, DSQ, top-N rounds-count rule, etc.)

Lives at `tests/unit/core-api/scoring-rules/`.

### 15.3 Contract verification

For each new DTO + each new mapper:
- `tests/integration/core-api/contract-verification-<area>.integration.ts` — asserts API response matches DTO schema
- Generated SDK type tests assert the Zod schema's type narrowing matches the wire format

### 15.4 MSW migration strategy (resolves Q14)

**Decision: page-by-page**, opportunistic.

For Phase 4 substrate slices that touch a frontend page, MSW handlers replace `vi.mock('@/lib/api')` for that page. Pages not touched in Phase 4 keep `vi.mock` as the existing baseline (per `pool-master-rop.4` / `rop.71`). This avoids a "drop everything to migrate MSW" detour that doesn't ship product value.

### 15.5 Test impact rule

Per `rules/model-change-rules.md` §5A: any persisted field change triggers an impact sweep. For Phase 4 slices, that includes the FAPI scenario above plus any browser/MSW tests on the affected pages.

---

## 16. Phase 4 implementation slices

Slice ordering per audit §9 Q17 dependency analysis. Each slice is a Beads child of `pool-master-rop.78` with ID `rop.78.<N>`. Each slice produces one PR with multi-pass review.

### 16.1 Slice ordering

```
rop.78.4  Substrate Prisma migration (drops + reshapes + adds; foundation)
rop.78.3  Provider adapter normalization + LiveScoreResult typing
rop.78.5  Sport / SportEvent / SportEventParticipant DTOs + mappers
rop.78.6  ContestEntryPick unification + mapper
rop.78.7  Golf-roster contribution table + scoring rule function
rop.78.8  Per-contest scoring lock + recalc/rollup unification
rop.78.9  Frontend TanStack Query key factory (q8h.A2 fold-in)
rop.78.10 Frontend cache-invalidation hook wrapper
rop.78.11 Frontend Zustand session-store cleanup (rop.18 fold-in)
rop.78.12 FAPI live-scoring scenario (rop.15 fold-in)
rop.78.13 Mock-feed-provider SDK consolidation (rop.16 fold-in)
rop.78.14 Validity matrix const map + contest-creation gating
```

Dependencies:
- `.3` depends on `.4` (the typed substrate is the persistence target the
  normalized adapter writes into; per the design conversation correction the
  schema lands first so adapter normalization can target real columns rather
  than legacy JSON blobs)
- `.5–.7` depend on `.4` (tables exist)
- `.8` depends on `.7` (scoring rule must exist before locking)
- `.9–.11` are frontend; can run in parallel with backend slices
- `.12` depends on `.7` + `.8` (full pipeline must work)
- `.13` depends on `.3` (typed adapter interface is the integration target)
- `.14` is foundational scaffolding; can run anytime

### 16.2 Existing rop.* re-parented under rop.78 (resolves Q16)

Per audit §8.2 fold-in plan:

| Defect | Action |
|---|---|
| `rop.14.2` (LeagueDashboardResponseSchema league field) | Folds into `rop.78.5` |
| `rop.14.3` (LeagueDashboardResponseSchema contests field) | Folds into `rop.78.5` |
| `rop.14.4` (LeagueBulkOperationResponseSchema split) | Stays independent (Phase 5 cleanup) |
| `rop.14.5` (latestPerformance / cross-provider performance) | Folds into `rop.78.3` (provider normalization) |
| `rop.18` (Zustand session-store mirror) | Folds into `rop.78.11` |
| `rop.7 / .8 / .11 / .12` (scoring race conditions) | Folds into `rop.78.8` |
| `rop.1` (live-scoring decoupled) | Folds into `rop.78.3` + `rop.78.7` (the substrate fix is the resolution) |
| `rop.16` (mock-feed-provider SDK) | Folds into `rop.78.13` |
| `rop.15` (FAPI live-scoring scenario missing) | Folds into `rop.78.12` |
| `rop.4`, `rop.10`, `rop.21`, `rop.22`, `rop.23`, `rop.71` | Stay under `rop.71` epic (test infrastructure track; informed by new DTOs but separate workstream) |
| `rop.14.1`, `rop.62`, `rop.65`, `rop.20` | Already shipped; no action |

### 16.3 Slice closeout convention

Each slice's PR follows the multi-pass review flow. Each Beads child closes with a `close_reason` summarizing files changed, defect proof, and gates run. The `rop.78` umbrella stays open until all `rop.78.<N>` children close; then it closes and this plan file is deleted (per ADR-0002).

---

## 17. Audit §9 question disposition

The Phase 1 audit listed 17 open questions for Phase 2. Each is resolved-by-design somewhere in this plan, deferred to a Phase 4 slice, or left as a Phase 1 snapshot.

| Q | Topic | Disposition |
|---|---|---|
| Q1 | Canonical "League summary" DTO | **Resolved** — §2 governing principle #2 (one canonical DTO per entity) + the rule landed in `domain-model-conventions-rules.md §8` (canonical full-shape DTO; permission-driven thin variants only). League DTO is league-scoped and stable; this redesign doesn't reshape it. |
| Q2 | Canonical "Contest summary" DTO | **Resolved** by §12.1 — `ContestDtoSchema` is the single canonical DTO used for list, detail, and dashboard. |
| Q3 | Canonical `ContestEntry` DTO including `latestPerformance` | **Resolved** by §12.1 — `ContestEntryDtoSchema` is canonical; the equivalent of `latestPerformance` is the typed `contributions` discriminated union (§12.1 example), backed by per-(category × contestFormat) contribution tables. |
| Q4 | Locking strategy for concurrent stat events | **Resolved** by §11.4 — per-contest pessimistic advisory lock. |
| Q5 | Recalc + rollup unification | **Resolved** by §11.3 — kill periodic rollup; stat-event-driven only. |
| Q6 | Transaction boundary for per-stat-event scoring | **Resolved** by §11.5 — one transaction per (contest, stat event). |
| Q7 | Debouncing / batching of stat events | **Resolved** by §11.6 — no batching; per-event latency is acceptable for office-pool sizes. |
| Q8 | Canonical `LatestPerformanceSnapshotDto` shape (tagged union vs generic) | **Resolved by design** — §6 + §8 collapse the question. Per-category detail tables (§6) and per-(category × contestFormat) contribution tables (§8) replace the polymorphic single shape with physically separate typed tables. There is no `LatestPerformanceSnapshotDto`; performance data lives in typed per-sport tables. |
| Q9 | Mock-feed-provider SDK strategy | **Resolved** by §10.5 — delete the hand-rolled SDK, consume the generated SDK in `mock-contest-feed-adapter.ts`. Folded into Phase 4 slice `rop.78.13`. |
| Q10 | `ProviderStatEvent` validation at the bus boundary | **Resolved** by §10.3 — Zod-validated `LiveScoreResult` at `publishLiveScoreUpdate`. |
| Q11 | Zustand vs React Query split | **Resolved** by §14.3 — React Query owns server data; Zustand owns ephemeral UI state only. Folded into Phase 4 slice `rop.78.11`. |
| Q12 | Per-feature `query-keys.ts` factory | **Resolved** by §14.1 — central factory shape. Folded into Phase 4 slice `rop.78.9`. |
| Q13 | Cache-invalidation contract enforcement | **Resolved** by §14.2 — hook-wrapper that declares invalidations per mutation. Folded into Phase 4 slice `rop.78.10`. |
| Q14 | MSW migration strategy | **Resolved** by §15.4 — page-by-page, opportunistic. |
| Q15 | E2E FAPI test scenario for live-scoring | **Resolved** by §15.1 — single FAPI scenario covering the full pipeline. Folded into Phase 4 slice `rop.78.12`. |
| Q16 | Re-parent existing rop.* defects under rop.78 | **Resolved** by §16.2 — fold-in plan per audit §8.2. |
| Q17 | Phase 4 slice ordering | **Resolved** by §16.1 — 12 slices in dependency order. |

## 18. Open questions for Phase 4

These are deliberately deferred — not blocking on Phase 2 sign-off. Each surfaces during its corresponding slice and gets a small design call there.

1. **Per-contest scoring lock implementation detail.** Postgres advisory lock identifier derivation: hash(contestId)? bigint(contestId substring)? Phase 4 slice `rop.78.8` decides.
2. **Tiebreaker semantics across contest types.** Bracket pools use `tiebreakerValue = predicted NCG total points`. What's the equivalent for other contest types? Not blocking — Phase 4 slices add per-contest-type tiebreaker columns as needed.
3. **Provider adapter retry / backoff on validation failure.** When a provider's `LiveScoreResult` fails Zod validation, does the adapter retry the call? Log and skip? Phase 4 slice `rop.78.3` decides.
4. **Migration of `sports.name` granularity.** Some current `Sport` rows are coarse (`GOLF`); the redesign expects granular (`PGA Masters` etc.). Migration writes a default `category` and `tournament_format` for each existing row, but the granular per-tournament rows are added per-tournament as live data arrives. Phase 4 slice `rop.78.4` decides whether to seed historical tournaments or wait for the live-scoring slice.
5. **Future fold-in of `DraftSession` / `DraftPickHistory` into `ContestEntryPick`.** Snake-draft contests are out of scope for this redesign. When a future epic builds a snake-draft contest type under the new substrate, that epic decides whether to fold the existing `draft_sessions` + `draft_pick_histories` tables into `ContestEntryPick` or keep them as a separate mechanism.

---

## 19. What this plan does NOT cover

- **Auth / authz.** Permission boundaries are mentioned in §12.2 (thin/full DTO) but the actual permission predicates live in existing auth middleware. No changes.
- **League / squad / membership entities.** The substrate redesign does not touch the `League`, `LeagueMembership`, `Squad`, or invitation tables. Those are stable.
- **Notifications.** Standings updates fire `standings.updated` events as today; downstream notification routing is unchanged.
- **Admin tooling.** Root-admin contest management uses the same DTOs as commissioner UI. No separate admin substrate.
- **Mobile clients.** iOS / Android consume the same generated SDK. No mobile-specific design here.

---

## 20. Phase 3 review gate

This plan does not auto-progress to Phase 4. The user reviews this document, pushes back on framing or open decisions, and signs off before any `rop.78.<N>` implementation slice spawns.

**How to review:**
- Walk through §§4–11 and confirm the typed entity model + scoring flow matches your intent.
- Verify §13 migration plan is acceptable (it's a clean break — no data preservation).
- Confirm §16 slice ordering matches your priority preferences. Reorder freely.
- Flag any design decision in §10 / §11 you'd like to revisit (the "Decision:" lines are leans, not locks).
- Section 17 open questions are intentionally deferred to Phase 4 slices. Signal if any should be promoted to a Phase 2 lock.

When signed off, Phase 4 slice `rop.78.3` opens.
