---
name: load-new-season
description: Putting next season's schedules on a PoolMaster site for every sport league at once — take stock of which leagues have published, gather and check each, write one file per sport, dry-run them together and apply on the user's yes. Use at the turn of a season, or when someone asks which schedules are still missing.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Write, Bash, WebSearch]
---

# Loading a new season

Each sport league's schedule goes on the site once a season, early, so commissioners can plan
contests on its events. One league's schedule is a `load-sport-data` run (its *Schedule* and
*Weeks* rows); that skill is the procedure for gathering, cross-checking, writing the file, the
dry run and the apply, so read it first. This skill is the season's sweep across every league:
what is due, in what order, and how to keep a dozen files reviewable.

Fields are not part of it. A field exists only shortly before its event, so it is loaded just
in time, event by event (`load-sport-data` *Field* row, and the `clutch-card-round` skill for a
stat pool round).

## Step 1 — take stock

List every sport league on the site against what the repo already holds for the season:

- The sport leagues come from the sport registry and the migrations that seed them
  (`rules/architecture-rules.md` §4 *Sport extension*).
- Real data files are in `packages/core-api/scripts/seed-golf/`, with `testData: false`
  and the season in their `scope`. A file named `-test` is last season's test data, not a
  schedule.
- A championship stat pool league has no season schedule: its event is one playoff round,
  set up when the matchups are announced. Leave it out of the sweep.

Show the user one table: league, season, whether a file exists, whether the league has
published the season yet, and what you propose. That table is the plan; work from it rather
than from memory of which leagues exist.

## Step 2 — who has published

A league's next season is loadable only once it is announced. `docs/SPORT-DATA-SOURCES.md`
says, per league, where the schedule comes from and when its field is set. The traps:

- **ESPN carries a season only once it is near.** Asked for next year too early, its feed
  returns the current season instead, with no error. Check the dates in what comes back.
  Before ESPN has it, the league's own site and Wikipedia's season page are the sources.
- **A schedule announced in part.** A tour that names its events but not all dates, or a
  league that publishes its weeks' games without kickoff times: load what is announced, leave
  each missing time out, and run the file again when the rest comes.
- **A season across two years** (the Premier League, the NBA, the NHL): one file per year
  its events start in, since a file's events start in its season year.

## Step 3 — gather in one fetch

A cloud session cannot reach the sport sites. Put every league's source pages into one
"Fetch sport sources" run on the working branch (feeds and plain pages in `urls`,
script-filled pages in `rendered_urls`), then read `sport-sources/` and its `index.json` for
the fetches that failed. Fetch before the branch has a PR: the workflow commits into the
branch.

## Step 4 — one file per sport

Write one real file per sport and season (`golf-2028.json`, `auto-racing-2028-formula-1.json`
when a sport's leagues publish months apart), with `contents` `SCHEDULE` (a league of weekly
games adds `PLAYERS`, `FIELDS` and `BRACKET`, since each week's field is every team). Times
are stored in UTC: convert each source's local time with its UTC offset on that date, and say
in the provenance which time zone the source gave. Every fact needs its two sources; a
disagreement is left out and listed (`load-sport-data` Step 3).

## Step 5 — dry-run together, apply on the user's yes

Delete `sport-sources/`, push, and dry-run "Load sport data" on each file. Show the user one
summary for the sweep: per file, the adds, the renames the loader matched by start date, the
conflicts and the disagreements. Apply each file only on the user's explicit yes ("Load"),
then run it again and check it reports everything as a skip.

Open the PR with every data file and the `docs/SPORT-DATA-SOURCES.md` changes: each source you
checked gets its *Checked* note dated, and each that failed is replaced or marked so.

## Step 6 — last season's test data

`rules/architecture-rules.md` §6 *Manual-testing seed data goes through the admin API* gives
every sport league a test data file of its last season as played. A new season does not
replace it: refreshing a league's test file with the season just finished is its own piece of
work. List the leagues whose test file is now a season behind and ask the user whether to do
it.

## Where this goes wrong

- **Loading last season as next.** ESPN's early answer, or a Wikipedia page still showing the
  old season, loads the wrong year's dates. Check the year on every event before the dry run.
- **A renamed event loaded as new.** Sponsors rename events between seasons. Check the dry run
  for an add next to an event that disappeared.
- **Fields loaded with the schedule.** A field gathered months early is a guess at who will
  play. Leave it for the event week.
- **One giant file.** A file per sport keeps a bad source to one dry run and one revert.
- **Applying the sweep without a dry run the user has seen.**
