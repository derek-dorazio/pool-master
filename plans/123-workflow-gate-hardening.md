# Workflow Gate Hardening

**Beads epic:** `pool-master-5xi`

## Purpose

PoolMaster's rules describe the right engineering behavior, but recent event
lifecycle review showed that the workflow does not reliably force those rules
into implementation or PR review outcomes.

This plan records the June 4, 2026 findings so a later hardening effort can
design and implement stronger gates without relying on chat history.

This plan is not an implementation plan for the Golf Results API flow. It is a
separate workflow-hardening lane.

## Triggering Findings

The Golf event completion discussion exposed several rule failures:

- Status/lifecycle comparisons exist as bare string literals in production
  application code even though the service rules require shared
  enums/constants.
- Review feedback identified `scheduled-event-reader.ts` comparing persisted
  event status with bare values such as `SCHEDULED`, `IN_PROGRESS`,
  `COMPLETED`, and `OFFICIAL`.
- Contest active/history classification currently uses `ContestStatus` even
  though the refined product rule depends on the linked sport-event closeout
  state. TypeScript accepts the code because `ContestSummaryDto.status` exists;
  the problem is that the DTO does not expose the lifecycle source required for
  the new behavior.
- PR review treated some rule violations as pre-existing and out of scope even
  when the slice depended on the same lifecycle semantics.
- Several rule scanners run in CI but are warning-only, so CI can be green
  while reporting known rule violations.

The core workflow failure is that Beads and plans record requirements and
acceptance criteria, but do not require a pre-code implementation analysis that
names exact files, contract surfaces, enum/constants, mappers, generated
artifacts, frontend consumers, and tests before implementation begins.

## Current Checker Inventory

### Generated API Freshness

Intent:

- Ensure DTO/route/OpenAPI changes are regenerated and committed.
- Preserve the contract chain:
  `Zod DTO -> route schema -> OpenAPI -> generated SDK/types -> frontend`.

Current implementation:

- `npm run api:check` runs `scripts/check-openapi-fresh.mjs`.
- The script regenerates OpenAPI and generated SDK/types in a temporary
  directory and compares them with committed artifacts.
- CI also runs `npm run api:validate`.

Gap:

- This gate proves generated artifacts are fresh.
- It does not prove that the modeled DTO is semantically sufficient for the
  product rule.
- It cannot catch frontend logic using the wrong exposed field, such as
  classifying contest history by `contest.status` when the rule requires linked
  event officiality.

Future requirement:

- Implementation analysis must explicitly identify when a product rule depends
  on a field that is not exposed by the generated DTO.
- PR review must verify that frontend lifecycle decisions use the approved
  contract field, not merely any available status-like field.

### Non-SDK Frontend HTTP Calls

Intent:

- Prevent frontend runtime code from bypassing the generated SDK with direct
  HTTP calls.

Current implementation:

- `npm run rules:check:no-non-sdk-fetch` runs
  `scripts/check-no-non-sdk-fetch.mjs`.
- The scanner rejects `fetch(`, `axios.`, and `new XMLHttpRequest(` in
  `clients/poolmaster/src`, with narrow infrastructure exceptions.

Gap:

- This gate only catches direct HTTP calls.
- It does not prove frontend data models are derived from generated response
  types.
- It does not detect semantic misuse of a generated field.

Future requirement:

- Keep this scanner, but do not treat it as sufficient evidence that frontend
  code follows generated contract discipline.
- Add review checklist or scanner coverage for generated response type
  derivation in pages/hooks that consume API data.

### Parallel Frontend API Types

Intent:

- Prevent frontend code from hand-maintaining duplicate API response/request
  types.

Current implementation:

- `npm run rules:check:no-parallel-api-types` runs
  `scripts/check-no-parallel-api-types.mjs`.
- The scanner collects type/interface names from
  `packages/shared/generated/hey-api/types.gen.ts` and fails when frontend code
  declares a local type/interface with the same name.

Gap:

- The check is name-based only.
- A local API-shaped type with a different name passes.
- A page can use a generated type correctly and still choose the wrong status
  field for the product rule.

Future requirement:

- Strengthen the rule or review process so API-shaped frontend models must
  derive from generated operation response types when they represent backend
  payloads.
- Explicitly separate mechanical checks from semantic review: no scanner can
  infer every product authority rule unless the implementation analysis records
  the intended field and reviewer checks it.

### Unsafe Casts

Intent:

- Prevent application code from bridging contract gaps with `as unknown as` or
  `as any`.

Current implementation:

- `npm run rules:check:unsafe-casts` runs
  `scripts/check-unsafe-casts.mjs --warn-only`.
- At the time of this plan, the scanner reports known findings and still exits
  successfully.

Gap:

- This is not a blocking gate.
- CI can be green while unsafe cast findings are present.

Future requirement:

- Decide whether to baseline, allowlist, or clean up existing findings.
- Convert the intended blocking subset to a non-warn CI gate.
- Do not describe warning-only output as enforcement.

### Route Discipline

Intent:

- Prevent route/handler code from bypassing service, repository, mapper, and
  shared DTO patterns.

Current implementation:

- `npm run rules:check:route-discipline` runs
  `scripts/check-route-discipline.mjs --warn-only`.
- It scans route/handler files for direct Prisma access, `SuccessSchema`,
  handler-level `.map()`, inline object schemas, and similar patterns.

Gap:

- This is not a blocking gate.
- At the time of this plan, the scanner reports many findings and CI still
  passes.
- Scanner findings are syntactic. They do not verify full contract-chain
  adequacy for a new product rule.

Future requirement:

- Split the scanner into enforceable categories, baseline known debt where
  necessary, and make new/touched violations blocking.
- Require implementation analysis to inventory mappers and route schemas for
  any shared-contract slice.

### Test Traceability

Intent:

- Ensure tests reference a use-case, business-rule, defect, or rule ID.

Current implementation:

- `npm run rules:check:test-traceability` runs
  `scripts/check-test-traceability.mjs --warn-only`.
- At the time of this plan, it reports many findings and still exits
  successfully.

Gap:

- This is not a blocking gate.
- Defect-fix and workflow-hardening slices can still land with tests that do
  not prove traceability unless reviewers enforce it manually.

Future requirement:

- Define a realistic baseline strategy.
- Make traceability blocking for new or touched tests first if full-repo
  cleanup is too large for one slice.

### Lifecycle String Literals

Intent:

- Ensure important lifecycle/status comparisons use shared enums/constants.

Current implementation:

- The rule exists in `rules/service-rules.md`.
- No dedicated blocking scanner was found for lifecycle/status string
  literals.
- `ContestStatus` exists in `packages/shared/domain/enums.ts`.
- Event status currently appears as DTO/provider-interface string unions and
  Zod literal arrays, not as a shared domain enum constant.

Gap:

- The codebase does not currently provide a shared `SportEventStatus` constant
  equivalent to `ContestStatus`.
- The rule cannot be applied consistently for event status until that shared
  constant exists.
- Existing scanners do not reject production comparisons or Prisma filters that
  use bare lifecycle strings.

Future requirement:

- Introduce or consolidate a shared `SportEventStatus` constant/type.
- Derive event DTO schemas and route filters from that shared status source
  where possible.
- Add a blocking scanner for lifecycle literals in production app code.
- Document allowed exceptions, such as:
  - shared enum/constant declarations
  - provider raw-code mapping tables
  - DTO schema declarations that intentionally define the source enum, if not
    derivable
  - generated files
  - tests and fixtures
  - user-facing display strings

## Required Workflow Change

Introduce a required pre-code **Implementation Analysis** gate for any slice
that touches shared contracts, lifecycle/status behavior, data sync, scoring,
contest classification, or cross-module flows.

The implementation analysis must be approved before coding starts.

Required sections:

- Current code inventory: exact files, functions, DTOs, mappers,
  repositories, routes, frontend consumers, and tests affected.
- Contract chain: domain type, DTO, route schema, mapper, OpenAPI, generated
  SDK/type, frontend usage, and documentation impacts.
- Enum/constant usage: exact lifecycle/status values involved and which shared
  constants must be used.
- Implementation delta: file-by-file proposed changes.
- Test delta: exact regression and behavior tests, including Beads/use-case or
  defect IDs.
- Existing violations encountered: classify as blocking, in-scope cleanup, or
  follow-up defect.
- Out-of-scope guardrails: what the slice must not change.
- Reviewer evidence checklist: what reviewers must explicitly verify.

## PR Review Requirement

PR reviews must review against the approved implementation analysis, not only
against the narrative plan or the diff.

For relevant slices, reviewers must explicitly state whether they verified:

- lifecycle/status comparisons use shared constants where available
- no new bare lifecycle literals were introduced outside documented exceptions
- frontend code uses generated operation response types for API payloads
- product lifecycle decisions use the approved DTO field/source
- DTO, mapper, route schema, OpenAPI, generated SDK, and frontend consumers are
  in sync
- warning-only scanner findings are either unrelated to the slice or tracked
  by a Beads follow-up

If a pre-existing violation directly affects the slice's behavior, reviewers
must not dismiss it as out of scope without creating or confirming a blocking
decision.

## Beads Slices

- `pool-master-5xi.1` — enforce shared lifecycle enum usage.
- `pool-master-5xi.2` — convert warning-only rule scanners into enforceable
  baselines.
- `pool-master-5xi.3` — create the implementation-analysis approval gate.
- `pool-master-5xi.4` — strengthen frontend generated-contract discipline.

## Open Questions

- Should the implementation-analysis artifact live as a plan section, a
  separate `tech-specs/` style file, or a Beads note template?
- Should lifecycle-literal scanning be full-repo blocking immediately, or
  touched-file blocking first with a baseline allowlist?
- Should warning-only scanners remain visible in `rules:check`, or should
  advisory checks move to a separate command so CI output does not imply
  enforcement?
- Should `SportEventStatus` live in `packages/shared/domain/enums.ts`, or
  should event DTOs become the source for a generated constant consumed by
  backend/frontend code?

