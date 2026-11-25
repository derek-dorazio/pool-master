# League Model Redesign: Seasons, Phases, Slots; Contests Cover Slots

**Tracking issue:** #1917

Agreed with Derek in the project thread "Sync Clutch Cards through their parent league",
2026-11-19 to 2026-11-21, and revised after a model, design and ticket review. Derek gave the go to implement on
2026-11-24; slice 0 (ADR 0012, #1979, #2037) is done.

See *Names* for every table, old and new.

## Names (settled with Derek 2026-11-22)

Full-path names built from their owners. Platform settings that a league picks are named
`Platform…Profile` (Derek 2026-11-23). Today's `SportEvent` prefix is kept, so an event
does not carry `Season` in its name: it gains a `seasonId` FK instead (Derek: a longer
`SportLeagueSeasonEvent` would lengthen every event table's name). Every provider id or
code lives only in a table whose name ends in `ProviderMapping`.

| Today | New | What it is |
|---|---|---|
| `SPORT_DATA_PROVIDER_BINDINGS_JSON`, webhook provider list, adapter constants | `Provider` (table) | One row per data provider, with its settings (Derek 2026-11-22). |
| `BALLDONTLIE_WEBHOOK_GAME_LEAGUES` and other per-league adapter constants | `ProviderLeague` | The provider's own list of leagues: provider, its code, sport, webhook timing. |
| `SportLeague.eventSyncProviderId`, `matchKeyword` | `SportLeagueProviderMapping` | Links a league to a ProviderLeague; `SportLeague.selectedProviderMapping` picks the one synced. |
| none | `SportLeaguePhase` | Timeless phase definition: PRESEASON, REGULAR, POSTSEASON. |
| none | `SportLeaguePhaseSlot` | Timeless slot definition in a phase: WEEK 14, WILD_CARD, FINAL, MASTERS. |
| none | `SportLeaguePhaseSlotProviderMapping` | How a provider's games match a slot. |
| none | `SportLeaguePosition` | QB, RB, WR, TE, with field eligibility and a baseline rating. |
| none | `SportLeaguePositionProviderMapping` | A provider's position codes. |
| `SportLeague.currentEventYear` | `SportLeagueSeason` | One real Season, with its date span. |
| none | `SportLeagueSeasonProviderMapping` | A provider's season id. |
| none | `SportLeagueSeasonPhase` | A phase in one Season. |
| none | `SportLeagueSeasonPhaseSlot` | A slot in one Season: dates, status, series format. |
| team conference/division in `metadata` JSON | `SportLeagueConference`, `SportLeagueConferenceDivision` (+ `…ProviderMapping` each) | A league's conferences (AFC, American League, Big Ten) and their divisions (AFC East); set by migration. |
| none | `SportLeagueSeasonTeamConference` | One row per Season and team: conference required, division optional, composite FK keeps the division inside the conference. |
| `Participant.teamAffiliation` | `SportLeagueSeasonParticipantTeam` | Roster row: one per Season and player, with team, position and rating. |
| `Participant` | `Participant` (same) | A team or player, across Seasons. |
| `ParticipantProviderMapping` | same name | Provider ids for a participant; `providerId` becomes a `Provider` FK. |
| `EventSeries` | removed | Cross-Season identity now comes from slot definitions. |
| `SportEvent` | `SportEvent` (same name) | A real event in one Season; gains `seasonId`. |
| none | `SportEventSlot` | Which Season slots an event covers; a slot belongs to at most one event. |
| `SportEvent.providerId`, `externalId` | `SportEventProviderMapping` | A provider's event id. |
| `SportEventParticipant` | same name | The event's field: teams, plus eligible players where Clutch Cards exist. |
| `SportEventTier` | `SportEventSlotTier` | Tier set per event slot. |
| `SportEventParticipantValuation` | `SportEventSlotParticipantValuation` | Tier and price per event slot and field row. |
| `SportEventRound` | same name | A scoring unit; gains a required slot FK and its `matchFormat`. |
| `SportEventMatch` | `SportEventRoundMatch` | Any meeting of sides in a round: two teams, two players, or a whole field. A best-of series is one Match. |
| `SportEventMatch` home/away columns | `SportEventRoundMatchSide` | One side of a Match: field row (empty until known), side number, spread, rollup outcome. Home/away is on the Game side result; seed on the field row. |
| none | `SportEventRoundMatchGame` | One played game: date, status, scores. |
| none | `SportEventRoundMatchGameProviderMapping` | A provider's game id (team-sport game, PGA round, PGA match). |
| `SportEventMatch` home/away scores, `SportEventParticipantGolfRound`, `SportEventParticipantRaceResult` | `SportEventRoundMatchGameSideResult` | A side's result in one Game: score, text result, score to par, position, start position, periods completed, start period, home/away, status. |
| none | `SportEventRoundMatchGameSideLineupPlayer` | Team-cup lineups: which players played for a side in a Game. |
| `SportEventMatchPeriodScore` | `SportEventRoundMatchGameSideResultPeriodScore` | Score per period per Game side, with a period kind (REGULAR / OVERTIME / SHOOTOUT). |
| `SportEventParticipantStatLine` | `SportEventRoundMatchGamePlayerStat` | Raw box score per Game, player and stat code. |
| none | `SportEventRoundMatchGamePlayerScore` | Composite score per Game, player and composite. |
| `SportEventParticipantStanding`, `…GolfStanding` | `SportEventParticipantStanding` | Event result per field row: total, score to par, position, display position, status (CUT / WD / DQ). |
| `SportEventParticipantRound`, `…GolfRound`, `…GolfStanding`, `…RaceResult` | removed | Replaced by Match sides, Game sides and Standing. |
| none | `SportEventParticipantProviderMapping` | Provider ids that last one event (PGA team and pairing competitors). |
| `TierProfile` | `PlatformTierProfile` | Platform tier settings; each league picks one (`platformTierProfileId`). |
| `PricingProfile` | `PlatformPricingProfile` | Platform price settings; each league picks one (`platformPricingProfileId`). |
| rating numbers in code | `PlatformRatingProfile` | Platform rating settings (games counted, lowest dropped, baseline blend); each league picks one (`platformRatingProfileId`). |
| composite weights in code | `PlatformScoringProfile` | Platform stat weights (Redzone, Hat Trick, …); each league picks one (`platformScoringProfileId`). |
| `ProviderSyncRun` | same name | One sync run. |
| none | `ProviderSyncFinding` | A problem the sync found, with severity and status. |
| `ContestSportEvent`, `squaresFromRound`, `bracketStartRound` | `ContestSeasonSlot` | The only record of which Season slots a contest covers. |

Elsewhere in this plan a leading `…` stands for the owner path in this table.

## The principle

**The event side mirrors the real world as the feeds report it, and stores each real thing
once.** A real game is one Game row, its box score is one set of stat rows, and its status
comes from the feed.

**The contest side decides what a contest is played on.** A contest covers a set of
**slots**. Contest templates carry that choice, so commissioners never pick slots
themselves.

Everything below follows from these two sentences.

## Why

The current model was built one sport at a time and leans on code to look right:

- **The season.** It is a bare `SportEvent.eventYear` plus a hand-set
  `SportLeague.currentEventYear`, and five rules for "the current year" disagree.
- **League facts in code.** Round counts and names, series lengths, preseason skipping,
  "which round is the final", the CFP date window and rollover months all sit in adapter
  tables and constants.
- **Matching by name.** Recurring events are an `EventSeries` found by name, and event
  pages and contest templates match series by name strings.
- **Series and advancement.** A best-of series is one `SportEventMatch` with no game rows.
  Advancement is a match number across the whole event (the Super Bowl is match 13).
- **Partial coverage, three ways.** Squares name one match, second-chance brackets store a
  start round, and everything else covers whole events.
- **Players.** A player's team is free text (`Participant.teamAffiliation`).
- **Clutch Cards.** They are about 20 separate stat-pool leagues, one per playoff round,
  that copy the parent league's games and are synced by a separate path (only the NBA's
  was built).

## 1. Definitions (timeless, one set per league, set by migration)

- **SportLeaguePhase**
  - `phase`: PRESEASON / REGULAR / POSTSEASON. The enum's explicit order is the phase's
    only order.
  - `isSynced`, non-null. An unsynced phase (NFL PRESEASON) gets no slots, events or
    findings.
- **SportLeaguePhaseSlot**: a position within a phase, and the strong key everything links on.
  - `key`: a unique code that nothing parses.
  - `slotKind`: an ordered enum (WEEK, PLAY_IN, ROUND_OF_64, ROUND_OF_32, ROUND_OF_16,
    QUARTERFINAL, SEMIFINAL, THIRD_PLACE, FINAL, TOURNAMENT), plus a checked `weekNumber`
    for WEEK.
  - No `order` column: `slotKind` plus `weekNumber` give the order; TOURNAMENT slots order
    by the Season slot's `startsAt` (the PGA order changes every year).
  - `name`: optional, for any league-specific label (Super Bowl, World Series, The Masters,
    Wild Card, Divisional, Sweet 16, Final Four).
  - `awardsTrophy`, `squaresEligible`.
  - Default `seriesFormat` (SINGLE_GAME / BEST_OF / AGGREGATE), `seriesGames` and
    `pairing` (FIXED / RESEEDED).
  - On screen, a slot shows its `name` if it has one, otherwise the word for its kind.
    Generic words ("Week {n}", "Semifinal") are the fallback only. They come from the
    display strings (`packages/shared/display-strings/en-US.ts`, landed): each slice adds
    the en-US keys for the enum values and error codes it adds.
  - Open phases (golf, tennis) have one definition per recurring tournament.
  - A format change, such as CFP growing from 2 rounds to 4, is a data change.
  - Daily-schedule leagues (NBA, NHL, MLB) get calendar-week REGULAR slots, Monday to
    Sunday, built by one global rule from the Season start. Weeks break in the league's
    time zone, which is a column on the league. Games match them by that date rule
    (matchType CALENDAR_WEEK), never by admin-entered dates.
  - Switched-off leagues get their definitions too, so reactivating one needs no new rows.
- **SportLeaguePhaseSlotProviderMapping**: one row per slot per provider. `matchType` is
  one of:
  - PROVIDER_CODE: structured phases, set by migration;
  - NAME_PATTERN: open phases;
  - DATE_WINDOW: feeds with no round marker, such as the NCAAF postseason. It uses a team
    filter.
  - CALENDAR_WEEK: daily-schedule leagues' REGULAR weeks, by the global date rule.
  - Inclusion only (Derek 2026-11-22): a row names each provider value we sync, and
    anything else is not synced. Each unmapped value raises one INFO finding per league and
    value (deduplicated, not per game), so a new format is seen once and never synced by
    default.
- **SportLeaguePosition**: code, `displayOrder` (display only, never used to identify or
  sequence play), `isFieldEligible` and `baselineRating`, with provider
  codes in **SportLeaguePositionProviderMapping**. The NFL's eligible positions are QB, RB, WR and TE.

## 2. Calendar (the real slots each Season)

- **SportLeagueSeason**: its own identity (start year and date span, unique per league and
  start year, span checked against its slots), with a **SportLeagueSeasonProviderMapping** per provider.
  - Test data (Derek): a few "Test-" events live in the **current** Season, each on its own
    Season slot row flagged `isTestData`, with a label (several per definition; unique on Season,
    definition and label), with
    re-dated dates. The sync never reads or writes test slots, so test and synced events
    never share a slot. QA only; never in production.
  - `SportLeague.currentSeasonId` follows one global rule: the Season whose span includes
    today. Between Seasons it points at the next Season once its schedule is published,
    otherwise the last one.
  - This replaces `currentEventYear` and every year fallback. A league's first Season comes
    from the migration that adds the league.
- **SportLeagueSeasonPhase**: FK to its phase definition.
- **SportLeagueSeasonPhaseSlot**: FK to its slot definition, plus:
  - `startsAt`, `endsAt` and `status` (SCHEDULED / IN_PROGRESS / COMPLETED);
  - `seriesFormat`, `seriesGames` and `pairing`, copied from the definition when the
    Season is created, so a later format change never rewrites a past Season.

## 3. Sporting events

- **SportEvent** (name kept): a real-world event in one Season (it gains `seasonId`),
  covering one or more of its slots through **SportEventSlot**.
  - **A slot belongs to at most one event**, enforced by a unique key. The NFL postseason
    is one event over WILD_CARD, DIVISIONAL, CONFERENCE and FINAL; there is no separate
    Super Bowl event.
  - A SINGLE_SLOT event is identified by its Season and slot. Provider ids live in
    **SportEventProviderMapping**.
  - EventSeries is removed.
- **SportEventParticipant** (name kept): the event's field.
  - It holds the **teams**, and in TEAM leagues the **eligible players of those teams**.
    Each player row points at the league Participant and records the team he plays for in
    this event.
  - A player row has a composite FK to his team's field row in the same event, and takes
    his roster team at each field sync until release.
  - Player rows are built only in leagues whose templates include a Clutch Card.
  - Seed, play-in place, withdrawn and eliminated reasons stay.
  - **Team** tiers and prices sit on the event slot (`SportEventSlotTier`, slice 7b): a set
    is built for each event slot that a template lists as a starting point, over the field
    rows not eliminated entering that slot (bye teams in), and frozen when that slot opens.
    A contest reads its first covered slot's set. **Every field check,
    count, tier and price runs over team rows only**, so player rows never block release.
- **SportEventRound**: a scoring unit, numbered within its event, with a **required** FK to one
  of its own event's slots (enforced by a composite FK). A week event's round 1 is
  WEEK_14; all four Masters rounds are MASTERS. A round kind and a loser-advances link
  (NBA play-in) belong to bracket shape (#1926).
- **SportEventRound** also carries `matchFormat` HEAD_TO_HEAD / FIELD, read from the feed
  where it varies by round (Ryder Cup foursomes, fourballs, singles). An F1 Grand Prix
  has one Round, its Race session (Derek 2026-11-22: pools run only on the race); which
  sessions are synced is mapping data, not code: the slot provider mapping includes session
  type Race only. A golf playoff is not a Round (Derek
  2026-11-22): its extra holes belong to round 4's Game, like overtime or extra innings, and
  we store whatever the feed reports for that Game and the Standing.
- **SportEventRoundMatch** (today SportEventMatch): any meeting of sides in a round (Derek
  2026-11-22). A best-of series is one Match. Two teams, two players, or a whole field: a
  golf stroke-play round is one FIELD Match with every golfer as a side, and a race is one
  FIELD Match with every driver as a side.
  - It is numbered within its round in kickoff order, and the number is stable once set.
  - Status is written once, from its Games.
- **SportEventRoundMatchSide**: one side of a Match.
  - Field row (a team or a player), `sideNumber` and spread (side 1 only). Home/away is on
    each Game side result, since it alternates in a series; the seed is on the field row
    only. The field row is empty until the side is known (an undecided bracket slot, a
    knockout match before its teams are set).
  - `outcome` WON / LOST / TIED / PENDING is a rollup from the Games, written only by the
    result writer (a series' 4–2). FIELD matches leave it empty.
  - Advancement is the next match plus a side number, unique per target side.
  - Pick'em picks and bracket picks point at a Match side.
  - `sideNumber` is the side's fixed place, not home or away: sync writes the away side as 1
    and the home side as 2 on Matches it creates; a neutral-site or FIELD Game uses
    `homeAway` NONE (Derek 2026-11-24).
  - Constraints: unique (match, side number) and (match, field row); a HEAD_TO_HEAD match has
    exactly sides 1 and 2, written in one transaction by the one writer; composite FKs keep
    every side in its Match's event.
- **SportEventRoundMatchGame**: one played game: date, status (including SUSPENDED and
  OFFICIAL), ending, result source, neutral site, with provider ids in
  **SportEventRoundMatchGameProviderMapping**.
  - Every Match has at least one Game. Unique (provider, provider id) on the mapping. The
    id is the team-sport game id, the PGA round id for a stroke-play round, or the PGA match
    id for match play.
  - The bracket build creates FINAL's Match, its two sides and Game 1 before the feed lists
    them, so squares can point at it early. `regionLabel` stays until #1926.
  - Squares games re-point to Game and read their two Game sides by side number; squares
    readiness requires HEAD_TO_HEAD.
- **SportEventRoundMatchGameSideResult**: a side's raw result in one Game, unique per Game and
  side: `score` (points, goals, strokes, holes up), a text result where the feed sends one
  ("4 & 3"), `scoreToPar` from the feed (never derived from a par, which breaks for
  multi-course events and mid-round), `position` (finish place), `startPosition`,
  `periodsCompleted` and `startPeriod` (holes thru, back-nine starts), `homeAway` HOME /
  AWAY / NONE, and `status` (DNF, DSQ, DNS, WD within that Game).
  - **…GameSideResultPeriodScore**: one row per Game side and period, with a period kind REGULAR /
    OVERTIME / SHOOTOUT. Golf hole scores are stored only where a contest reads them; none
    does today.
  - **…GameSideLineupPlayer** (DEFERRED, Derek 2026-11-22): team-cup lineups, the player field
    rows that played for a side in a Game (Ryder Cup pairs). Not built in this epic; built
    when match play is synced. Recorded in `rules/domain-model-concepts.md` as a deferred
    concept so a later change uses this shape.
- **SportEventParticipantStanding**: the event result per field row: total, score to par,
  position, display position ("T5") and status (CUT / WD / DQ). One writer per scoring
  family: when the feed supplies them, the sync writes the feed's own totals and tie-aware
  position (the provider is the source of truth, Derek 2026-11-22); one function per family
  computes only what the feed doesn't supply.
  - Written only for events whose rounds are FIELD Matches; head-to-head results live on the
    Match sides, and season standings belong to the Season (Derek 2026-11-24).
  - A cut golfer has no side in the rounds after the cut; CUT lives only here.
  - The field row's withdrawn and eliminated reasons stay the event-level status, and
    Standing reads them.
- **Removed**: SportEventParticipantRound, …GolfRound, …GolfStanding and …RaceResult. The
  racing rider name and the horse trainer become field-row columns.
- **SportEventParticipantProviderMapping**: provider ids that last only one event, such as
  PGA team and pairing competitors (their players come from the feed's `members`).
- Leaderboards read Standing in one query and per-round Game side scores in one
  event-wide query; webhook writes are batch upserts. Query-scaling tests pin a 150-golfer,
  4-round event.

## 4. Participants and providers

- **Participant**: a team or player of the league. `participantType` is kept on the row.
  `SportLeague.participantType` becomes required, and `Sport.participantType` (and the
  registry copy) goes.
- **SportLeagueSeasonParticipantTeam**: one row per Season and player, holding his current
  team, position, `rating` and last-seen date, written by the roster sync; it replaces
  `teamAffiliation`. No trade history is kept (Derek).
- Leagues with no feed stay switched off (decided), so every league in scope is synced.
- **Providers**:
  - **Provider** (a table, Derek 2026-11-22): `code` (BALLDONTLIE), name, `baseUrl`,
    `requestsPerMinute`, `webhooksEnabled`, what its plan includes (`hasPlayerStats`, …) and
    `isEnabled`. The code picks the adapter in code; nothing else about a provider is in
    code. Each environment's database has its own rows, so QA's free-tier rate and
    production's paid rate are row values, edited on the Providers admin page instead of by
    a Terraform apply. The API key and webhook secret stay in Secrets Manager.
  - **ProviderLeague**: FK to Provider, the provider's league code (`nfl`), sport, and the
    webhook settings per league (`quietAfterMinutes`, which event set it sends). These
    replace `BALLDONTLIE_WEBHOOK_GAME_LEAGUES`, the golf quiet minutes and the per-league
    constants in the adapter. Event id prefixes go away with SportEventProviderMapping. The
    provider's own words (its status codes, its webhook event names) stay in the adapter as
    mapping data, with a finding on a miss (§17).
  - Moving out of config and code: `SPORT_DATA_PROVIDER_BINDINGS_JSON` (base URL, rate),
    the webhook provider list read from the environment, and `CFP_LEAGUE`'s tour and name
    match (replaced by the slot's DATE_WINDOW mapping, slice 13). The Terraform variable is
    removed only after the code that reads the table is deployed (`apply-terraform` skill).
  - **SportLeagueProviderMapping**, with `SportLeague.selectedProviderMapping` (null = not
    synced) replacing `eventSyncProviderId` and `matchKeyword`;
  - **ParticipantProviderMapping**, with a `Provider` FK.
  - The convention (Derek): every provider id or code lives in a table whose name ends in
    *ProviderMapping*, one row per provider. No other row holds a provider key. ProviderLeague
    is the provider's own league list, which SportLeagueProviderMapping points at.
- **ProviderSyncFinding**:
  - severity ERROR / WARNING / INFO, plus kind, subject ids and detail;
  - status OPEN / RESOLVED / WAIVED, where WAIVED needs a note;
  - deduplicated per kind and subject, with a retention cleanup and an alert on ERROR.
- **Switching providers is gated**: add a mapping, run re-mapping, then select it. It is
  refused with 409 `PROVIDER_SWITCH_NOT_READY` while an ERROR finding is open.

## 5. Player stats, scores and ratings

- **…GamePlayerStat**: the raw box score, one row per Game, player and `SportStat` code.
  - The team is stored on the row and checked: the player's team row, or the player row
    itself in individual sports, is a side of that Game's Match.
  - The enum gains the codes the composites need.
- **Composite definitions** (Redzone, Triple Threat, Box Score, Power Play, Hat Trick)
  become platform-level rows of weights per stat code, and each league picks one.
- **…GamePlayerScore**: the composite value per Game, Participant and composite (unique on
  all three), written by one writer when a Game's stat rows change: the league's composite
  plus any composite an open contest still names. It is keyed by Participant, not field
  row, so a card over several slots of one event scores cleanly. A contest records which composite it
  uses.
- **Player rating**:
  - the average GamePlayerScore over his team's last 4 games (a game he didn't play counts
    as 0), dropping the lowest 1;
  - stored on the roster row with the slot it is "as of";
  - blended with the position's `baselineRating` when the history is short;
  - its numbers (4 games, drop the lowest 1, the baseline blend) live in a platform
    **PlatformRatingProfile** table, like PlatformTierProfile and PlatformPricingProfile, and each league
    picks one (Derek 2026-11-23: no hard-coded numbers). One profile is seeded.
- **When ratings are computed**: when a field is built, and after each slot COMPLETES.
  - Missing history is backfilled first, by a low-priority job that renews its lease and
    shares one provider rate budget.
  - If nothing exists, the rating is 0, with a WARNING finding and a Re-run action.
- Player rows, ratings and box scores exist only in leagues whose templates include a
  Clutch Card, and box scores only for slots a card covers or a rating window needs. A
  league that offers Clutch Cards must be on a provider plan with stats.
- A stat correction after settlement raises a finding.

## 6. How the sync builds it

1. **Seasons**: Seasons are added by migration. The sync maps the provider's season id to an
   existing Season row through SeasonProviderMapping (no rollover-month constants); an
   unknown Season is an ERROR finding.
2. **Slots**: only synced phases.
   - One league-agnostic adapter per provider reduces each game to a provider code
     (`REG:5`, `POST:3`, a tournament id).
   - The slot mappings then match it in order: PROVIDER_CODE, then NAME_PATTERN for open
     phases on first sight, then DATE_WINDOW.
   - **NAME_PATTERN**: the name is normalized (case, year and "presented by" removed). One
     match links, and a linked tournament matches by id from then on. **No match creates
     nothing**: it raises a finding with "link to existing" (adds a pattern) or "create
     new". Two matches raise an ERROR.
   - A value no mapping includes is not synced and raises one deduplicated INFO finding per
     league and value (inclusion only, §1); waiving it marks it known and excluded.
   - Name matching happens only here, and only where the feed gives nothing better.
3. **Events**: created and kept current in their Season (ADR 0011), and only for slots
   that one of the league's templates covers, so there are no empty weekly events.
4. **Field, rounds, matches, games**: teams and eligible players into the field; games under
   their match in the round for their slot.
   - A partial page or missing feed deletes nothing.
   - A re-issued provider game id falls back to slot, teams and game number, with a finding.
   - **A game moved to another week moves to the slot it is played in.** Picks on it in the
     original slot are voided equally (a void reason plus `voidedAt` on predictions and
     picks): no points, and in survivor the team isn't used up. Pick'em and survivor
     members re-pick if it moves before the cutoff.
   - A game postponed with no new date: after a wait, the slot raises an admin finding with
     a "complete slot" action, and picks on that game are voided the same way.
5. **Status bubbles up through the domain event handler map** (epic #1946, handlers in
   #1953):
   - The flow is Game (from the feed), then Match (decided by its series length), then
     Slot, then Event. Each status change raises a domain event, whose handler queues the
     parent's refresh job in the same transaction.
   - **A slot** is IN_PROGRESS when any Game starts. Whether it is COMPLETED is one
     function per scoring family: matches when every Match is decided; stroke play when
     the final round's results are posted; racing when results are posted. Stats count
     only where they are fetched. The transition is a guarded write.
   - **COMPLETED is final**: it never reopens on its own, and a late change becomes an
     admin finding.
   - **The event's status is derived from its slots.** EventLifecycleService stays the one
     status writer. A draft stays DRAFT whatever its slots do; release moves it to its
     derived status. From slice 18, Event COMPLETED no longer settles contests (slice 14
     keeps today's trigger).
   - Ratings, results emails and notifications are handlers on the map.
   - The per-event `autoLifecycleEnabled` stays as the one switch, with an admin action to
     set a slot's status.
   - `architecture-rules.md` §4 is amended to match.
6. **Rosters**: their own step for TEAM leagues, on a global interval (default daily),
   taking over #1859.
   - BALLDONTLIE NFL uses `players/active` (league-wide, about 17 pages).
   - Ineligible positions are dropped while reading.
   - A player missing from the feed is never deleted.
   - Box scores come from `stats?game_ids[]` (NHL: `player_period_stats`). Each endpoint
     is probed, and its plan tier confirmed, before it is built.

## 7. Release and contests

**Release** is still per event, through the same Ready checks. The release check and
auto-release look at the event's **next slot that hasn't started**, so a late release only
loses the slots already under way. The event-level "event started" readiness reason goes.

**Contest templates name their slots** as a list of slot definitions, with a coverage mode
(§9c):

| Template | Coverage mode | Covers |
|---|---|---|
| Super Bowl squares | ONE_SLOT | FINAL |
| Super Bowl Clutch Card | ONE_SLOT | FINAL |
| Playoff bracket | ALL_LISTED | every POSTSEASON slot but the play-in |
| Playoff survivor | FROM_SLOT | every POSTSEASON slot but the play-in |
| Whole-tournament tiered, budget, quick pick | ALL_LISTED | every POSTSEASON slot but the play-in |
| Round tiered, budget, quick pick | ONE_SLOT | each starting-point POSTSEASON slot |
| Playoffs Clutch Card | ALL_LISTED | every POSTSEASON slot of one event |
| NFL week pick'em | ONE_SLOT | each WEEK slot |

**The contest's covered slots**:

- **Storage.** A contest copies its template's slots, resolved to that Season's slots, into
  **ContestSeasonSlot**. A later template edit never changes a running contest.
- **One record.** ContestSeasonSlot is the **only** record of what a contest covers. The
  contest's events are read through each slot's owning event. `ContestSportEvent`,
  `squaresFromRound`, the squares round number and `bracketStartRound` go. A squares
  contest still names its one Game, because a best-of Finals has several: the commissioner
  picks it, defaulting to Game 1, and a check keeps it inside the covered slot.
- **Readiness.** Each contest type declares what it needs from its covered slots before it
  can open. Squares needs its Game to exist. A Clutch Card needs its covered teams known
  (bye teams seeded) and ratings as of the slot before its first covered slot. The API answers "can this contest open now?", and the web app only reads
  that answer.
- **Cutoff.** One function: the first covered Game's start, else the slot's `startsAt`.
  With neither, the contest can't open.
- **Pick windows per slot.** For pick'em and survivor over several slots, a slot's picks
  open when its matchups are known, close at its first Game, and are revealed then. A
  single-slot contest behaves as today.
- **Settlement** runs when every covered slot is COMPLETED or CANCELLED, as a job keyed by
  the contest; squares settle on their one Game, final or cancelled.
  Leaderboards rebuild through the existing snapshot job, one per contest.
- **Team tiered, budget and quick pick contests** cover what their template's coverage mode
  gives (§9c) and use their first covered slot's team tiers. Bracket templates may list slots (Championship Weekend =
  [CONFERENCE, FINAL]). Whether each template is worth offering is #1965.
- Join, leave and rename close at the first covered Game.
- **Keyed by covered slots, computed once by the API**:
  - the offering's label, dates and teams (Create contest cards, the event page Coming-up
    sort);
  - commissioner notices (EVENT_COMING_UP, EVENT_READY_FOR_CONTESTS), keyed by offering
    (template plus covered slots);
  - change notices, contest progress, and email links to event pages.
- **Event pages** point at a slot definition, and each offer carries only the page and the
  template (the template holds the coverage). `/play/clutch-card` resolves the same way.
- **History.** See §9c: championship year, finishes and medals, cups, perpetual trophies
  and points profiles. Week detection reads the slot.

## 8. Clutch Cards: a contest type on the parent league

- **What it is.** A Clutch Card contest covers listed slots of one parent league event, through the same ContestSeasonSlot.
- **Pick list.** The player field rows of the event's teams that are not eliminated and
  have a place in a covered slot, judged at cutoff, so bye teams are included. The API
  computes it. A Super Bowl card has 2 teams; a Semifinal card has 4.
- **Tiers and prices are keyed by event slot** for every contest type:
  **SportEventSlotTier** (unique event slot + tier key, from the league's tier profile) and
  **SportEventSlotParticipantValuation** (unique event slot + field row: tier, price, manual
  flag), replacing SportEventTier and SportEventParticipantValuation. A contest reads the
  tier set of its first covered slot: team contests read the first slot's (built at
  release); a week event has one slot, as today. A manual tier or price freezes auto-tiering
  for that slot's set.
- **Player tier sets** cover the players of the teams alive entering that slot. They're computed when the slot before it completes and ratings
  refresh (the first slot of a phase at release), then frozen. A contest reads the tier set
  of its first covered slot.
- **Contests hold no player, team or match data**: only covered slots, setup, picks (FKs to
  field rows) and standings. The tier and cost snapshots on `ContestEntryPick` go.
- **Members pick once**, before the first covered Game; a player scores in every covered
  Game his team plays.
- **Picks** point at those field rows. Injured and reserve players stay pickable.
- **Scoring.** An entry's standing is the sum of its picks' GamePlayerScore over the
  covered Games, with the setup's N-of-M rule. Clutch Cards stay composite only.
- **Removed:**
  - the Clutch Card leagues, `parentSportLeagueId`, `parentRoundNumbers`, `parentEventId`,
    the delayed sync and `isClutchCardLeague`;
  - SportEventParticipantStatLine.

  The test data moves to the parent leagues, and the `add-clutch-card-league` skill is
  rewritten or retired.
- **Trade-off accepted.** Leagues whose feed has no player stats get no Clutch Card.

## 9. Removed or changed

- **Removed**:
  - EventSeries;
  - `SportEvent.eventSeriesId`, `eventYear`, `providerId`, `externalId`;
  - `SportEventMatch.externalGameId`;
  - `SportLeague.currentEventYear`, `matchKeyword`, `eventSyncProviderId`, `roundNames`,
    `roundSeriesLengths`, `bracketAdvancement` (now `pairing`) and the Clutch Card columns;
  - `Sport.participantType`;
  - `Participant.teamAffiliation`;
  - `ContestSportEvent`, `squaresFromRound`, `EventPageOffer.bracketStartRound`;
  - SportEventParticipantStatLine;
  - SportEventParticipantRound, …GolfRound, …GolfStanding, …RaceResult;
  - the home/away, score and winner columns on SportEventMatch (now sides).
- **Changed**:
  - `EventPageOffer.eventSeriesName` and `ContestConfigTemplate.eventSeriesNames` become
    slot definition ids;
  - `ContestConfigTemplate.eventType` is removed (the slots say it);
  - `ParticipantProviderMapping.providerId` becomes a `Provider` FK.
- **Data.** None is migrated. When the core lands, QA is rebuilt and the migration history
  is squashed again, both on Derek's word.

## 9b. Sport-specific leftovers found by the 2026-11-23 scan

Each moves into the model in the slice named. None is new design; each follows a settled rule.

- `Sport.tournamentFormat`, its enum and the registry copy: replaced by a default
  `matchFormat` on the slot definition, copied to the Round; the contest validity matrix keys
  on matchFormat (slice 5, readers in 10/10b).
- Scoring family: `SportLeague.scoringFamily` required, the registry copy deleted; COMPOSITE
  leaves the enum with Clutch Cards (slices 4 and 26).
- Round count: `SportEvent.rounds`, the sport's `defaultRounds`, the made-up 4 golf rounds and
  `roundsPar` deleted; the count is an API field from the Round rows. The unplayed-round
  penalty becomes a to-par setting on the stroke-play scoring definition, never derived from
  a par (slice 10b).
- Periods: `matchPeriodLayout`, its sport default and both "18 holes" constants become one
  required period count and period word per league or slot definition (slice 10).
- Provider keys outside mappings: `Participant.externalId` and `externalIds` move to
  ParticipantProviderMapping; `ProviderSyncRun.providerId` becomes a Provider FK and its
  `eventId` a SportEvent FK (slice 1).
- `Participant.role` becomes the roster row's SportLeaguePosition; team abbreviation a
  Participant column (slice 21).
- Conferences and divisions (Derek 2026-11-23), from team `metadata` JSON into the model:
  SportLeagueConference (FK to the league, code unique per league, proper name) and
  SportLeagueConferenceDivision (FK to its conference), each set by migration with a
  provider mapping; SportLeagueSeasonTeamConference per Season and team (conference
  required, division optional, composite FK). Divisions sit inside conferences in every feed
  (MLB calls its top level "league"); WNBA and NCAA have conferences only; soccer and golf
  have neither. The existing team sync writes the Season rows from the team payload (NCAA
  conferences come as an id from the feed's conference list); no new sync. Bracket pairing
  reads these (slice 21, readers with #1926).
- `sport` copied onto SportEvent, ContestConfigTemplate and ProviderSyncRun: read through the
  league, columns dropped (slice 3).
- `SportOrder` in code becomes `Sport.displayOrder` (slice 3).
- Ties per sport (`pickEm.tiePicks`, `shootout`): there are no tie picks (Derek 2026-11-24,
  §9c), so `pickEm.tiePicks` is deleted (slice 17). A boolean `canEndTied` on the slot
  definition stays as the fact that its games can end level (Derek 2026-11-23), read by
  result handling and never to offer a pick; how a game actually ended comes from the feed as the Game's ending;
  whether a spread is offered is template config (slices 5 and 17).
- `selectionTypes` and `scoringDefinitions` per sport: the league's templates say it; the API
  returns the offered types and default scoring; the web app stops re-deriving (slice 19).
- `SPORT_TYPICAL_PLAY_MS`: a per-league `typicalGameMinutes` beside `quietAfterMinutes` on
  ProviderLeague (slice 1).
- `ROUND_NAMES_FROM_FINAL` arrays ("Super Bowl", "Frozen Four", …) deleted; slot `name`
  holds proper names, generic words come from the display strings (slice 5).
- `modules/golf/golf-seeding-algorithm.ts`: its invented `oddsToWin` stops. Odds belong to
  the feed and the sync and are stored unaltered, otherwise empty (Derek 2026-11-23: we only
  derived odds to get tiers and prices, so we derive only those); the tier order falls to
  seed then rank; pricing moves to a PlatformPricingProfile function; the golf module is
  deleted (slice 3).
- Web app: the leaderboard's `scoringFamily === HEAD_TO_HEAD` branch becomes an API field;
  `STAT_POOL_FORMULAS`, `clutch-card-copy.ts` and `BUILT_STAT_LINE_SPORTS` go with the Clutch
  Card rebuild, rendered from PlatformScoringProfile (slices 19 and 26).
- URL segments (Derek 2026-11-23): stored `SportLeague.urlSegment` (`nfl`) and
  `Sport.urlSegment` (`football`) instead of building them from names or computing them in
  two places; event pages' `slug` is renamed `urlSegment` too (slice 3).

## 9c. Sync and contest audits (2026-11-23)

Two more read-only passes found these, each folded into a slice. Items still waiting on Derek
are listed under Open questions.

Sync:
- Config moves onto Provider and ProviderLeague (slice 1): the per-sport `scheduledSports`
  switch is deleted; webhook safety-net poll intervals, the default provider, provider
  priority and adapter `sportsCovered` become rows; duplicated schedule defaults go;
  sync jobs, runs and the rate budget carry a Provider FK; `MappingConfidence.HIGH` (unused)
  goes; participant ids are the raw feed id, never prefixed with the league.
- Rate limit (Derek 2026-11-23, slice 1): each sync service limits itself locally to the
  Provider's `requestsPerMinute` divided by the job task pool's maximum task count (config,
  no database call per request); a resilience library (cockatiel) honours Retry-After on a
  429, otherwise backs off exponentially with jitter up to a cap, and a circuit breaker
  pauses that Provider briefly during a 429 storm.
- Mock provider (Derek 2026-11-23, slice 1): no mock provider code in production source (no
  `mockEventState` branches, wiring, or the root admin "Start live simulation" golf tool);
  the QA mock service task is disabled. The mock module itself stays in the repo until
  deferred #1981 removes it.
- Manual score-source linking (Derek 2026-11-23, slice 7): removed, with `syncScope` and
  admin-entered feed ids; a league is synced or off, so nothing is linked by hand.
- Runs (slice 2): `ProviderSyncRun.payloadJson` stops driving behaviour (columns plus
  findings); each sync kind has one name, `ProviderSyncKind`, used by jobs, runs, settings keys and the API; logged-only anomalies and
  the synthetic health check become finding kinds and a status computed from runs and jobs.
- Field sync covers events whose next slot has not started, not "next 2 events or 14
  days" (slice 10c); job dedupe keys and payloads use our own ids, not provider id strings.
- Games (slice 10): webhooks route by GameProviderMapping (no prefix match, no fan-out to all
  leagues; an unknown id is a finding); `lastProviderNotificationAt` moves to the Game; the
  NCAA play-in placeholder participant becomes an empty Match side; field row metadata
  (seed, odds, play-in place) becomes columns.
- Seeds (Derek 2026-11-23, slice 21 / #1926): a seed comes only from the feed. Where the feed
  gives none (BALLDONTLIE's MLB standings), the slot raises a WARNING finding and an admin
  enters the seeds; `toMlbSeeds` and every computed seeding rule are deleted.
- Golf (slice 8): an unknown tour is a finding, not "all leagues".
- The web app reads provider names from the API, not by id lookups in four places.
- Implementation notes from the sync re-review (2026-11-23):
  - Slice 1: only worker-role tasks call a provider; the Providers page and every API route
    read health and counts from runs and jobs, never a live provider call.
  - Slice 1: the adapter client does no retries of its own; cockatiel is the only retry layer.
    A call refused by an open breaker or exhausted retries ends the job's try as
    RATE_LIMITED, re-queued for when the breaker reopens, without counting toward attempts.
  - Slice 1: stop reading `SPORT_DATA_DEFAULT_PROVIDER` and `SPORT_DATA_PROVIDER_BINDINGS_JSON`
    in the same PR that removes the mock adapter; the Terraform variables and the QA mock
    task are removed afterwards with the `apply-terraform` skill.
  - Slice 1: functional and integration tests register a fake `SportDataProvider` from test
    code through the app's provider-factory dependency; tests of manual linking are deleted
    in slice 7.
  - Slice 1: the migration deletes `ParticipantProviderMapping` and `ProviderSyncRun` rows
    whose provider is `mock-contest-feed`; slice 7's migration deletes manual-admin event
    links.
  - Slice 1: the migration seeds the free-tier `requestsPerMinute`; the PR's post-deploy step
    sets production's value on the Providers page before the Terraform binding is removed.
  - Slice 1: `ParticipantProviderMapping` is unique on (provider, externalId, sport league,
    participant type), so a raw team id and a raw player id cannot collide.
  - Slice 1: webhooks for a Provider are on only when `webhooksEnabled` is true and its secret
    is set; the flag without a secret raises an ERROR finding.
  - Slice 1: `scheduledSports` and the Sports page's own schedule calculation and `nextRunAt`
    are deleted; the webhook safety-net poll interval is a per-Provider column, read by the
    10c tick; 10c owns every other interval.
  - Slice 7 (Derek 2026-11-23): the root admin catalog browse (pick a feed event to link) is
    deleted with manual linking, along with its live provider call; admin views of the feed
    read what sync stored. "Sync now" and other admin buttons queue the scheduled job;
    webhooks record the notification and queue the scores job, with no provider call.
    Endpoint paths stay in each adapter beside the typed response they parse.
  - Slice 7: admin event creation stays only for flagged test slots, which have no provider
    mapping.
  - Slice 10: a tournament-level notification (golf) routes through
    `SportEventProviderMapping` to that event's current round Game.
  - Slice 10c: the field window rule (events whose next slot hasn't started) lands here;
    earlier slices leave the old reader alone. Job payloads carry only our own ids (league,
    event, Game) plus the Provider FK; the migration deletes queued jobs of retired types.
  - Order: 10c after 2, 6, 10 and 10b; before 14.

Contest:
- Contest scoring (Derek 2026-11-23, slice 18b): `ParticipantContestScoringRule` (a sorted
  list read only for its first row) and the template's scoring inside `configJson` are
  replaced by one `ContestScoringConfiguration` row, pointed at by both
  `ContestConfigTemplate` and `ContestConfiguration` (a contest copies its template's row).
  Columns: `scoringDefinition` enum (`STROKES_TO_PAR_TOTAL`, renamed from
  `GOLF_RELATIVE_TO_PAR_TOTAL`; `FINISH_POSITION_POINTS`; `KNOCKOUT_ROUND_POINTS`; new
  `CORRECT_PICK` for pick'em and survivor; new `SQUARES_PERIOD_WIN`; `COMPOSITE_TOTAL`),
  and `settings` JSON validated by the definition's Zod schema (it includes the tiebreaker).
  Bracket and pick'em settings are `{ pointsPerWin, roundScaling, upsetBonus }`, where
  `roundScaling` is `{ rule: NONE }` or `{ rule: MULTIPLY_EACH_ROUND, multiplier }` and
  `upsetBonus` is `{ rule: NONE }` or `{ rule: SEED_DIFFERENCE, multiplier }`. Round n scores
  `pointsPerWin × multiplier^(n-1)`, where n counts the contest's covered slots in `slotKind` order
  (the enum's explicit order, plus `weekNumber`), starting at 1 for the first covered slot;
  no new column, never list position. The positional `roundValues`
  array and the placeholder `KNOCKOUT_ROUND_POINTS` on prediction contests are removed.
  Templates set the defaults (brackets ×2, pick'em NONE).
- Per-event entry state (`ContestEntryEvent`, `ContestEntryEventStanding`, the leaderboard
  snapshot's shown event, the squares draw's pending receipts) keys by `ContestSeasonSlot`;
  pick'em and survivor weeks are that slot, not round numbers worked out three ways
  (slices 15/17).
- A bracket's
  start is its first covered slot, not `startsAtRound` in config JSON; the final is the slot
  kind FINAL, never `rounds.at(-1)` or `roundCount-1` (slices 9/15/16).
- One stored setup shape for template and contest, with "one default per scope" as a partial
  unique index on (sport league, selection type); copied and dead columns go
  (`ContestConfiguration.selectionType`, `ContestEntryPick.contestFormat` and `period`,
  `ContestPrizeDefinition`, unchecked `templateVersion`) (slices 3/11/15).
- Budget salary cap is read from the first covered slot's pricing, not copied into config
  JSON (slice 15).
- `Contest.startsAt` stops being a stored cutoff; the cutoff function is the one source, the
  API returns it, and the SQL that hides never-opening drafts calls the same rule; the web
  app's lock, entry, current-event and squares-game helpers read API fields (slices 16/18).
- Tiebreaker (Derek 2026-11-23, slice 18b): the kind and its range live in the scoring
  configuration's settings, e.g. `"tiebreaker": { "kind": "WINNING_SCORE", "min": -30,
  "max": 10 }` (so `tiebreakerKind` is not a separate column), seeded per league by
  migration and returned by the API; the web app's `WINNING_SCORE_OPTIONS` goes. An entry's
  guess is stored once, on its per-slot row (`ContestEntry.tiebreakerValue` goes). Entries
  tied on score order by the closest guess to the feed's winning total to par; still tied
  share the place (T1).
- Tiebreaker game (Derek 2026-11-23, slices 10/17): a slot value,
  `SportEventSlot.tiebreakerGameId`, shared by every contest covering the slot. Set when the
  slot's pick window opens (its matchups known), then re-run on each schedule change until
  that Game starts, by one rule: latest scheduled start, ties to the lower Game id (a FINAL slot's
  championship; a regular week's last kickoff). A root admin can change it in the event's
  slot dialog until that Game starts (audited). If it is cancelled or moved out of the slot,
  the rule picks again and raises a finding; guesses carry over. Replaces
  `weekTiebreakerGame` and `rounds.at(-1)`.
- Contest model audit (2026-11-23), consequences of the slot model:
  - `ContestSeasonSlot` is unique on (contest, Season slot) with no sequence column; every
    row's Season is the contest's `sportLeagueSeasonId` (`Contest.seasonYear` and
    `Cup.seasonYear` become `sportLeagueSeasonId`; `Cup` keys on (league, Season) and drops
    `sportLeagueId`).
  - `ContestEntryEvent` becomes `ContestEntrySlot` and `ContestEntryEventStanding` becomes
    `ContestEntrySlotStanding`, keyed (contestEntryId, contestSeasonSlotId), with a row per
    covered slot that opens a pick window: each slot for pick'em and survivor, the first
    covered slot for every other type (a bracket is submitted once).
  - `ContestEntryMatchPrediction` becomes `ContestEntryRoundMatchPrediction`: a Match and a side (always set: there are no tie picks), plus the predicted team for a bracket,
    since a later-round side means "winner of match A" and can win while the picked team is
    out; voids are `voidedAt` and `voidReason`.
  - `ContestLeaderboardSnapshot` keys by a nullable ContestSeasonSlot FK (null = the default
    board) on a surrogate id with a NULLS NOT DISTINCT unique, replacing `shownEvent = ''`.
  - `ContestSquaresGame` points at `sportEventRoundMatchGameId` (a Game in a covered slot);
    `ContestSquaresWinner` keys a moment as period number plus `isFinal`.
  - Dropped as copies or dead: `Contest.contestFormat` (follows from `selectionType`),
    `Contest.startsAt`, `ContestEntryPick.slot`, `countingPickLimit` on both standing tables,
    `ContestConfiguration.selectionType` and `templateVersion`, `ContestPrizeDefinition`.
- Template coverage (Derek 2026-11-23, slice 11): `ContestConfigTemplate` drops `sport`,
  `eventType` and `eventSeriesNames` and lists the slot definitions it covers in one child
  table, `ContestConfigTemplateSlot` (template, `SportLeaguePhaseSlot`); there is no phase
  table ("whole postseason" lists its slots; a season-long open-phase contest is not
  offered). One default per (sport league, selection type). Coverage mode (Derek
  2026-11-24), `ContestConfigTemplate.coverageMode`: ONE_SLOT (the list is where it may run;
  the commissioner picks one slot: tiered, budget, quick pick, squares, a single-round Clutch
  Card), ALL_LISTED (covers every listed slot of one event: brackets, a tiered, budget or
  quick pick pool over several POSTSEASON slots of one event, a whole-playoffs Clutch Card) or FROM_SLOT (the commissioner picks a starting slot and the contest covers it
  and every later listed slot: season-long pick'em and survivor). A contest copies only the
  slots its mode and the commissioner's choice give into `ContestSeasonSlot`. No template versions: a contest
  copies its slots into `ContestSeasonSlot` at creation, so a template edit (by migration
  when a structure changes, or by root admin) affects only future contests. Slot
  definitions are never deleted while a Season slot points at them. Fallback (Derek): if the
  trophy design needs a stable identity across structure changes, revisit with a template
  phase coverage row (`ContestConfigTemplatePhase`).
- Cups (Derek 2026-11-24, slices 20c and 20f): a cup adds up the counted contests that cover a single
  slot and rank every entry by its own choices (today tiered, budget and the Clutch Card;
  both tiered and budget count). Contests covering several slots (pick'em, survivor,
  bracket, a tiered, budget or quick pick pool over several POSTSEASON slots of one event)
  crown their own winner and never count; a contest on one TOURNAMENT slot (one major) is
  ONE_SLOT and counts; squares and quick pick
  never count. One global rule, no sport branches. Which cups exist is sport league data,
  `SportLeagueCupDefinition` (sport league, name, `coverage` ALL_SLOTS | PHASE |
  LISTED_SLOTS, `phase` only with PHASE by database check) with
  `SportLeagueCupDefinitionSlot` rows for LISTED_SLOTS, seeded by migration: golf
  "Season Cup" (ALL_SLOTS) and "Majors Cup" (LISTED_SLOTS); tennis Season and Grand Slam
  cups; racing a Season Cup; every sport league with REGULAR and POSTSEASON phases a
  "Regular Season Clutch Cup" and a "Playoff Clutch Cup" (PHASE), which fill once Clutch
  Cards run there. `Cup` keys on (League, Season, cup definition); a contest counts in every
  cup whose coverage holds its slot. `Contest.cupWeight` and the `CupWeight` enum are removed
  (Derek 2026-11-24): every qualifying contest counts ×1. There is no follow setting
  (Derek 2026-11-24): a league has every cup whose coverage holds one of its counted
  contests, shown from its first counted contest (the API returns `isShown`). Finish rows drop `weight`.
- Championship year (Derek 2026-11-24, slices 6/20): `SportLeagueSeason.championshipYear`,
  NOT NULL, explicit on every Season and set by migration, never computed: the year the
  Season is named for (NFL 2025 → 2025, Super Bowl included; NBA, NHL, NCAA basketball and
  European soccer 2025-26 → 2026; golf, tennis, racing, MLB → the calendar year). Each
  contest copies it at creation (`Contest.championshipYear`), so settlement timing can't
  move a contest across New Year. Because it is set by migration, Seasons are added by
  migration; a Season the feed reports that has no row raises an ERROR finding and is not
  synced until the migration lands (a root admin "create next Season" action is deferred to
  #1995). `LeagueYearFinish.year` and `LeagueYearReview.year`
  become `championshipYear`, read from the contest. A championship year closes (Derek 2026-11-24) when every
  Season with that championship year, in the sport leagues the League ran contests in, has
  finished its last slot and every contest in that year is final; the close is stored once
  per League and year (`LeagueChampionshipYear.closedAt`), never reopens, and no contest can
  be created into a closed year. The plan's earlier "LeagueYearFinish → Season FK" is
  replaced.
- Finishes and medals (Derek 2026-11-24, slice 20b): `LeagueYearFinish` is renamed
  `ContestSquadFinish` (one row per team per settled contest, from its best entry: place,
  tied, ranked entries, points, `championshipYear` copied from the contest). Every
  contest type with a finishing order writes them (tiered, budget, quick pick, pick'em,
  survivor, bracket, Clutch Card); squares does not. Medals count gold, silver, bronze and
  top 10 (new) from these rows in one shared function, over every contest that writes them;
  cups and the Championship filter them by their own rules. A team's run in a recurring
  contest (its Masters finishes by Season) reads the same rows through the covered slot; its
  team-page screen is #1996.
  Hall of Lame and the record book are unchanged apart from the year rename.
- Perpetual trophies (Derek 2026-11-24, slice 20d): `PerpetualTrophy` (League FK, template
  FK, slot definition FK set only for ONE_SLOT templates), replacing the event-series +
  selection-type key string (no built id string). ONE_SLOT: template plus its slot (the
  Masters tiered and Memorial tiered trophies are separate). ALL_LISTED and FROM_SLOT: the
  template alone (a season-long pick'em keeps one trophy whatever week it starts). A ONE_SLOT
  contest on a single WEEK slot gets none (replaces `isWeekOfGames`); a contest without a
  template gets none. Named from the template, sport league and slot by the API; one plate per
  Season with that Season's winners; "repeat winner" means consecutive Seasons. A trophy shows
  from its first Season (`PERPETUAL_TROPHY_MIN_YEARS` goes). Templates have no versions and
  are edited in place, so a trophy's history survives setup changes. Squares (Derek 2026-11-24)
  keep a perpetual trophy: each Season's plate is the team whose box won the final score
  (the frozen final-period `ContestSquaresWinner`); still no medals, Championship points or
  records.
- Points scales (Derek 2026-11-24, slice 20e): `STANDARD_POINTS`, `TOP_TEN_POINTS` and the
  `CupPointsScale` enum move to `PlatformPointsProfile` (code, name, `kind` TABLE |
  FIELD_BEATEN, `points` list for TABLE, `pointsAfterTable` for STANDARD's tail), seeded by
  migration; `League.platformPointsProfileId` replaces `cupPointsScale`, and a league's
  custom list is a points profile row the league owns (`cupCustomPoints` goes). Crowned cups freeze the
  profile's points they used. Kept in code as fixed rules: last place needs 3+ teams, medal
  by place, the championship grid's 10 places.
- Championship counting (Derek 2026-11-24, slice 20e): `PlatformChampionshipProfile`
  (code, `counting` ALL_FINISHES | CUP_CONTESTS), seeded by migration with two rows ("All
  contests", "Cup contests"); `League.platformChampionshipProfileId`, default All contests,
  chosen by the commissioner in league settings. ALL_FINISHES counts every contest that
  writes a finish (all but squares); CUP_CONTESTS counts only contests whose template has
  `countsInCups`. The profile governs the League Championship only; medals, the record book
  and the Hall of Lame count every finish. The Championship reads the current choice until
  its year closes, then freezes with the year.
- Cup crowning (Derek 2026-11-24, slice 20f): automatic. A cup is crowned, by a job on the
  domain event handler map, once every slot it covers has finished and every counted
  contest in it is final; the API returns `isOver`. Crowning freezes its points; the
  commissioner `crownCup` route and button go. A year can't close with a cup uncrowned. A
  correction after crowning raises a finding.
- Clutch Cards for the 2027 NFL playoffs (Derek 2026-11-24): the goal stays (#937 closed,
  replaced by slice 26 from the sync); slices are built in the best order with slice 26
  targeted before late January.
- Contest events page (Derek 2026-11-24, slice 15): the commissioner's free "Events" checklist
  (`contest-events-page.tsx`, `setContestSportEvents`) is deleted. The coverage pick (the
  slot, or the starting slot) is made at creation and can be changed on the contest's
  settings while it is in Set up, with the same picker; from Open its slots are fixed.
- Cancelled slots (Derek 2026-11-24, slices 6 and 14): Season slot status gains CANCELLED, set
  from the feed or by a root admin (audited). Contests covering only that slot are cancelled
  and their entries voided; a multi-slot contest settles on the slots played; cups and the
  year close treat a cancelled slot as finished.
- Overlapping rounds (Derek 2026-11-24, slices 16 and 26): a contest locks at its first
  covered Game and, when it picks from a field (tiered, budget, quick pick, Clutch Card),
  opens once every match feeding that slot is decided; brackets and pick'em pick sides, which
  can be "winner of", so they open earlier. Templates list a slot
  as a starting point (ONE_SLOT, or the first slot of ALL_LISTED / FROM_SLOT) only where that
  holds; the NBA and NHL second round and Conference Finals are not starting points, so
  today's Conference Finals Clutch Cards go. A contest that can't open raises a finding.
- Play-in rounds (Derek 2026-11-24, slices 11 and 26): whole-tournament tiered, budget and quick
  pick templates list the Round of 64 (NBA first round) through the Final and leave the
  play-in out; the play-in is still synced and fills the bracket before the cutoff.
- Clutch Card coverage (Derek 2026-11-24, slice 26): a Clutch Card template covers slots of one
  event only (regular-season or playoffs, never both), so one field, pick list and tier set.
- No tie picks (Derek 2026-11-24, slices 11 and 17): in every sport, soccer included, a pick'em,
  survivor or bracket pick names one of the two sides. `PredictedResult.TIE`, `takesTiePicks`,
  `tiePicksOffered`, `PREDICTION_TIE_NOT_OFFERED` and the web tie option are deleted in slice
  17, and its migration deletes stored tie picks. Games can still end tied, and today's rules
  for that are kept: in pick'em a pick on a tied game earns nothing (a tie has no winner; a
  spread push is still a push), and in survivor a tied game puts the entry out, as a loss does.
  Brackets are for elimination tournaments, whatever the phase (Derek 2026-11-25: "postseason is
  not a requirement"): a bracket template lists only knockout slots, played head to head and not
  a WEEK of a season's games, so a playoff round and a tennis Slam both fit. Any other slot is
  refused, read from the slot's kind and match format (slice 11); the ATP and WTA bracket
  templates stay.
- No multi-tournament field pools (Derek 2026-11-24, slices 11 and 15: "not practical; the
  Majors cup serves that purpose"): tiered, budget and quick pick contests never span events.
  The PGA and LPGA majors pools and the ATP and WTA Grand Slam tiered pools are deleted by
  migration in slice 11 (#2010), with their code: `scoreMissedLineup` and the multi-event
  `ContestSportEvent.sequence` reading (slice 15). The unplayed-round 80 inside one event
  stays (an API field in 10b). A league runs one
  contest per major, and the Majors Cup (golf) or Grand Slam Cup (tennis) adds them up.
  Only pick'em and survivor (FROM_SLOT over WEEK events) span events; ALL_LISTED covers one
  event's slots. The events sync loads each Season's whole schedule ahead, so coverage is
  fixed at creation from the Season's slots, with no "slot created" join handler. The
  existing late-join job `ADD_RELEASED_EDITION_TO_CONTEST` (the release-into-template-contests
  handler, `addReleasedEditionToContest`) is deleted in slice 11.
  Future rule (Derek 2026-11-24): if a field contest ever spans several events, it takes
  one set of picks made once ("Scottie Scheffler for the next three tournaments"), never a
  pick window per event. Not built now.
- Corrections after settlement (Derek 2026-11-24, slice 18): the feed's new value is always
  stored; settled results stay frozen; the finding offers a root admin "Re-settle" until the
  contest's championship year closes. Re-settling recomputes the contest and everything
  downstream (finishes, medals, cups, the Championship), is audited and notifies the
  league's commissioners.
- F1 (from "F1 only car racing at launch" and sync-only): BALLDONTLIE covers F1, so slice
  10d adds the F1 adapter on FIELD Matches (races as Games, drivers as sides).
- Provider switch (Derek 2026-11-24, slice 10): the migration that adds a league's new
  provider supplies its team mappings. Games match by the two teams and the date; players
  by team plus the new provider's roster. Each unmatched player raises a finding with a
  "map to" action, and the switch stays blocked while any ERROR finding is open. Names are
  never matched.
- Two contests on one slot (Derek 2026-11-24, slice 20f): leagues don't run a tiered and a
  budget pool on the same event, so cups add no per-slot limit; every counted contest
  counts. The Trophy case help says which contests count. A league that wants practice
  contests out of its Championship picks the "Cup contests" counting profile.
- Crowning cups plan feature (Derek 2026-11-24, slice 20f): cups crown automatically on
  every plan, so the CUP_CROWNING plan feature, its gate, its plan-list label and its
  pricing-table row are removed.
- Championship tab medals (Derek 2026-11-24, slice 20e): on the Championship tab the medal
  tiles and the matrix follow the Championship's counting profile; the squad page's
  all-time medals count every finish and are labelled "All contests". The API returns both.
- Manual result entry (Derek 2026-11-24, slices 7 and 8): results come only from the feed,
  and test events get theirs from the test data loader (last season's box scores). The
  manual score, bracket, golf-round and race-order panels and the CSV uploads are deleted,
  not rebuilt on Game side results. A feed failure raises a finding.
- Obvious calls from the final review (2026-11-24, taken as recommended): a voided survivor
  pick survives the week ("Voided · game postponed"); a league's custom cup points are a
  points profile row the league owns; a finding requires its league, links the rest by
  optional composite FKs and carries one providerValue column (NULLS NOT DISTINCT unique);
  WEEK slot definitions are seeded to the longest season and each Season makes only its
  weeks; event page copy stays in the web keyed by page and template; Sport.urlSegment is
  seeded with today's value (american-football); a Season may hold several labelled test
  slots per definition, unique on (Season, definition, label); unmapped participants become
  a finding kind whose action is the existing map page, and the Sports Issues column counts
  open findings by severity.
- League structure tab (Derek 2026-11-24, slices 5, 6 and 21b): the League page gets a
  read-only Structure tab listing phases, slot definitions with their provider mappings,
  Seasons and their slots, positions, conferences and divisions. Rows open a view-only
  dialog with no Edit, because migrations own these rows.
- History review (2026-11-24, model, behaviour and tickets reviewers; reports in the design
  folder). Fixes that follow from decisions already made:
  - Copies agree by composite FKs: Season, Contest and finish `championshipYear` cannot
    differ. `Cup` keeps `sportLeagueId` with composite FKs to its Season and definition; the
    definition gets a stable `key`. Cup routes and the squad cup-points route take a cup id,
    since one sport league can have several cups in a Season.
  - Cup is re-keyed once, in 20f; slice 15 only adds `sportLeagueSeasonId`. The 20f
    migration deletes cups that match no definition (an NFL pick'em cup) and finishes from
    squares; the 20b migration refills or deletes old finish and year-review rows.
  - The cup counting rule has a model home: `ContestConfigTemplate.countsInCups`, seeded by
    migration (tiered, budget, Clutch Card), true only on ONE_SLOT templates and enforced by
    a check, so multi-slot templates never count; copied to the contest; no selection-type set in
    code. Cup contest lists show only counted contests. Cup and points-profile names that
    are generic words ("Season Cup", "Standard") are display strings keyed by code; a name
    column holds only proper names ("Majors Cup").
  - Points: a cup reads the league's current points until crowned and freezes them at
    crowning; the Championship uses the same rule, not a per-finish snapshot.
  - Completion time is `Contest.endsAt` only; the finish row doesn't copy it. History lists
    a contest under its `championshipYear` everywhere (the drill-down's calendar-year window
    goes), so an NFL 2025 contest settling in February stays in 2025.
  - The clock never decides a year: the ~20 `championshipYear(now)` call sites and the
    web's `isCupSeasonOver`, `CUP_SHOWN_FROM_COUNTED`, points preview and trophy names read
    API fields (open and closed years, `isOver`, `isShown`). The shared function is renamed
    so it can't be confused with the column. "Last year" reads the previous Season row,
    never `year - 1`, including the Ready for contests email's last-year winners.
  - `SportLeagueSeason.name` ("2025-26"), set by migration with the Season.
  - The plan limit "sports leagues a year" counts by `Contest.championshipYear`.
  - Squares drops out of trophies, history winners, the record book and the Hall of Lame
    with its finish rows; medals are counted in one function (three today).
  - With NOT_COUNTED gone (Derek 2026-11-24) commissioners no longer exclude a contest; the
    opt-out screen and its golden-journey E2E step go.
  - Team-sport leagues have no cup until they run Clutch Cards (Derek 2026-11-24); the
    Trophy case's empty state says so.
  - Interim readers: slices 11 and 15 keep perpetual trophies, repeat winners, cups by
    year and last-year winners working on the new keys until 20–20d land; `moveToSeason`
    is deleted in 15.
- Squares (Derek 2026-11-23, slice 18c): rows are side 1 and columns side 2 by side number,
  not away and home. `ContestSquaresWinner` keeps the period, box and winning entry (frozen
  at settlement, as decided in October) but drops `homeScore`/`awayScore`; the screen reads
  the running score from the Game sides' period scores, which hold the feed's points per
  period (BALLDONTLIE `home_team_q1`…), summed by one server function. A feed correction
  after settlement that would move the winning box raises a finding, never a silent change.
- `GOLF_RELATIVE_TO_PAR_TOTAL` is renamed for stroke play and reads Game sides; the web's
  unplayed-round `'80'` and current-round derivation become API fields (slice 10b).
- Event page offer copy moves out of `event-page-copy.ts` into offer or template data
  (slice 11).

## 9d. Final review fixes (2026-11-24)

Five reviewers (model, behaviour, tickets, front end, product) read the whole plan. Their
questions are settled in §9c. These are the fixes that follow from decisions already made,
grouped by the slice that owns them. Each slice ticket carries its lines.

**Every slice.**
- Display strings: each slice adds the en-US keys (by code) for the enum values and error
  codes it adds; no slice waits on #1955.
- *Web consumers*: every DTO-changing slice lists the web files that read what it changes,
  moves each reader to the API field it adds, and adds web unit and MSW tests for them.
- Each slice names the browser journey steps it breaks and fixes them in the same PR;
  journeys move to seeded leagues and labelled test slots.
- Each slice names its query-scaling case: 1 the Providers list, 2 findings, 6 Season slots
  per league, 7 events with their slots, 15 contests with covered slots, 17 entry slots per
  contest, 21 the roster, 26 the pick list over covered slots.
- Each slice carries its docs from *Docs that change with their slice*, and retires the plans
  it supersedes: `championship-stat-pools.md` and `stat-pools-expansion.md` (1b),
  `live-sports-data-balldontlie.md` (10c), `super-bowl-squares.md` (18c).
- Defects fixed with a failing test first: 6 the five "current year" rules; 8 the unknown
  tour read as PGA; 10 webhook routing by id prefix and a series result at Game 1 (#1722);
  13 the CFP field is every bowl team (#1715); 17 a postponed game's picks stay locked;
  18b the tiebreaker collected but unused (#368).
- Every derived fact (started, open, revealed, over, expected crowning date, readiness
  reason) is an API field; the web app reads it.

**Provider core (1, 1c, 1d, 1e).**
- 1 owns `SportLeagueProviderMapping` and `SportLeague.selectedProviderMapping`; every DTO
  that names a provider returns its name. The webhook `eventIdPrefix` stays in the adapter
  until slices 7 and 10 delete it. A webhook flag with no secret is refused and logged
  until findings exist (slice 2 raises it as an ERROR finding).
- `Provider` and `ProviderLeague` are the stated exception to the provider-key rule: they
  are the provider's own lists. Game, event and Season mappings are keyed by
  (ProviderLeague, provider id).
- RATE_LIMITED retries don't count toward attempts, but one deduplicated WARNING per
  Provider is raised after N minutes of continuous RATE_LIMITED, and an ERROR at the quiet
  threshold.

**Findings (2).** Dedupe per kind and subject; retention cleanup, which never deletes a
WAIVED inclusion finding; an alert on ERROR (its delivery path named, Terraform if an
alarm); WAIVED needs a note. The list is a Manage grid; rows open a ⤢ dialog with Details
and Actions; later slices add actions by kind. Sync kinds come from `ProviderSyncKind`.

**Renames and removals (1b, 3, 3b, 3c, 4).**
- 1b owns every old Clutch Card removal: `parentSportLeagueId`, `parentRoundNumbers`,
  `parentEventId`, `isClutchCardLeague`, the delayed sync, COMPOSITE, StatLine,
  `clutch-card-parents.ts`, `stat-pool-copy.ts`, `clutch-card-copy.ts`,
  `clutch-card-page.tsx`, the Clutch Card event page offers, the `add-clutch-card-league`
  skill and its AGENTS.md rows, and the Clutch Card text in `ux-rules.md` §12/§13.
  `/play/clutch-card` keeps its address and shows inactive until 26.
- 3 renames only, listed: `SportEventMatch` → `SportEventRoundMatch`, `TierProfile` /
  `PricingProfile` → `Platform…`. Every `Platform…Profile` gets a `code`; `name` stays
  only for proper names.
- 3b deletes the golf module and its odds (closes #387).
- 3c adds `Sport.urlSegment` (seeded with today's values) and `Sport.displayOrder`, drops the
  `sport` copies, and drops `ContestEntryPick.contestFormat`/`period`/`slot` (closes #632)
  and `ContestPrizeDefinition`.
- 4 drops `Sport.participantType`.

**Definitions, Seasons and events (5, 5b, 6, 7, 7b).**
- 5b adds `matchFormat` and `canEndTied`; `tournamentFormat` is deleted in 10b once its last
  reader moves. The period unit is an enum (QUARTER / HALF / PERIOD / INNING / HOLE) with a
  count, on the slot definition.
- 6: the migration creates each Season with its phases, slots and `championshipYear`; the
  sync maps the provider's season id and fills slot dates. Slot dates come from the slot's
  Games (earliest start, latest end); migration dates are placeholders. A slot outside the
  Season span raises a finding and never blocks a write. `currentSeasonId` is recomputed by
  one daily function from rows (the next Season has a slot with a synced event). Calendar
  week 1 anchors on the Season's earliest Game, in the league's time zone (a new column); a
  game before the span is a WARNING. Unique (sportLeagueId, championshipYear). Root admin
  year pickers become Season pickers (`SportLeagueSeason.name`, default `currentSeasonId`);
  "make current" and "clone year" go; query keys by `seasonId`. Drops `eventYear` and
  `currentEventYear`.
- 7: drops `SportEvent.providerId`/`externalId`, deletes the catalog browse (closes #1809),
  the year import and manual linking; the run-sync page's pickers go and "Sync now" queues
  the job; the hand-made event form becomes "pick a test slot of the current Season". The
  Event page gets a *Slots* tab whose rows open a `DetailEditModal`; later slices add their
  actions there. Venue moves to the Game and `participantCount` becomes an API field over team rows, both in
  10f; event dates derive from its slots; `metadata` is dropped or typed.
- 7b (new): team tiers, valuations and the `tierConfig`/`pricingConfig` JSON re-keyed to the
  event slot. A slot's tier set covers field rows not eliminated entering that slot. The
  Field tab gets a slot selector; query keys move to (event, slot).
- Coverage resolves from the offered event's own slots; every row of a contest's coverage
  shares one `isTestData`; cups and the rating window skip test slots.

**Sync matching (8, 12, 13).**
- 8 adds the inclusion-only INFO finding (one per league and value; waiving marks it known
  and excluded). 12 and 13 are blocked by 8 only and land before 10 and 10b.
- 12 uses `SportLeaguePhaseSlotProviderMapping` with matchType NAME_PATTERN: normalized
  (case, year, "presented by"), actions "link to existing (adds a pattern)" and "create
  new", an ERROR on two matches, and match by id once linked. The open-phase Season slot is
  created when its first tournament matches, never at Season creation.
- 13 ships all of #1924 (badge and banner included), with unplaced games at INFO. DATE_WINDOW
  matches games inside the Season slot's own dates plus the mapping's team filter.
- Events are also created (unreleased, offering nothing) for slots a Clutch Card's rating
  window needs; release ignores events with no covering template.

**Games and sides (9, 10, 10e, 10f, 10g, 10b).**
- 9 carries only "the final is the round's slot kind FINAL"; it adds the slot's `name` and
  `slotKind` to every round and bracket-game DTO, and the deletions of the round-name arrays
  and `roundNames` move into it. The positional final goes.
- 10 takes the re-issued game id fallback and a moved game: a move never re-parents; the old
  Game keeps its picks' FKs and is marked moved, and a new Match and Game are made in the
  target slot's event with the mapping moved. Until 17, a move raises a finding only.
  Drops `SportEventMatch.externalGameId`.
- Side numbers are fixed by whoever creates the Match; the sync applies away 1 / home 2 only
  to Matches it creates, and updates `homeAway` only on existing ones. The FINAL placeholder
  Game links to the feed's game by (slot, Match, game number 1). `homeAway` sits on the Game
  side result (it alternates in a series).
- `isPlayInPlace` and the placeholder participant go: an undecided side is an empty Match
  side. There are no tie picks, so `predictedResult` goes and every pick stores its side and team.
- One field row `status` enum (ACTIVE / WITHDRAWN / ELIMINATED / DISQUALIFIED); Standing
  reads it. Seed only on the field row. The shootout only as SHOOTOUT period rows.
- `sportEventSlotId` is carried Round → Match → Game by composite FKs; a null outcome is tied
  to FIELD format by check; the spread sits on side 1 only.
- 10b: the slot completes on the feed's tournament status FINAL, not a round count; round n
  sides come only from the feed's round n. `formatThru` reads `periodsCompleted`; CUT, WD
  and F are `enum.ParticipantStandingStatus` short forms. Golf notification routing moves
  here. Drops the racing rider name column and `tournamentFormat`.

**Status and release (14, 14b).**
- 14 keeps today's event-COMPLETED settle trigger; 18 removes it with settlement by slots.
- "Started" is judged by the cutoff function (first Game's start, else `startsAt`), never by
  status; 10c's field window and 14b use it.
- Overdue moves to the Game: past start + `typicalGameMinutes` with no update raises a
  finding. Postponed picks are voided only on the feed's POSTPONED status, never on
  silence, a breaker open or RATE_LIMITED. A postponed game with no new date raises a
  finding with "complete slot" after a wait; root admin can also set or cancel a slot.
- 14b: release by the next unstarted slot; `ReleaseCheckKey.NOT_STARTED` goes and
  `autoReleaseDaysBeforeStart` keys on that slot. A readiness check "seeds present for a
  slot whose pairing needs them" (WARNING when the field is known, ERROR inside the
  auto-release window).
- #1953 is blocked by 6, 10 and 10b; it settles by slot, drops the reopen row, and adds the
  Match and Event refresh rows.

**Contests (15, 15b, 15c, 16, 17, 18, 18b, 19).**
- 15 states covered slots per coverage mode: ONE_SLOT and ALL_LISTED take the template's
  slot definitions ∩ the chosen event's Season slots; FROM_SLOT takes them ∩ the chosen
  Season's slots from the starting slot on. `templateId` is NOT NULL. Its *Web consumers* list
  `firstContestEvent`/`lastContestEvent`/`currentContestEvent`, replaced by
  `currentSlotId` and the cutoff. `ContestDraw.receiptsPendingSportEventId` becomes a
  ContestSeasonSlot FK. The bracket start-round picker, `?startRound=` and its helpers go.
- 15b: squares (`squaresFromRound`, the Game FK; the API returns the Game choices),
  `bracketStartRound`, `EventPageOffer` and the salary cap from slot pricing.
- 15c: `ContestConfiguration.selectionType`, `templateVersion`, `Contest.contestFormat`; the
  template's `contestFormat` goes and its unique key is (sportLeagueId, selectionType,
  templateKey).
- 16 owns `Contest.startsAt` and the web cutoff helpers, and folds #1932 and #1990.
  Readiness returns a reason code per wait, shown in words ("Opens when the Wild Card round
  ends").
- 17: entry slot reads carry `opensAt`, `closesAt`, `isOpen`, `isRevealed`; `?round=` becomes
  a slot id. Voids for moved and postponed games, shown "Voided · game moved to Week 15"; a
  void before the cutoff sends the entry back to needing picks. The tiebreaker game is set
  when the slot's window opens and re-run on schedule changes; a change reopens the guess
  and notifies entries that guessed. The guess shows the game's teams.
- 18: each contest type declares its settlement trigger; squares settle on their one Game,
  the rest on covered slots.
- Every suggested contest name, trophy name and offering label is built by the API from the
  covered slots' names. Offering notices group by covered slots; each pick window that opens
  sends the existing opened or reminder notice for that round.

**History (20 to 20f).** `Contest.countsInCups` copied from the template, read by every cup
and championship reader; `crownedPointsProfileId` plus a frozen `crownedPoints Int[]` on cups
and the same pair frozen on `LeagueChampionshipYear` at close; 20b drops `points` and
`settledAt`. The close ignores drafts that can never open; the Championship tab says what
holds the year open. The contest page and Create contest say "Counts toward the 2026
championship"; the year picker marks open years and opens on the earliest open year with a
live contest. Edit championships says what a change rescores and how many contests each
counting choice covers. A cup row shows its expected crowning date; a crowned cup shows on
League Home for a few days. Cup definitions are seeded only where a single-slot template can
fill them. The year review reads the latest closed year not yet sent. The plan-limit route's
`seasonYear` becomes `championshipYear`.

**Rosters, stats and Clutch Cards (21, 21b, 21c, 22–27).**
- 21 defines "leagues whose templates include a Clutch Card" once, in the model; tests seed a
  Clutch Card template; 27 is the first QA proof. The roster sync is a `ProviderSyncKind`
  job on the 10c tick. The Field tab splits into Teams and Players. Drops
  `Participant.teamAffiliation`.
- 21b: conferences and divisions. 21c: seeds from the feed, `toMlbSeeds` removed.
- 24 rates when a slot completes, on the handler map.
- 26 (backend) and 26b (web): the leaderboard renderer is chosen by the contest's
  `scoringDefinition`, not the league's family; COMPOSITE entries and `StatLinesPanel`
  go; `/play/clutch-card` resolves (#1076); one Clutch Card template per playoff slot plus
  the whole-event card; `ux-rules.md` §13 item 3 rewritten.
- 28 re-maps every `…ProviderMapping` table, listed.

**Structure and admin.** The League page's read-only Structure tab (5, extended in 6 and 21b). The Sports
Issues column counts open findings. The Contest templates dialog shows "Covers". Profiles
sections (23, 24) open view first through `DetailEditModal`. The "add league" page goes in
5; the `add-sport` skill adds a league.

## 10. Slices

Live state is in the sub-issues of #1917 (slice N is the ticket titled "League model N"). Each slice is 1–3 hours and carries in its own PR:

- its tests: query-scaling cases for list GETs, contract verification, and failing tests
  first for defects;
- its docs, rules and skills;
- the test-data loader update;
- a blast-radius statement;
- "Blocked by", including other epics (#1946/#1953, the display-string epic).

Migration slices merge one at a time. Each migration must still apply to QA's rows: a slice
that adds a required column deletes or creates the rows it can't fill (no data is kept), or
the deploy stops with P3009.

In build order (Derek 2026-11-24: "build in the best order"). Each line ends with its
blockers beyond the slice before it; see §9d for what each slice also carries.

0. Naming pass and ADR (docs PR), before anything is built.
1. Provider core: the Provider and ProviderLeague tables seeded by migration; base URL, rate,
   webhook and per-league adapter settings read from them; `SportLeagueProviderMapping` and
   `selectedProviderMapping`; the Providers page; the Terraform binding variable removed
   afterwards.
1b. Old Clutch Card leagues and every piece of their code removed (no users; rebuilt in 26).
1c. Provider resilience: the local limiter, cockatiel, RATE_LIMITED retries. (after 1)
1d. Mock provider out of production source; env var reads. (after 1)
1e. `Participant.externalId` → mapping, its unique key, run and job Provider FKs, raw ids.
    (after 1)
2. Findings, with the admin list. (after 1)
3. Pure renames, listed (`SportEventRoundMatch`, `Platform…Profile` with `code`).
3b. Golf module and its odds removed (closes #387).
3c. `Sport.urlSegment` and `displayOrder`; `sport` copies and dead pick columns dropped
    (closes #632).
4. Positions; `SportLeague.participantType` required.
5. Phase and slot definitions for every league, the `add-sport` skill, the Structure tab.
5b. `matchFormat` and `canEndTied` on definitions (`tournamentFormat` goes in 10b).
6. Seasons (and labelled test slots), the current-Season rule, the Season fetch, slot dates
   from Games, calendar-week slots and the league time zone; Season pickers in root admin.
7. Events in a Season, EventSlot, event provider mapping, the Slots tab; manual linking and
   catalog browse removed.
7b. Team tiers, valuations and pricing re-keyed to the event slot. (after 7)
8. Sync matching by provider code; adapter tables removed; the inclusion INFO finding.
9. Round slot FK, per-round match numbering, slot name and kind on round DTOs; round-name
   arrays and `roundNames` removed here.
12. Sync matching by golf name, with the finding actions. (after 8)
13. Sync matching by date window and calendar week, all of #1924. (after 8)
10. Games, GameProviderMapping, webhook routing, moved and re-issued games. (after 8, 9, 13)
10e. Match sides, Game side results and period scores; pick'em, bracket and squares readers.
10f. Field row metadata columns and the period count.
10g. The tiebreaker game and its slot dialog.
10b. Golf and racing on FIELD Matches; golf and race tables and `tournamentFormat` removed.
    (after 10e, 12)
10c. Sync scheduling on jobs (absorbs #1835, #1933): one tick queues due work as jobs; field
    window judged by "started", never status.
10d. F1 adapter: races on FIELD Matches from BALLDONTLIE's F1 API. (after 10b)
11. EventSeries removed; event page offers and templates point at slots
    (`ContestConfigTemplateSlot`, `coverageMode`); Create contest interim.
14. Status bubbling (Game, Match, Slot, Event) on the handler map, completion per scoring
    family, Game overdue, postponement wait, set and cancel slot. (after #1953)
14b. Release by the next unstarted slot; seeds readiness check.
15. ContestSeasonSlot replaces ContestSportEvent; Season FK on Contest and Cup;
    `templateId` required; web consumers. (after 7b, 10e, 11)
15b. Squares Game FK, `bracketStartRound`, `EventPageOffer`, salary cap from slot pricing.
15c. The §9c contest drops.
16. Readiness and cutoff from covered slots (folds #1932, #1990).
17. Pick windows per slot and voided picks; moves and postponements void.
18. Settlement by covered slots and per-type triggers; event-COMPLETED trigger removed.
18b. `ContestScoringConfiguration` and the tiebreaker (closes #368). (after 10b, 17)
18c. Squares winners from Game sides and period scores.
19. Offerings and notices by covered slots. (after 18b)
20. Championship year on contests and history.
20b. `ContestSquadFinish`; medals in one function.
20c. `CupWeight` and NOT_COUNTED removed.
20d. Perpetual trophies.
20e. Points and championship profiles.
20f. Cups: definitions, crowning, `CUP_CROWNING` removed.
21. Rosters and player field rows (closes #1859); trainer column; Teams and Players tabs.
    (after 10c)
21b. Conferences and divisions.
21c. Seeds from the feed; `toMlbSeeds` removed.
22. Player stats.
23. Composites and scores; scoring profile section.
24. Rating, on slot COMPLETED; rating profile section. (after 14, #1953)
25. Rating backfill job.
26. Clutch Card contest type, backend. (after 16, 19)
26b. Clutch Card web app and `/play/clutch-card`. Target: before late January 2027.
27. Clutch Card test data on the parent leagues.
28. Provider switch gate and re-mapping of every mapping table. (after 10, 10b, 21b)
29. QA rebuild and squash.
30. Domain model documentation overhaul (Derek 2026-11-22): `rules/domain-model-concepts.md`
    and the model rules rewritten for the new model, including its deferred concepts
    (team-cup lineups, injuries #1934).

Admin screens ship with their backend slice. Related tickets:

- after the core: #1926 bracket shape (re-scoped to shape only; absorbs #793), #1965
  template review;
- deferred: #1934 injuries;
- separate epics: display strings, the domain event handler map (#1946).

## Durable decisions to codify

Before this plan is deleted:

- an ADR for the Season, Phase, Slot model, contests covering slots, and Clutch Cards as a
  contest type (superseding the round-league design and amending ADR 0011);
- `rules/domain-model-concepts.md` updated for Season, Phase, Slot, Game, ContestSeasonSlot and
  the roster row;
- `architecture-rules.md` §4 updated for status bubbling;
- `docs/LIVE-SPORTS-DATA-SYNC.md` rewritten for the mapping-table sync.
- `rules/domain-model-conventions-rules.md` §17 *One computation per fact* gains (Derek
  2026-11-22): the data provider is the source of truth. A fact the feed supplies (scores,
  totals, positions and ties, status, cut) is stored from the feed; we compute or derive a
  fact only when the feed doesn't supply it (composites, ratings, standings for families
  the feed doesn't rank).

### Rules that land before implementation (slice 0, with the ADR, reviewed)

- `domain-model-conventions-rules.md`: §10 *Full-path names* (owner-path names, `SportEvent`
  prefix, `Platform…Profile` + `platform…ProfileId`, copied settings are `…Template`); §17
  *Provider keys live only in ProviderMapping tables*, inclusion-only with one INFO finding
  per unmapped value; §17 feed-first line in *One computation per fact*; §17 *Proper names are
  data, generic words are strings* (#1955); §9 *No nullable either/or parents*; §11 a Match
  has 2..n sides, no sport result tables; §17 fixes for `providerRef`, `orderIndex` and the
  WARNING/ERROR miss wording.
- `domain-model-concepts.md`: the target model (entity chain, vocabulary, "the event side
  mirrors the feed", "contests cover Season slots and hold no team, player or match data")
  and a *Deferred concepts* section, with stale rows flagged until slice 30.
- `workflow-rules.md` §1 and AGENTS.md: every active league is provider-synced; a league with
  no feed stays off (replaces "synced and unsynced are two workflows").
- `review-triggers.md` §9 and the `scan-hard-coded-rules` / `review-a-pr` skills: flag a
  provider key column outside a mapping, an either/or FK pair, generic-word columns, and
  recomputing a fact the feed supplies.
- `testing-rules.md` §9B: pin a 150-golfer, 4-round leaderboard read.

Display text that becomes a display string (coordinator note from the #1960 review,
2026-11-23): a column that today holds display text and becomes a key holds an enum code
mapped to a typed display-string key (for example through the typed `sportWord(sport, role)`
helper), never a free key string.

### Docs that change with their slice

- 1: provider settings out of `architecture-rules.md` §3/§6 and `service-rules.md` §1.
- 1 (S1, S2): the rate-limit quota and retry policy in `docs/LIVE-SPORTS-DATA-SYNC.md`;
  `docs/EVENT-SETUP-PROCEDURES.md` loses mock linking and "Start live simulation"; the mock
  provider's sections in `docs/CI-AND-QUALITY-GATES.md` and `docs/LOGGING-OPERATIONS.md` say
  it no longer runs (deleted with the module by #1981).
- 7 (S3): manual score-source linking out of `docs/EVENT-SETUP-PROCEDURES.md` and
  `docs/SPORT-DATA-LOADING.md`.
- 10c (S4, S5): the scheduler, job kinds, dedupe keys and season-state intervals in
  `docs/LIVE-SPORTS-DATA-SYNC.md` and the generated background-jobs table.
- 1b: retire the `add-clutch-card-league` skill and its AGENTS.md rows; Clutch Card lines in
  `architecture-rules.md` §4 and `ux-rules.md` §12/§13.
- 5: rewrite the `add-sport` skill; the sport registry text in `architecture-rules.md` §4.
- 6–7: the test-data shape in `architecture-rules.md` §6.
- 11: rewrite the `add-event-page` skill; `ux-rules.md` §13 items 1–3 and §12 item 12.
- 11 and 15 (no multi-tournament field pools): the majors-pool and multi-event lines in
  `domain-model-concepts.md`, `ux-rules.md`, the `add-sport` skill, `docs/DOMAIN-OPERATIONS.md`,
  `docs/EMAIL-DELIVERY.md`, `docs/EVENT-SETUP-PROCEDURES.md`, `docs/SPORT-DATA-LOADING.md` and
  `docs/BACKGROUND-JOBS.md` (the `ADD_RELEASED_EDITION_TO_CONTEST` row).
- 14: status bubbling and the handler map in `architecture-rules.md` §4.
- Every sync slice: its part of `docs/LIVE-SPORTS-DATA-SYNC.md`, fully rewritten by 29.
- 20: `docs/DOMAIN-OPERATIONS.md` championship section and rows 914–924;
  `docs/EMAIL-DELIVERY.md` (year in review opens when the year closes).
- 20b: the LeagueYearFinish row in `domain-model-concepts.md`.
- 20c, 20e, 20f: `docs/DOMAIN-OPERATIONS.md` cup section; the Cup row in
  `domain-model-concepts.md`.
- 20d: `plans/season-cups.md` and `plans/league-history-research.md` deleted or marked
  superseded.
- 30: the full `domain-model-concepts.md` overhaul.

## Open questions

Both reviewers agreed with the recommendations for 1, 2, 3 and 5.

1. ~~Clutch Card player tiers and prices~~ Settled: tier sets and valuations keyed by event slot, read from a contest's first covered slot (§8).
2. ~~Roster row shape~~ Settled: one row per Season and player, no trade history (§4).
3. ~~Multi-slot Clutch Card picks~~ Settled: pick once; a player stops scoring when his team is out (§8).
4. ~~Clutch Cards during the build~~ Settled (Derek): no users, so the old Clutch Card leagues and code are removed early (slice 1b) and rebuilt as the new contest type; no effort keeps them working.
5. ~~Naming pass~~ Settled (Derek 2026-11-22): keep the full-path names and today's
   `SportEvent` prefix. Definitions `SportLeaguePhase`, `SportLeaguePhaseSlot`,
   `…SlotProviderMapping`, `SportLeaguePosition` (+ `…PositionProviderMapping`); calendar `SportLeagueSeason`,
   `…SeasonProviderMapping`, `…SeasonPhase`, `…SeasonPhaseSlot`, `…SeasonParticipantTeam`;
   events `SportEvent`, `SportEventSlot`, `SportEventProviderMapping`, `SportEventParticipant`,
   `SportEventSlotTier`, `SportEventSlotParticipantValuation`, `SportEventRound`,
   `SportEventRoundMatch`, `SportEventRoundMatchGame` (+ `…GameProviderMapping`,
   `…GamePlayerStat`, `…GamePlayerScore`); `Provider`, `ProviderLeague`,
   `SportLeagueProviderMapping`, `ProviderSyncFinding`, `PlatformScoringProfile`,
   `PlatformRatingProfile`, `PlatformTierProfile`, `PlatformPricingProfile`; contests `ContestSeasonSlot` (avoids `ContestEntryPick.slot`). Every provider key
   lives in a `…ProviderMapping` table.
6. ~~Test data~~ Settled: test events in the current Season on labelled test slot rows
   (§2); the loader re-dates test events into them.
