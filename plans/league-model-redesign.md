# League Model Redesign: Seasons, Phases, Slots; Contests Cover Slots

**Tracking issue:** #1917

Agreed with Derek in the project thread "Sync Clutch Cards through their parent league",
2026-11-19 to 2026-11-21, and revised after a model, design and ticket review. No slice is
dispatched until Derek gives the go.

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
| `ParticipantProviderMapping` | same name | Provider ids for a participant; `providerId` becomes the Provider enum. |
| `EventSeries` | removed | Cross-Season identity now comes from slot definitions. |
| `SportEvent` | `SportEvent` (same name) | A real event in one Season; gains `seasonId`. |
| none | `SportEventSlot` | Which Season slots an event covers; a slot belongs to at most one event. |
| `SportEvent.providerId`, `externalId` | `SportEventProviderMapping` | A provider's event id. |
| `SportEventParticipant` | same name | The event's field: teams, plus eligible players where Clutch Cards exist. |
| `SportEventTier` | `SportEventSlotTier` | Tier set per event slot. |
| `SportEventParticipantValuation` | `SportEventSlotParticipantValuation` | Tier and price per event slot and field row. |
| `SportEventRound` | same name | A scoring unit; gains a required slot FK and its `matchFormat`. |
| `SportEventMatch` | `SportEventRoundMatch` | Any meeting of sides in a round: two teams, two players, or a whole field. A best-of series is one Match. |
| `SportEventMatch` home/away columns | `SportEventRoundMatchSide` | One side of a Match: field row (empty until known), side number, home/away, seed, spread, rollup outcome. |
| none | `SportEventRoundMatchGame` | One played game: date, status, scores. |
| none | `SportEventRoundMatchGameProviderMapping` | A provider's game id (team-sport game, PGA round, PGA match). |
| `SportEventMatch` home/away scores, `SportEventParticipantGolfRound`, `SportEventParticipantRaceResult` | `SportEventRoundMatchGameSide` | A side's result in one Game: score, text result, score to par, position, start position, periods completed, start period, status. |
| none | `SportEventRoundMatchGameSidePlayer` | Team-cup lineups: which players played for a side in a Game. |
| `SportEventMatchPeriodScore` | `SportEventRoundMatchGameSidePeriodScore` | Score per period per Game side, with a period kind (REGULAR / OVERTIME / SHOOTOUT). |
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
    display-string epic, and until then from today's UI label maps.
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
    Season slot row flagged `isTestData` (unique per Season, definition and flag), with
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
  - **Team** tiers and prices stay event-level, frozen at release. **Every field check,
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
  - Field row (a team or a player), `sideNumber`, `homeAway` HOME / AWAY / NONE, seed and
    spread. The field row is empty until the side is known (an undecided bracket slot, a
    knockout match before its teams are set).
  - `outcome` WON / LOST / TIED / PENDING is a rollup from the Games, written only by the
    result writer (a series' 4–2). FIELD matches leave it empty.
  - Advancement is the next match plus a side number, unique per target side.
  - Pick'em picks and bracket picks point at a Match side.
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
- **SportEventRoundMatchGameSide**: a side's raw result in one Game, unique per Game and
  side: `score` (points, goals, strokes, holes up), a text result where the feed sends one
  ("4 & 3"), `scoreToPar` from the feed (never derived from a par, which breaks for
  multi-course events and mid-round), `position` (finish place), `startPosition`,
  `periodsCompleted` and `startPeriod` (holes thru, back-nine starts), shootout score and
  `status` (DNF, DSQ, DNS, WD within that Game).
  - **…GameSidePeriodScore**: one row per Game side and period, with a period kind REGULAR /
    OVERTIME / SHOOTOUT. Golf hole scores are stored only where a contest reads them; none
    does today.
  - **…GameSidePlayer** (DEFERRED, Derek 2026-11-22): team-cup lineups, the player field
    rows that played for a side in a Game (Ryder Cup pairs). Not built in this epic; built
    when match play is synced. Recorded in `rules/domain-model-concepts.md` as a deferred
    concept so a later change uses this shape.
- **SportEventParticipantStanding**: the event result per field row: total, score to par,
  position, display position ("T5") and status (CUT / WD / DQ). One writer per scoring
  family: when the feed supplies them, the sync writes the feed's own totals and tie-aware
  position (the provider is the source of truth, Derek 2026-11-22); one function per family
  computes only what the feed doesn't supply.
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
  - **ParticipantProviderMapping**, with the provider as the enum.
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
  row, so a card spanning two events scores cleanly. A contest records which composite it
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

1. **Seasons**: fetch the current and next Season through SeasonProviderMapping, with no
   rollover-month constants.
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
     derived status. Event COMPLETED no longer settles contests.
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

**Contest templates name their slots**, either as a list of slot definitions or as a whole
phase:

| Template | Covers |
|---|---|
| Super Bowl squares | FINAL |
| Super Bowl Clutch Card | FINAL |
| Playoff bracket, survivor, tiered, budget, quick pick | phase POSTSEASON |
| Playoffs Clutch Card | phase POSTSEASON |
| NFL week pick'em | its WEEK slot |

**The contest's covered slots**:

- **Storage.** A contest copies its template's slots, resolved to that Season's slots, into
  **ContestSeasonSlot** (`ContestEntryPick.slot` and
  `lineupSlot` already exist). A later template edit never changes a running contest.
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
- **Settlement** runs when every covered slot is COMPLETED, as a job keyed by the contest.
  Leaderboards rebuild through the existing snapshot job, one per contest.
- **Team tiered, budget and quick pick contests always cover their whole phase.** They use
  the event's team tiers. Bracket templates may list slots (Championship Weekend =
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
- **History.** Trophies and last-year winners key by contest type plus the sorted set of
  covered slot definitions, not by a built id string. `Contest.seasonYear`, `Cup.seasonYear`
  and LeagueYearFinish become FKs to the Season. Week detection reads the slot.

## 8. Clutch Cards: a contest type on the parent league

- **What it is.** A Clutch Card contest covers any set of the parent league's slots in one
  Season, through the same ContestSeasonSlot.
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
  - `ParticipantProviderMapping.providerId` becomes the Provider enum.
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
- Ties per sport (`pickEm.tiePicks`, `shootout`): a boolean `canEndTied` on the slot definition
  (Derek 2026-11-23); how a game actually ended comes from the feed as the Game's ending;
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
  findings); field sync has one `ProviderSyncKind`, not five names; logged-only anomalies and
  the synthetic health check become finding kinds and a status computed from runs and jobs.
- Field sync (slices 7/16) covers events whose next slot has not started, not "next 2 events
  or 14 days"; job dedupe keys use ids, not provider id strings.
- Games (slice 10): webhooks route by GameProviderMapping (no prefix match, no fan-out to all
  leagues; an unknown id is a finding); `lastProviderNotificationAt` moves to the Game; the
  NCAA play-in placeholder participant becomes an empty Match side; field row metadata
  (seed, odds, play-in place) becomes columns.
- Golf (slice 8): an unknown tour is a finding, not "all leagues".
- The web app reads provider names from the API, not by id lookups in four places.

Contest:
- Per-event entry state (`ContestEntryEvent`, `ContestEntryEventStanding`, the leaderboard
  snapshot's shown event, the squares draw's pending receipts) keys by `ContestSeasonSlot`;
  pick'em and survivor weeks are that slot, not round numbers worked out three ways
  (slices 15/17).
- Knockout round values are rows per slot definition, not a positional array; a bracket's
  start is its first covered slot, not `startsAtRound` in config JSON; the final is the slot
  kind FINAL, never `rounds.at(-1)` or `roundCount-1` (slices 9/15/16).
- One stored setup shape for template and contest, with "one default per scope" as a partial
  unique index on (league, selection type, coverage); copied and dead columns go
  (`ContestConfiguration.selectionType`, `ContestEntryPick.contestFormat` and `period`,
  `ContestPrizeDefinition`, unchecked `templateVersion`) (slices 3/11/15).
- Budget salary cap is read from the first covered slot's pricing, not copied into config
  JSON (slice 15).
- `Contest.startsAt` stops being a stored cutoff; the cutoff function is the one source, the
  API returns it, and the SQL that hides never-opening drafts calls the same rule; the web
  app's lock, entry, current-event and squares-game helpers read API fields (slices 16/18).
- Squares use side 1 and side 2 by side number, not away rows and home columns (slice 18).
- `GOLF_RELATIVE_TO_PAR_TOTAL` is renamed for stroke play and reads Game sides; the web's
  unplayed-round `'80'` and current-round derivation become API fields (slice 10b).
- Event page offer copy moves out of `event-page-copy.ts` into offer or template data
  (slice 11).

## 10. Slices

Live state is in the sub-issues of #1917. Each slice is 1–3 hours and carries in its own PR:

- its tests: query-scaling cases for list GETs, contract verification, and failing tests
  first for defects;
- its docs, rules and skills;
- the test-data loader update;
- a blast-radius statement;
- "Blocked by", including other epics (#1946/#1953, the display-string epic).

Migration slices merge one at a time. Each migration must still apply to QA's rows: a slice
that adds a required column deletes or creates the rows it can't fill (no data is kept), or
the deploy stops with P3009.

In order:

0. Naming pass and ADR (docs PR), before anything is built.
1. Provider core: the Provider table and ProviderLeague seeded by migration; base URL, rate,
   webhook and per-league adapter settings read from them; Providers page edits them; the
   Terraform binding variable removed afterwards.
1b. Old Clutch Card leagues and their code removed (no users; rebuilt in 26).
2. Findings, with the admin list.
3. Mechanical rename.
4. Positions; `SportLeague.participantType` required.
5. Phase and slot definitions for every league, with the `add-sport` skill.
6. Seasons (and flagged test slots), the current-Season rule and the Season fetch;
   calendar-week slots.
7. Events in a Season, EventSlot, event provider mapping.
8. Sync matching by provider code; adapter tables, `roundNames`, `roundSeriesLengths`,
   `bracketAdvancement` removed.
9. Round slot FK and per-round match numbering, with all readers.
10. Games, Match sides and Game sides for team sports, GameProviderMapping, period kinds,
    Match status and outcome from Games, FINAL placeholder Game; pick'em, brackets and squares
    read sides.
10b. Golf and racing on FIELD Matches: Game sides from the PGA round id, Standing from the
    feed, the cut, event-level competitor mapping; golf and race tables removed.
10c. Sync scheduling on jobs (Derek 2026-11-23; absorbs #1835 and #1933): one scheduler
    tick queues due work as jobs with id-based dedupe keys: events per league, field per event
    whose next slot hasn't started, scores per Game due or in progress. Interval per sync kind
    and season state (in season or offseason, from Season slot dates) in global settings.
    "Sync now" on the event queues the same job. In-memory per-sport timers, string locks
    and `scheduledSports` are removed; the live sweep polls Games, not in-progress events,
    and the "play is underway" heuristics go (S5).
11. EventSeries removed; event page offers and templates point at slots.
12. Sync matching by golf name, with the finding actions.
13. Sync matching by date window and calendar week, with #1924's backend.
14. Status bubbling on the handler map, completion per scoring family, release by next
    unstarted slot.
15. ContestSeasonSlot replaces ContestSportEvent, `squaresFromRound`, `bracketStartRound`.
16. Readiness and cutoff from covered slots.
17. Pick windows per slot and voided picks.
18. Settlement by covered slots.
19. Offerings and notices by covered slots.
20. History keys and Season FKs.
21. Rosters and player field rows (closes #1859); horse trainer column.
22. Player stats (StatLine removed).
23. Composites and scores.
24. Rating.
25. Rating backfill job.
26. Clutch Card contest type.
27. Clutch Card test data moved onto the parent leagues.
28. Provider switch gate and re-mapping.
29. QA rebuild and squash.
30. Domain model documentation overhaul (Derek 2026-11-22): `rules/domain-model-concepts.md`
    and the model rules rewritten for the new model, including its deferred concepts
    (team-cup lineups, injuries #1934).

Admin screens ship with their backend slice. Related tickets:

- after the core: #1926 bracket shape (re-scoped to shape only), #1933 sync cadence,
  #1965 template review;
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

### Docs that change with their slice

- 1: provider settings out of `architecture-rules.md` §3/§6 and `service-rules.md` §1.
- 1b: retire the `add-clutch-card-league` skill and its AGENTS.md rows; Clutch Card lines in
  `architecture-rules.md` §4 and `ux-rules.md` §12/§13.
- 5: rewrite the `add-sport` skill; the sport registry text in `architecture-rules.md` §4.
- 6–7: the test-data shape in `architecture-rules.md` §6.
- 11: rewrite the `add-event-page` skill; `ux-rules.md` §13 items 1–3 and §12 item 12.
- 14: status bubbling and the handler map in `architecture-rules.md` §4.
- Every sync slice: its part of `docs/LIVE-SPORTS-DATA-SYNC.md`, fully rewritten by 29.
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
6. ~~Test data~~ Settled: test events in the current Season on flagged test slot rows (§2).
   the loader re-dates test events into it.
