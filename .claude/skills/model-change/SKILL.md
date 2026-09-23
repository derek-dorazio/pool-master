---
name: model-change
description: Changing the Prisma schema, a domain type, or an enum — classify the blast radius first, then work the chain from migration through frontend consumers. Use whenever work implies a shared-contract, DTO, or persistence change.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Write, Bash]
---

# Changing the model

**Classify before you implement.** This step is the whole point of the skill, and it used to
be a separate role's job — it is now a decision you make here, because the classification is
cheap and the cost of getting it wrong is a half-built change across six layers.

## Step 1 — classify

Which of these is the request, actually?

1. **No model change.** The UI can be built from what the contract already exposes.
2. **Contract-only change.** New DTO field, better description, a route shape — no schema,
   no migration.
3. **True model / persistence change.** Schema, migration, and everything downstream.

Getting this wrong in the optimistic direction is the expensive failure: treating an
unclear implication as "probably frontend-only" means discovering the model change halfway
through the UI work.

**If the classification is not obvious, low-risk, and clearly supported by the reviewed
plan — confirm with the user before implementing.** That check is cheap; a speculative
migration is not.

## Step 2 — check it against the conventions before proposing it

`rules/domain-model-conventions-rules.md` is the model language of this repo — lifecycle
naming, `status` vs `isActive`, and the rest. Read it before proposing a change, not after.

When you present the change, say:

- which conventions it follows,
- where it departs from convention, if anywhere,
- whether that departure is justified or should be normalized instead.

A one-off modeling pattern that nobody argued for is how the next entity becomes harder to
reason about. If a change suggests a genuinely better repeatable pattern, raise it as a
**candidate convention** — do not promote it into `rules/domain-model-conventionsrules.md`
without the user agreeing, and prefer promoting only what is already visible in multiple
domain areas.

## Step 3 — work the chain

For a true model change, in order:

1. Prisma schema + migration
2. Shared domain types
3. DTOs (`packages/shared/dto/`)
4. Mappers
5. Routes
6. `npm run api:refresh` / `api:validate`
7. Frontend consumers of the changed SDK types
8. Tests at every layer the change crossed

`rules/model-change-rules.md` governs the chain. Steps 3–6 are the `add-endpoint` sequence —
use that skill for the detail.

## Where this goes wrong

- **Enum members added in one place.** A new enum value needs the Prisma enum, the domain
  type, and every `Record<Enum, …>` map and `switch` that covers it. A `Record<Enum, …>`
  fails the build on a missing key — that is why the codebase types its lookup maps that
  way. A `switch` does **not**: it compiles fine while silently not handling the new case.
  Grep for the enum name and check every `switch` by hand.
- **Two definitions of one name.** A const object and a string union for the same enum can
  coexist and disagree about membership, and a barrel's explicit re-export silently beats
  its `export *`. The result is a type and a value that admit different sets, which `tsc`
  does not report. Before adding an enum, grep for the name across
  `packages/shared/domain/` to confirm there is exactly one definition.
- **Stale fields left exposed.** If the product direction has moved and the contract still
  exposes retired fields, say so — contract-cleanup debt is worth naming explicitly rather
  than working around.
