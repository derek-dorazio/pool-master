# Tennis

**Tracking issue:** #704

Execution narrative for #704 (tennis). It checks tennis against what the bracket sports already
built, says how the work is cut into PRs, and lists what is still open. Open questions sit under
the slice they belong to, each with a recommendation; none of them blocks starting slice 1.

## What tennis already gets for free

Tennis is a knockout of individuals: a Grand Slam singles draw is 128 players, 32 of them
seeded, in seven rounds with no byes. Almost everything a knockout needs is built and running
for basketball, hockey, baseball and football:

- **The bracket.** `SportEventMatch` with `advancesToMatchId`/`advancesToSide` and
  `regionLabel`. `BRACKET_MATCHES_MAX` is already 127, a 128 draw's match count, and
  `KNOCKOUT_ROUND_VALUES_MAX_ROUNDS` is 8, so seven rounds fit. Brackets with byes exist (the
  1000-level events' 96 draws).
- **Who won.** Every scorer reads `winnerSide`, never the score: knockout round points and the
  seed-difference upset bonus (`score-team.ts`), bracket picks (`bracket-picks.ts`) and survivor
  (`survivor.ts`). An unseeded player already counts as the field's worst seed for the upset
  bonus (`knockoutSeeds`).
- **Every pool type tennis wants.** Tiered, budget and random-draw roster pools, full brackets,
  second-chance brackets from a later round (#760), and playoff survivor, one pick per round with
  each player once (#804). Multi-event contests and a template that names its event series
  (#714, golf's majors pool) give a four-Slams pool.
- **Qualifiers.** A Slam draw is published with 16 "Qualifier" places that are filled a day or two
  later. That is exactly a play-in place (#709): a field row standing for someone not yet known,
  which `fillPlayInSlot` points at the real player, keeping every pick of the place.
- **Tiers and prices.** Tiers are auto-assigned by ranking or odds (`compareForTiering`); prices
  by seed, then odds (`deriveGolfPrices`).
- **Data.** The sport data file already carries players, fields, the bracket and results, and
  the loader applies them (`load-sport-data`).
- **Individuals in head-to-head.** Nothing checks the participant type in the head-to-head
  family. Screens read the sport's vocabulary (`bracket-copy.ts` says `${team.one}` from it), with
  a few hard-coded "team" strings left (`bracket-entry-page.tsx`'s
  `PREDICTION_TEAM_NOT_IN_GAME`), which slice 2 sweeps.

## What tennis needs

Three real gaps, and a few small ones:

1. **A match won without being finished.** A retirement (the loser stops mid-match, often
   ahead), a walkover (the loser never starts) and a default (disqualification).
   `describeScoreProblem` in `match-result-service.ts` refuses a winner whose score isn't
   higher, and there is nowhere to say how the match ended. #791 (soccer's shoot-outs, being
   built now) relaxes the same check for a level knockout score, but deliberately leaves
   retirements to this ticket (soccer plan Q1.2).
2. **The sport itself**, with its leagues, vocabulary, round names, templates and test seeds.
3. **A player who pulls out after the draw is published.** Before the event starts a lucky loser
   takes the place; once a match is scheduled a late withdrawal is a walkover. After release the
   bracket's pairings are fixed (`sport-event-bracket-service.ts`), and only a play-in place can
   take a new player.

Small ones: budget pricing has no ranking fallback for the 96 unseeded players with no odds;
the few hard-coded "team" strings.

Nothing in tennis needs #792 (ties): a tennis match always has a winner and tennis offers no
pick'em. Pick'em by day of play and squares don't suit tennis and aren't offered.

## Dependencies on the soccer work

- **#791 shoot-outs** and slice 1 here change the same lines: the result request,
  `MatchResultInput` and `describeScoreProblem`. Slice 1 starts after #791 merges, so it builds on
  its rule rather than conflicting with it.
- **#791 and #792** each add an entry to `SportDefinition` (`shootout`, `pickEm`). The `TENNIS`
  definition in slice 2 must set both (`shootout: null`, `pickEm` as every non-soccer sport), so
  slice 2 starts after both merge.
- Nothing depends on soccer slices 3 to 5.

## The PRs

1. **How a match ended: retirements, walkovers and defaults** (shared, sport-agnostic). After #791.
2. **Tennis and the Grand Slams**: the sport, the ATP and WTA draws of the four Slams, every pool type,
   test seeds. After slice 1 and #792.
3. **Withdrawals after the draw**: lucky losers, in any sport that plays a bracket. After slice 2;
   can fold into it if small.
4. **NCAA singles championships**: data only. After slice 2.

Slices 1 and 3 are shared by every sport that plays matches; only 2 and 4 are tennis.

Scenario-suite rows ride in each PR, as hockey's did, rather than as a slice of their own.

## Slice 1: how a match ended

- **Enum:** `MatchEnding` (`PLAYED`, `RETIREMENT`, `WALKOVER`, `DEFAULT`), a Prisma enum and a
  non-null `ending` column on `SportEventMatch`, default `PLAYED` (existing rows backfill to it).
  Through `SportEventMatchDto`, the mapper and `RecordSportEventMatchResultRequest` (optional,
  default `PLAYED`). A cleared result goes back to `PLAYED`.
- **Every sport that plays matches gets it** (Derek 2026-10-21): it is optional on every
  result, not a tennis switch. A walkover or a withdrawal through injury can happen in any match
  play: a forfeited college game, a "no contest" in March Madness (2021), a future golf match-play
  event. So there is no per-sport list of allowed endings; `PLAYED` stays the default everywhere.
- **Rules** (422 `MATCH_RESULT_INVALID`, as other score problems are):
  - `PLAYED`: unchanged, including #791's shoot-out rule.
  - `RETIREMENT` and `DEFAULT`: both scores or neither, and the winner's may be lower (the
    sets completed when it stopped).
  - `WALKOVER`: no scores and no period scores.
- **Scoring:** nothing changes. Every scorer reads `winnerSide`, so a walkover or retirement
  winner advances, earns the round's points and keeps a survivor pick alive; the other player is
  out (`ELIMINATED`). See Q1.2.
- **Data file:** a result gains an optional `ending` (default `PLAYED`), applied by the loader.
- **Web:** the admin result form offers the endings beside the winner, collapsed under "Ended
  early" so the usual one-click winner entry is unchanged. Match rows on the bracket, game and leaderboard screens read "2-1 ret.", "w/o",
  "def." (the abbreviations live with the ending, not the sport).

Questions:

- **Q1.1** Name: `MatchEnding` with `PLAYED`, `RETIREMENT`, `WALKOVER`, `DEFAULT`?
  Recommendation: yes. A non-null `PLAYED` rather than null-means-played keeps it typed. A
  shoot-out stays out of it: #791 already stores it as two scores, and a level score with
  shoot-out scores says so on its own.
- **Q1.2** Does a walkover win count as a win? Recommendation: yes, everywhere. The player
  advances, earns the round's points (and an upset bonus if the seeds say so), and a survivor or
  bracket pick on them is right. A pick on the player who withdrew or retired is wrong. This is
  how tennis records it, and every pool we found does the same.

## Slice 2: tennis and the Grand Slams

The `add-sport` skill, as hockey did it.

- **Sport:** `TENNIS`, `INDIVIDUAL`, `HEAD_TO_HEAD`, `MATCHES`, no period layout (so no
  squares). Selection types `TIERED`, `BUDGET_PICK`, `RANDOM_DRAW`, `BRACKET`, `SURVIVOR`.
  Scoring `KNOCKOUT_ROUND_POINTS`. `shootout: null`, `pickEm` as
  every non-soccer sport (unused: no `PICK_EM`). `defaultRounds` 7.
- **Vocabulary:** player/players, event "draw" ("the Australian Open men's singles draw"),
  sport league "series", round "round", match "match", eliminated "Out", withdrawn
  "Withdrawn", eventStart "first match". Round names counted back from the final: Final,
  Semifinals, Quarterfinals, Fourth round, Third round, Second round, First round. A league
  that names its rounds differently sets `SportLeague.roundNames`.
- **Leagues:** **ATP** (men's singles) and **WTA** (women's singles), split as every other
  sport's men's and women's competitions are (see Q2.1). Each holds four event series: the
  Australian Open, Roland Garros, Wimbledon and the US Open. Their 1000-level events join the
  same leagues later (Q4.2).
  The sport's `defaultTierLayout` is six tiers of eight (Q2.2).
- **Draw layout:** `regionLabel` names each quarter of the draw ("Top quarter" ... "Bottom
  quarter") through the quarterfinals, so the 127-pick bracket screen groups the first round's
  64 matches by quarter instead of one long list. The semifinals and final carry none, as a
  Final Four does. Check the entry screen on a phone with a full draw.
- **Seeds:** `seedNumber` is the tournament's own seed, 1 to 32, and null for the rest; screens
  show "(1) Sinner". `ranking` is the ATP or WTA ranking when the draw is made. The admin's
  "derive seeds from ranking" action is not used for tennis, because it overwrites real seeds.
- **Prices:** `deriveGolfPrices` gains ranking as its third key (seed, then odds, then ranking),
  so the unseeded players are priced by ranking when the file has no odds.
- **Templates** (`rules/ux-rules.md` §12 naming, one default per format, round values for seven
  rounds):
  - Tiered, "Whole field" (default): one player from each of the six tiers, all six count,
    knockout round points.
  - Tiered, "Seeds only": one player from each of the first four tiers (the 32 seeds), all four
    count. Tiers live on the event and are shared by every contest (#249), so this is a contest
    rule, not a second tier layout: `TieredContestRules` gains an optional `tiersUsed` (the first
    N tiers; absent means all).
  - Tiered, "Whole field, best four count": six tiers, the best four picks count. Nothing new:
    `countedScores` already does this.
  - Golf gets the matching variation in the same PR (Derek 2026-10-21): "Top four tiers", one
    golfer from each of the event's first four tiers, all four count, on each golf league's
    default tiered setup.
  - Budget, and random draw (the office sweepstake).
  - Bracket: the full draw (default), and a "second week" bracket from the fourth round (#760).
    See Q2.3.
  - Survivor: one player per round, each once.
  - Multi-event: a "Slams season" tiered pool over a year's four Slams in one league
    (`event_series_names`, as golf's majors pool).
- **Qualifier places** use play-in places as they are. The admin screen's copy for them reads a
  new vocabulary word, `playInPlace` ("Qualifier"; basketball "Play-in").
- **Test seed:** the 2026 US Open men's and women's singles as played, through
  `load-sport-data`, including the qualifier places and any retirements and walkovers.
- **Sweep:** the remaining hard-coded "team" strings in the bracket and survivor screens read
  the sport's participant noun.

Questions:

- **Q2.1** One "Grand Slams" sport league holding both draws, or an ATP league and a WTA league?
  A contest's events all come from one sport league (#713), so separate leagues rule out a pool
  covering both draws of a Slam. Recommendation (revised 2026-10-21 after Derek's question):
  ATP and WTA, split as basketball, hockey and golf are. A one-league exception for tennis would
  be the only one, and the 1000-level events belong to the ATP and WTA anyway. If a men's plus
  women's pool is wanted, it should come as a general "contest across leagues of one sport"
  feature, which would also give a combined men's and women's March Madness pool. **Decided 2026-10-21:
  separate ATP and WTA leagues; no combined men's and women's pool.**
- **Q2.2** How should the roster pool's tiers be cut? A draw has 32 seeds and 96 others.
  Recommendation: six tiers of eight by ranking, the last taking everyone else (1-8, 9-16,
  17-24, 25-32, 33-40, and 41 down); pick one from each, all six count. Ranking and seeding agree
  at every Slam today, so the first four tiers are the seed lines. **Decided 2026-10-21:** as recommended,
  as the "Whole field" default, plus a "Seeds only" variation picking from the first four tiers.
- **Q2.3** A full-draw bracket is 127 picks. Default to it, or to the second-week bracket (from
  the fourth round, 15 picks)? Recommendation: full draw as the default, as the bracket sites
  that offer tennis do, with the second-week bracket as the variation for people who join late
  or want less work.
- **Q2.4** Results for the live 2027 Australian Open pilot (mid-January): the admin marks each
  match's winner (scores optional; around 60 a day across both draws in the first days, a
  handful a day in the second week), or a paid feed (around $40-150 a month)? Recommendation:
  admin entry for the pilot, then decide on a feed from how heavy it was.
- **Q2.5** Show set-by-set scores ("6-4 3-6 7-6")? Recommendation: not now. A match's score is
  sets won ("3-1"), which is all scoring needs and what the admin can enter quickly. Set scores
  would need a new non-cumulative period shape and add entry work.

## Slice 3: withdrawals after the draw

A player who pulls out after the draw is published is replaced by a lucky loser until their
first match starts; after that it is a walkover (slice 1).

**Shared, not tennis-only** (Derek 2026-10-21): the action works on any released bracket in any
sport. It matters most where the participants are individuals (tennis, and later darts, snooker
or golf match play), but nothing in it reads the sport or the participant type, and the copy
reads the sport's participant noun ("Replace player", "Replace team").

- **Action:** "Replace player" on a first-round side whose match hasn't started, after release
  too. It adds the lucky loser as a new field row (unseeded, untiered: see below), puts it on that
  side, and marks the old row inactive, `WITHDRAWN`. Refused once the match has started (409),
  and refused on a play-in place, which is filled instead.
- **Picks:** a pick of the withdrawn player stays a pick of that player and scores as a
  first-round loss: no round points, a bracket pick of them is wrong from that match on, and a
  survivor pick on them in the first round is out. An entry still open before the event starts
  can change it; screens mark the player "Withdrawn". This matches how a golfer withdrawn before
  tee-off is treated.
- **The lucky loser** joins the event's last tier and is priced at the bottom of the budget
  curve, so roster pools can pick them while entries are open.

Questions:

- **Q3.1** Should picks move to the lucky loser instead, as a filled play-in place's do?
  Recommendation: no. A play-in place stands for whoever wins; a named player doesn't, and moving
  a pick of a top seed to a lucky loser would surprise the entrant more than losing it. Most
  withdrawals come before entries close, while entrants can still change their picks.

## Slice 4: NCAA singles championships

The NCAA Division I men's and women's singles championships: 64-player draws, individuals, so
data only (a league row per draw, its round names, a test seed of the 2026 edition as played).

Questions:

- **Q4.1** The NCAA team championships? Those are teams, and tennis is an individual sport. The
  sport's participant type and noun ("player") would need a per-league override, as
  `matchPeriodLayout` has. Recommendation: defer. The singles championships cover college tennis
  for pools, and the team tournament can come with Davis Cup and the Billie Jean King Cup finals,
  which need the same override.
- **Q4.2** The optional events: the ATP Masters 1000 and WTA 1000 draws (96 with byes), the
  Olympics (64), and the ATP and WTA Finals. Recommendation: none now. The 1000-level events and
  the Olympics are a league row and a data file each and can be added whenever wanted; the Finals
  start with a round robin, which no bracket model here plays. List them on a deferred ticket, as
  soccer did with #818.

## Not in this work

Doubles, squares, pick'em by day of play, set-score or stat-based scoring, and a live feed.
