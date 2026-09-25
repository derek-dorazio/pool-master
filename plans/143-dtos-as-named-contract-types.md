# Plan 143 — DTOs as Named Contract Types

**Tracking issue:** #192

## Purpose

Make generated, named DTO types the only way the frontend learns the shape of an API
response.

Today the frontend cannot import a type for a league, because none exists.
`components.schemas` in `openapi.json` is empty: every route calls `zodToJsonSchema(X)`
inline, so every shape is published per-operation and hey-api has nothing named to emit.
The only available handle is to index into a response wrapper —

```ts
type LeagueDetail = GetLeagueResponses[200]['league'];
```

— and that expression then gets copy-pasted. #87 measured **20 type names declared across
71 sites**, three of which derive from *different endpoints* under a single name. The
frontend behaviour is not the defect; it is the only thing available.

## Governing Principles

- **The contract is published, not reconstructed.** If the frontend has to build a type by
  indexing into a response, the contract did not publish it.
- **Name the enums too.** `z.enum([...])` already yields a correct union in the generated
  output, but an inline anonymous one. Naming only object schemas leaves the frontend
  re-spelling `'HEALTHY' | 'QUESTIONABLE' | ...` at every use instead of importing
  `ParticipantStatus`. This is the easiest part of the job to skip and the most annoying
  to retrofit.
- **One name per concept, and it comes from the generator.** A hand-written alias for a
  generated type is the problem this plan exists to remove, not a convenience.
- **Interim consolidation is not the destination.** A lint rule preventing duplicated
  derivations is a workaround for a missing named type. Do not let its existence become an
  argument that the underlying problem is handled.

## Scope

**In:** schema registration in `packages/core-api/src/**/routes.ts` (521 `zodToJsonSchema`
call sites across 21 files), the shared DTO modules in `packages/shared/dto/`, the
regenerated artifacts, and the frontend consumers of each converted module.

**Out:** what the database enforces (#186), how environment values are named (#184), and
the deploy pipeline (#191).

## Key Decisions

### 1. Registration mechanism — SETTLED in slice 1

**`fastify.addSchema({ $id })`, with routes referencing `{ $ref: 'Name#' }`.** Three things
were established by trying them, and each looked correct one layer up:

1. **A route cannot `$ref` `#/components/schemas/Name`.** Fastify builds the response
   serializer from the route schema and resolves `$ref` against schemas added via
   `addSchema` — it has no knowledge of `components.schemas`. The document pointer fails at
   boot: `Cannot find reference "#/components/schemas/ServiceVersionResponse"`.
2. **@fastify/swagger renames hoisted schemas `def-0`, `def-1`, …** unless given a
   `refResolver.buildLocalReference` that returns `json.$id`. Without it the components
   exist and the generator emits `Def0` — present, and useless as an import.
3. **Component registration must NOT live in the swagger plugin.** A route that `$ref`s a
   component needs it registered whether or not the app serves docs. Putting the loop in
   the swagger plugin made every route silently depend on documentation being enabled; the
   version module's unit tests, which build a bare Fastify instance, failed at boot with
   `Cannot resolve ref "ServiceVersionResponse#"`. It lives in
   `plugins/schema-components.ts`, is `fastify-plugin`-wrapped so schemas land on the root
   instance, and is **idempotent** (`getSchema` before `addSchema`) so every route module
   can register it without ordering rules.

`packages/shared/dto/schema-registry.ts` holds the registry. `registerSchema(name, schema)`
returns its argument so registration composes inline at the declaration, and **throws when
two different schemas claim one name** — that collision is the drift this epic removes, and
it must fail at startup rather than letting the last registration win.

### 1a. Known limitation — nested components still inline

`ServiceVersionResponse.service` publishes the `VersionComponent` shape inline rather than
referencing it, because `dto/json-schema.ts` resolves local `$ref`s before registration.
TypeScript is structural, so the inlined shape is still assignable to the named
`VersionComponent` and the frontend is unaffected — the cost is duplication in the generated
file, not correctness.

Fixing it means making the conversion registry-aware so a nested *registered* schema emits a
ref instead of being flattened. Deliberately deferred: it is an optimisation, and
`json-schema.ts`'s inlining exists for a real reason (generators cannot follow refs embedded
under `paths`) that a careless change would reintroduce.

### 2. Naming convention — decide once, in slice 1

The generated names become the frontend's vocabulary, so they are not a detail. Settle at
minimum: the suffix (`LeagueDto` vs `League`), how list-item and detail variants of one
entity are distinguished, and whether response envelopes are named alongside their payloads.

`rules/domain-model-conventions-rules.md §8` *One canonical DTO per entity* governs; this
slice states how the published names satisfy it.

### 3. List and detail carry the same object

Owner direction: list endpoints return the **full object**, not a page-shaped subset. Two
known gaps, both a single field:

- `AdminListGolfSeasons` omits `isCurrent` (detail 11 fields, list 10)
- `AdminListGolfPlayers` omits `providerMappings` (detail 14, list 13)

`GetLeague` and `GetLeagueByCode` already return identical 13-field shapes, so that pair
needs no change. Fix the two gaps in the slices that own those modules.

### 4. One session, serial slices — REVISED

This epic was originally scoped for parallel agent sessions. **That is no longer the plan:
the remaining conversion runs in a single session, serially.** What follows from that:

- **The artifact collision is moot.** Every slice regenerates `openapi.json` and
  `packages/shared/generated/hey-api/`, and `api:check` is a blocking gate. That made two
  in-flight slices conflict *every time*. With one session there is nothing to collide with.
- **Slices no longer need to be module-shaped.** Module-sized scopes existed to give
  parallel agents bounded, non-overlapping work. That framing is what produced both bugs
  found in slice 5 (see the blind-spots section): `team-owner-invitations.dto.ts` was
  missed because it is not named after a route module, and `admin/routes.ts` needed a
  `#192-mixed:` marker only because module-shaped slices leave files half-converted.
- **Slices are now sized for REVIEW, not for scheduling.** The repo owner reads each PR;
  that is the only constraint on how big a slice should be.

**The completion criterion is now DTO-shaped:** a slice is done when every producer and
every consumer of the DTOs it registered is converted, wherever they live — not when a
named module's directory is finished. Check 1 already enforces the producer half (any
route inlining a registered schema fails), which is why registering the league DTOs forced
`admin/routes.ts` and `invitations/routes.ts` to convert in the leagues slice. The consumer
half is still convention.

### 5. What this does and does not fix

**Fixes:** a named DTO whose field is `z.enum([...])` publishes a real union, so `tsc`
rejects an invalid value in frontend code. Today, wherever a DTO uses `z.string()`, it does
not.

**Does not fix:** a union still accepts a bare *valid* literal — `x.status === 'HEALTHY'`
compiles against the union exactly as against `string`. `poolmaster/no-bare-enum-literals`
covers that rename case and is not superseded.

**Does not fix:** what the database enforces. #186 promotes 23 `String` columns to enums;
a DTO declaring `z.enum` over a `String` column is stricter than storage, which is its own
hazard. Sequence #186 first where they touch the same fields.

## Execution Sequence

**Slice 1 — plumbing. DONE.** §1 settled above, and proven end to end on `squads`:
`components.schemas` went from 0 to 9 named entries, routes `$ref` them, the generator emits
importable types, and all five frontend derivations were deleted. `leagues` and `contests`
followed on the same mechanism; `components.schemas` now carries **82** named entries.

**`version` was the first module tried and is deliberately NOT converted.** It has no
frontend consumers — `lib/version-info.ts` reads a static `version-info.json` asset with a
different shape — so it could only ever prove the server half. It is also operational
plumbing rather than product surface, and **#180 already owns how `/version` reports build
identity**, including retiring `VersionService`'s `?? '0.1.0'` / `?? 'development'`
fallbacks. Converting it here would have split that work across two tickets. It converts as
part of #180.

**Pick modules with real frontend consumers.** The point of a slice is deleting derivations;
a module nothing derives from proves only half the chain.

Regression cover, both added in slice 1: `tests/unit/shared/schema-registry.test.ts` for the
registry contract, and `tests/unit/shared/openapi-named-components.test.ts` asserting on the
**committed artifacts** — that components are named rather than `def-N`, that a converted
route `$ref`s rather than inlines, and that the generator emits importable types. Verified by
removing the `refResolver` and confirming four of those cases fail. Extend
`CONVERTED_COMPONENTS` in that file as each slice lands.

**Slices 2..N — one per route module, parallelisable after slice 1.**

Done: `squads` (slice 2), `leagues` (slice 3), `contests` (slice 4),
`team-invitations` + the `team-owner-invitations` DTO module (slice 5). `invitations` came
free with the leagues slice and is already clean. `version` belongs to #180.

**The earlier module list was wrong in both directions.** It named `golf`, `sport-catalog`,
`email` and `contest-entry-picks` as remaining modules; none of them has a `routes.ts` at
all. It also listed `invitations`, which was already done. Work the measured list below
instead, and re-measure rather than trusting it:

```
# route files with remaining domain inlines (anything not ErrorEnvelopeSchema/SuccessSchema)
```

| Route file | Domain inlines | Notes |
|---|---:|---|
| `admin/golf/routes.ts` | 102 | largest by far; also the largest frontend payoff (~30 derivations) |
| `admin/routes.ts` | 41 | carries the `#192-mixed:` marker; needs `admin` + `ingestion` + `contest-management` DTOs |
| `account/routes.ts` | 12 | |
| `drafts/routes.ts` | 12 | |
| `admin/platform-config-routes.ts` | 11 | shares `config.dto.ts` with `config/routes.ts` |
| `contest-management/routes.ts` | 7 | `contest-management.dto.ts` also feeds `admin/routes.ts` |
| `auth/routes.ts` | 6 | |
| `participants/routes.ts` | 4 | |
| `admin/audit-routes.ts` | 2 | shares `admin.dto.ts` with `admin/routes.ts` |
| `events/routes.ts` | 2 | |
| `client-logs/routes.ts` | 1 | |
| `config/routes.ts` | 1 | shares `config.dto.ts` with `admin/platform-config-routes.ts` |
| `version/routes.ts` | 1 | deferred to #180 |

**Only three DTO modules cross route-file boundaries:** `admin.dto.ts` (2 files),
`config.dto.ts` (2), `contest-management.dto.ts` (2). Everything else is 1:1, so most
remaining slices are genuinely self-contained — the cross-module hazard that bit slices 2-4
is nearly spent.

### Slice order, and why

1. **Small leaves first — DONE.** `client-logs`, `events`, `admin/audit-routes`,
   `participants`, `auth`.

   **Three modules were DELETED rather than converted:** `history`, `notifications` and
   `account-consent`. Each had zero frontend callers and no server-side producer — closed
   loops no feature entered. `history` had no table of its own either; it re-queried the
   contest tables, which is what the contest list and scoreboard already do. The cheapest
   conversion is the one you do not do: this removed three modules from the backlog instead
   of adding named components nothing would import. Measure before converting.
2. **`config`** — both its route files together, the smallest of the three cross-file DTOs.
3. **`account`, `drafts`** — self-contained, medium.
4. **The admin cluster** — `admin.dto.ts` + `ingestion.dto.ts` + `contest-management.dto.ts`
   across `admin/routes.ts`, `admin/audit-routes.ts` and `contest-management/routes.ts`.
   **This is what deletes the `#192-mixed:` marker.** Until it lands, check 5 is blind to
   the second-largest route file in the repo, so this should not sit to the end. It may be
   split into several PRs; the marker stays until the last one.
5. **`admin-golf`** — 102 inlines and the biggest frontend payoff, taken last among the
   conversions because it is the one most worth having a fully proven guard set for.
6. **Enforcement slice** — lint rule banning `Responses[...]` indexing in `features/**`;
   retire the `#192-mixed:` mechanism once no file uses it.

Each slice: register that module's DTOs as named components → `api:refresh` → replace its
frontend consumers' derivations with imports → **delete every local derived type the module
owned** → tests at every layer crossed.

**Deleting the derivations is not optional cleanup; it is the deliverable.** A slice that
adds the import but leaves `type LeagueDetail = GetLeagueResponses[200]['league']` in place
has made things worse: there are now two ways to name one shape, and the next developer
cannot tell which is current. No slice is done while any derived alias it owns still exists.
`grep -rnE "Responses\[[0-9]+\]" clients/poolmaster/src` must return nothing for that
module's types before the slice closes. **Match any status, not just 200** — checking only
`[200]` is precisely the bug that let seven `[201]` derivations survive three slices.

Per-slice, also resolve that module's share of **#149** (loose `ZodTypeAny` / `z.unknown`).
A loose Zod type publishes as `unknown`, which defeats the point of naming the schema. It is
cheaper to fix while already editing the schema than as a second pass.

Sizing note: `admin` (685 lines of DTO) and `admin-golf` (649) are far larger than the rest
and should be split further when they are picked up — they are now the two largest
remaining. (`contests` at 462 DTO lines and `leagues` at 362 are done.)

The enforcement slice (item 6 above) also decides the fate of
`poolmaster/no-duplicate-feature-types`: retire it if the class of problem is gone, or keep
it as a backstop and say why.

## Guards

Two gates cover this epic, and between them they have caught every mistake made so far.
Both are **self-deriving** — neither keeps a list of converted modules, because a list is
maintenance that gets forgotten, and a forgotten entry makes a guard quietly stop covering
a module.

**`tests/unit/shared/openapi-named-components.test.ts`** asserts on the committed
artifacts. Every component must generate an importable type; none may be a `def-N`
placeholder; and no frontend file may index into the response map of an operation whose
200 is now a `$ref` — those map names are computed from the operationIds, the same way
hey-api derives them. It also asserts the mirror: at least one *unconverted* operation's
map must still be indexed, so a rewrite that matched a converted name as a substring of an
unconverted one reads as failure rather than progress.

**`scripts/check-dto-conversion-complete.mjs`** (in `rules:check`) covers four ways the
conversion fails without any type error, failing test, or implausible-looking document:

1. **A route inlines a schema that is published as a named component.** Half-converted
   modules publish one shape inline and `$ref` it everywhere else, so the frontend gets a
   named type for part of a module and a response-map derivation for the rest.
2. **A registered name never reaches `components.schemas`.** `registerSchema()` runs as a
   module side effect, so a DTO module no route imports registers nothing — the registry
   looks right and the document silently lacks the component.
3. **`registerSchema('X', YSchema)`** publishes the wrong shape under a plausible name.
   Nothing downstream can tell: the component exists, generates a type, and every `$ref`
   resolves. Only the shape is wrong.
4. **A route calls `schemaRef()` without registering the components plugin.** That fails at
   *boot*, and only in whatever app-building path exercises that module — a module without
   such a test ships broken.

5. **A converted route file still inlines a domain schema nobody registered.** Checks 1-3
   all reason about names that are ALREADY in the registry, so a DTO module with zero
   registrations is invisible to every one of them. `team-owner-invitations.dto.ts` had
   seven exported schemas and no registrations while `squads/routes.ts` — marked converted
   — inlined five of them, and every guard passed. A file may opt out with a
   `#192-mixed:` comment naming why; opted-out files are printed on success.

Each was verified by planting the failure and confirming it fires, not by observing a green
run. Check 1 found six real half-conversions on its first execution; check 5 found the
`team-owner-invitations` module.

### Two blind spots found by re-auditing already-converted modules

Both were found only because the earlier slices were re-checked after the guards existed,
which is the practice worth keeping: **a guard written during slice N does not retroactively
prove slices 1..N-1, and neither does it passing.**

- **`openapi-named-components.test.ts` checked only `responses.200`.** Ten of 45 converted
  operations return 201, so they were invisible to it — and seven derivations against
  `createLeague`, `generateInviteLink` and `acceptInvitation` survived in
  `leagues/test/fixtures.ts` indexing `[201]` while the guard read green. It now scans every
  2xx status.
- **Check 5's gap, above.** Squads, the original end-to-end proof, was half-converted for
  three slices.

### A slice's scope is not knowable from its DTO module

Two structural facts, both learned the hard way, both of which change how a slice is
planned:

- **DTO ownership does not follow route-module boundaries.** `leagues.dto.ts` schemas are
  consumed by `admin/routes.ts` and `invitations/routes.ts`. Converting "the leagues
  module" left those two inlining shapes every other route referenced.
- **Converting a route changes which FRONTEND files are in scope.** The set of derivations
  to delete follows from which operations now `$ref`, not from the DTO module — which is
  why the test derives it from the document.

## Open Questions

- **Does the `$ref` strategy survive Fastify's response validation?** The route schemas are
  used for serialization as well as documentation. Slice 1 must confirm a referenced schema
  still validates responses, not only that it renders in the document.
- **Do any two modules legitimately publish the same entity under different shapes?** If so,
  one canonical DTO per entity (§8 of the conventions) forces a decision that is a product
  call, not a mechanical one. Surface those rather than picking.
- **How large is the frontend diff per module?** Unmeasured. The 71 sites #87 found are only
  the *duplicated* names; single-use derivations were never counted and will also need
  replacing.

## Sources / Prior Decisions

- #190 — the finding that `components.schemas` is empty and why the frontend derives.
- #87 — measured the duplication (20 names, 71 sites, 3 cross-endpoint disagreements);
  closed will-not-fix in favour of this epic.
- `rules/domain-model-conventions-rules.md §8` — one canonical DTO per entity, type
  alignment across layers.
- `rules/model-change-rules.md` — the chain each slice works.
