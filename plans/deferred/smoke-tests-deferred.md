# PoolMaster Smoke Test Suites — Deferred Tasks

> These tasks are explicitly deferred and should NOT be implemented until the web platform is complete and stable. They were extracted from the main plan file to prevent accidental implementation. The entire smoke test suite requires a deployed environment to test against.

## Deferred Tasks

| ID | Phase | Task | Original Status | Reason |
|---|---|---|---|---|
| ST-001 | 1 | Create `smoke-tests/` directory with `package.json`, `tsconfig.json`, Vitest and Playwright configs | Not Started | Needs deployed environment |
| ST-002 | 1 | Create `.env.example` and `shared/config.ts` with env-driven configuration | Not Started | Needs deployed environment |
| ST-003 | 1 | Implement `shared/auth.ts` — login helper that obtains JWT from deployed auth endpoint | Not Started | Needs deployed environment |
| ST-004 | 1 | Implement `shared/api-client.ts` — typed HTTP wrapper (GET, POST, PUT, DELETE with auth headers) | Not Started | Needs deployed environment |
| ST-005 | 1 | Write `api/health.test.ts` to validate connectivity to all 5 services | Not Started | Needs deployed environment |
| ST-006 | 2 | Implement `shared/helpers/user.ts` — registerUser, loginUser, getProfile | Not Started | Needs deployed environment |
| ST-007 | 2 | Implement `shared/helpers/league.ts` — createLeague, inviteMembers, acceptInvite, cleanup | Not Started | Needs deployed environment |
| ST-008 | 2 | Implement `shared/helpers/contest.ts` — createContest, configurePool, lockPool, cleanup | Not Started | Needs deployed environment |
| ST-009 | 2 | Implement `shared/helpers/draft.ts` — startDraft, makeRandomPicks, completeDraft | Not Started | Needs deployed environment |
| ST-010 | 2 | Implement `shared/helpers/scoring.ts` — submitScores, recalculate, getStandings | Not Started | Needs deployed environment |
| ST-011 | 2 | Build `shared/data/sports-matrix.ts` — all valid sport x contestType x selectionType x scoringEngine combos | Not Started | Needs deployed environment |
| ST-012 | 2 | Create fixture JSON files for all 10 sports | Not Started | Needs deployed environment |
| ST-013 | 2 | Create `shared/data/user-pool.ts` and `scripts/seed-test-users.ts` | Not Started | Needs deployed environment |
| ST-014 | 2 | Implement `shared/helpers/cleanup.ts` — resource registry and teardown logic | Not Started | Needs deployed environment |
| ST-015 | 3 | Implement `api/league-lifecycle.test.ts` — create, configure, invite, accept, roles | Not Started | Needs deployed environment |
| ST-016 | 3 | Implement `api/contest-creation.test.ts` — create one contest per sport x type x draft combo | Not Started | Needs deployed environment |
| ST-017 | 3 | Implement `api/pool-management.test.ts` — pool creation, participants, pricing, tiers, lock | Not Started | Needs deployed environment |
| ST-018 | 4 | Implement `api/draft-execution.test.ts` — snake draft with random picks for all members | Not Started | Needs deployed environment |
| ST-019 | 4 | Implement `api/draft-execution.test.ts` — tiered, budget, open selection, pick'em, bracket picks | Not Started | Needs deployed environment |
| ST-020 | 4 | Implement `api/scoring-lifecycle.test.ts` — submit fixture data, recalculate, validate standings | Not Started | Needs deployed environment |
| ST-021 | 4 | Implement `api/full-workflow.test.ts` — end-to-end golf snake draft from league to payouts | Not Started | Needs deployed environment |
| ST-022 | 5 | Implement `api/commissioner-actions.test.ts` — pause, resume, undo pick, adjust score, reopen, confirm payouts | Not Started | Needs deployed environment |
| ST-023 | 5 | Add negative test cases — invalid contest configs, over-budget picks, unauthorized access | Not Started | Needs deployed environment |
| ST-024 | 6 | Configure Playwright — browsers, base URL, storage state, screenshot/video on failure | Not Started | Needs deployed environment |
| ST-025 | 6 | Implement page object models for all key pages | Not Started | Needs deployed environment |
| ST-026 | 6 | Implement `ui/auth.spec.ts` — register, login, logout, error states | Not Started | Needs deployed environment |
| ST-027 | 7 | Implement `ui/league-creation.spec.ts` — create league via wizard UI | Not Started | Needs deployed environment |
| ST-028 | 7 | Implement `ui/member-management.spec.ts` — invite, accept, manage roles via UI | Not Started | Needs deployed environment |
| ST-029 | 7 | Implement `ui/contest-wizard.spec.ts` — create one contest per sport via wizard | Not Started | Needs deployed environment |
| ST-030 | 7 | Implement `ui/draft-room.spec.ts` — join draft room, make picks, complete draft | Not Started | Needs deployed environment |
| ST-031 | 7 | Implement `ui/standings.spec.ts` — view standings, results, payouts | Not Started | Needs deployed environment |
| ST-032 | 7 | Implement `ui/commissioner-dashboard.spec.ts` — commissioner overrides via UI | Not Started | Needs deployed environment |
| ST-033 | 8 | Implement `ui/full-workflow.spec.ts` — end-to-end from register to payouts in browser | Not Started | Needs deployed environment |
| ST-034 | 8 | Validate UI suite on Firefox and WebKit browsers | Not Started | Needs deployed environment |
| ST-035 | 9 | Create GitHub Actions workflow for smoke tests (manual, post-deploy, nightly triggers) | Not Started | Needs deployed environment |
| ST-036 | 9 | Configure Slack alerting on smoke test failure | Not Started | Needs deployed environment |
| ST-037 | 9 | Configure artifact uploads — Playwright traces, screenshots, videos, JUnit XML | Not Started | Needs deployed environment |
| ST-038 | 9 | Write `smoke-tests/README.md` with setup instructions, running locally, CI integration | Not Started | Needs deployed environment |
