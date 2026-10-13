---
name: add-sport
description: Adding a new sport (or a new scoring family) to PoolMaster — refine it, add the registry entry, scoring family, storage, admin results, contest setup, web vocabulary and tests, then reflect on this skill. Use whenever work makes contests possible for a sport that is not yet supported.
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
| Seeding source | Ranking, seed lines or odds: what feeds tiers and budget prices |
| Selection types | Which existing engines fit (tiered, budget) |
| Scoring rules and presets | How a participant scores, and any per-league presets |
| Results source | Admin entry only, or a provider feed |
| Vocabulary | Participant, round, knocked out, event start, as the audience says them |

Write every open point as a question with a recommendation. The table goes in the ticket, or
in a plan only when the sport needs a new scoring family or a model change.

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
   one migration, together with its `sports` reference row
   (`rules/architecture-rules.md` §6 *Reference data goes in a migration*). Use the
   `model-change` skill.
2. **Sport definition.** Add its `SportDefinition` to the sport registry: participant type,
   scoring family, tournament format, selection types, scoring definitions, vocabulary and
   round labels. Run `tsc`; every exhaustive map that lacks the sport now fails. Fix each.
3. **Scoring definitions.** If the sport needs a new participant scoring definition, add it to
   the exhaustive scoring-definition record with its direction, unit and formatters. Direction
   is declared once there and nowhere else.
4. **Scoring family.** Reusing one: nothing beyond the registry entry. New one: implement the
   scoring-family interface, add its extension tables beside the core round and standing rows
   (one table set per family, never per sport), register it in the scoring-family registry and
   the leaderboard detail map, and add its live-score variant to the results union. The
   compiler lists both maps once the family is in the enum.
5. **Field seeding and pricing.** Confirm the seeding source feeds tiers and budget prices
   through the existing event services.
6. **Admin results.** An admin must be able to enter or correct every result without a
   provider (`rules/architecture-rules.md` §4 *Provider data reaches only events an admin
   authored and linked*).
7. **Contract.** Any new DTO, route or error code goes through the `add-endpoint` skill and
   regenerates the SDK in the same slice.
8. **Web app.** Copy and round labels come from the sport definition. Use the
   `add-frontend-feature` skill.
9. **Tests.** The registry conformance suite covers the new definition automatically; make
   sure it runs. Add integration coverage for any new query (`rules/testing-rules.md` §9
   *Integration Test Depth Requirement*), and one browser journey: create event, seed field,
   create contest, enter, score, settle (`rules/testing-rules.md` §6 *Functional and Browser
   E2E Rules*).
10. **Docs and gates.** Update the docs the change touches in the same PR, then run the
    `release-check` skill.

## Step 3 — reflect

Before the PR is marked ready, compare what was built against this skill: steps that were
missing, wrong or unused, and traps you hit. Fix this file in the same PR, so the review sees
it, and add one line to the PR body saying what changed in the skill. A sport PR that changes
nothing here says so explicitly.

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
- **Adding catalog values "for later".** Add a sport, scoring definition or enum value only
  with the code that uses it. Unused values are dead code and get deleted.
- **Hiding missing results with defaults.** An unscored participant is unranked, never a
  made-up score (`rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*). A
  sport's real rule for a missing result (golf's fixed 80 strokes) is a documented scoring
  rule in its family, not a fallback.
