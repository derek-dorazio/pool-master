---
name: load-sport-data
description: Loading a sport league's real schedule, players or event fields into a PoolMaster site from public sources — gather from a primary and a second source, cross-check, write a sport data file, dry-run it through the "Load sport data" workflow, and apply on the user's yes. Use when someone wants events or fields on the site without keying them in.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Write, Bash, WebSearch]
---

# Loading sport data

Sport data goes onto a site through its admin API, never through the database or a
migration (`rules/architecture-rules.md` §6 *Database Data: Reference, Fixture, Test*). The
loader and its data shape live in `packages/core-api/scripts/seed-golf/`; the "Load sport
data" workflow runs it, because a cloud session cannot reach the site. This skill gathers
the data, proves it, writes the file and drives that workflow.

Real data only. A value no source gave is left out, never guessed: the data file is not the
place for a plausible default (`rules/testing-rules.md` §1B *Forbidden Application-Code
Patterns* says why made-up values are dangerous; a data file shown as real is the same
risk). Made-up data belongs only in a test seed whose envelope says `testData: true`.

## Step 1 — scope the ask

Turn the request into an envelope scope before gathering anything: one sport, one season,
the sport leagues, and what the file will hold.

| Ask | `contents` |
|---|---|
| "The 2027 PGA TOUR schedule" | `SCHEDULE` |
| "...and who plays" | `SCHEDULE`, `PLAYERS`, `FIELDS` |
| "The field for this week's event" | `PLAYERS`, `FIELDS` (the event must already be on the site) |

`contents` is what a run may change, so keep it as narrow as the ask: a fields file without
`SCHEDULE` can never rewrite the schedule. `FIELDS` always comes with `PLAYERS`. One sport
and season per file; several sport leagues of it are fine.

## Step 2 — gather from two sources

Use the source list below, primary first. Search finds the pages; reading them needs the
pages themselves, which a cloud session cannot fetch. Dispatch the "Fetch sport sources"
workflow on your branch with the page URLs (at most 20 a run), then pull the branch and read
`sport-sources/`: each page's visible text, then any JSON it embeds (schedule sites keep
their data there). `index.json` says which fetches failed.

For each fact, get it from the primary and from a second, independent source: event name,
start and end dates, venue, location, rounds, par; each player in a field and their ranking.

## Step 3 — cross-check

- **Both agree:** load it.
- **They disagree:** leave it out of the file, and list it for the user with both values
  and both links. Never pick one silently.
- **Only the official league site has it:** load it, and say so in the summary.
- **Neither has it:** leave it out (a `null` venue, no ranking on that field entry).

Odds are not loaded: they move daily and differ by book, so two sources rarely agree.

## Step 4 — write the data file

Write it next to `golf-2026.json` in `packages/core-api/scripts/seed-golf/`. The shape is
`sport-data-file.ts` there; read it rather than copying an old file. The envelope:

```json
{
  "schemaVersion": 1,
  "scope": { "sport": "GOLF", "season": 2027, "sportLeagues": ["PGA TOUR"], "contents": ["SCHEDULE", "PLAYERS", "FIELDS"] },
  "testData": false,
  "provenance": { "gatheredAt": "2027-01-05", "gatheredBy": "load-sport-data skill", "sources": [{ "name": "PGA TOUR schedule", "url": "https://www.pgatour.com/schedule" }] },
  "sportLeagues": [{ "name": "PGA TOUR", "players": [], "events": [] }]
}
```

- Sport league names must match the site's (`PGA TOUR`, `LPGA Tour`), or the loader creates
  a second league.
- A player's `key` becomes their external id, so keep one key per person for good:
  `<league>-<name slug>`, as the existing files do. Rankings are whole numbers.
- A field's order is its seed order.
- Name the file for people: sport and season, plus a word for a narrower file
  (`golf-2027.json`, `golf-2027-pga-fields.json`). Nothing reads the name.
- List every page you used under `provenance.sources`.

Validate it before pushing: the loader's parser refuses a file whose data strays outside its
scope, and the unit tests in `tests/unit/core-api/` show how to call it.

## Step 5 — dry run, show, apply

1. Delete `sport-sources/`, commit the data file and push the branch.
2. Dispatch "Load sport data" on that branch with the file and `mode` `dry-run`. It reads the
   site and writes nothing.
3. Read the run's summary and show the user: the counts, every add, update and conflict,
   plus the disagreements from Step 3. A conflict is an event that has started or finished;
   the loader never changes those, so an admin decides.
4. Apply only on the user's explicit yes to that dry run: the same workflow with `mode`
   `apply`. Running it again should report everything as a skip; say so if it does not.
5. Open a PR for the data file, so the next load starts from it.

## Sources per sport

| Sport | Primary | Second source | Rankings |
|---|---|---|---|
| Golf (PGA TOUR, LPGA Tour) | pgatour.com, lpga.com schedule and field pages | The season's Wikipedia article; espn.com golf schedule | owgr.com, rolexrankings.com |

Adding a sport adds its row here (the `add-sport` skill's reflect step), and its data shape
to the loader.

## Where this goes wrong

- **Filling a gap from memory.** A venue or date you are fairly sure of is still a guess;
  leave it out and say so.
- **A renamed event loaded as new.** Sponsors rename events. The loader matches a renamed
  event by a start within three days and reports the rename as an update; check the dry run
  for an event that shows as an add next to one that disappeared.
- **Applying without a dry run, or on a dry run the user has not seen.**
- **Merging the fetched pages.** `sport-sources/` is scratch; it never reaches main.
- **Widening `contents` "to be safe".** A wider file can change more; that is the opposite
  of safe.
