# 131 — hey-api nullable (`| null`) generation fix

**Bead:** pool-master-m32
**Status:** implemented (Fix 2) on branch `fix/pool-master-m32-hey-api-nullable`, 2026-09-03 —
per user go-ahead in the research review session. §4/§5 kept as written for the record.
**Author:** research pass 2026-09-03

### Implementation summary (Fix 2)

- `packages/shared/openapi/nullable-to-3-1.ts` (+ `openapi/index.ts`, exported as
  `@poolmaster/shared/openapi`) — `rewriteNullableToOpenApi31` helper: recursive
  `nullable: true` → 3.1 type-array / `anyOf` null-branch, **and adds `null` to any
  `enum` array** (under 2020-12 `enum` is validated independently of `type`, so
  `{ type: [T,"null"], enum: [...] }` alone still forbids null and hey-api drops the union).
- `packages/core-api/scripts/export-openapi.ts` + `packages/mock-contest-feed-provider/scripts/export-openapi.ts`
  import it from `@poolmaster/shared/openapi` and call it before writing the spec. Doc stays
  `openapi: 3.1.0`. `@poolmaster/shared` added to the mock provider's deps.
- `tests/unit/shared/openapi-nullable-3-1.test.ts` — unit-tests the helper on every shape
  (incl. nullable enums and allOf-wrapped enums) **and** asserts on the committed artifacts:
  `openapi.json` has zero `"nullable"`; no `type:[T,"null"]`+`enum` node omits `null`;
  `hey-api/types.gen.ts`'s `| null` line count ≥ `api-types.ts`'s; `matchKeyword` / `price` /
  `memberType` carry `| null` in the SDK.
- `npm run api:refresh` regenerated: `openapi.json` (798 `nullable: true` → 3.1 encoding,
  large textual diff), `hey-api/types.gen.ts` (**+777 `| null`**, incl. the 18 nullable-enum
  slots — `memberType`, `inactiveReason`, account `timeFormat`/`dateFormat`, …; 8 stale JSDoc
  comments fixed; no double-`| null` artifacts), `api-types.ts` (`(T | null) | null` collapsed
  to `T | null`, recovered `Format: date-time` JSDoc; `| null` line count 777, now matched by
  the SDK). No new frontend/test typecheck fallout from the enum slots.
- Test harness (not in the §2.3 frontend-only count — that scan was `clients/poolmaster/src`
  only): `tests/functional/builders.ts` (hand-rolled league shape → `description?: string | null`)
  and `tests/functional/golf-admin-tournament.functional.ts` (6 null-guards for
  `seedNumber` / `worldRanking` / `oddsToWin` / `tierOrderIndex`). Confirmed via a
  `tsc -p tests/tsconfig.json` before/after diff that no other `tests/` file regressed.
- Frontend: the 14 predicted `tsc` errors fixed in 5 golf-admin files + 1 test —
  `golf-tier-board-utils.ts` (`TierCard.worldRanking`/`oddsToWin` widened to `| null`,
  null-safe sort), `golf-tier-board.tsx` (`?? '—'` in the rank/odds line),
  `golf-round-score-upload-card.tsx` (guard `entry.before`/`entry.after`),
  `golf-tournament-score-source-card.tsx` (guard `scoreSource` alongside the existing
  `syncScope` check — keeps behaviour and the existing test fixtures),
  `golf-league-details-card.tsx` (`matchKeyword ?? undefined` at two form sites),
  `golf-tier-board-utils.test.ts` (`(e.price ?? 0) + 1`).
- Verified green — full pre-commit gate set (re-run after the enum fix-forward):
  `turbo typecheck --force` (6/6); `eslint … --max-warnings 0`; `jest` unit (834/834);
  `test:service:functional-api` (60/60, with `DATABASE_URL` set); `test:poolmaster:unit`
  (491/491). Plus `api:check` fresh, `rules:check` (no new findings), mock-provider regen
  (zero diff — no nullable fields).

### Review fix-forward (Riley Pass, REQUEST CHANGES → addressed)

- **HIGH / CONTRACT** — nullable *enum* fields (`z.enum(...).nullable()` /
  `z.nativeEnum(...).nullable()`, 18 slots incl. `LeagueDto.memberType`) still generated
  without `| null`: `{ type: [T,"null"], enum: [...] }` doesn't permit null under 2020-12.
  Fixed by also pushing `null` into the `enum` array; SDK `| null` line count now equals
  api-types.ts (777). Verified with a scratch hey-api run (`enum: [...,null]` → `… | null`).
- **MEDIUM / TEST** — regression guard only checked "no `nullable` keyword". Added the
  enum-node assertion and the `hey-api ≥ api-types` `| null` line-count assertion (would have
  caught the enum gap), plus representative-field checks.
- **MEDIUM / ARCH** — helper moved from `packages/core-api/src/openapi/` to
  `packages/shared/openapi/` (exported as `@poolmaster/shared/openapi`); both export scripts
  import the package path, no `scripts/` → other-package-`src/` hop. Test moved to
  `tests/unit/shared/`.
- **LOW** — `wrapWithNullBranch` / multi-member composition branches remain synthetic-only
  (the real spec produces no `anyOf`); kept as defensive, unit-tested, noted in the helper's
  doc comment.

### Follow-ups surfaced during implementation

- **Sub-schema dedup leak** (pre-existing, separate bead): `AdminGolfRoundScoreValuesDtoSchema`
  is used once `.nullable()` (`before`) and once bare (`after`), but `zod-to-json-schema` /
  `json-schema.ts` ref-resolution lets `nullable: true` land on both, so the spec — and now
  the generated type — says `after: {...} | null` when the DTO says non-null. Frontend guards
  it for now. Fixing the leak in `packages/shared/dto/json-schema.ts` is its own task.
- Golf tournament test fixtures set `scoreSource: { providerId: '', externalId: '' }` while
  `syncScope: 'NONE'`; per the DTO `scoreSource` is `null` when unlinked. Not corrected here
  to keep this PR focused — worth a fixture cleanup pass.
- Stale committed `packages/mock-contest-feed-provider/scripts/export-openapi.{js,d.ts}` are
  not regenerated by `npm run build` (script runs via tsx); left as-is, pre-existing.

---

## 1. Problem statement

`@hey-api/openapi-ts` (`^0.95.0`, config `packages/shared/openapi-ts.config.ts`) drops the
`| null` union from **every** nullable field when generating
`packages/shared/generated/hey-api/types.gen.ts`, even though the OpenAPI JSON it is fed
(`packages/shared/generated/openapi.json`) marks those fields `"nullable": true`.

- `hey-api/types.gen.ts` contains **0** occurrences of the string `null` — not one.
- `packages/shared/generated/api-types.ts` (generated from the *same* JSON by
  `openapi-typescript`) contains **777** `| null` unions. That generator is unaffected.
- First noticed on golf DTOs (`price: z.number().nullable()` → `price: number`) but confirmed
  systemic: `AdminGolfLeagueDtoSchema.matchKeyword: z.string().nullable()` → `matchKeyword: string`,
  and it hits every DTO family.

The frontend imports the **hey-api** SDK exclusively (`clients/poolmaster/src/lib/api.ts`
re-exports `@poolmaster/shared/generated/hey-api/index`; the `rules:check:no-parallel-api-types`
rule forbids importing `api-types.ts` from `clients/poolmaster/src`). So the wrong signatures
are what the whole frontend typechecks against, and latent "server can send `null` here"
bugs are currently invisible to `tsc`.

---

## 2. Blast radius (measured, not estimated)

### 2.1 Source DTOs

`packages/shared/dto/*.ts`, `.nullable()` **without** `.optional()` on the same field
(chain-aware count):

| File | nullable-but-required fields |
|---|---:|
| `admin-golf.dto.ts` | 47 |
| `contests.dto.ts` | 34 |
| `drafts.dto.ts` | 29 |
| `admin.dto.ts` | 12 |
| `events.dto.ts` | 9 |
| `version.dto.ts` | 4 |
| `live-score.dto.ts` | 3 |
| `contest-management.dto.ts` | 3 |
| `auth.dto.ts` | 1 |
| `leagues.dto.ts` | 1 |
| **Total** | **143** |

Plus **79** fields that are `.nullable().optional()` — also mis-generated (hey-api emits
`field?: T` where the correct shape is `field?: T | null`). Lower severity (callers already
have to handle `undefined`), but they get fixed for free by the same change.

### 2.2 Generated SDK

Regenerating with the fix (see §4) adds **759** `| null` field-slots spread across **120**
exported generated types (`*Data` request types and `*Responses` response types). Current
count in the committed file: **0**. `openapi.json` carries **798** `"nullable": true`
markers. So the drop rate today is effectively **100%**.

### 2.3 Frontend typecheck fallout

`cd clients/poolmaster && npx tsc --noEmit` today: **clean (exit 0)**.
With the corrected `types.gen.ts` swapped in: **14 errors, 5 files, all under
`clients/poolmaster/src/features/root-admin/` (golf admin only)**:

| File | errors | nature |
|---|---:|---|
| `golf-tier-board-utils.ts` | 4 | `price` (`number \| null`) assigned to a local `number` field; `tierOrderIndex` (`number \| null`) used in `.sort()` arithmetic |
| `golf-round-score-upload-card.tsx` | 4 | `entry.before` / `entry.after` (`AdminGolfRoundStandingDtoSchema.nullable()`) dereferenced (`.strokes`, `.status`) with no guard |
| `golf-league-details-card.tsx` | 3 | `league.matchKeyword` (`string \| null`) fed into a react-hook-form `defaultValues` / `form.reset` typed `string \| undefined`; `editSchema` too narrow |
| `golf-tournament-score-source-card.tsx` | 2 | `tournament.scoreSource` (`.nullable()`, "null when unlinked") dereferenced; code branches on `syncScope === 'NONE'` but TS can't narrow from that |
| `golf-tier-board-utils.test.ts` | 1 | `e.price` possibly null in an assertion |

Error codes: 9× `TS18047` (possibly-null deref), 4× `TS2322` (not assignable), 1× `TS2345`.

Every one is a genuine latent null-safety gap that the wrong type was masking. The set is
**contained to one feature area**, touches **no shared UI primitive** and **no league-facing
code**, and is small enough to fix in **one pass** — no field-by-field staging needed.

---

## 3. Root cause

**This is a spec-labelling bug on our side, not a version-dependent `@hey-api/openapi-ts` defect.**

1. `packages/shared/dto/json-schema.ts` runs `zod-to-json-schema` with `target: 'openApi3'`,
   which emits **OpenAPI 3.0-style** schemas: nullability as `{ "type": "string", "nullable": true }`.
2. `@fastify/swagger@9.7.0` also emits a structurally **OpenAPI 3.0.3** document — its
   `lib/spec/openapi/` generator defaults `openapi: '3.0.3'`, converts `const` → `enum`,
   rewrites `definitions` → `components/schemas`, and has **no** 3.1 code path. Verified: the
   exported `openapi.json` contains **no** 3.1-only constructs (no `webhooks`, `const`,
   `prefixItems`, `type` arrays, `$ref` siblings, `examples`, `patternProperties`, `$schema`).
3. But `packages/core-api/src/plugins/swagger.ts:14` hard-codes the version **string** as
   `openapi: '3.1.0'` (comment: *"@fastify/swagger uses 3.1.0"* — inaccurate; the string is
   fully caller-controlled and the body is 3.0.3).
4. `@hey-api/openapi-ts` dispatches its parser on that version string: `>=3.0.0 <3.1.0` →
   3.0 parser (honours `nullable: true`); `>=3.1.0` → 3.1 / JSON-Schema-2020-12 parser, which
   has **no handling for the 3.0-only `nullable` keyword** and silently discards it.
5. `openapi-typescript` is lenient and honours `nullable: true` regardless of the declared
   version, which is why `api-types.ts` stayed correct and masked the mismatch.

### Confirming experiment (scratch)

| # | Spec fed to hey-api | hey-api ver | `| null` in `types.gen.ts` |
|---|---|---|---:|
| **A** | committed spec as-is (`openapi: 3.1.0` + `nullable: true`) | 0.95.0 | **0** |
| **A′** | committed spec as-is | **0.97.3** | **0** |
| **B** | same bytes, only `openapi` string → `"3.0.3"` | 0.95.0 / 0.97.3 | **759** |
| **C** | keep `openapi: 3.1.0`, rewrite every `nullable: true` → `type: [T,"null"]` / `anyOf` null branch | 0.95.0 / 0.97.3 | **759** |

Takeaways:

- **hey-api fully supports OpenAPI 3.1** (variant C). Feed it *valid* 3.1 nullability and it
  emits `| null` correctly, on both the pinned 0.95.0 and the current 0.97.3.
- **Upgrading hey-api does NOT fix this** (variant A′): 0.97.3 on our *actual* committed spec
  still produces 0 `| null`. It can't — a newer 3.1 parser will still, correctly, ignore the
  `nullable` keyword that OpenAPI 3.1 removed. (0.98/0.99 additionally crash on this machine
  through the normal toolchain — `Cannot read properties of undefined (reading 'AnyKeyword')`
  — so "just bump to latest" is not even runnable right now without separate work.)
- **`openapi-typescript` output is byte-identical** across A / B / C and matches the committed
  `api-types.ts` — that generator honours `nullable: true` regardless of the declared version,
  which is why `api-types.ts` stayed correct and hid the mismatch.
- **Variant C also *fixes* pre-existing wrong JSDoc** in the generated file: today `types.gen.ts`
  labels 4 distinct golf leaderboard-round columns all as *"Round 1 leaderboard column"* and
  collapses two different date fields both to *"When the invite stops being valid…"*. That is
  a description-dedup artifact of the `nullable: true` encoding making sibling schemas look
  identical. The 3.1 `type: [T,"null"]` encoding keeps them distinct, so C's 16-line delta vs
  baseline (beyond the `| null` additions) is entirely JSDoc *corrections*. Variant B (relabel)
  leaves that misattribution in place.

`@hey-api/openapi-ts` GitHub issue [#1639](https://github.com/hey-api/openapi-ts/issues/1639)
("required fields that are nullable generate without `| null`", OpenAPI 3.0) was **closed as
not planned**. Issue [#2759](https://github.com/hey-api/openapi-ts/issues/2759)
("nullable=true or oneOf with nullable") is the same theme. Both are consistent with: hey-api
expects the document to be valid for the version it declares.

---

## 4. Fix options

**We do not have to leave OpenAPI 3.1, and no package upgrade helps.** The problem is that
the document declares 3.1 but encodes nullability with `nullable: true`, a keyword that
OpenAPI 3.1 **removed** (3.1 uses `type: ["string", "null"]`). The fix is to make the
encoding match the declared version. Options below, best first.

### Fix 2 — emit real 3.1 nullability, stay on `openapi: 3.1.0`  ★ recommended

In `packages/core-api/scripts/export-openapi.ts`, after the spec object is built (alongside
the existing `resolveRefs` walk), run one more recursive pass that rewrites 3.0-style
nullability into 3.1-style and keeps `openapi: '3.1.0'`:

- `{ type: "<t>", nullable: true, … }` → `{ type: ["<t>", "null"], … }`
- `{ type: ["<t>", …], nullable: true }` → append `"null"` to the array
- `{ allOf|oneOf|anyOf|$ref … , nullable: true }` (no own `type`) →
  `{ anyOf: [ <the wrapper, nullable stripped>, { type: "null" } ], … }`
- delete the `nullable` key in every case

Our spec only contains **8 distinct nullable shapes** (§enumerated: mostly `type` + `format`/
`minimum`/`maximum`/`enum`/`properties` siblings; 29 `allOf` wrappers; no bare `$ref+nullable`,
no `oneOf/anyOf+nullable`), so the transform is ~20 lines and fully covers the surface.
Apply the same helper in the mock provider's export script for parity.

Then `npm run api:refresh`.

**Measured net effect (variant C, verified on hey-api 0.95.0 *and* 0.97.3):**

- `openapi.json`: every `"nullable": true` (798) becomes a `"null"` entry in a `type` array or
  `anyOf`. Larger textual diff, but a faithful, mechanical 3.0→3.1 nullability translation.
- `hey-api/types.gen.ts`: **+759** `| null` unions **plus** the JSDoc misattributions fixed
  (see §3 — "Round 1" ×4 → "Round 1/2/3/4"; invite/invitation date descriptions). Strip the
  `| null` and the only remaining delta vs today is those description corrections.
- `hey-api/sdk.gen.ts`, `hey-api/index.ts`: unchanged.
- `api-types.ts`: **byte-identical** to the committed file (verified — `openapi-typescript`
  produces the same output from the 3.1-encoded spec).
- No `@hey-api/*`, `@fastify/*`, or `zod-to-json-schema` version change.

**Effort:** Small. ~20-line transform in one script (+ the shared helper reused for the mock
provider) + `api:refresh` + fix the 14 frontend errors in §2.3 + update 1 test. Single PR.

**Risk:** low. The transform only touches the *exported* spec, not the schemas Fastify uses
for request/response validation at runtime (those are the separate `zodToJsonSchema(...)`
calls in `routes.ts`). `/apidoc` (swagger-ui) renders 3.1 fine. Main thing to get right is
transform coverage — mitigated by asserting `grep -c '"nullable"'` on the exported spec is
**0** in `check-openapi-fresh` / a unit test.

### Fix 1 — relabel the version string to `openapi: 3.0.3`  (minimal fallback)

`@fastify/swagger@9.x` has no 3.1 emitter — it *defaults* to `openapi: '3.0.3'`, does
`const`→`enum`, `definitions`→`components/schemas`, and our exported body contains **no**
3.1-only constructs (no `webhooks`, `const`, `type` arrays, `$ref` siblings, `examples`,
`patternProperties`, `$schema`). So the body is already a 3.0.3 document and the `'3.1.0'`
string in `packages/core-api/src/plugins/swagger.ts:14` (and mock provider `src/swagger.ts:8`)
is simply inaccurate. Change both to `'3.0.3'`, `npm run api:refresh`.

- **Net effect:** `openapi.json` 1 line; `hey-api/types.gen.ts` +759 `| null` and otherwise
  **byte-identical** (`sed 's/ | null//g'` == current — not even the JSDoc changes); `sdk.gen.ts`/
  `index.ts`/`api-types.ts` byte-identical. Smallest possible diff.
- **Cost:** it is a real (if only nominal) step back to 3.0.3, and it does **not** fix the
  pre-existing JSDoc misattribution that Fix 2 cleans up.
- Pick this only if the larger `openapi.json` diff from Fix 2 is judged not worth it. No test
  asserts on the `3.1.0` string (`grep -rn "3.1.0"` → only the two config lines).

### Fix 2b — change the `zod-to-json-schema` target  (viable, wider blast radius)

`packages/shared/dto/json-schema.ts` forces `target: 'openApi3'`, which is why `.nullable()`
serialises as `nullable: true`. The library's **default** target (`jsonSchema7`) already
emits `{ "type": ["string", "null"] }` — 3.1-correct — with no post-processing.

Not recommended as the primary path because that `zodToJsonSchema` wrapper also feeds
**Fastify's runtime request/response validation** (`zodToJsonSchema(Schema)` in every
`modules/*/routes.ts`), and `target` affects far more than nullability (unions, records,
`.default()`, `$ref`/`allOf` composition, tuples). Switching it changes what the API
validates against at runtime and needs a full route-surface + contract-test pass. Fix 2's
export-only transform gets the same generated output without touching validation. Revisit 2b
only as part of a deliberate "emit genuine JSON-Schema-2020-12 everywhere" effort.

### Fix 3 — patch `types.gen.ts` after codegen  ✗ rejected

Post-generation regex/AST step that re-adds `| null`. Fragile (must re-derive nullability the
generator discarded), fights the tool on every bump, and breaks the `check-openapi-fresh`
byte-comparison unless reproduced there. No upside over Fix 2.

### Fix 4 — hand-widen the exported types  ✗ rejected

Manually edit 759 slots across 120 generated types. Not maintainable; wiped on the next
`api:refresh`. Non-starter.

### Version bump  ✗ does not fix this

Verified: `@hey-api/openapi-ts@0.97.3` on our actual committed spec still yields **0** `| null`
(variant A′). A newer 3.1 parser correctly keeps ignoring the removed `nullable` keyword.
0.98/0.99 also crash on this machine through the normal toolchain. A bump is orthogonal to
this fix and can be evaluated separately on its own merits.

---

## 5. Recommendation

**Fix 2 (real 3.1 nullability, stay on `openapi: 3.1.0`), size Small, single PR.**
Fall back to **Fix 1** (relabel to 3.0.3) only if the reviewer prefers the minimal
`openapi.json` diff over staying on 3.1. Both restore the identical 759 `| null` unions with
the current pinned `@hey-api/openapi-ts@0.95.0` — no package upgrade, and no upgrade would
help (§4, variant A′).

Steps:

1. Add the 3.0→3.1 nullability transform to `packages/core-api/scripts/export-openapi.ts`
   (rules in §4 Fix 2), and reuse the helper in the mock provider's export script.
2. `npm run api:refresh`; commit regenerated `openapi.json` + `hey-api/**` (+ mock provider
   `generated/**`).
3. Add a guard so this can't silently regress: assert the exported spec contains **0**
   `"nullable"` occurrences (unit test and/or a check in `scripts/check-openapi-fresh.mjs`).
4. Fix the 14 `tsc` errors in the 5 golf-admin files (§2.3): null-guard `entry.before/after`
   and `tournament.scoreSource`; widen the 2 local types in `golf-tier-board-utils.ts` (or
   null-coalesce in the sort + card mapping); widen `editSchema` / coalesce `matchKeyword`
   in `golf-league-details-card.tsx`; update `golf-tier-board-utils.test.ts`.
5. `npm run api:check`, frontend `typecheck`, golf-admin test suites, and `/apidoc` all green.

**Why Small:** ~20-line transform in one script with a fully-measured effect (759 `| null`
added + 8 stale JSDoc comments fixed, nothing else — `api-types.ts` byte-identical); frontend
fallout is 14 mechanical fixes in one contained feature area; no runtime-validation change
(the transform touches only the exported spec); no shared-contract semantics change (the
server already sends these nulls — the types just catch up).

### Low-confidence / open items

- **Runtime `null` handling in the 5 files** — this plan sizes the *typecheck* fix. Whoever
  implements should sanity-check that a guard (vs. `?? 0` / `?? ''`) is the right product
  behaviour per field (e.g. an unpriced golfer in the tier board — show blank vs. `0`?).
  Likely trivial, but it's a product call, not a mechanical one.
- **Transform coverage** — built against the 8 nullable shapes present today (§4 Fix 2). The
  `"nullable"`-count assertion in step 3 catches any shape the transform misses now or later.
- **`/apidoc` + contract tests** — no version-string assertions found in the repo; still
  eyeball swagger-ui after the change.
- **Mock provider** currently has no nullable fields, so its parity change is unverified
  against real fallout — precautionary.
- **`.nullable().optional()` (79 fields)** get corrected to `?: T | null` by the same change;
  the 14-error count is the full frontend delta from variant C (which already includes them),
  so no separate number is expected — but confirm during implementation.
- **Fix 2b (`zod-to-json-schema` target)** is the "cleanest in principle" route and would
  make *all* emitted schemas genuine JSON-Schema-2020-12, but it also changes runtime
  validation shapes — worth a dedicated spike later, not part of this fix.
