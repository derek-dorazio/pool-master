---
name: clutch-card-round
description: Running one playoff round's Clutch Card on a PoolMaster site — when the matchups are announced, create the event and load both teams' stars, ranked for tiers; after each game, load its box score, checked against a second source, so standings settle. Use when a round's pairings come out, or a Clutch Card game has been played.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Write, Bash, WebSearch]
---

# Running a Clutch Card round

A Clutch Card is a contest on a championship stat pool: members pick the stars (players) of the
teams in one playoff round, and each star scores their sport's composite in every game they
play (Triple Threat, Power Play, Box Score, Redzone). The stat pool sport league already exists,
created by a migration (`add-sport` makes a new one). This skill runs one round of it, in two
parts that use one data file:

1. **Set up**, as soon as the round's matchups are announced: the event, its field of stars
   and their ranking, so an admin can release it before the first game.
2. **Box scores**, after each game: that game's stat lines, so the leaderboard moves, and
   after the last game the contests settle.

Both parts are a `load-sport-data` run (its *Box scores* row). That skill is the procedure for
gathering, cross-checking, writing the file, the dry run and the apply; read it first. This
skill adds what is particular to a Clutch Card. Real data only: a stat or a player no source
gave is left out, never guessed (`rules/testing-rules.md` §1B *Forbidden Application-Code
Patterns* says why made-up values are dangerous; a data file shown as real is the same risk).

## One round, one event

A Clutch Card never spans playoff rounds. Each round is its own sport league, event and
contest: Championship Weekend and the Super Bowl, the CFP semifinals and the National
Championship, a conference final and the final. A round of several series or games (both
conference finals, both semifinals) is one event whose field is every team's stars.

The event's rounds are its games. A real file gives the most games the round can take (seven
for a best-of-seven series, one for a single game); a test file, written after the round was
played, gives the games as played (five for a Finals won in five). Read the stat pool sport
league's test data file (`packages/core-api/scripts/seed-golf/`, the league's name in its
`scope`) before writing a real one: it is the shape to copy, and `docs/SPORT-DATA-LOADING.md` *Seeded championship stat
pools* says what it holds.

## Part 1 — set up the round

### Step 1 — the matchups

Confirm the pairings from the primary and a second source (`docs/SPORT-DATA-SOURCES.md`, the
league's stat pool row): the teams, the first game's date and start time, and the last date the
round can end (Game 7's, for a series). A pairing still waiting on a game is not announced:
wait for it rather than loading half a field.

### Step 2 — the stars

Who is in the field is fixed per sport, and the league's test data file shows it: every NBA
or WNBA player on the roster; NHL skaters, not goalies; MLB position players, not pitchers; an
American football team's quarterbacks, running backs, wide receivers and tight ends; every
player in a college basketball team's box score. Gather, for each team:

- **The roster as it stands for the round.** Current-roster feeds drop a traded or released
  player and add a call-up; take the roster for the playoff round, not last month's. The NHL's
  roster endpoint is the current roster only, so build an NHL field from its player landing
  pages.
- **Each player's position and team**, loaded on the player (`position`, `team`).
- **Each player's regular-season composite total**: the sport's composite applied to their
  regular-season stats. It is their `ranking` (1 is the highest total), and it is what tiers
  and budget prices come from. Odds are never loaded. A player traded during the season counts
  both teams' stats; say so in the provenance.

Rosters come from the league or ESPN feed and a second source; regular-season totals the same
way. A player whose position or total the two sources disagree on is listed for the user, not
loaded on one source's word (`load-sport-data` Step 3).

### Step 3 — write the file and fetch

The real file sits beside the test files, named for people: sport, season and round
(`basketball-2027-nba-finals.json`). The set-up run's `contents` are `SCHEDULE`, `PLAYERS`
and `FIELDS`. The event:

- its name as the league uses it, its start date the first game's, and `startsAt` the first
  game's start with its UTC offset, since that is when picks close;
- its end date the local date of the last possible game, not the expected last game. The
  loader ends the event at noon UTC the day after, which is past any US evening finish (see
  *Where this goes wrong*);
- its rounds the most games the round can take.

A cloud session cannot reach the sport sites, so source pages come through the "Fetch sport
sources" workflow on the working branch. It commits into that branch, so fetch before the
branch has a PR, or the fetched pages land in the PR's history. github.com is reachable
directly (the nflverse files).

### Step 4 — dry run, the user's go, release

Dry-run "Load sport data" on the file and show the user the field: each team's star count, the
top of the ranking and any player left out, with why. Apply only on the user's explicit yes
("Load"). A data file never releases an event: an admin then builds tiers and releases it on
the event's Manage page (`docs/EVENT-SETUP-PROCEDURES.md` *Build tiers* and *Release it for
contests*), and commissioners can create Clutch Card contests on it.

Before the first game, a late injury or a call-up is the same file run again: a player dropped
from the field is withdrawn, a new one added. After release a new player joins untiered, so
say so to the user.

## Part 2 — each game's box score

### Step 5 — the stat lines

After each game, from the primary and a second source (`docs/SPORT-DATA-SOURCES.md`): every
field player who played, with their count of each stat the composite counts. Check it player by
player. A player who did not play has no line; a player with a line of zeros played and
recorded nothing. Two sources often name a player differently (a first initial, a suffix), and
two teammates can share a row name in one of them: match on team and surname, settle a shared
name by the rest of the line, and list any line you cannot match.

### Step 6 — load it

Add the game to the event's `games` in the same file, keeping the games already there, and
narrow the run's `contents` to `PLAYERS`, `FIELDS` and `STATS`, so a box-score run can never
rewrite the event. Dry-run, show the user the game's lines and any disagreement, and apply on
their "Load", once per game. A game's lines replace the stored ones for that game, so loading a
corrected line later is the same run; an admin can also correct one player's line on the
event's Results page.

### Step 7 — the round ends

Completion runs on the clock, not on the last box score: the event completes, and its
contests settle, at noon UTC the day after its end date, whatever is loaded by then. A series
that ends early leaves its later games unplayed, and they score nothing for anyone; the event
stays in progress until noon UTC the day after its end date, unless an admin completes it
from the event's Manage page once the last box score is in. Open a PR for the data file, so
next year's round starts from it, and add the round's sources to `docs/SPORT-DATA-SOURCES.md`
if they changed.

## Where this goes wrong

- **An end date that comes too soon.** The event completes on its own at noon UTC the day
  after its end date and its contests settle on whatever box scores are in. An end date on the
  expected last game settles the round before a Game 7. Use the last possible game's date, and
  if a game is postponed past it, ask an admin to turn off the event's automatic lifecycle
  before it passes.
- **A field built from the current roster.** It misses the player traded at the deadline and
  keeps the injured one released last week. Use the roster for the round.
- **Ranking by something other than the regular-season composite.** Points per game, salary or
  a fantasy ranking all tier the field differently from what the setups promise.
- **One event across two rounds.** A contest never spans playoff rounds; load each its own.
- **A box score loaded on one source's word.** Feeds correct stat lines for a day after a
  game (an assist reassigned, a goal credited to another skater). A late correction is a
  reload of that game, not a reason to skip the second source.
- **Loading without the user's go.** Every apply, set-up or box score, waits for their "Load".
