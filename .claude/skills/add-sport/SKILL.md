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
| Selection types | Which existing selection types fit: roster picks (tiered, budget, random draw), and for a sport played in games the prediction types too (bracket, pick'em, survivor) |
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
   - Head to head: a bracket of matches, points per round won plus an optional seed upset
     bonus (basketball, American football, hockey, baseball, soccer, tennis). A league whose rounds the sport's names
     do not fit names its own (`SportLeague.roundNames`, seeded with the league: the NBA's), and a league whose field the
     sport's default tiers do not fit sets its own tier count (`SportLeague.tierCount`: the
     College Football Playoff's six). Its matches are `SportEventMatch` rows in the event core, not family tables.
     A sport whose level match is settled by a shoot-out sets the definition's `shootout` (its
     label, soccer's "pens"); every other sport sets it to null. The score stays level and the
     shoot-out's winner goes through. A sport that calls overtime something else (soccer's
     "extra time") sets `vocabulary.overtime`, which the final-score label reads.
     A two-legged tie (the Champions League's) is one match scored on aggregate, scheduled at the
     first leg, with no period scores; it needs no model of its own. Nor does a series (MLS's
     best-of-three round one): one match scored in games won. Either one can't take a squares
     pool, so a league with them sets `SportLeague.squaresFromRound` to its first round of
     single games.
   - Finish position: points by place (horse racing, auto racing, cycling).
   Reusing a family is the normal case and needs no new tables. A **new** family is a model
   change and a much larger slice: stop and confirm with the user.
2. **Participant type.** Individual or team.
3. **Selection types.** List the ones the sport offers in its definition's `selectionTypes`;
   contest create refuses any other. What fits follows the scoring family:
   - Every sport: the roster picks, `TIERED`, `BUDGET_PICK` and `RANDOM_DRAW`.
   - A sport played in games (head to head) can add the prediction types: `BRACKET`, a knockout
     bracket pool, picked to the final before it starts (a second-chance bracket starts at a
     later round, such as the Sweet 16); `PICK_EM`, the winner of every game of each week,
     straight up or by confidence, optionally against the spread; and `SURVIVOR`, one team a
     week, each team once. The validity matrix allows prediction contests only on events of
     games.
   - Any sport: a multi-event contest, one contest across many events whose entries submit
     per event (a golf majors pool, an NFL season of weeks). It is a shape of contest, not a
     selection type, so the sport adds nothing for it.
   A new selection type is separate work through the selection-engine registry, not part of
   adding a sport.
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
   A sport whose family lands before its scoring may register with no scoring definitions;
   contest create then refuses it until the scoring slice adds one.
3. **Scoring definitions.** If the sport needs a new participant scoring definition, add it to
   the exhaustive scoring-definition record with its direction, unit and formatters, and its
   contest settings schema to the settings record (the empty object when it takes none).
   Direction is declared once there and nowhere else. Settings that have no sensible default
   (a points table is the commissioner's choice) make contest create require them, from the
   request or a template preset (`CONTEST_SCORING_SETTINGS_REQUIRED`), so ship the presets as
   contest templates carrying them in `config_json.scoring`, in the reference-data migration.
   Make every settings field required, never defaulted: the settings travel in a discriminated
   union, and a JSON Schema `default` inside a `oneOf` is not applied (Ajv strict mode refuses
   it). In a nested union whose arms differ in fields (an upset bonus of none, or of a
   multiplier), list the arm with the extra field first: request validation tries the arms in
   order and strips a field the arm it is trying does not declare, so the field never arrives.
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
   sure it runs. Add the sport's row to the sport x selection-type scenario suite
   (`tests/functional/sport-selection-scenarios.functional.ts`): one played event from its
   last-season test seed (step 11), which yields a journey per roster selection type, from
   preset to settled board. Add integration coverage for any new query (`rules/testing-rules.md` §9
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
11. **Go live.** Put the sport's first real event on the site through the data pipeline, not
    the Manage pages: gather its schedule with the `load-sport-data` skill and commit the data
    file in this PR, so the sport league and event are loaded, and the field later, without
    anyone signing in to type them. Then write down what stays an admin's job as a procedure
    in `docs/` (odds, tiers, prices, release, results: screen names, paths, buttons, what to do
    when a result changes). Walking it is how a missing admin step shows up before the first
    real event does. If the event needs something the loader's one event shape cannot carry,
    add it to the loader here rather than sending an admin to type it. Pipeline support for a
    sport is three things, all in this PR: its row in `docs/SPORT-DATA-SOURCES.md` with each
    source checked by one fetch, its first season's schedule file, and a test slate per sport
    league in `test-slates/` so contests can be tried before a real field is out. Each sport
    league also gets a test data file of its last season as played
    (`rules/architecture-rules.md` §5 *Manual-testing seed data goes through the admin API*).
    Every league goes through the same two workflows: "Fetch sport sources" gathers the
    source pages (a cloud session cannot reach the source sites), and "Load sport data" applies
    a file, the season's schedule once, then each event's field as it is set. Only the source
    sites differ per league, so the workflows need no change for a new sport.
    A knockout differs. Its field and pairings exist only once the bracket is set (the NFL
    playoffs' at the end of the regular season), so there is no bracket to write ahead, and a
    slate fills a field but no bracket; its test data is the last real bracket, played out, and
    it needs no schedule file or slate. A sport league whose last edition was a while ago (a
    World Cup every four years) uses its last edition played, whatever the year. A
    regular season of games is a schedule like any other: each week is an event with its
    games, which link nowhere, written once the league publishes them (the NFL's in May); its
    test data is last season's weeks as played (the `load-sport-data` skill, *Test slates*).

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
- **Keying format behaviour off the sport.** What a bracket needs (its release checks, the
  seed lock at release) follows the tournament format through `sportPlaysMatches`, so the next
  bracket sport inherits it. Its release checks join the event service's blocker list rather
  than adding a second release path.
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
- **Vocabulary words read inside a sentence.** Copy puts each word into a sentence of its own:
  `eventStart` follows "the" ("Entries close at the post time"), so "the start" would read "at
  the the start". Read where a word is used before choosing it, not only how the audience says it.
- **Family copy that names one sport's participant.** A message such as "every runner still in
  the field" in a family's admin card reads wrong for the next sport. Error and hint copy reads
  the vocabulary too, not only headings and column labels.
- **Unseeded teams seeded by their place.** A test seed's field entry without a `seed` takes its
  place in the field, so an unseeded team in a 48-team draw reads as seed 40 and an upset bonus
  over it pays out wildly. Give unseeded teams the seed after the last one (17 in the NCAA men's
  soccer field, 9 in each women's bracket).
- **League presets without their leagues.** A per-league template needs its league row, so the
  league is reference data even though admins normally create leagues
  (`rules/architecture-rules.md` §6 *Reference data goes in a migration*). Give each league's
  templates their own keys and one default per format and kind of event, named and described
  as `rules/ux-rules.md` §12 *League Pages and Commissioner Tools* (item 12) says. The template's foreign key then keeps
  those leagues through any test cleanup that empties sport leagues, and a test that counts
  sports or leagues sees them.
- **A league that plays differently from the sport's layout.** The tier layout belongs to the
  sport, not the league. The sport's tier size is used only while an event keeps the sport's
  tier count and the field fills every tier at that size; otherwise *Auto-assign tiers from
  odds* spreads the field evenly (an F1 field of 22 on four tiers comes out 6/6/5/5), and release
  refuses an event with an empty tier.
  So a league on fewer tiers needs only the tier deletion in its setup procedure, and its tiered
  preset must count the tiers it plays. A league default in a format other than tiered is fine:
  the create-contest page starts on the format of the league's own default.
- **Looking up a sport league by its sport.** `SportLeagueDto` carries no `sport` (only
  `sportId`). Find a sport's leagues by listing with `?sport=`, not by filtering the DTOs.
- **Applying race results with POST.** The finishing-order apply is a `PUT` (it replaces the
  rows it names); only its preview is a `POST`. Tests and helpers that guess the verb fail.
- **Web tests that list every sport.** The Manage menu and its layout test name each sport
  in registry order, so a new sport fails two web unit tests until they list it. Expected, not
  a defect: add the sport's name to both.
- **Dating a test seed from a fixed day in a functional test.** Release refuses an event that
  has started by the server's clock, which a test cannot set, so a test seed moved forward from
  a fixed `now` stops releasing once real time passes it. Load a seed with today as `now`.
- **Test cleanup that deletes sport reference rows.** Sports, their reference sport leagues
  and contest templates come from migrations; a cleanup that empties them breaks every test
  that runs after it, and a database that is not rebuilt between runs. Delete only the rows
  the test made (`rules/testing-rules.md` §9A *Integration Test Isolation and Cleanup*).
- **Copying an older sport's reference migration.** The sports row's tournament format is
  `MATCHES` for a sport played in games; the American football migration's `KNOCKOUT_BRACKET`
  was renamed since, and Postgres refuses it. A league that reads the sport's round names stores
  an empty `round_names` array, never null (the column is not null). A new period layout
  (hockey's three periods) is a Postgres enum value too: add it in the enum migration beside the
  sport, and its squares moment labels where the compiler points.
- **Scenario rows keyed by league name.** Two sports can share a league name ("NCAA Division I
  Men" plays basketball and hockey), so a functional suite whose test names or tags come from
  the league name runs two rows under one name. Key them by event name, or name the sport too.
- **ESPN date ranges.** The ESPN scoreboard refuses `dates=<from>-<to>` with a 400 for most
  leagues; fetch one day per URL, at most 20 URLs a run. Each "Fetch sport sources" run
  replaces the folder the last one wrote, so copy what you need before the next run.
- **A bye on the away side.** A fixed bracket may name a team placed straight into a later
  round on either side of its match (MLB's byes are home sides, the Champions League's away
  sides); the earlier round's winner fills the other side through `advancesTo`.
- **Team words in a match sport's screens.** The bracket and survivor screens read the sport's
  participant noun, its `vocabulary.match` ("match", else "game"), its `eventStart` and its
  `vocabulary.scoreUnit` ("sets" for tennis, else "points") through the helpers in
  `contest-sport.ts`. An individual sport in the head-to-head family shows any "team" left in
  copy at once; render one screen on the new sport and read it.
- **A tie word for a sport that never ties.** Every head-to-head sport names a tie
  (`vocabulary.tie`), tennis included, because the shared result and pick screens read it; the
  definition test refuses one without.
- **A second tier layout for a variation.** Tiers live on the event and every contest shares
  them, so a variation that picks from fewer tiers (tennis's Seeds only, golf's Top four tiers)
  is the tiered rules' `tiersUsed`, not a new tier layout.
- **Squares on a league whose final is a series.** A series is one bracket match scored in
  games won, so it has no single game for a grid. Leave squares out of such a sport's selection
  types and its period layout off the definition, and add the league to the template checks'
  series leagues, which otherwise expect a squares default (MLB, the NBA, the NHL).
- **Adding catalog values "for later".** Add a sport, scoring definition or enum value only
  with the code that uses it. Unused values are dead code and get deleted.
- **Hiding missing results with defaults.** An unscored participant is unranked, never a
  made-up score (`rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*). A
  sport's real rule for a missing result (golf's fixed 80 strokes) is a documented scoring
  rule in its family, not a fallback.
