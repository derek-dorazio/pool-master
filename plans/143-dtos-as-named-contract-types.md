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

### 1. Registration mechanism — decide once, in slice 1

Two viable approaches, and **mixing them produces half-referenced documents that are worse
than either**:

- `zod-to-json-schema` with a definitions/`$ref` strategy, collecting named definitions into
  `components/schemas`.
- Fastify `addSchema` with a stable `$id` per DTO, letting the swagger plugin emit the refs.

Slice 1 picks one, applies it to a single small module end to end, and records the choice
here. Everything downstream copies that module.

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

### 4. Parallel authoring, serialised merging

Every slice regenerates `openapi.json` and `packages/shared/generated/hey-api/`, and
`api:check` is a **blocking** gate that fails when the committed artifacts are stale. Two
slices in flight therefore conflict on those files **every time** — this is guaranteed, not
occasional.

Work the slices in parallel; merge them one at a time, rebasing and re-running
`npm run api:refresh` immediately before each merge. A slice that sat unmerged for a day
needs regenerating again, not just rebasing.

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

**Slice 1 — plumbing. Blocks everything else; nothing runs in parallel until it lands.**
Decide §1 and §2, convert one small module (`version` or `client-logs` — both are tiny and
have few frontend consumers), regenerate, and confirm the frontend can import a named type
from it. Record both decisions in this file as part of the slice.

**Slices 2..N — one per route module, parallelisable after slice 1.**
`account`, `account-consent`, `admin`, `auth`, `client-logs`, `config`,
`contest-entry-picks`, `contest-management`, `contests`, `drafts`, `email`, `events`,
`golf`, `history`, `ingestion`, `invitations`, `leagues`, `notifications`, `participants`,
`sport-catalog`, `squads`, `team-invitations`, `version`.

Each slice: register that module's DTOs as named components → `api:refresh` → replace its
frontend consumers' derivations with imports → delete the now-dead local aliases → tests at
every layer crossed.

Per-slice, also resolve that module's share of **#149** (loose `ZodTypeAny` / `z.unknown`).
A loose Zod type publishes as `unknown`, which defeats the point of naming the schema. It is
cheaper to fix while already editing the schema than as a second pass.

Sizing note: `admin` (685 lines of DTO) and `admin-golf` (649) are far larger than the rest
and should be split further when they are picked up. `contests` (462) and `leagues` (362)
are the next tier.

**Final slice — enforcement.**
Lint rule banning `Responses[...]` indexing in `features/**`, so the old pattern cannot
return. Retire `poolmaster/no-duplicate-feature-types` if the class of problem is gone, or
keep it as a backstop and say why.

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
