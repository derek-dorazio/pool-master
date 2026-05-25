# Provider Sync Diagnostics

**Beads epic:** `pool-master-ueu`

## Purpose

Root-admin sync history currently answers only whether a provider sync job
finished. That is not enough for investigation. A completed manual sync can
still be operationally suspicious when the provider returns no data, participant
hydration processes zero records, or imported events are not contest-eligible.

This plan defines the diagnostic surface needed for root admins to understand
what was requested, what the provider returned, what PoolMaster persisted, what
was skipped, and why.

## Governing Principles

- `rules/service-rules.md` governs backend route, DTO, mapper, and OpenAPI
  discipline.
- `rules/react-ui-rules.md` governs generated-client usage and frontend state
  ownership.
- `rules/ux-rules.md` governs honest loading, empty, error, warning, and
  success communication.
- `rules/testing-rules.md` requires traceable tests and defect-first validation
  when a shipped behavior is being corrected.

Task state, implementation slices, and closeout notes live in Beads. This plan
is narrative only and should be deleted when `pool-master-ueu` closes.

## Current Gap

The sync history details modal shows the captured run payload, but the payload
is not shaped for investigation:

- the primary visible result is `STATUS=COMPLETED`;
- `responsePayload` currently represents the serialized ingestion job, not the
  provider response, so the field name is misleading;
- raw request data is visible, but provider response data is not;
- run stats are shallow (`recordsProcessed`, `errors`) and do not explain
  events, participants, rankings, player stats, skips, or contest readiness;
- warnings are not first-class, so a manual sync with zero useful data appears
  as ordinary success.

The resulting admin experience cannot distinguish a healthy sync from a sync
that completed but left Create Contest with no eligible events.

## Key Decisions

### Manual zero-data runs are warnings

Manual syncs should treat zero returned or zero processed data as an
investigation-worthy warning. Scheduled syncs may legitimately poll before new
provider data exists, so zero-data scheduled runs may remain informational
unless the provider reports an explicit error.

The admin surface should therefore support at least these outcomes:

- `COMPLETED`
- `COMPLETED_WITH_WARNINGS` or an equivalent `COMPLETED` status with warning
  severity in the payload
- `FAILED`

If changing the persisted enum is too broad for the first slice, keep the
existing status enum and add an `outcome.severity` field. The UI should still
render warning tone and warning copy for manual zero-data completions.

### Rename job details and add provider payloads

The run payload should stop overloading `responsePayload`. The existing
serialized ingestion job detail should be renamed to `jobPayload`. A new
`providerPayload` section should capture the provider response and provider
request context. Store distinct sections:

- `requestPayload` — root-admin request and provider request context;
- `providerPayload` — provider operation, endpoint or adapter operation,
  request parameters, raw provider response, truncation metadata, parse status,
  and provider-level warnings/errors;
- `jobPayload` — ingestion job status, timings, records processed, error log;
- `outcome` — admin-facing summary, severity, warnings, and errors;
- `stats` — normalized counts across provider data, persisted data, skipped
  data, and contest readiness.

### Normalize first, retain raw provider payload for debugging

The admin UI and contract should be driven by normalized provider results, not
provider-specific raw response shapes. Normalized results are what power the
stats, record grids, skip reasons, warnings, and contest-readiness summary.

For debugging, the backend should also persist the raw provider payload in JSON
form under `providerPayload.raw`. In the first implementation, this can live
inside the existing provider sync run JSON storage if that keeps the migration
small; a dedicated JSON column or detail table can follow if payload size or
retention needs outgrow the existing row. Raw payload persistence must:

- exclude credentials, auth headers, cookies, and secrets;
- record whether the payload is complete or truncated;
- include provider operation/request metadata so the raw response is
  attributable;
- remain a drill-down/debug aid rather than the frontend's primary data model.

### Stats should explain contest readiness

The sync details view should make the Create Contest impact visible. For event
and participant feeds, stats should include:

- provider records returned;
- events fetched, created, updated, unchanged, skipped;
- participants fetched, created, updated, unchanged, skipped;
- rankings and player stats fetched/created/updated where relevant;
- contest-eligible events after sync;
- events pending field release;
- events missing loaded participants;
- events already locked;
- events outside the requested window;
- warnings and errors.

### Records use canonical grids; raw provider JSON stays simple

Root admins need raw provider payload access for debugging, but the operational
UI should not try to render provider-specific shapes. The modal should lead with
a readable overview and stats driven by canonical/normalized model data, then
offer grids or sections for:

- synced events grid;
- participants grid;
- rankings/player-stats grid;
- skipped records grid;
- warnings/errors;
- normalized/job JSON.

Raw provider JSON should be exposed through a simple "Show provider payload"
link or button that opens a raw JSON modal. The user can read raw JSON; the app
does not need a provider-payload grid in this slice. Large provider responses
may need truncation. If truncation is introduced, the payload must say so
explicitly.

## API Surface Implications

This work likely changes the root-admin provider sync run DTO returned by
`adminListProviderSyncRuns`. The backend should expose a typed diagnostic
payload rather than forcing the frontend to infer shape from a generic object.

The generated SDK remains the frontend source of truth. Frontend implementation
should wait for the backend DTO/OpenAPI/client regeneration slice before
building against the new details shape.

## UI Narrative

The sync history row should summarize the result in one line:

- "Completed event schedule sync: 3 events fetched, 1 created, 2 updated."
- "Completed with warnings: manual participant sync processed 0 records."
- "Failed participant sync: provider response could not be parsed."

The details modal should be titled "Sync run details" rather than "Sync
payload." Its first screen should show:

- status/severity badge;
- provider, sport, feed, trigger, event target, date window;
- started, completed, and duration;
- summary text;
- metric tiles for key stats;
- visible warning/error list.

The canonical details should stay in the primary modal. Raw provider payloads
should sit behind a "Show provider payload" action with copy controls. Job
details should sit behind a "Show job payload" action or a compact job-log
section.

## Testing Expectations

Backend tests should cover:

- manual sync with zero provider records produces a warning outcome;
- manual participant sync with zero processed participants produces a warning;
- failed provider calls preserve error details;
- provider exchange and job payloads are separated in the returned DTO;
- stats are populated for schedule, participants, rankings, and player stats
  where supported.

Frontend tests should cover:

- warning-tone rows for manual zero-data completions;
- modal overview stats;
- warnings/errors visibility;
- request JSON and provider response JSON drill-down;
- scrollable record grids for at least one event and one participant scenario.

Functional API coverage should prove the mock provider path can produce an
investigable run that explains whether contest-eligible events were created.

## Dependencies

- Backend provider adapters may need a small tracing/result envelope so provider
  request and response data can be captured without duplicating adapter logic.
- Sync persistence may need to record per-record actions and skip reasons.
- OpenAPI and generated frontend clients must be regenerated before frontend
  consumption.
- Existing admin sync history tests should be updated rather than bypassed.

## Deferred Work

- Long-term retention and storage limits for raw provider payloads.
- Download/export of large provider responses.
- Scheduled-sync anomaly detection beyond zero-data manual warnings.
- Provider-specific detail renderers beyond a normalized generic grid.
