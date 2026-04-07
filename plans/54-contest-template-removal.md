# Plan 54: Contest Template Removal

## Purpose

Remove the current contest-template concept from the active backend model, API,
service code, and planning guidance.

The reviewed domain model has replaced template-driven contest setup with:

- `ContestConfiguration`
- `ParticipantContestScoringRule`
- `ContestEntryAggregationRule`
- `ContestPrizeDefinition`

Commissioners configure contests directly using those concrete objects and
registry-backed rule definitions. The old `ContestTemplate` concept is no
longer valid and should not influence implementation.

## Why Templates Must Be Removed

The current template implementation is materially misaligned with the reviewed
domain model because it still assumes:

- tenant/platform template sharing
- broad JSON blobs like:
  - `draftConfig`
  - `scoringConfig`
  - `payoutConfig`
  - `poolConfig`
- old contest-pool concepts
- old scoring-template concepts
- older naming and associations that predate the new contest configuration
  model

## Active Direction

For first pass:

- commissioners configure contests directly
- no `ContestTemplate` model is needed
- no contest-template CRUD API is needed
- no selection-template or scoring-template admin workflow is needed
- no backend implementation should preserve template concepts as a compatibility
  layer

If a reusable-configuration concept is ever needed later, it should be
re-designed from scratch on top of the new contest-configuration model.

## What Should Be Removed

### Schema / Domain

- `ContestTemplate`
- related domain types and repository interfaces

### Service / Routes

- `/api/v1/templates`
- `packages/core-api/src/modules/templates/`
- `packages/core-api/src/modules/contests/template-service.ts`
- `packages/core-api/src/modules/contests/template-handler.ts`
- template wiring in league/admin modules

### Template Registries And Template-Led Setup Paths

- old scoring-template selection flows
- old selection-template CRUD/config flows
- admin config surfaces for scoring/selection templates

### Documentation / Planning Guidance

- active docs and plans should not instruct agents to use contest templates,
  scoring templates, or selection templates as part of the new contest model

## Notes

- example/default configurations are still fine as product guidance
- but those should be expressed as examples or defaults, not as a persisted
  template subsystem

## Task Outline

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 54-001 | 1 | Remove `ContestTemplate` from the target schema and domain model | Done | Removed from Prisma target schema, baseline migration, shared domain model, and repository ports |
| 54-002 | 1 | Remove template CRUD routes, services, handlers, and repository interfaces | Done | Removed `/api/v1/templates`, template service/handler, Prisma adapter, wiring, and bulk-create-from-template path |
| 54-003 | 1 | Remove scoring-template and selection-template config surfaces that assume a template subsystem | Not Started | Remaining template-like scoring/selection surfaces tracked separately |
| 54-004 | 2 | Update docs/plans/rules so agents do not treat templates as an active concept | Done | Active cleanup completed in the earlier domain-model review pass |
| 54-005 | 2 | Remove or rewrite tests that enforce template behavior | Done | Template unit coverage removed and bulk/helper references cleaned up |
