## Objective

Implement the next commissioner-managed league features beyond lifecycle:

- edit league details
- manage league identity/icon
- define the first truthful league-management settings surface

## Dependencies

- [82-league-lifecycle-user-cases.md](./82-league-lifecycle-user-cases.md)
- [83-league-lifecycle-execution.md](./83-league-lifecycle-execution.md)

## Planning Notes

- The current `Manage League` modal has scaffolded `Details`, `Icon`, and
  `Settings` tabs, but there is no approved backend contract yet for those
  slices.
- This must remain a backend-first workflow. Do not implement the frontend
  forms until the backend surface and model review are complete.
- Start clean. If a proposed league field or setting is speculative, remove it
  instead of preserving it.
- Product review on April 15, 2026 locked the first truthful scope:
  - `Details` should edit `name` and `description`
  - `leagueCode` remains immutable after creation and should be shown read-only
  - `Settings` should stay intentionally small and read-only for now, limited
    to explaining the current `joinPolicy`
  - `Icon` should become a real curated icon-selector flow backed by a fixed
    built-in icon catalog, not custom uploads
- The existing create-league modal already seeds `leagueCode` from `name` on
  blur while still allowing commissioner override during create. Edit flows
  should keep `leagueCode` read-only.
- League homepage URL can be derived from the existing bookmarkable
  `/league/<leagueCode>` route and does not require new backend model fields.
- Inactive leagues should render `Details` and `Settings` read-only, leaving
  lifecycle as the only mutable surface.

## Locked Product Decisions (April 15, 2026)

- `Manage League` remains a modal for this slice.
- `Details`:
  - editable: `name`, `description`
  - read-only: `leagueCode`, status, member count, active contest count,
    created date
- `leagueCode` should be shown read-only after creation to both commissioners
  and members.
- Commissioner and member league surfaces should include a convenient read-only
  league homepage link derived from `leagueCode`.
- `Settings` remains intentionally small and read-only in this slice. Current
  `joinPolicy` may be explained there, but not edited yet.
- `Icon` should move forward as a curated built-in selector:
  - no custom uploads in this slice
  - frontend should ship a PoolMaster icon catalog for supported sports
  - the UX should support both small selector usage and larger league-tile
    usage
- The curated icon catalog should be implemented as product assets under the
  PoolMaster webapp image/assets surface rather than improvised inline SVG
  fragments.

## Data-Model Review Outcome (April 15, 2026)

- `Details` editing can use the existing first-class league fields:
  - `name`
  - `description`
- `leagueCode` immutability uses the current model and route semantics; no
  schema change is required for that rule.
- The league homepage link is a frontend derivation from `leagueCode`; no
  schema change is required.
- Read-only `Settings` for current `joinPolicy` also needs no model change.
- The curated `Icon` flow **does require** a new first-class league field.
  Recommended direction:
  - add `League.iconKey`
  - model it as a first-class persistence field and shared contract field
  - back it with a closed enum/catalog rather than a free-form URL or JSON blob
  - keep custom user uploads out of scope for this slice
- Backend work for `Details` can proceed immediately once the DTO/route surface
  is defined.
- Backend work for `Icon` must wait for the icon catalog and enum shape to be
  approved.

## Task Table

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 92-001 | 1 | Product/data-model review of league details, icon, and first-pass settings | Done | Locked April 15, 2026: `Details` edits `name`/`description`; `leagueCode` immutable and read-only after create; `Settings` stays read-only and limited to current `joinPolicy`; `Icon` becomes curated built-in selector with no custom uploads. |
| 92-002 | 1 | Data-modeler review of required backend/model changes | Done | `Details` and read-only `Settings` can use the current model. Icon support requires a new first-class `League.iconKey` field backed by a closed catalog/enum. |
| 92-003 | 1 | Backend developer: add truthful commissioner APIs for approved league details/settings | Done | Added commissioner `updateLeagueDetails` API for `name` and `description` only. `leagueCode` remains immutable and `Settings` remains read-only for now. Contract, OpenAPI, and generated SDK/types were refreshed. |
| 92-004 | 1 | Backend developer: add backend validation and tests | Done | Added unit, contract-verification, and functional coverage for commissioner-only details edits and inactive-league read-only behavior. Validated with `api:refresh`, `api:validate`, typecheck, eslint, PoolMaster vitest, `build:poolmaster`, and `test:coverage:service:fresh`. |
| 92-005 | 2 | Frontend developer: implement real `Details` tab editing against the backend contract | Done | `Manage League` now supports real commissioner editing for `name` and `description`, shows immutable `leagueCode`, homepage link, and read-only metadata, and makes inactive leagues read-only. |
| 92-006 | 2 | Frontend developer: implement approved `Icon` flow | Done | Added first-class `League.iconKey`, commissioner `updateLeagueIcon` API, curated 20-icon PoolMaster sprite catalog, selector UI in `Manage League`, and icon rendering in the league selector, league tiles, and league detail views. Validated with `api:refresh`, `api:validate`, Prisma generate, typecheck, eslint, PoolMaster vitest, `build:poolmaster`, and `test:coverage:service:fresh`. |
| 92-007 | 2 | Frontend developer: implement first-pass `Settings` tab for approved settings only | Done | `Settings` now shows the current read-only `joinPolicy` via a truthful detail fetch and explicitly defers broader commissioner settings. |
| 92-008 | 2 | Frontend developer: add UI tests and browser-journey hooks for league management | In Progress | UI tests now cover details editing, inactive read-only behavior, and curated icon updates. Browser-journey expansion remains intentionally deferred until broader league-management and account flows are finished. |
