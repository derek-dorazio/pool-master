# ADR 0012: Leagues Have Seasons, Phases and Slots; Contests Cover Slots; Clutch Card Is a Contest Type

- **Status:** Accepted
- **Date:** 2026-11-23
- **Amends:** [ADR-0011](./0011-provider-sync-creates-events.md)
- **Supersedes:** the Clutch Card round-league design (a stat pool sport league per playoff
  round, synced from its parent league's event, #1820), which was recorded in
  `rules/architecture-rules.md` §4 rather than as an ADR

## Context

The sport side of the model was built one sport at a time and leans on code to look right.
A season is a bare `SportEvent.eventYear` plus a hand-set `SportLeague.currentEventYear`, and
five readers disagree on "the current year". Round counts, round names, series lengths,
"which round is the final", a playoff's date window and rollover months sit in adapter
constants per league. Recurring events are an `EventSeries` found by name, and event pages
and contest templates match series by name. A best-of series is one match with no game
rows, and each scoring family keeps its own result tables (golf rounds, race results). What
a contest covers is stored three ways: whole events, one squares match, or a bracket's start
round. Clutch Cards are about twenty separate stat-pool leagues, one per playoff round, that
copy the parent league's games through their own sync path, built for one league only.

Every one of these is a fact about a league or a season held in code or matched by name,
the opposite of `rules/domain-model-conventions-rules.md` §17 *Rules Live In The Model, Not
In Code*. Settled with Derek, 2026-11-19 to 2026-11-23; the slices are epic #1917.

## Decision

**The event side mirrors the real world as the feeds report it and stores each real thing
once. The contest side decides what a contest is played on, by covering Season slots.**

- **A league's calendar is model rows.** Timeless definitions per league, set by migration:
  phases (PRESEASON / REGULAR / POSTSEASON) and slots in each phase (a week, a playoff round,
  a recurring tournament), each slot with a key, a kind, an optional proper name and its
  default series format. Each real Season copies them into Season phases and Season slots
  with dates and a status. The current Season follows one global rule from the Season's
  dates.
- **Events sit in a Season and cover slots.** A `SportEvent` gains a Season and covers one or
  more of its slots; a slot belongs to at most one event. Under it, Round → Match → Game:
  a Match is any meeting of two or more sides (two teams, two players, or a whole field), a
  best-of series is one Match, and a Game is one game played. Results are Game side rows for
  every sport; the per-family result tables go.
- **Every provider key lives in a `…ProviderMapping` table**, inclusion only. The provider
  itself becomes a table, so its settings are rows rather than environment config. The
  feed is the source of truth for what it supplies.
- **Contests cover Season slots.** A contest template names the slots it covers (a list of
  slot definitions or a whole phase); a contest copies them, resolved to its Season, into
  `ContestSeasonSlot`, the only record of what it covers. Readiness, cutoff, pick windows,
  settlement and history are keyed by covered slots. Contests hold no team, player or match
  data, only covered slots, setup, picks and standings.
- **Clutch Card is a contest type on the parent league.** It covers the parent league's slots,
  picks the parent event's player field rows and scores from per-Game player stats. The
  round leagues, their parent columns and their separate sync are removed.
- **Every active league is provider-synced.** A league with no feed stays switched off; there
  is no second, admin-authored path for a live league.

### What this changes in ADR 0011

ADR 0011 stands: for a synced league, the sync creates and keeps its events. It is amended in
three ways:

- The sync creates events **in their Season and for the slots a template covers**, matched
  through slot provider mappings, not through invented scope ids, `match_keyword` or series
  names.
- An event's **status is derived from its slots**, which follow their Games' status from the
  feed (Game → Match → Slot → Event, on the domain event handler map), not from its dates by
  the lifecycle scheduler. A COMPLETED slot is final.
- ADR 0011's fallback for "leagues with no feed" ends: such a league is off. Admin edits
  remain for correcting a feed's mistake.

## Consequences

- A new league, season or format is data: definition rows by migration and mapping rows,
  with no adapter constants and no code per league.
- Partial coverage (one round, the last two rounds, one game of a Finals) is one mechanism
  for every contest type, and a Clutch Card on any round needs no new league.
- Golf, racing and team sports share one result shape, so leaderboards, status and scoring
  read the same tables; a family differs only in its scoring function.
- A league whose feed has no player stats gets no Clutch Card, and a league no provider
  covers cannot be offered at all.
- No data is migrated. QA is rebuilt and the migration history squashed when the core lands.
- The rules that govern code not yet written land first: `rules/domain-model-conventions-rules.md`
  §9, §10, §11 and §17, `rules/domain-model-concepts.md` §5 *The Target Model*,
  `rules/workflow-rules.md` §1 and `rules/review-triggers.md` §9. Each slice updates the
  docs it changes.

## Alternatives considered

- **Keep `EventSeries` and match recurring events by name.** Rejected: names change, and a
  slot definition already gives the cross-Season identity by key.
- **Keep a stat pool league per playoff round for Clutch Cards.** Rejected: it copies the
  parent's games, needs its own sync per league, and a card on a new round needs a new
  league. Covering the parent league's slots needs none of that.
- **A versioned per-league round format instead of slot rows.** Rejected: a format change is
  a data change on the definitions, and each Season keeps the series format it was created
  with.
- **A longer `SportLeagueSeasonEvent` name for events.** Rejected: it lengthens every event
  table's name; `SportEvent` keeps its name and gains a Season foreign key.
- **Keep unsynced leagues live with admin-authored events.** Rejected: a second path for a
  shrinking set of leagues, and the one that let league facts drift into code.
