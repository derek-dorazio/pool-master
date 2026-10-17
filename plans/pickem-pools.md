# Pick'em pools

**Tracking issue:** #607

Written 2026-10-11 for Derek's question: which sports suit pick'em pools, which use spreads,
and how pick'em fits Poolmaster's domain model and design. Status: research and first-level
design; no slices filed. Builds on the sport extension architecture proposal (the sport registry
and scoring families, #602 to #606) and `plans/next-sport-adoption.md` (#599). Open questions
sit under the section they belong to, each with a recommendation; nothing waits on them.

*2026-10-14:* the domain model for pick'em (and for knockout pools, built first) is now
`plans/knockout-and-pickem-design.md`; where the two differ, that doc is newer. This plan keeps
the sport research and the style catalog.

---

## TL;DR

- **What a pick'em pool is:** every round (an NFL week, an AFL round), each entry picks the
  winner of each game. Points accumulate over a season, with weekly winners along the way.
  Variants: against the spread, confidence points, survivor (one team a week, out on a loss),
  footy tipping (straight-up, with a margin tiebreaker), score predictors (soccer).
- **Best sports:** NFL and college football in the US; AFL and NRL tipping in Australia; the
  Premier League and other soccer leagues with score predictors; rugby (Super Rugby, Six
  Nations, the Rugby World Cup). Also good for playoff and tournament games (NFL playoffs, March
  Madness game by game). Daily-schedule sports (NBA, NHL, MLB) are a poor fit except their
  playoff series.
- **Spreads:** a US football habit. NFL and college football pools are split between
  straight-up and against-the-spread; the rest of the world picks straight-up (Australia adds a
  margin tiebreaker; soccer adds draws and exact scores).
- **Fit:** a **medium change, not a mismatch.** Leagues, squads, entries, contest lifecycle,
  sport events, rounds, the team field, the `SelectionEngine` seam, the scoring-family seam and
  the ranking code all carry over. Four things are new: a **match** (fixture) entity, a
  **match-pick** table, **per-match lock and reveal** (today one lock covers the whole contest),
  and **season-long contests** with picks made round by round plus per-round standings. Roughly
  six PRs after the sport registry.

---

## 1. Which sports fit pick'em

| Sport | Pool habit | Games per round | Spread? | Draws? | Notes |
|---|---|---|---|---|---|
| **NFL** | The biggest US office pool after March Madness: weekly pick'em, confidence, survivor, against the spread | 13-16 a week, 18 weeks + playoffs | Both: straight-up is the casual default; ATS is common in more serious pools | Rare (ties) | Tiebreaker is usually the total points of the Monday night game |
| **College football** | Large, often "pick 10 of the week's games" | 50+ a week; pools pick a subset | ATS very common (lopsided matchups make straight-up trivial) | No | Commissioner picks the games, or the top 25 |
| **AFL (footy tipping)** | Australia's office pool; ESPN footytips ran ~870k tipsters in one competition | 9 a round, 24 rounds + finals | No, straight-up | Yes, rare | Margin tip on the round's first game breaks ties; missed tips often default to the away team |
| **NRL (rugby league tipping)** | Same as AFL in NSW and Queensland | 8 a round | No | Rare | Same rules as AFL tipping |
| **Soccer leagues** (Premier League, MLS, Champions League) | Predictor games (official PL Predictor, Superbru) | 10 a matchweek (PL) | No | **Common, a real third outcome** | Often predict the exact score: PL Predictor gives 5 for the right outcome, 10 for the exact score |
| **Rugby union** (Super Rugby, Six Nations, World Cup) | Superbru predictors with private pools | 3-8 a round | No | Rare | Pick the winner and the margin band |
| **NFL playoffs, March Madness** | Game-by-game pick'em as a bracket alternative | 2-32 a round | Sometimes ATS | No | Same engine as weekly pick'em on a knockout event |
| **NBA, NHL, MLB** | Weak for the regular season (games daily, not in rounds); playoff series pick'em is popular | — | Rarely | No | Series pick'em = winner plus number of games |
| **UFC** | Fight-card pick'em among fans | 10-14 fights a card | No (sometimes method of victory) | Rare | One card is one "round" |

**Recommended order:** NFL (straight-up, confidence, survivor, then ATS), then AFL/NRL tipping
(same engine plus a margin tiebreaker), then soccer predictors (needs draws and exact scores),
then college football (needs a "pick N of these games" rule).

Questions:

- **Q1.1** NFL first, with ATS in the first release or added after? *Decided by Derek 2026-10-17:* straight-up
  and confidence first; ATS as the next slice, because lines need a data source and a lock rule.
- **Q1.2** Is AFL tipping in scope at all, given an Australian audience? *Decided by Derek 2026-10-17:*
  designed now, built when a league asks; deferred as #710 (uses the shared total-points tiebreaker, not a margin).

---

## 2. Every contest style

*Expanded 2026-10-11 on Derek's request: every contest style in one catalog, with survivor
and bracket shown as special cases of pick'em.*

Every office pool is one of three kinds, decided by **what an entry holds**:

1. **Roster pools:** the entry holds **participants** (golfers, teams, horses) and scores
   what they do. This is everything Poolmaster runs today.
2. **Prediction pools (pick'em):** the entry holds **predictions about games** and scores
   whether they came true. This epic.
3. **Assignment pools:** nobody chooses; the entry is **dealt** participants or numbers.

The kind sets the selection engine. The sport's scoring family sets how participants score
in a roster pool (stroke play, knockout advancement, finish position, stat accumulation), and
the match-result family scores predictions.

### 2.1 Roster styles

| Style | How an entry picks | Exclusive? | Status | Scores with |
|---|---|---|---|---|
| **Tiered** | One or more from each tier | No | Built | Any scoring family |
| **Budget (salary cap)** | Any participants within a cap | No | Built (#93) | Any |
| **Snake draft** | Turn by turn, each participant to one entry | Yes | Planned (#199) | Any |
| **Category** | One from each category (for example "a former major winner") | No | Planned (#99) | Any |
| **Open selection** | Any N participants from the field | No | Catalog only | Any |
| **Random draw (sweepstake)** | Dealt at random (see assignment pools) | Yes | Ticket #601 | Any |
| **Auction (Calcutta)** | Participants auctioned; the buyer owns them | Yes | Idea only | Usually knockout; payouts are outside Poolmaster |
| **DFS (positions + cap)** | Budget plus position slots (QB, RB, FLEX...) | No | Idea (`next-sport-adoption.md` §3.6) | Stat accumulation |
| **One-and-done (season)** | One participant per event across a season, each used once | No | Idea | Any; needs multi-event contests |

Roster scoring options are scoring rules on the contest, not styles: best N of M counting,
**round values and seed bonus** for knockout events (`next-sport-adoption.md` §1), finish
points for races, the 80-stroke rule for golf.

### 2.2 Prediction (pick'em) styles

All of these share one engine family: the entry predicts outcomes of matches, and each
prediction scores on its own.

| Style | What an entry predicts | Scoring | Lock | Notes |
|---|---|---|---|---|
| **Straight-up** | The winner of each game | 1 per correct pick | Per game, at kickoff | Ties: 0, half, or 1 (setting) |
| **Against the spread** | A side against a published line | 1 per pick that covers | Per game | Pushes: 0 or half; lines published per round |
| **Confidence** | Winners, each given a distinct weight 1..N | The weight of each correct pick | Per game | Weights are a permutation of 1..N for the round |
| **Tipping** (AFL, NRL) | Winners, plus the margin of one game | 1 per correct tip | Per game | Margin error breaks ties; missed tips default (away team or none) |
| **Score predictor** (soccer) | Home and away score | e.g. 5 for the outcome, 10 for the exact score | Per game | A draw is a valid outcome |
| **Pick N games** (college football) | Winners of N games chosen from the week's slate | 1 per correct pick, often ATS | Per game | The commissioner or the entry chooses which games |
| **Series pick'em** (NBA, NHL, MLB playoffs) | Series winner and number of games | Points for winner, bonus for games | Per series, at game 1 | A series is a match with a best-of-N |
| **Survivor** | **One team per round** | Alive or out | Per game | Special case below |
| **Bracket** | **Every game of a knockout event, before it starts** | Round values, optional upset bonus | Whole bracket, at the first game | Special case below |
| **Finishing order** (races) | The top N finishers in order | Points per correct position | Per race | The catalog's `PREDICT_TOP_N`; like an exacta or trifecta |

#### Survivor: pick'em with three rule changes

Survivor (also called eliminator or knockout pool) is straight-up pick'em with:

1. **One pick per round** instead of one per game; the entry chooses which game.
2. **Each team at most once per season** for that entry.
3. **Elimination instead of points:** a loss (or a tie, by setting) knocks the entry out;
   optional strikes allow 1-3 losses first. Standings rank alive entries first, then by rounds
   survived. Elimination needs its own contest setting: the never-read
   `Contest.scoringStopsOnElimination` column was deleted with #698.

Variants: two picks per round late in the season, buybacks, survivor on a knockout event
(March Madness: one team per day, never the same team twice).

#### Bracket: pick'em with every round picked up front

A bracket is straight-up pick'em on a knockout event, with three rule changes:

1. **All rounds are picked before the event starts**, including games whose teams are not
   known yet. A later-round pick is "this team wins slot X", which only counts if that team
   gets there.
2. **One lock for the whole bracket** at the first game, instead of per game.
3. **Scoring by round value**, usually doubling (1, 2, 4, 8, 16, 32), with the optional upset
   bonus from the knockout scoring rules. The tiebreaker is the predicted total points of the
   final.

Variants: a **second-chance bracket** that starts at a later round (the Sweet 16), which needs
a start round in the bracket contest's rules (the unused `startRound` column was dropped in
#598); seed-multiplier and flat scoring as presets.

What bracket adds to the model: matches must exist as **bracket slots before their teams are
known** (a slot, the two slots that feed it, sides filled in as earlier games finish). So
`SportEventMatch` needs a slot number and "fed by" links, and nullable sides until they are
decided. Building that into the match entity from the start keeps bracket a variant instead of
a rebuild.

### 2.3 Assignment styles

| Style | What happens | Fit | Notes |
|---|---|---|---|
| **Random draw (sweepstake)** | The field is dealt out at random | Ticket #601; works on golf now | See #601 for where it is used |
| **Squares** (Super Bowl, also NCAA final) | Entries claim or are dealt cells of a 10x10 grid; the last digits of each team's score at each quarter pick the winning cell | Separate small engine on a single match | One of the most common US office pools for the Super Bowl; scoring is per quarter, not per game outcome |
| **Prop pool** | Commissioner-written questions (first scorer, coin toss, winning horse) with set answers | Out of scope | Needs free-form questions and manual grading; OfficePoolStop runs these |

Questions:

- **Q2.1** Are squares worth a small ticket for the Super Bowl (February 2027)? *Decided by Derek 2026-10-17:*
  yes as a later small ticket, deferred as #711; it needs only one match with quarter scores, but it is not
  pick'em, so it stays out of this epic's first slices.
- **Q2.2** Prop pools: out of scope? *Decided by Derek 2026-10-17:* yes, deferred as #712 with an approach; free-form questions are a different
  product.

---

## 3. How it fits the current model

### 3.1 What carries over unchanged

| Pick'em concept | Existing model | Notes |
|---|---|---|
| The pool | `League`, `Squad`, `ContestEntry` | Unchanged; an entry still belongs to a squad |
| The season | `SportEvent` ("2026 NFL Regular Season", "2027 AFL Premiership Season") | One event spans the season. Its edition and series already fit (`EventSeries` "NFL Regular Season", `eventYear` 2026) |
| A week or round | `SportEventRound` | Already "an NFL week's set of games" in its own schema comment |
| The teams | `Participant` (`TEAM`) and `SportEventParticipant` (the field) | 32 NFL teams, 18 AFL clubs |
| Picking rules | `SelectionEngine` seam | A pick'em, confidence and survivor engine each supply the rules; the shared handler keeps auth and persistence |
| Scoring | Scoring-family seam (#606) | A new family, `MATCH_RESULT`, beside stroke play, knockout and finish position |
| Ranking | `compareScores`, `rankSortedScores`, `ContestEntryStanding` | Higher-is-better points, unchanged ranking |
| Contest lifecycle | Contest `DRAFT -> OPEN -> ACTIVE -> COMPLETED` | Same statuses; what each allows changes (section 3.3) |
| Tiebreaker input | `ContestEntry.tiebreakerValue` | Fits a season-end tiebreaker; per-round tiebreakers need more (section 3.2) |
| Survivor elimination | (new contest setting) | `Contest.scoringStopsOnElimination` was never read and was deleted with #698 |

### 3.2 What is new

1. **A match (fixture) entity, `SportEventMatch`.** Event, round, home and away field members,
   kickoff time, status, home and away score, neutral-site flag. Pick'em cannot work without it:
   today nothing records which teams play each other. The same table is what the knockout
   family, soccer group stages and bracket pick'em need (`next-sport-adoption.md` Q1.1), so it
   is built once for all of them. It should live in the core event tables, not a pick'em
   module.
2. **Lines.** A spread per match (home-team perspective, half points allowed) with the time it
   was published. Kept on the match or in a small `SportEventMatchLine` row if lines get history.
   Publishing is an **explicit admin action per round** ("Publish week 6 lines"), which matches
   the explicit-release pattern rather than a time-based lock.
3. **A match-pick table, `ContestEntryMatchPick`.** Entry, match, picked outcome
   (`HOME`, `AWAY`, `DRAW`), optional confidence weight, optional predicted margin, optional
   predicted home and away score, `pickedAt`. Unique on (entry, match).
   Why not reuse `ContestEntryPick`: that table requires a field member and carries roster
   columns (tier, cost, lineup slot, pick sequence). A pick'em pick is an outcome of a game:
   "draw" and "exact score" are not field members. Survivor picks a team, but storing it as
   (match, side) keeps one table for all pick'em formats; the team is derived.
4. **Per-match lock and reveal.** Today a contest takes picks only while `OPEN` and before the
   event's start, and reveals every entry's picks once it leaves `OPEN`
   (`SelectionService`, `contestPicksRevealed`). Pick'em needs both decided **per match**:
   a pick is editable until its match kicks off, and every entry's pick on that match becomes
   visible at kickoff. This is the largest behaviour change. It should become a property of the
   selection engine (roster engines lock per contest; match engines lock per match) rather than
   a branch on contest format.
5. **Season-long contests with rolling picks.** A contest stays open to picks for months,
   round by round. Consequences:
   - **No single "submit".** The roster model's `DRAFT -> SUBMITTED` entry status does not fit.
     Recommendation: pick'em entries are active from creation; each pick saves on its own, and
     the round screen shows "6 of 14 picked".
   - **Contest status:** `OPEN` until the first match of the season, `ACTIVE` while the season
     runs, but `ACTIVE` keeps accepting picks for future matches. That is a meaning change for
     `ACTIVE` that must be explicit in the domain docs.
   - **Late joiners:** allowed while `ACTIVE`, scoring zero for rounds already played
     (configurable).
   - **Missed picks:** a per-contest default (no pick, away team, or favourite).
6. **Round standings.** `ContestEntryRoundStanding` (entry, round, points, position, tiebreaker
   value) for weekly winners, beside the season `ContestEntryStanding`. Per-round tiebreakers
   (AFL margin on game 1, NFL Monday night total points) live here or on the match pick.
7. **New selection types.** `PICK_EM` (with straight-up, ATS, confidence, tipping, score
   predictor and pick-N as configuration of one engine), `SURVIVOR` and `BRACKET`, all three
   match-pick engines. `PICK_EM`, `SURVIVOR` and `BRACKET_PICK_EM` exist in the catalog today but
   #605 deletes unbuilt values, so they come back with this work. Configuration goes into the
   typed `ContestSelectionConfig` union, keyed by selection type, like budget and tiered.

### 3.3 How it sits on the sport extension architecture

- **Sport registry (#602):** NFL and AFL become `SportDefinition`s with `participantType: TEAM`,
  vocabulary ("week" vs "round", "game" vs "match", "pick" vs "tip"), and `selectionTypes`
  `[PICK_EM, SURVIVOR]`. A sport can allow both roster and pick'em types (NFL playoffs could
  run a tiered team pool and a pick'em pool on the same event).
- **Scoring family (#606):** a new `MATCH_RESULT` family. `persistResults` writes match scores
  and statuses; `scoreParticipants` is not the right shape for it, because a pick'em score
  depends on the pick (side, weight, line), not on a field member alone. Recommendation: the
  family interface gets an entry-level scoring hook (`scoreEntries`) that the roster families
  implement with today's best-N sum and the match family implements as "sum of points per
  pick". This should be decided **when #606 is shaped**, so the interface is not golf-shaped
  twice; this plan is the second input #606 asked for.
- **Web:** the entry page is a round view (games listed with two buttons, plus a confidence
  dropdown or margin box), not a roster grid; the leaderboard has season and week tabs. Both go
  into the per-family UI registry (`SCORING_FAMILY_UI`) proposed in the architecture plan.
- **`no-sport-branching` lint:** pick'em never branches on NFL vs AFL; tipping-specific rules
  (margin, away default) are configuration, not sport checks.

Questions:

- **Q3.1** New `ContestEntryMatchPick` table, or extend `ContestEntryPick` with a nullable match
  and outcome? Recommendation: a new table. Extending the roster table would make every column
  on it optional for one format or the other, which the typed-model preference argues against.
- **Q3.2** Should `ACTIVE` keep meaning "locked" for roster contests and "running, picks still
  open for future games" for pick'em, or should pick'em get its own status? Recommendation:
  same statuses, with the lock rule owned by the selection engine; a second status set would
  ripple through every contest screen.
- **Q3.3** Allow late joiners? Recommendation: yes, scoring zero for past rounds, with a
  commissioner switch to close joining.

---

## 4. Data

- **Schedules:** published once a season (NFL in May, AFL in late October or November). An admin
  import from a file or a feed, then round dates follow the matches.
- **Results:** a handful of games per round, so admin entry is workable for a pilot. Free feeds
  exist for some leagues (football-data.org covers the Premier League and Champions League; an
  unofficial ESPN scoreboard is widely used for the NFL but is not licensed; Squiggle publishes
  AFL fixtures and results, inferred from common use and not checked).
- **Lines:** need a source for ATS. Odds APIs with free or cheap tiers exist (inferred; not
  priced here). Lines can also be typed in by an admin when publishing a round.

Question:

- **Q4.1** Admin-entered schedules and results for the NFL pilot, or a feed from the start?
  *Decided by Derek 2026-10-17:* the schedule loads through the "Load sport data" pipeline like
  every sport league (no CSV import); weekly results are marked on the same admin results
  screen as knockout matches until a live feed exists.

---

## 5. Slices (first cut; not filed)

0. **Prerequisites:** sport registry (#602), sport enum columns (#603), and the scoring-family
   extraction (#606) shaped with this plan as its second input.
1. **Match entity:** `SportEventMatch` with admin create, schedule import and results entry.
   Shared with the knockout family.
2. **Season events:** an NFL season event with weeks as rounds and 32 teams as the field;
   sport definition for NFL.
3. **Pick'em engine and match picks:** `PICK_EM` selection type (straight-up and confidence),
   `ContestEntryMatchPick`, per-match lock and reveal, the round entry screen.
4. **Match-result scoring and standings:** season and round standings, weekly winners, the
   Monday night tiebreaker, settlement per round and at season end.
5. **Survivor:** `SURVIVOR` engine (one team a round, once a season, out on a loss, strikes).
6. **Spreads:** lines per match, "Publish lines" admin action, ATS scoring with pushes.
7. **Bracket:** bracket slots on the match entity, the `BRACKET` engine, whole-bracket lock,
   round values and upset bonus, second-chance brackets. Target March Madness 2028.
8. **Later:** series pick'em, squares, AFL/NRL tipping (margin tiebreaker, away default, draws),
   soccer predictors
   (exact scores, draws), college football "pick N games".

Question:

- **Q5.1** Target the 2027 NFL season (starts early September 2027) for slices 1-5?
  *Decided by Derek 2026-10-17:* yes; it gives room to finish the sport registry and the knockout family
  first, and the NFL playoffs in January 2027 can still run as a tiered team pool on the
  knockout family.

---

## Sources

- NFL pool formats (survivor, confidence, ATS): https://www.footballguys.com/article/2026-office-pool-against-spread-picks-week03 , https://rotogrinders.com/articles/nfl-pool-strategy-2026-gain-edge-survivor-pickem-pools-4214320
- Footy tipping rules (margin tiebreaker, draws, defaults): https://rbyc.org.au/2024/03/03/afl-footy-tipping/ , https://footytipping.awsaustralia.com.au/view/Affiliate/site/orgsite/awsa70/images/TERMS091818.pdf
- ESPN footytips scale: https://standard.net.au/story/8678224/warrnambool-mans-afl-tipping-success-sees-chance-to-win-50k
- Premier League Predictor rules (5 for outcome, 10 for exact score, per-match lock): https://www.premierleague.com/EN/games/premier-league-matchweek-predictor/rules-faqs
- Superbru rugby and soccer predictors: https://www.superbru.com
