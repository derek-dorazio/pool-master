# PoolMaster Sports Data Provider Integration — Deferred Tasks

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

> These tasks are explicitly deferred and should NOT be implemented until the web platform is complete and stable. They were extracted from the main plan file to prevent accidental implementation.

## Deferred Tasks

| ID | Phase | Task | Original Status | Reason |
|---|---|---|---|---|
| 06-009 | 1 | Redis caching layer (scores, schedules, profiles) | Not Started | ioredis scaffolded, cache layer needs implementation |
| 06-013 | 2 | Stale score detection and UI staleness indicator | Not Started | Deferred |
| 06-019 | 3 | Sportradar tennis adapter | Not Started | Requires enterprise contract |
| 06-020 | 3 | Equibase horse racing adapter | Not Started | Requires commercial data license |
| 06-022 | 3 | Webhook receiver endpoint (`POST /api/v1/internal/webhooks/{provider_id}`) | Not Started | Deferred |
| 06-023 | 3 | Data correction handling pipeline (is_correction flag → recalculate) | Not Started | isCorrection flag exists, pipeline deferred |
| 06-024 | 3 | Cost tracking and budget alerts per provider | Not Started | Deferred |
| 06-025 | 4 | Historical data seeding pipeline (last 3 seasons per sport) | Not Started | Deferred |
| 06-027 | 4 | Smart polling optimisation (contest-aware frequency) | Not Started | Deferred |
| 06-028 | 4 | Ingestion admin dashboard (provider status, errors, costs) | Not Started | Deferred |
| 06-029 | 4 | Request batching and cost optimisation | Not Started | Deferred |
