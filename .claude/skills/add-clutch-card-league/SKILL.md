---
name: add-clutch-card-league
description: Adding a Clutch Card for a new playoff round — the stat pool sport league and its three default setups by migration, last season's box scores as its test data, cross-checked against a second source, and the copy, docs and tests that name every round. Use when someone wants a Clutch Card on a round the site does not offer yet, such as the PWHL Finals or the Women's Final Four.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Write, Bash, WebSearch, WebFetch]
---

# Adding a Clutch Card league

A Clutch Card round is a sport league of players scored by the composite family, one league per
playoff round (`rules/ux-rules.md` §13 *Event Pages* item 3: *A stat pool covers one playoff
round*). Adding one needs no new code when its sport already has a composite: it is a migration,
a last-season data file, and the lists of rounds that copy and tests keep. Running a round once
the league exists is the `clutch-card-round` skill; this skill makes the league.

A sport with no composite yet (as soccer's Hat Trick once was) needs the composite first: its
stats, its definition in the sport's registry file, its labels and copy. That is the `add-sport`
skill's *Scoring family* step, and it rides in the same PR as the sport's first leagues.

## Step 1 — settle the round with the user

Write this in the ticket, each open point a question with a recommendation:

| Decision | What to settle |
|---|---|
| Name | The round a fan would name (`WNBA Finals`, `Men's Frozen Four`). It is the league's name, the event's name and, with "Stars", the contest's suggested name (`statPoolContestName` drops a trailing "Final") |
| Shape | One event per round. When a round holds two series (conference finals, semifinals), both are one event and game N holds each series' Game N |
| Sport and composite | The sport, and so the composite its stars score (Triple Threat, Power Play, Box Score, Redzone, Hat Trick) |
| Display order | Its `display_order` among the sport's leagues: after the sport's existing stat pool leagues, in the calendar order of their rounds |
| Last season | Which season the test data is: the latest one fully played. A round still being played is not "as played" yet, so use the year before |

Men's and women's competitions are always separate leagues. Two sports can have rounds of the
same name (basketball's and hockey's Men's National Championship); everything that lists rounds
keys them by sport and name, so a same-named round is fine, but say it in the ticket.

## Step 2 — the migration

Reference data (`rules/architecture-rules.md` §6 *Reference data goes in a migration*):

1. Name it after main's latest migration, with a timestamp no open branch is using
   (`npm run rules:check:migration-timestamps` checks the order).
2. Insert the sport league as the other stat pool leagues' migrations do (find them with
   `grep -l "'COMPOSITE'" packages/core-api/prisma/migrations/*/migration.sql`): `FIXED`
   advancement, `INDIVIDUAL` participants, `COMPOSITE` scoring, idempotent on
   `("sport_id", "name")`.
3. Insert its three default setups, one per format, in this order: Tiered (six tiers, one pick
   each, best four count), Budget (six stars under the cap, best four) and Quick pick (three stars,
   all count), each `is_default`, scored by `COMPOSITE_TOTAL`. Template keys are
   `<league-slug>-tiered-<composite>`, `-budget-` and `-quick-pick-`. Copy the description wording
   from a sibling league of the same sport so the composite reads the same everywhere.
4. Run it on a scratch database with `prisma migrate deploy`, not a reset of the shared one.

## Step 3 — last season's data file

Every sport league has a test seed of its last season as played
(`rules/architecture-rules.md` §6 *Manual-testing seed data goes through the admin API*). Build it
with the `load-sport-data` skill (its *Box scores* row) and the `clutch-card-round` skill for what
is particular to a Clutch Card: the field of stars ranked by their regular-season composite
total, every game's box score, and each line checked against a second source.

- The file is `packages/core-api/scripts/seed-golf/<sport>-<season>-<round>-test.json`; one file
  may carry two rounds of the same competition (semifinals and final).
- Use the sources already listed for the sport in `docs/SPORT-DATA-SOURCES.md`, and add the
  round's row there with the date the two sources were found to agree.
- A stat or a player neither source gave is left out, never guessed.

## Step 4 — the lists that name every round

Each of these names the rounds, and a missing one fails a test or leaves copy out of date:

- `contest-template-reference-data.integration.ts`: the sport's league names in order, and the
  stat pool leagues table (league, template key prefix, composite). Add the round to both, and to
  the test name that lists the championships.
- `tests/unit/core-api/seed-golf.test.ts`: a `describe` for the new file. Name its scope, its
  events' dates and game counts, which teams play which game, and two or three real stat lines a
  reader can look up.
- `stat-pool-contest.test.ts`: the suggested contest name test lists every round.
- `sport-blurbs.ts`: the sport's blurb names its Clutch Card rounds.
- `clutch-card-copy.ts`: the calendar. Most rounds are already there, shown as coming soon until
  their league exists; add the round under its month if it is not.
- `docs/SPORT-DATA-LOADING.md`: the list of stat pool leagues the migrations create, and the
  paragraph naming each test file and what it holds.

If the work is tracked in a narrative plan, record the league there too.

## Step 5 — gates and PR

Run the `release-check` skill. The PR body names the league, its display order, its three
template keys, the season of the test data and the two sources that agreed. After merge, the
league is on QA; its test data loads only on the user's say-so (the `load-sport-data` skill, Step 5).

## Traps

- **A round that spans two playoff rounds.** Never one league for semifinals and final together;
  two leagues, two events, two contests.
- **A display order that collides.** The integration test checks each sport's orders are unique
  and in the listed order; pick the next free slot rather than renumbering others.
- **Test data from a round still being played.** The loader requires results in a test file, so
  an unfinished round cannot be its test data.
- **A league with no event page.** The Clutch Card page lists the round as available once its
  league exists, but no event page shows it until one is added (the `add-event-page` skill).
