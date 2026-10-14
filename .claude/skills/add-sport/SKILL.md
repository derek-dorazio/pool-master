---
name: add-sport
description: Adding a new sport (or a new scoring family) to PoolMaster — refine it, add the registry entry, scoring family, storage, admin results, contest setup, web vocabulary and tests, set up its first event, then reflect on this skill. Use whenever work makes contests possible for a sport that is not yet supported.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Write, Bash]
---

# Adding a sport

A sport is supported when it is in the sport registry and nowhere else. The `Sport` enum and
the validity matrices say what is coherent; the registry says what is built
(`rules/architecture-rules.md` §2 *Validity / Compatibility Matrices Source of Truth*,
§4 *Sport extension*). The compiler is your checklist: add the sport to the registry first,
then fix what `tsc` and lint report.

The loop is refine, implement, reflect. Do all three in the same piece of work.

## Step 0 — refine

Fill in a refinement table for the sport before any code, one row per decision:

| Decision | What to settle |
|---|---|
| Participant | Individual or team, and what the audience calls one |
| Sport leagues | Which real-world leagues or tours run its events (one sport, many leagues: auto racing has F1, IndyCar and NASCAR) |
| Event and field | What one event is, how big its field is, how many rounds or stages |
| Seeding source | Ranking, seed lines or odds: what feeds tiers and budget prices, and how an admin gets it in before release |
| Selection types | Which existing engines fit (tiered, budget) |
| Scoring rules and presets | How a participant scores, and any per-league presets |
| Results source | Admin entry only, or a provider feed |
| Vocabulary | Participant, round, knocked out, event start, as the audience says them |

Write every open point as a question with a recommendation. The table goes in the ticket, or
in a plan only when the sport needs a new scoring family or a model change.

Settle the seeding source for real, not as "later". Releasing an event requires every active
participant to have a tier and a price, even when every contest on it will be a random draw,
so a sport with no way to tier and price its field cannot release an event at all. Tiers come
from ranking or odds; budget prices come from seed numbers, then odds for participants with
no seed, so a sport seeded by odds needs only its odds before pricing.

## Step 1 — classify the sport

1. **Scoring family.** Does an existing family already score this sport?
   - Stroke play: lowest total wins (golf).
   - Knockout advancement: points per round won (tennis, March Madness, NFL playoffs).
   - Finish position: points by place (horse racing, auto racing, cycling).
   Reusing a family is the normal case and needs no new tables. A **new** family is a model
   change and a much larger slice: stop and confirm with the user.
2. **Participant type.** Individual or team.
3. **Selection types.** Which existing engines fit. A new selection type is separate work
   through the selection-engine registry, not part of adding a sport.
4. **Results source.** A new provider follows `rules/architecture-rules.md` §3 *Provider and
   Adapter Registry Discipline*.
5. **Vocabulary.** Check `rules/domain-model-concepts.md` §2 *Vocabulary* so product terms
   keep their meaning.

## Step 2 — work the chain

In order:

1. **Enum and reference row.** Add the sport to the `Sport` domain enum and the Prisma enum in
   one migration, and its `sports` reference row (and any contest templates) in the next one:
   Postgres refuses a new enum value inside the transaction that adds it
   (`rules/architecture-rules.md` §6 *Reference data goes in a migration*). Use the
   `model-change` skill. A sport whose presets differ by sport league seeds those leagues in
   the same reference-data migration, and each template finds its league by sport and name
   (same section).
2. **Sport definition.** Add its `SportDefinition` to the sport registry: participant type,
   scoring family, tournament format, default rounds and tier layout, selection types, scoring
   definitions, vocabulary and round labels. Run `tsc`; every exhaustive map that lacks the sport now fails. Fix each.
3. **Scoring definitions.** If the sport needs a new participant scoring definition, add it to
   the exhaustive scoring-definition record with its direction, unit and formatters, and its
   contest settings schema to the settings record (the empty object when it takes none).
   Direction is declared once there and nowhere else. Settings that have no sensible default
   (a points table is the commissioner's choice) make contest create require them, from the
   request or a template preset (`CONTEST_SCORING_SETTINGS_REQUIRED`), so ship the presets as
   contest templates carrying them in `config_json.scoring`, in the reference-data migration.
   Make every settings field required, never defaulted: the settings travel in a discriminated
   union, and a JSON Schema `default` inside a `oneOf` is not applied (Ajv strict mode refuses
   it).
4. **Scoring family.** Reusing one: nothing beyond the registry entry. New one: implement the
   scoring-family interface, add its extension tables beside the core round and standing rows
   (one table set per family, never per sport), and register it in the scoring-family registry
   and the leaderboard detail map; the compiler lists both maps once the family is in the enum.
   Add a live-score variant to the results union only when a provider for it exists; until
   then the family declares `liveScores: null` and its results come from admin entry. A
   supported sport with no provider sits in the default scheduled sports anyway, and the
   ingestion scheduler logs one warning per change in that set: expected, not a defect.
5. **Field seeding and pricing.** Confirm the seeding source feeds tiers and budget prices
   through the existing event services, and that an event can be released (step 0).
6. **Admin results.** An admin must be able to enter or correct every result without a
   provider (`rules/architecture-rules.md` §4 *Provider data reaches only events an admin
   authored and linked*). A new family's results route refuses an event of another family
   with 422 `EVENT_SCORING_FAMILY_MISMATCH`, as golf's score routes do. On the web, the family
   adds its entry to `SCORING_FAMILY_ADMIN_UI` (exhaustive, so the build asks for it): the
   results page's name and body. The Manage event, field, tier, participant and sport league
   pages are shared by every sport under `/manage/sports/:sport/`, so a new sport needs no new
   admin pages; its menu entry and URL segment come from the registry
   (`rules/architecture-rules.md` §4 *Sport extension*).
7. **Contract.** Any new DTO, route or error code goes through the `add-endpoint` skill and
   regenerates the SDK in the same slice.
8. **Web app.** Copy and round labels come from the sport definition, admin screens
   included: the definition's `name`, and the vocabulary's `participant`, `event`,
   `sportLeague`, `round`, `withdrawn` and `eventStart` (and `eliminated`, only for a sport
   that knocks participants out). A new family adds its leaderboard to `SCORING_FAMILY_UI`,
   including its `entryTiebreaker` (null when entries submit without one); a new scoring
   definition adds its contest-setup inputs to `SCORING_SETTINGS_UI`. Both are exhaustive
   records. Use the `add-frontend-feature` skill.
9. **Tests.** The registry conformance suite covers the new definition automatically; make
   sure it runs. Add integration coverage for any new query (`rules/testing-rules.md` §9
   *Integration Test Depth Requirement*), and one end-to-end journey: create event, seed field,
   create contest, enter, score, settle (`rules/testing-rules.md` §6 *Functional and Browser
   E2E Rules*). A slice with no UI yet proves it as an SDK functional journey; once the
   screens exist, a browser journey. A sport that joins a family whose shared screens already
   have a browser journey proves itself with an SDK journey, and words that differ with a
   component test under its own sport. The browser journey sets `JourneyRun.sport` and reuses the
   golden journey's teardown (extend `JourneySport`), and tiers its field the realistic way:
   odds in the field grid, then auto-assign tiers from odds.
10. **Docs and gates.** Update the docs the change touches in the same PR, then run the
    `release-check` skill.
11. **Go live.** Set up the sport's first sport league and event through the Manage pages, the
    way an admin will, and write that setup down as a procedure in `docs/` (screen names,
    paths, buttons, what to do when a result changes). Walking it is how a missing admin
    step shows up before the first real event does.

## Step 3 — reflect

Before the PR is marked ready, compare what was built against this skill: steps that were
missing, wrong or unused, and traps you hit. Fix this file in the same PR, so the review sees
it, and add one line to the PR body saying what changed in the skill. A sport PR that changes
nothing here says so explicitly.

Add the sport's sources to `docs/SPORT-DATA-SOURCES.md`, so its schedules and fields can be
loaded without keying them in.

When the sport lands as a series of slices, each slice's PR still records what it learned,
and the closing slice folds the lessons in. Check each against the code before writing it
down: a lesson that was true mid-series may not be by the end.

## Where this goes wrong

- **Comparing the sport by value.** `event.sport === Sport.TENNIS` outside the sport registry
  and scoring-family folders is the bug this structure exists to prevent; lint rejects it.
  Put the difference in the definition or the family.
- **A `switch` without an exhaustive default.** End it in `default: assertNever(value)`, so the
  next sport fails the build instead of falling through silently.
- **One extension table set per sport.** Tennis and March Madness share knockout tables. A
  table named after a sport, for a family that already exists, is a duplicate.
- **One sport per league.** F1, IndyCar and NASCAR are sport leagues of one auto racing sport,
  not three sports. A new sport is a new way of competing, not a new organiser.
- **Golf words in shared screens.** "Golfer", "tee time", "to par" and "cut" in a shared
  component are a vocabulary leak; read them from the sport definition.
- **Sport words in a family's screens.** Two sports in one family can still say different
  things: horse racing has a "Rider" column and calls its top places "Win / Place / Show"
  (`vocabulary.rider`, `vocabulary.topPlaces`). A word that differs between sports of the same
  family belongs in the vocabulary, not hard-coded in the family's card or leaderboard.
- **Family copy that names one sport's participant.** A message such as "every runner still in
  the field" in a family's admin card reads wrong for the next sport. Error and hint copy reads
  the vocabulary too, not only headings and column labels.
- **League presets without their leagues.** A per-league template needs its league row, so the
  league is reference data even though admins normally create leagues
  (`rules/architecture-rules.md` §6 *Reference data goes in a migration*). Give each league's
  templates their own keys and one default per league. The template's foreign key then keeps
  those leagues through any test cleanup that empties sport leagues, and a test that counts
  sports or leagues sees them.
- **Looking up a sport league by its sport.** `SportLeagueDto` carries no `sport` (only
  `sportId`). Find a sport's leagues by listing with `?sport=`, not by filtering the DTOs.
- **Applying race results with POST.** The finishing-order apply is a `PUT` (it replaces the
  rows it names); only its preview is a `POST`. Tests and helpers that guess the verb fail.
- **Adding catalog values "for later".** Add a sport, scoring definition or enum value only
  with the code that uses it. Unused values are dead code and get deleted.
- **Hiding missing results with defaults.** An unscored participant is unranked, never a
  made-up score (`rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*). A
  sport's real rule for a missing result (golf's fixed 80 strokes) is a documented scoring
  rule in its family, not a fallback.
