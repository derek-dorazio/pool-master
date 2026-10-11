# Pick'em pools

**Tracking issue:** #607

Written 2026-10-11 for Derek's question: which sports suit pick'em pools, which use spreads,
and how pick'em fits Poolmaster's domain model and design. Status: research and first-level
design; no slices filed. Builds on the sport extension architecture proposal (the sport registry
and scoring families, #602 to #606) and `plans/next-sport-adoption.md` (#599). Open questions
sit under the section they belong to, each with a recommendation; nothing waits on them.

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

- **Q1.1** NFL first, with ATS in the first release or added after? Recommendation: straight-up
  and confidence first; ATS as the next slice, because lines need a data source and a lock rule.
- **Q1.2** Is AFL tipping in scope at all, given an Australian audience? Recommendation: design
  for it now (the margin tiebreaker and draws cost little), build when a league asks.

---

## 2. Formats to support

| Format | An entry's picks per round | Scoring | Extra rules |
|---|---|---|---|
| Straight-up pick'em | One winner per game | 1 per correct pick | Ties: configurable (0, half, or 1) |
| Against the spread (ATS) | One side per game, against a published line | 1 per pick that covers | Pushes: configurable (0 or half); lines lock at a set time |
| Confidence | One winner per game, each given a distinct weight 1..N | The weight of each correct pick | Weights must be a permutation of 1..N for the round |
| Survivor | **One team per round** | Alive or out | Each team used at most once per season; out on a loss (or a tie, configurable); optional strikes |
| Tipping (AFL/NRL) | One winner per game, plus a margin on one game | 1 per correct tip | Margin error breaks ties; missed tips default (away team, or none) |
| Score predictor (soccer) | Home and away score per game | e.g. 5 for the right outcome, 10 for the exact score | Draw is a valid outcome |

All formats share **season standings** (sum over rounds) and **round standings** (weekly
winners). A pool can also run on a single round (one week only).

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
| Survivor elimination | `Contest.scoringStopsOnElimination` | An existing column with the right meaning |

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
7. **New selection types.** `PICK_EM` (with straight-up, ATS, confidence and tipping as
   configuration of one engine) and `SURVIVOR`. Both values exist in the catalog today but
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
  Recommendation: admin entry with a CSV schedule import; about 16 results a week is light work,
  and it keeps the pilot independent of a paid feed.

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
7. **Later:** AFL/NRL tipping (margin tiebreaker, away default, draws), soccer predictors
   (exact scores, draws), college football "pick N games".

Question:

- **Q5.1** Target the 2027 NFL season (starts early September 2027) for slices 1-5?
  Recommendation: yes; it gives room to finish the sport registry and the knockout family
  first, and the NFL playoffs in January 2027 can still run as a tiered team pool on the
  knockout family.

---

## Sources

- NFL pool formats (survivor, confidence, ATS): https://www.footballguys.com/article/2026-office-pool-against-spread-picks-week03 , https://rotogrinders.com/articles/nfl-pool-strategy-2026-gain-edge-survivor-pickem-pools-4214320
- Footy tipping rules (margin tiebreaker, draws, defaults): https://rbyc.org.au/2024/03/03/afl-footy-tipping/ , https://footytipping.awsaustralia.com.au/view/Affiliate/site/orgsite/awsa70/images/TERMS091818.pdf
- ESPN footytips scale: https://standard.net.au/story/8678224/warrnambool-mans-afl-tipping-success-sees-chance-to-win-50k
- Premier League Predictor rules (5 for outcome, 10 for exact score, per-match lock): https://www.premierleague.com/EN/games/premier-league-matchweek-predictor/rules-faqs
- Superbru rugby and soccer predictors: https://www.superbru.com
