# Plan 135 — Rule Scanners to ESLint

**Tracking issue:** #134

## Purpose

Migrate the bespoke rule scanners to ESLint rules where the rule is expressible there, so
violations surface at write time in the editor rather than at push time in CI.

The repo has 13 custom scanners under `scripts/check-*.mjs`, wired through
`npm run rules:check`. The instinct — repo conventions as executable checks rather than
prose in a CONTRIBUTING file — is right and under-adopted. The implementation is the
problem: a Node script that greps the tree gives no editor feedback, no autofix, and no
per-line escape hatch with a recorded justification.

## Governing Principles

- **Feedback belongs as close to authoring as possible.** A squiggle while typing beats a
  CI failure after push.
- **An escape hatch with a justification beats no escape hatch.** `eslint-disable-next-line`
  with a reason comment is reviewable; a scanner allowlist buried in a script is not.
- **Not everything is an ESLint rule.** Project-wide analysis and non-code checks stay
  scripts, and saying so explicitly is part of the design.

## Key Decisions

### 1. Three-way split of the current scanner set

> ## ⚠ Flat config does not merge rule options — read before writing any config
>
> A later `{ files: [...], rules: { 'no-restricted-syntax': [...] } }` block does not add to
> the top-level one — it **replaces** it, silently, inside that scope.
>
> **The precise boundary**, measured with `--print-config` after a fourth agent contradicted
> the first statement of this warning. It said "the last matching object wins outright,"
> which is too strong and would make people restate options they do not need to:
>
> | Later entry | Earlier options |
> |---|---|
> | bare severity — `'rule': 'error'` | **retained** → `[2, {…inherited}]` |
> | options array — `'rule': ['error', {}]` | **discarded** → `[2, {}]` |
>
> So severity-only overrides and additive plugin blocks (new rule names) are safe. The trap
> is specifically a scoped re-declaration *with* an options array.
>
> `eslint.config.js` already carries `no-restricted-syntax` at top level (the slice-1 cast
> selectors). **Five remaining migration targets are proposed as `no-restricted-syntax`**
> — `no-inline-query-keys`, `no-inline-theme-styles`, `shared-ui-controls`,
> `no-env-fallbacks`, `feature-theme-tokens`. Adding any of them as a path-scoped block
> disables the cast rules in that path while `npm run lint` stays green and nothing
> reports the loss.
>
> Confirmed independently four times: a scoped block declaring its own array drops the
> inherited selectors; spreading them back in restores both. The fourth check is the one
> that narrowed the claim — it also verified with `--print-config` that appending
> `tseslint.configs.recommendedTypeChecked` leaves `no-restricted-syntax`,
> `no-restricted-globals`, `no-restricted-imports`, the `no-unused-vars` `argsIgnorePattern`
> **and** the test-file exemption all intact, because those presets set overlapping rules as
> bare severities. The only casualties there are `no-empty-object-type` and
> `no-require-imports` flipping back on, both at 0 findings.
>
> **Mitigated in advance.** `eslint.config.js` now hoists its selectors into a module-level
> `CAST_SELECTORS` constant with the rule written into the file's header comment: any scoped
> re-declaration must spread it —
> `'no-restricted-syntax': ['error', ...CAST_SELECTORS, ...YOUR_SELECTORS]`.
>
> This is the slice-1 "confident, wrong 0 findings" failure in a new costume: the loss is
> invisible from CI. Treat a green lint after adding a scoped block as unproven until a
> positive control shows the inherited selectors still fire.


**Already covered by existing plugins — near-free:**

> **Standing correction from slice 1: verify every proposed replacement against the
> real tree before trusting this table.** Two of the three rows below were wrong, and
> the first was wrong in the worst possible way — a replacement that looked obviously
> equivalent and would have caught *nothing*. The table was written from what the rules
> are named, not from what the scanners actually matched. Assume the remaining rows
> carry the same defect until each is diffed.
>
> The verification that works: run the scanner, run the candidate ESLint rule over the
> same tree, and diff the two result sets. A rule is a faithful port only if it is a
> superset of the scanner's findings *and* every extra is explainable.
>
> Two traps that produce a confident, wrong "0 findings" during that check — both hit
> in slice 1: an ESLint config outside the repo cannot resolve `typescript-eslint` and
> fails to load, and `--format compact` no longer ships with ESLint core. Either
> swallows all output. Never read a bare 0 as "the rule found nothing" without
> confirming the run happened.

| Scanner | Replacement |
|---|---|
| ~~`check-unsafe-casts`~~ | **Migrated and deleted (slice 1)** — but *not* by the rules originally proposed here. The proposal was `@typescript-eslint/no-explicit-any` and the `no-unsafe-*` family; measured against the tree, that would have caught **0 of 20** findings. Every one was `as unknown as`, which involves no `any` at all, and the `no-unsafe-*` family needs type information and catches *consequences* of `any` values rather than double assertions. What works is `no-restricted-syntax` with `TSAsExpression > TSAsExpression[typeAnnotation.type="TSUnknownKeyword"]`, plus a second selector on `TSAnyKeyword` for the `as any` half. |
| ~~`check-no-non-sdk-fetch`~~ | **Migrated and deleted (slice 1).** `no-restricted-globals` / `no-restricted-imports` as proposed, and this row was correct — with one caveat found by testing: `no-restricted-globals` flags *any reference* to the global, including `fetchImpl: typeof fetch = fetch`, a dependency-injection test seam that the scanner's `fetch\s*\(` correctly ignored. Ported rules can be *less* precise, not only more. |
| `check-test-disable-discipline` | **Not a migration — see *The test-disable row is a policy change* below (#158).** The scanner does not ban skipped tests, it bans *undocumented* ones, and it also flags whole skipped files and directories. `no-disabled-tests` has no concept of either. Adopting it makes skips unconditionally illegal. Decide that on purpose or keep the scanner. |

**Custom ESLint rules — good fit:**

| Scanner | Approach |
|---|---|
| `check-route-discipline` | **Researched in depth — the proposal here is wrong; see *Route discipline, measured* below.** `no-restricted-imports` for Prisma catches **0 of 17** findings. No custom rules are needed: all patterns are plain `no-restricted-syntax` selectors. |
| `check-no-inline-query-keys` | `no-restricted-syntax` on array literals in `queryKey:` position |
| `check-no-inline-theme-styles` | `no-restricted-syntax` on style props carrying raw color literals |
| `check-shared-ui-controls` | `no-restricted-syntax` on bare JSX controls where a shared primitive exists |
| `check-no-env-fallbacks` | `no-restricted-syntax` on `import.meta.env.X ?? …` and `process.env.X ?? …` |
| `check-no-duplicate-extract-error-message` | `no-restricted-imports` plus a local-redeclaration rule |
| ~~`check-test-traceability`~~ | **Retired, not migrated.** Plan 138 landed Option B: the UC/BR requirement is dropped and the surviving one — defect-fix tests cite their issue number — is not mechanically detectable, since no scanner can tell which tests are defect-fix tests. Nothing to port. |

### 1v. Slice 2 landed: the plugin exists, two rules migrated

`eslint-rules/` holds the local plugin. Two scanners are deleted and replaced by named
rules, each with its own `files`/`ignores` transcribed from that scanner's exclusion list —
which is the whole reason for §1z's plugin decision, since distinct rule ids compose where a
second `no-restricted-syntax` block would have replaced the first.

| Rule | Replaces | Verification |
|---|---|---|
| `poolmaster/no-inline-query-keys` | `check-no-inline-query-keys` | **Exact match, line for line.** Four planted shapes — plain, `as const`, quoted key, parenthesized — scanner reported `:4 :7 :10 :13`, rule reported the same. |
| `poolmaster/no-mocked-api` | `check-no-mocked-api` | **Strict superset.** Scanner 1, rule 2 on the same fixture: the rule also catches `jest.mock`, which the scanner never matched despite the backend running Jest. |

A green `npm run lint` after wiring proved nothing on its own — both scanners were already at
zero, and "both report 0" is exactly the false signal §1y warns about. The verification above
is planted violations, which is the only way a zero-finding scanner can be checked.

**RuleTester tests** live in `eslint-rules/__tests__/run-rule-tests.mjs`, spawned by a Jest
wrapper because the rules are ESM and the backend suite transpiles to CommonJS — the same
reason the scanner tests spawn their scripts.

**A test spawned a deleted scanner**, exactly as in slice 1. `query-keys-factory.test.ts`
ran `check-no-inline-query-keys.mjs` against a temp tree. Its rule-logic half is now
RuleTester's; its *scope* half — that `lib/query-keys.ts` is exempt — is config, not rule
logic, so it is now a `--print-config` assertion that the rule is `off` there and `error`
elsewhere. Worth keeping the pattern: when a scanner becomes a rule, its test usually splits
into a logic half and a config half.

**Slice 3 added three more**, each verified the same way:

| Rule | Replaces | Verification |
|---|---|---|
| `poolmaster/no-bare-ui-controls` | `check-shared-ui-controls` | **Strictly more precise**, as §1y predicted. Scanner `:4 :5 :6 :7`, rule `:4 :5 :6` — line 7 is a `<button>` inside a JSX comment, the scanner's one false positive. |
| `poolmaster/no-duplicate-extract-error-message` | `check-no-duplicate-extract-error-message` | **Exact match**, 2 and 2. The plan's `no-restricted-imports` half was dropped as inapplicable (§1y): the violation is a local *definition*, so there is no module to ban importing. |
| `poolmaster/no-inline-theme-styles` | `check-no-inline-theme-styles` | **Exact match**, 4 and 4 — and it catches what the plan's "raw color literals" wording would have dropped: `fontSize: 14`, `color: 'inherit'`, and a no-interpolation template. Correctly ignores `color: theme.accent` and `gap: 8`. |

**A scanner test spawned a deleted scanner for the second time.**
`frontend-rule-scanners.test.ts` ran `check-no-inline-theme-styles.mjs` twice. Same split as
slice 2: the rule-logic half moved to RuleTester, and the scope half (`.tsx` only, tests
excluded) is config. This is now three for three — **assume a scanner has a test that spawns
it, and grep before deleting.**

**Still to migrate:** `no-parallel-api-types` (migratable per §1b, but needs a config-load-time
read of the generated type names, which is a different shape from the four done so far), and
`feature-theme-tokens` (pairs with `no-inline-theme-styles`).

**Both blockers were answered and both scanners are now migrated** (see §1y below).
The owner's call: no fallbacks, error out instead; no skipped tests, no marker escape.

### 1z. The vehicle is wrong: use a local plugin, not `no-restricted-syntax`

**This supersedes the `no-restricted-syntax` proposal in every row below.** Measured against
planted violations in a mirrored fixture tree:

| Config shape | Planted violations | Caught |
|---|---|---|
| One `no-restricted-syntax` block per scanner, as this plan phrases it | 16 | **4** |
| Hand-computed union blocks per scope | 16 | 16 |

The naive layering silently lost query-keys, theme, controls, dup-extractor **and** the
slice-1 cast selectors — everything except the last matching block. `npm run lint` stayed
green throughout.

Spreading the inherited array (the `§1` mitigation) is necessary but **not sufficient**. The
five scanners have five *different* path scopes that overlap on every axis — query-keys
includes tests but excludes `lib/query-keys.ts`; theme is `.tsx` only and excludes tests;
controls is `features/**` minus `features/shared/ui/**` minus tests; dup-extractor excludes
`lib/errors.ts`; mocked-api's pattern appears **only** in test files. Making that work took
**seven** hand-maintained union blocks, and each new rule multiplies the partition.

A second, independent instance: the config's `{ files: [test globs], rules: {
'no-restricted-syntax': 'off' } }` block makes `check-no-mocked-api` **dead on arrival** as a
`no-restricted-syntax` rule, because its pattern only ever appears in tests.

**Write these as named rules in a local ESLint plugin.** Distinct rule ids never clobber each
other, so `files`/`ignores` composes per rule exactly as each scanner's exclusion list reads.
You also get real rule names in output, per-rule `eslint-disable`, and `RuleTester` unit
tests. Verified working on this ESLint (9.39.4). `no-restricted-syntax` keeps only the
slice-1 cast selectors.

### 1y. What the zero-finding scanners actually match

All seven verified by planting violations — a scanner at zero cannot be verified by running
it, since "both report 0" proves nothing.

| Scanner | Plan's description | What it actually does |
|---|---|---|
| `check-no-inline-query-keys` | accurate | 5 selectors needed (`as const` / `satisfies` / quoted key variants). Exact match. **106 live `queryKey` sites** — highest editor value. |
| `check-no-inline-theme-styles` | "raw color literals" | **Wrong.** It flags a literal of *any* kind on 14 named style props — `fontSize: 14` and `color: 'inherit'` are violations. Implementing the plan's wording would drop those. |
| `check-shared-ui-controls` | accurate | ESLint is **strictly more precise**: the scanner is a raw-text regex and flags `<button>` inside comments. Opposite direction from slice 1's `typeof fetch` case. |
| `check-no-duplicate-extract-error-message` | "`no-restricted-imports` plus a local-redeclaration rule" | `no-restricted-imports` is **not applicable** — the violation is a local *definition*; there is no non-canonical module to ban importing. Drop that half. |
| `check-no-mocked-api` | "uncertain; enumerated shapes expressible, general fake-data judgment not" | **Describes a scanner that does not exist here.** It is one regex for `vi.mock('@/lib/api')`. Nothing to split; fully expressible. Worth widening to `/^(vi\|jest)$/` since the backend still runs Jest. |
| `check-test-disable-discipline` | `eslint-plugin-vitest`/`-jest` + custom rule | Those plugins are **not installed**, and neither expresses the `SKIP:` comment half. One ~30-line custom rule reproduces the scanner byte-for-byte, including its off-by-one marker window. |
| `check-no-env-fallbacks` | "`import.meta.env.X ?? …` and `process.env.X ?? …`" | The `import.meta.env` half **is not in the scanner** — adding it is a scope expansion, not a migration. And see below. |

### 1x. `check-no-env-fallbacks` is failing open on two real violations

The scanner reports a clean tree. The ESLint equivalent finds two genuine instances of the
banned pattern, both confirmed by reading the source:

- `packages/core-api/src/core/logger.ts:50` — `process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development'`, split across three lines. The scanner is **line-based**, so a multi-line chain is invisible to it.
- `packages/core-api/src/modules/admin/health-service.ts:152` — `process.env.npm_package_version ?? '0.1.0'`. The scanner's regex hard-requires `[A-Z_][A-Z0-9_]*`, so a **lowercase env name** slips through.

This is the only one of the seven where ESLint finds bugs the scanner cannot, and it makes
the migration a bug fix rather than a refactor. Per "a scanner cannot migrate until its
findings are at zero", budget the two-line cleanup inside that slice.

**A trap in the other direction**, worth recording: the obvious encoding
`[right.type="Literal"][right.value!=""]` also matches *numeric* literals and flags
`Number(process.env.PORT ?? 3000)`, which the scanner deliberately allows as a tunable. Use
`[right.raw=/^['"].+['"]$/]`.

### 1w. Lint coverage gap — found here, fixed here

`npm run lint` globbed `packages/*/src/**/*.ts`, which missed **69 files under
`packages/shared/` outside `src/`** — the entire DTO layer, where the API contract lives —
plus the backend test corpus that `check-test-disable-discipline` walks. Migrating any
scanner without widening the globs would have converted a 673-file gate into a 491-file one.

This applied **retroactively to slice 1**: the cast rules never covered those files either.

Fixed: globs widened to `packages/**/*.ts`, taking coverage from 491 to **545 files**. Cost
was two `any` findings in `packages/shared/events/event-bus.ts`, a heterogeneous handler
registry where `unknown` rejects storing a typed handler and `never` stores but cannot be
called — both tried; now carrying a justification.

### 1v. Off-the-shelf plugins: seven free zeros, and where the scanner set does not overlap

A fourth research agent measured fourteen candidate plugins against the real tree in a
sandbox matched to the repo's eslint 9.39.4 / typescript 5.9.3. Filed as **#156** (adopt
the seven at zero), **#157** (`exhaustive-deps`), **#158** (the `tests/` scope and the
policy change above) and **#159** (a duplicate export the audit turned up). Recorded here
so the migration plan is not written as though ESLint's ecosystem does not exist.

**Seven plugins find nothing today** — `react-hooks` (`rules-of-hooks`), `jsx-a11y`
(recommended plus two options), `import-x` (four graph rules), `react`,
`@tanstack/query` (six of seven), `vitest`, and `jest` (three discipline rules). Composed
into one bundle in shipping shape and run over 671 files: 0 findings, 0 fatal, each rule
confirmed on for the right file types via `--print-config`, each zero backed by a passing
positive control. `rules-of-hooks` in particular is a severe correctness rule the repo has
never enforced.

**Where they do *not* help, which matters more for this plan.** Of the eleven scanners
still live, exactly one has meaningful plugin coverage (`check-test-disable-discipline`,
and only its detection half — see below). `check-no-inline-query-keys`,
`check-no-mocked-api`, `check-shared-ui-controls`, `check-no-parallel-api-types`,
`check-no-duplicate-extract-error-message`, `check-no-env-fallbacks`,
`check-no-inline-theme-styles` and `check-feature-theme-tokens` have **no plugin
equivalent at all**. The local-plugin route in §1z is not a stopgap until something
off-the-shelf arrives; it is the only route for this repo's rules.

**Two of the repo's own conventions blind candidate rules**, which is worth stating
because it will recur:

- `@tanstack/query/exhaustive-deps` cannot see inside a query-key factory, so the
  `react-ui-rules.md` §4 mandate structurally hides the dependencies it checks. Its one
  finding (`my-team-history-page.tsx:127`) is a false positive caused by the repo
  following its own rule, and its zero elsewhere is weak evidence rather than a clean bill.
- `react-hooks/exhaustive-deps` demands whole query objects where `react-ui-rules.md` §5
  deliberately keys deps on narrow fields. Four of its ten findings are the rule being
  wrong; see #157.

**Three plugins are measured skips**, recorded so they are not re-researched: `n` (610
findings, 598 of them because it understands neither TS path aliases nor npm workspaces),
`security` (105 findings, 0% true-positive rate — both non-`detect-object-injection`
findings were read and both are false positives), and `unicorn` (2626 findings, and
`no-null` alone is 1435 of them against a codebase that uses `?? null` at every query
boundary).

**No merge-trap collisions.** All fourteen candidates were checked against the six rule
names this repo declares. Not one plugin declares any of them, so the §1z hazard does not
extend to plugin adoption in either order.

### 1u. The test-disable row is a policy change, not a migration

`check-test-disable-discipline.mjs` does not ban skipped tests. It bans **undocumented**
ones: it accepts any skip carrying an adjacent `SKIP: #<issue>` marker (or the legacy
`SKIP: pool-master-abc.1` form), and it separately flags whole skipped files and
directories. `no-disabled-tests` has a concept of neither.

So swapping the scanner for the plugin rule makes a skip **unconditionally illegal**
rather than illegal-unless-tracked. It costs nothing today only because the repo has zero
skipped tests — confirmed by grepping the scanner's own patterns across `tests/`,
`clients/` and `packages/`, which returns no matches. The first legitimately-deferred test
pays for it.

Either keep the scanner for the marker semantics and take the plugin rules as
belt-and-braces, or make the policy change deliberately and update
`rules/testing-rules.md`, where the `SKIP: #NN` convention is documented. Landing it
silently as a migration is the one option that is not available. Tracked in #158.

### 1t. The lint scope gap is not fully closed

§1w widened the glob from 491 to 545 files, closing the `packages/shared/` DTO gap. It did
not close the other one: **125 files under `tests/` — including 86 backend Jest test files
— are still unlinted**, plus one under `clients/poolmaster/e2e/`. The frontend test corpus
under `clients/` is covered; the root-level `tests/` tree is not.

That gap blocks two things in this plan: any `eslint-plugin-jest` adoption beyond the three
discipline rules (full recommended is 43 findings there), and the `check-test-disable-discipline`
decision above, since the scanner covers `tests/` and lint does not. Tracked in #158.

### 1a. Route discipline, measured

`check-route-discipline` has **6 patterns; only 4 fire.** Its 95 findings decompose as:

| Pattern | Findings | Verified ESLint equivalent |
|---|---|---|
| `prisma.*` calls | 17 | `CallExpression[callee.object.object.name="prisma"]` — **17/17, zero diff** |
| `SuccessSchema` | 24 | `Identifier[name="SuccessSchema"]` — superset (29; the 5 extras are `ImportSpecifier` double-counts) |
| `.map(` | 35 | `CallExpression[callee.property.name="map"]` — 35/35 same sites |
| inline `type:'object'` schemas | 19 | `ObjectExpression:has(> Property[key.name="type"][value.value="object"]):has(> Property[key.name="properties"])` — exact 1:1 |
| `additionalProperties: true` | **0** | free to port, lands at `error` immediately |
| `reply.send(await prisma.…)` | **0** | dead; subsumed by the prisma selector |

**Scope:** `packages/core-api/src/modules/**/{routes,handler,handlers}.ts` → 30 files. A bare
`**/{routes,handler,handlers}.ts` would wrongly capture `packages/mock-contest-feed-provider`
and `clients/_archived/web`.

**Why the plan's Prisma proposal fails.** The flagged `prisma` binding never comes from an
import of `@prisma/client` — it comes from `getAppPrisma(fastify)` or a `PrismaClient`
parameter. Only 2 of 30 route files import `@prisma/client` at all, and one of those has
**zero** prisma findings. `no-restricted-imports` would produce 2 findings, **none
overlapping the scanner's 17**, plus a new false positive. Same failure mode as
`check-unsafe-casts`: written from the rule's name, not from what the scanner matched.

**The honest backlog is 46, not 95.**

- `SuccessSchema` is **24/24 false positives** against the repo's own rule. `service-rules.md`
  requires `SuccessSchema` only for endpoints returning *domain data*; all 24 sites are
  mutations with no domain payload (`adminDeleteUser`, `logoutUser`, `pauseContestDraft`, …).
  The predicate is semantic and not statically decidable. **Delete the pattern** rather than
  add 24 disable comments.
- `.map()` broad-matches ~24 false positives, including **5 sites that already delegate to a
  mapper** — the scanner flags code doing exactly what the rule demands. Narrowed to
  callbacks returning an object literal it finds **11 real** sites.
- One prisma finding (`events/routes.ts:14`) is DI wiring, not a query; narrowing to
  `prisma.model.method()` drops it, leaving 16.

**`drafts/routes.ts` holds 47 of 95** in one 1493-line file, and its prisma and `.map()` work
overlap in the same functions — 10 of its 14 prisma findings sit inside exported helpers that
take `prisma` as a parameter, i.e. a repository living in a routes file. There is no drafts
mapper or repository today. **Slice that file on its own**, not as two tree-wide pattern
passes.

Suggested order: (a) port `additionalProperties` free and delete the two dead/false patterns;
(b) inline schemas, 19 → 0, an exact port so it is pure cleanup — budget for OpenAPI regen
fallout; (c) `drafts/routes.ts` as its own slice; (d) enable the narrowed prisma and `.map()`
rules tree-wide and delete the scanner.

### 1b. Corrections to the "stays a script" set

| Scanner | Plan said | Verified |
|---|---|---|
| `check-no-parallel-api-types` | stays a script | **Overturned.** It only matches *exact type-name collisions* against 942 generated names. `eslint.config.js` is an ES module and can read the generated file at config-load time and pass the name set to a ~12-line rule. Migratable now, zero backlog. Two costs to record: the editor's ESLint server must reload after `api:refresh`, and the rule is **weaker than `5xi.4` wants** — it catches name collisions only, so a local `ContestSummary` structurally duplicating `GetContestResponse` stays invisible. It finds 0 because it is narrow, not because the frontend is clean. |
| `check-openapi-fresh` | stays a script | **Holds.** Its subject is the delta between committed artifacts and freshly generated ones; ESLint has no phase in which the "expected" side exists. Correctly wired as `api:check`, not in `rules:check`. |
| `check-pr-review-triggers` | stays a script | **Holds** — it inspects the PR body, not the tree. Two defects found: it checks `result.status` but never `result.error`, so a missing `gh` yields a bare unexplained failure; and CI invokes the script directly rather than via the npm script, so editing the npm script would not change CI. |
| `check-feature-theme-tokens` | **unclassified** | Belongs in *custom ESLint rules — good fit*, merged with `check-no-inline-theme-styles` (they overlap on `style={{ color: '#fff' }}`). Zero backlog. Migrating it collapses `npm run lint` to a single `eslint` call and removes a `&&` that currently means the theme check never runs when ESLint fails. One regression to accept or mitigate: ESLint core cannot parse `.css` (vacuous today — 0 CSS files under `features/`). |
| `check-form-query-mirror` | "may not be worth it" | **Justification describes a different rule.** The plan defers it over an RHF field-count rule the scanner does not implement and never mentions; what it actually enforces is `react-ui-rules.md` *Server Data Form-State Hazard*. A second confirmed instance of the table being written from names rather than code. The port is an exact match, and **the scanner is 77 characters from failing open** — its regex caps the `useEffect` body at 1600 chars and the single real finding is 1523. It also misses 4 `.tsx` files outside `features/`. Its one finding is real but flagged for the wrong reason: the hazard named in the message is genuinely guarded, while a *different* clause of the same rule is violated — the latch keys on mount rather than entity identity, so navigating between two manage URLs keeps the previous contest's values. One-line fix. **Promote this to an early slice.** |

**After the migrations land, the surviving scripts contribute nothing to `rules:check`** —
`openapi-fresh` runs as `api:check` and `pr-review-triggers` is a PR-gated CI step. So
`rules:check` can eventually be deleted outright rather than shrunk.

**Stays a script — correctly so:**

| Scanner | Why |
|---|---|
| `check-no-parallel-api-types` | Requires cross-file knowledge of the generated types file; ESLint's per-file model fits badly |
| `check-openapi-fresh` | Regenerates artifacts into a temp dir and diffs — not a lint concern |
| `check-pr-review-triggers` (née riley-marker) | Inspects the PR body, not the tree |

**Uncertain, decide during execution:**

- `check-no-mocked-api` — the concrete patterns (`initialData: mockData`,
  `queryFn: async () => mockData`, `catch { return mockData }`) are expressible; the
  general "is this fake data" judgment is not. Likely a partial migration where ESLint
  catches the enumerated shapes and the script retains the broader sweep.
- `check-form-query-mirror` — the "more than two fields uses React Hook Form" rule is
  semantic enough that a faithful ESLint implementation may not be worth it.

### 2. ESLint severity replaces the warn-only baseline mechanism

Seven scanners currently run `--warn-only` with an acknowledged backlog, which means CI
passes while reporting known violations. ESLint has a native, better-understood version of
the same idea:

- ~~`"warn"` for rules with an existing backlog, surfaced in the editor without failing CI~~
- `"error"` for rules with a clean baseline
- ~~`--max-warnings 0` on a per-directory basis as areas get cleaned~~
- `eslint-disable-next-line` with a required description for genuine exceptions

**Corrected in slice 1.** The first and third bullets assumed a lint invocation this repo
does not have. `npm run lint` already runs a global `--max-warnings 0`, and the tree sits
at exactly zero warnings, so a `warn`-severity rule with any backlog fails CI on its first
run — "surfaced without failing CI" is not achievable as written.

The repo owner chose to **clear the backlogs rather than tolerate them**, so every migrated
rule lands as `error`. `@typescript-eslint/no-unused-vars` was promoted `warn` → `error` in
the same slice (baseline was 0, so it cost nothing) to keep the strictness uniform.

That makes the escape-hatch bullet load-bearing rather than incidental: with no warn tier,
a genuine exception has nowhere to go except an `eslint-disable-next-line` carrying its
reason. Slice 1 produced three, each with an inline justification — TanStack's invariant
`ColumnDef` (#150), a `fetch` DI seam reading a static asset, and a zod-to-json-schema
retype without which ts-jest fails `TS2589`.

**Consequence for later slices:** a scanner cannot be migrated until its findings are at
zero. Budget the cleanup as part of each slice, not as a follow-up.

This subsumes the baseline strategy Plan 123 was going to design.

### 3. This plan supersedes `pool-master-5xi.2`

Plan 123's epic and all four of its slices are `open` — none were ever started. The
scanners still run `--warn-only`, which is the observable confirmation. It is a recorded
findings document from June 2026, not work in flight, so there is no active lane to
disturb.

`pool-master-5xi.2` — "convert warning-only rule scanners into enforceable baselines" —
describes this plan's goal by a different mechanism. Migrating to ESLint *is* the
conversion to enforceable, because severity and disable-comments are the baseline
mechanism. The slice is closed as superseded.

**The rest of Plan 123 needs disposition too**, since it was written while the workflow was
being *strengthened* and parts of it now point the opposite way from Plans 132 and 133:

| Slice | Disposition |
|---|---|
| `5xi.1` Enforce shared lifecycle enum usage | **Goal still valid**, mechanism changes. It calls for "a blocking scanner for lifecycle literals in production app code" — under this plan that is an ESLint rule, not a script. Fold the rule into this plan's custom-rule set; the `SportEventStatus` shared-constant work stays its own slice. |
| `5xi.2` Convert warn-only scanners | **Superseded by this plan.** |
| `5xi.3` Implementation-analysis approval gate | **Dropped.** It required a pre-code analysis artifact — current code inventory, contract chain, file-by-file delta, reviewer evidence checklist — approved before coding starts, for any slice touching shared contracts or lifecycle behavior. That is substantial ceremony, proposed when the multi-pass review flow was being reinforced. Plans 132 and 133 remove ceremony on the grounds that it costs more than it returns; keeping both would be incoherent. Closed without implementation. |
| `5xi.4` Strengthen frontend generated-contract discipline | **Partly absorbed.** Its concrete ask — make API-shaped frontend models derive from generated operation response types — overlaps `check-no-parallel-api-types`, which this plan keeps as a script precisely because it needs cross-file knowledge. Worth keeping as a slice, scoped to strengthening that one scanner. |

Plan 123 is then deleted per ADR-0002, with `5xi.1` and `5xi.4` re-homed here and the
lifecycle-enum domain work tracked separately.

## Data Model / API Surface Implications

None.

## Dependencies

- **Plan 123** — unstarted; this plan absorbs or supersedes three of its four slices per
  decision 3. Not a blocker, but its disposition should land in the same effort so the
  plan file can be deleted rather than left implying work that has moved.
- ~~**The traceability revisit** — if traceability is retired, `check-test-traceability` needs no migration.~~ Settled: it was retired, so one migration target is gone. See `rules/testing-rules.md §1A`.
  Sequencing 138 first avoids building a rule that is then deleted.
- **Plan 136** — migrating to Vitest changes which test-lint plugin applies
  (`eslint-plugin-vitest` vs `eslint-plugin-jest`). Sequencing 136 first avoids configuring
  the wrong one.

## Execution Sequence

~~**First — the near-free migrations.**~~ **Partly done (slice 1).** `unsafe-casts` and
`no-non-sdk-fetch` are migrated and their scripts deleted; all 20 `as unknown as` findings
were fixed at the root first, which turned out to be four causes rather than twenty
problems — 17 of them one audit-log signature. The detection half of `test-disable`
remains, and is unverified against the tree.

The slice did "prove the approach on real violations" — including proving that the table
above could not be trusted without measuring. `test-disable` is now known not to be a
migration at all (§1u, #158).

**Insertable at any point — the off-the-shelf plugins (#156).** Seven plugins are at zero
findings today and depend on nothing else in this sequence. Landing them early buys
`rules-of-hooks` and the a11y rules before the custom-plugin work starts, and it stands up
the plugin-block config shape that §1z's local plugin will sit beside. See §1v.

**Second — custom rules, highest-traffic first.** Route discipline and the frontend rules
fire most and benefit most from editor feedback.

**Third — retire the migrated scripts** and shrink `rules:check` to the scripts that
remain.

**Fourth — Plan 123 disposition.** Close `5xi.2` as superseded, re-home `5xi.1`'s
lifecycle-literal rule and `5xi.4`'s scanner strengthening, drop `5xi.3`, and delete the
plan file per ADR-0002.

## Open Questions

- **Does `check-no-mocked-api` split or stay whole?** A partial migration means two homes
  for one rule, which the repo's own `§0` discourages. Keeping it whole as a script means
  the highest-value prohibition gets the weakest feedback loop.
- **Flat config or legacy?** The repo has `eslint.config.js`, suggesting flat config
  already. Custom rules in flat config are straightforward but the plugin-authoring shape
  differs from the legacy documentation most examples use.
- **Does the lint glob widen to `tests/`?** 86 backend Jest files are unlinted. This gates
  the `test-disable` disposition and any `eslint-plugin-jest` adoption past the three
  discipline rules. See §1t, #158.
- **Does `check-test-disable-discipline` keep its marker semantics?** §1u — the answer is a
  policy decision, not a technical one.

## Sources / Prior Decisions

- Plan 123 — Workflow Gate Hardening (`pool-master-5xi.2`, overlapping scope)
- Plan 136 — Test runner consolidation (determines the test-lint plugin)
- `rules/testing-rules.md §1A` — the landed traceability decision (retired one migration target)

---

## 1y. The two blocked scanners, resolved

Both blockers were product calls, and both were answered the same way: **fail loud rather
than absorb the problem.**

### `check-no-env-fallbacks` → `poolmaster/no-env-fallbacks`

The scanner matched one physical line with a regex and failed open on two live violations.
The AST rule finds the last operand of a `??`/`||` chain whose left side reads an env
object, so source wrapping is irrelevant.

Measured on a fixture carrying 8 planted violations and 6 shapes that must stay silent:

| | Caught | Missed |
|---|---|---|
| `check-no-env-fallbacks` (line-based) | 3 | 5 |
| `poolmaster/no-env-fallbacks` (AST) | 8 | 0 |

The five the scanner missed: a `??` chain split across lines, a lowercase env name (its
regex required `[A-Z_][A-Z0-9_]*`), computed access (`process.env['X']`), a conditional
tail (`?? (isCi ? 'ci' : 'development')`), and `||` in place of `??`. Neither tool flagged
any of the 6 allowed shapes (`?? ''`, numeric, identifier, `null`, an allow-listed name, a
chain with no literal tail).

Source fixes that unblocked it, all in `packages/core-api/src/`:

- `core/config.ts` gained `readAppEnv()` and `readServiceVersion()`, both throwing
  `RequiredEnvMissingError`, mirroring the existing `readJwtSecret()` shape.
- `core/logger.ts` lost `resolveEnvironment()` (the `?? 'development'` chain the scanner
  never saw) **and** `resolveServiceVersion()`, which was a second, silently-optional copy
  of the same version chain. Both now call the bootstrap readers.
- `modules/admin/health-service.ts` lost `?? '0.1.0'`.
- `LOG_LEVEL` is allow-listed by name: a wrong verbosity is a nuisance, not a deployment
  misreporting what it is. The allowance is a config entry, not a regex blind spot.

**Deployment consequence, stated plainly:** a process that sets none of `RELEASE_VERSION` /
`APP_VERSION` / `GIT_SHA` / `npm_package_version` now fails at startup. `npm_package_version`
is only set when the process runs through an npm script, so a container running
`node dist/index.js` needs an explicit variable. `.env.example`, `tests/setup.ts`,
`tests/integration/helpers.ts` and the CI workflow were all updated; a deployment manifest
outside this repo was not, and cannot be from here.

### `check-test-disable-discipline` → `poolmaster/no-disabled-tests`

The scanner banned *undocumented* skips; the rule bans skips. The `SKIP: #NN` escape is
gone, and `rules/testing-rules.md` §1C was rewritten around why: nothing ever reconciled a
marker against the issue it named, so a skip outlived its issue and stayed green, and
writing a comment was cheaper than fixing or deleting the test — which made the marker the
default resolution for anything that went red.

Migration cost was zero: **the repo had no skipped tests when this landed**, so the ban
locks in the existing state rather than demanding a cleanup.

The rule covers every scanner form plus `it.skip.each(...)` chains, and keeps the coarse-grain
half (`*.skip.test.ts` files, `skipped/` directories) by reporting on the file path.

**Coverage trap worth recording.** `npm run lint` globs `packages/**` and
`clients/poolmaster/src/**` — not `tests/`, which the scanner walked. Migrating the rule into
`eslint.config.js` alone would have left the gate listed, passing, and checking nothing over
the largest test tree in the repo. Adding `tests/**` to the main run instead surfaces 2773
pre-existing `recommendedTypeChecked` errors. `eslint.tests.config.mjs` runs the one rule over
`tests/` without type information; clearing that backlog, or exempting `tests/` from type-aware
linting, stays a separate decision. Verified by planting a skip in `tests/` and confirming the
gate exits 1 — a green gate over an empty tree proves nothing, which is the same lesson as §1x.
