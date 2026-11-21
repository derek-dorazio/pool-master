# League Model Redesign: Seasons, Phases, Slots, and Clutch Cards on the Parent League

**Tracking issue:** #1917

Agreed with Derek in the project thread "Sync Clutch Cards through their parent league"
(2026-11-19 to 2026-11-21). It began as "sync every Clutch Card league through its parent"
and became a redesign of how every Sport league is modelled, because Derek called the model
"foundational to the entire product". No slice is dispatched until the model, design and
ticket reviews are done and Derek gives the go.

Names are design names built from their owners (SportLeagueSeasonPhaseSlot, …). A naming
pass may shorten them before build; the shape does not change with it.

## Why

The current model was built one sport at a time and leans on code to look right:

- A season is a bare `SportEvent.eventYear`, with a hand-set `SportLeague.currentEventYear`
  and five other rules for "the current year" that disagree (web `getFullYear()` fallbacks,
  the overview's `seasonOf`, the sync's UTC year).
- Round counts, round names, series lengths, preseason skipping, "which round is the final",
  the CFP date window and season rollover months are tables and constants in each adapter.
- Recurring events are an `EventSeries` found by name; event pages and contest templates
  match series by name strings.
- A best-of series is one `SportEventMatch` with no game rows; advancement is addressed by a
  match number across the whole event (Super Bowl = match 13).
- A player's team is free text (`Participant.teamAffiliation`) with no season.
- Clutch Cards exist as about 20 separate stat-pool leagues, one per playoff round, because a
  league's field could be only teams or only players. Each overrides `participantType` and
  `scoringFamily`, links to its parent by `parentSportLeagueId` + `parentRoundNumbers` and
  `SportEvent.parentEventId` found by date overlap, treats each game as a golf round, and is
  synced by a separate path (only the NBA's was built).

The redesign moves those facts into rows that every reader shares.

## The model

Three layers, all owned by a SportLeague, plus participants and providers.

### 1. Definitions ("enums with properties")

Timeless, one set per league, set by migration.

- **SportLeaguePhase**: `phase` enum (PRESEASON, REGULAR, POSTSEASON) with explicit order;
  `isSynced` (non-null). An unsynced phase (NFL PRESEASON) gets no slots and no events.
- **SportLeaguePhaseSlot**: a position within a phase and the strong key everything links on.
  `key`, `order` (order lives only here), `awardsTrophy`, `seriesFormat` (SINGLE_GAME,
  BEST_OF, AGGREGATE) with `seriesGames` (checked: SINGLE_GAME 1, AGGREGATE 2, BEST_OF odd
  ≥ 3), `pairing` (FIXED, RESEEDED).
  - Keys are structural and shared by all leagues, counted back from the final: PLAY_IN,
    ROUND_OF_64, ROUND_OF_32, ROUND_OF_16, QUARTERFINAL, SEMIFINAL, THIRD_PLACE, FINAL;
    REGULAR uses WEEK_1…WEEK_n. Display labels ("Super Bowl", "Wild Card") come from a UI map
    of league + key.
  - Open phases (golf, tennis) have one definition per recurring tournament (MASTERS,
    THE_OPEN, JOHN_DEERE_CLASSIC…).
  - A format change (CFP from 2 rounds to 4) is a data change; SEMIFINAL is SEMIFINAL every
    Season. Definitions carry no from/to season.
- **SportLeaguePhaseSlotProviderMapping**: one row per slot per provider. `matchType`
  PROVIDER_CODE (structured phases, by migration), NAME_PATTERN (open phases), DATE_WINDOW
  (feeds with no round marker, e.g. NCAAF postseason).
- **SportLeaguePosition**: code, order, `isFieldEligible`, `baselineRating`, with provider
  code mappings. NFL eligible: QB, RB, WR, TE (not K: Redzone counts no kicking stats).

### 2. Calendar

The real slots each Season. No participants or scores.

- **SportLeagueSeason**: `providerSeason` (unique per league); may span two years.
  `SportLeague.currentSeasonId` points at one, set by the sync with one global rule: the
  Season whose slot dates include today; between Seasons, the next once its schedule is
  published, otherwise the last. Replaces `currentEventYear` and every year fallback.
- **SportLeagueSeasonPhase**: FK to its phase definition.
- **SportLeagueSeasonPhaseSlot**: FK to its slot definition, `startsAt`, `endsAt`, `status`
  (SCHEDULED, IN_PROGRESS, COMPLETED). No order of its own.

Why Season is back: it was removed in October (plan 147, #315) because it gave an event two
parents (Season and EventSeries), earned little, and was a branded year. Now an event has one
parent (its Season), the Season owns phases, slots and the current pointer, and it spans real
dates.

### 3. Sporting events (what contests are played on)

- **SportLeagueSeasonEvent** (today SportEvent): a real-world event in one Season covering
  one or more of its slots through **SportLeagueSeasonEventSlot**; `slotScope` SINGLE_SLOT /
  MULTI_SLOT, checked against the slot count. NFL Week 14 covers WEEK_14; the NFL postseason
  is one MULTI_SLOT event over four slots. EventSeries is removed; nothing has a parent event.
- **…EventFieldParticipant** (today SportEventParticipant): one participant in one event's
  field (seed, tier, price, play-in place, withdrawn), pointing at the league's Participant.
  The same team in two events is one Participant in two field rows.
- **…EventRound**: a scoring unit in the event, numbered within it, with a **required** FK to
  the slot it plays in (a week event's round 1 → WEEK_14; postseason round 2 → QUARTERFINAL;
  all four Masters rounds → MASTERS).
- **…EventRoundMatch**: two sides meeting in a round; a best-of series is one Match. Numbered
  within its round in kickoff order and stable once assigned. Advancement is a match FK plus a
  side.
- **…EventRoundMatchGame**: one played game: date, status, score, `providerRef`. Every Match
  has at least one, so scores and provider ids always live on the Game. World Series = one
  Match; Game 4 = one Game.

### Participants

- **Participant**: a team or player of the league; `participantType` TEAM / INDIVIDUAL is kept
  on the row because a TEAM league now holds both. `SportLeague.participantType` becomes
  required (set by migration) and `Sport.participantType` (and the code registry copy) goes.
- **SportLeagueSeasonParticipantTeam**: a player's team and position in one Season (season,
  player FK, team FK, position FK, `rating`). Written by the roster sync for TEAM leagues.
  Replaces `teamAffiliation`. There is no player→team FK on Participant itself.

### Providers

- **Provider** enum; **ProviderLeague** (provider + provider-owned code + sport);
  **SportLeagueProviderMapping** per league and provider, with
  `SportLeague.selectedProviderMapping` (null = not synced) replacing `eventSyncProviderId`
  and `matchKeyword`.
- **SportLeagueSeasonEventProviderMapping** replaces `SportEvent.providerId` / `externalId`;
  **ParticipantProviderMapping** keeps its rows with the provider as the enum.
- Convention: a *Ref* is one provider id on a row; a *ProviderMapping* is a table with one row
  per provider.
- Switching providers is gated: add a mapping, run re-mapping (findings for anything it cannot
  pair), then select it; refused with 409 `PROVIDER_SWITCH_NOT_READY` while an ERROR finding
  is open.
- **ProviderSyncFinding**: severity (ERROR, WARNING, INFO), kind, subject ids, detail, status
  (OPEN, RESOLVED, WAIVED with a required note). A re-run resolves what now pairs.

### Player stats and scores

- **…EventRoundMatchGamePlayerStat**: the raw box score, one row per player per Game per stat
  code (the existing `SportStat` codes), with the team he played for stored on the row.
- **Composite definitions** (Redzone, Triple Threat, Box Score, Power Play, Hat Trick) move from
  the sport definitions in code to rows: weights per stat code, platform level, each league
  picks one. Clutch Cards stay composite only (Derek, 2026-10-23): no per-contest stat choice.
- **…EventRoundMatchGamePlayerScore**: the composite value per player per Game, written by one
  writer when that Game's stat rows change. Contests read only these rows.

## How the sync builds it

1. **Seasons**: fetch the current Season's `providerSeason` and the next; a league's first
   Season comes from the migration that adds it. No rollover-month constants.
2. **Slots**: only synced phases. One adapter per provider, knowing nothing about leagues,
   reduces each game to a provider code (`REG:5`, `POST:3`, a tournament id). The slot
   mappings match it: PROVIDER_CODE first; NAME_PATTERN for open phases on first sight
   (normalized name: case, year and "presented by" removed; one match links, none creates a
   definition with a WARNING, two give an ERROR; a linked tournament matches by id after
   that; a sponsor rename is merged by an admin, adding a pattern); DATE_WINDOW for feeds with
   no marker, using Season slot dates an admin enters (#1924). No match = ERROR finding.
   Name matching happens only here, and only where the feed gives nothing better.
3. **Events** are created and kept current in their Season (ADR 0011), slots linked as they
   are established.
4. **Field, rounds, matches, games**: teams, and in TEAM leagues the eligible players, into
   the field; games under their match in the round for their slot.
5. **Slot status**: the one Game writer queues a "refresh slot status" job (deduped per slot)
   on any Game status change, written with the change (`JobsForWrite`). The job recomputes the
   slot (any Game started = IN_PROGRESS; every Game final, cancelled or postponed out =
   COMPLETED) and, on a change, queues the follow-ups listed in one function: player ratings
   on COMPLETED, results emails, notifications. A rescheduled game can move it back.
6. **Current Season** pointer.

Rosters are their own step for TEAM leagues on a global interval setting (default daily),
taking over the deferred Participants sync (#1859). BALLDONTLIE NFL: `players/active`
(league-wide, team + position, about 17 pages); ineligible positions are dropped while reading
and never stored. Box scores come from `stats?game_ids[]` (NHL `player_period_stats`).

## Features that read the model

- Event page offers point at a slot definition (NFL FINAL, PGA MASTERS) and resolve to the
  current Season's events on it.
- Contest template collections (the majors) point at slot definitions and collect per Season.
- Bracket round count, final and labels come from the event's slots.
- Perpetual trophies (parked, minor): slot definitions with `awardsTrophy`; identity = set of
  covered slot definitions + contest type.
- Rule (now `rules/domain-model-conventions-rules.md` §17): no lookup, join or unique
  constraint on a name or label.

## Clutch Cards on the parent league

- **A contest type, not a league or an event format.** A Clutch Card contest covers any set of
  the parent league's slots in one Season, across phases. "Playoffs" (every POSTSEASON slot) and
  "Super Bowl" (FINAL) are contest templates pointing at slot definitions.
- **Field**: the eligible players of the event's teams, as INDIVIDUAL field rows. A contest's
  pick list is those whose team still plays in the covered slots. No field-size cap: injured
  and reserve players stay pickable; ratings sort starters up. Use a tier profile without a
  capped last tier.
- **Scoring**: entry standing = sum of its picks' GamePlayerScore over the covered Games, with
  the setup's N-of-M rule. Contests hold only slots, setup, picks and standings.
- **Removed**: the Clutch Card leagues, `parentSportLeagueId`, `parentRoundNumbers`,
  `parentEventId`, the 10-minute delayed sync, `isClutchCardLeague`. Test data moves to the
  parent leagues; the `add-clutch-card-league` skill is rewritten or retired.
- **Trade-off accepted**: leagues whose feed has no player stats get no Clutch Card (fits the
  sync-only rule). Position quotas on a card are deferred.

## Player rating (tiering and pricing players)

- `rating` on the Season roster row: the average GamePlayerScore over the player's last 4 team
  games (a game not played = 0), dropping the lowest 1. A short or empty window blends in the
  position's `baselineRating` (seeded estimates, e.g. NFL Redzone QB 35, RB 15, WR 13, TE 9).
  No position multiplier: the composite already weights positions. Weights live in a
  platform **player rating profile** that each league picks.
- Computed by a job queued once when a slot becomes COMPLETED. If a player lacks history for
  the window (Week 1, a postseason after an unsynced regular season), the job first backfills
  those box scores; if none exist, rating 0 and a WARNING finding with Re-run.
- Tiering and pricing sort the whole field (teams by odds > seed > rank, players by rating);
  frozen at release as today. No odds and no injuries (deferred, #1934).

## Removed or changed

- Removed: EventSeries; `SportEvent.eventSeriesId`, `eventYear`, `providerId`, `externalId`;
  `SportEventMatch.externalGameId`; `SportLeague.currentEventYear`, `matchKeyword`,
  `eventSyncProviderId`, `roundNames`, `roundSeriesLengths`, `parentSportLeagueId`,
  `parentRoundNumbers`, the `participantType` / `scoringFamily` overrides' Clutch Card use;
  `SportEvent.parentEventId`, `parentRoundNumbers`; `Sport.participantType`;
  `Participant.teamAffiliation`; `SportEventParticipantStatLine` (replaced by GamePlayerStat).
- Renamed: SportEvent, SportEventParticipant, SportEventMatch to the design names above.
- Changed: `EventPageOffer.eventSeriesName` and `ContestConfigTemplate.eventSeriesNames` →
  slot definition ids; `ParticipantProviderMapping.providerId` → Provider enum.

## Slices

Live state is in the sub-issues of #1917. Narrative order: providers foundation; phase and slot
definitions; seasons and calendar; Round › Match › Game; sync onto the mapping table with slot
status; rosters and positions; player stats and scores; player rating; Clutch Card contest
type; admin screens. Each migration slice merges alone. Related, already filed: #1924 (slot
dates for feeds with no marker), #1926 (bracket model, incl. `pairing` and series format
readers), #1933 (sync cadence by season state), #1934 (injuries, deferred), #1928 and #1929
(shared rules, independent).

## Durable decisions to codify

Before this plan is deleted: an ADR for the Season / Phase / Slot model and Clutch Cards as a
contest type (superseding the round-league design); `rules/domain-model-concepts.md` updated
for Season, Phase, Slot, Game and the roster row; `docs/LIVE-SPORTS-DATA-SYNC.md` rewritten for
the mapping-table sync.

## Open questions

- Naming pass: shorten the design names (e.g. drop the SportLeagueSeason prefix inside the
  event levels) before slice 1 is built.
- Bracket shape (field size, regions, seed pairings, neutral final) is #1926, after the core.
- PGA POSTSEASON (FedEx Cup: field shrinks across three events) is modelled later.
- "Slate" (a subset of a slot's matches, e.g. NFL Sunday early window) is reserved for a later
  contest scope.
