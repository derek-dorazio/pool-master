# Audit: Mocks, Stubs, and Unfinished Implementations

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

## Context
Full audit of all code that is not implemented for real — using mocks, stubs, hardcoded data, TODOs, or placeholders. This document catalogs everything for prioritized remediation.

---

## BACKEND SERVICES — In-Memory Stores (20+ Map-based stores instead of Prisma/DB)

| Service | File | Store | Should Be |
|---|---|---|---|
| Billing | stripe-service.ts | MockStripeClient (customers, subscriptions, invoices Maps) | Real Stripe SDK |
| Billing | subscription-service.ts | subscriptionStore, tenantCustomerMap | Prisma TenantSubscription |
| Billing | usage-service.ts | usageStore Map | Prisma TenantUsage |
| Billing | trial-service.ts | trialStore Map | Prisma TenantSubscription |
| Billing | dunning-service.ts | dunningStore Map | Prisma + Stripe |
| Billing | cancellation-service.ts | feedbackStore Map | Prisma CancellationFeedback |
| Billing | enterprise-service.ts | enterpriseStore Map | Prisma EnterprisePlan |
| Billing | plan-change-service.ts | degradationStore Map | Prisma |
| Billing | entitlement-service.ts | overrideStore Map | Prisma EntitlementOverride |
| Billing | invoice-service.ts | generateMockInvoices() | Real Stripe invoices |
| Billing | revenue-analytics-service.ts | MOCK_DATA constants | Real aggregation queries |
| Admin | flag-service.ts | flags Map | Prisma FeatureFlag |
| Admin | announcement-service.ts | announcements Map | Prisma GlobalAnnouncement |
| Admin | impersonation-service.ts | sessions Map | Prisma ImpersonationSession |
| Admin | admin-audit-service.ts | mock entries | Prisma AdminAuditEntry |
| Admin | export-service.ts | exportStore Map | Real async export job |
| Admin | migration-service.ts | runs Map | Prisma MigrationRun |
| Admin | support-service.ts | all mock data | Real observability queries |
| Scoring | score-store.ts | participantScores, entryScores Maps | DynamoDB |
| Shared | event-bus.ts | handlers Map (in-process) | Redis Streams / SQS |
| History | retention-service.ts | configStore Map | Prisma RetentionConfig |
| History | season-notes-service.ts | notes Map, trophies Map | Prisma SeasonNote, Trophy |

## BACKEND SERVICES — Mock/Placeholder API Responses

| Service | File | Issue |
|---|---|---|
| Admin | tenant-service.ts | listTenants/getTenantDetail return hardcoded mock data |
| Admin | user-service.ts | listUsers/getUserDetail return hardcoded mock data |
| Admin | contest-service.ts | getContests/getContestDetail return hardcoded mock data |
| Admin | health-service.ts | All health/infra/metrics return MOCK_DATA constants |
| Admin | provider-service.ts | MOCK_PROVIDERS Map, healthCheck returns mock |
| Admin | quick-actions-handler.ts | All actions return mock results |
| Billing | webhook-handler.ts | Handlers log events, no real Stripe signature verification |
| Auth | routes.ts | forgot-password and OAuth callback are placeholders |
| Auth | admin-auth.ts | Token validation is a placeholder (base64 decode) |
| Draft | routes.ts | GET /:contestId, POST /start, POST /pick all return 501 |
| Ingestion | index.ts | Callbacks only log — no DB persistence for events/participants/rankings |

## BACKEND SERVICES — TODOs in Write Operations

| Service | File | Operation | TODO |
|---|---|---|---|
| Admin | tenant-service.ts | changePlan, suspend, delete, credit, extendTrial | Wire to Prisma |
| Admin | user-service.ts | resetPassword, forceLogout, disable, enable, merge, sendEmail | Wire to Prisma + auth/notification services |
| Admin | contest-service.ts | forceClose, reopen, overrideScore, recalculate, reIngest | Wire to Prisma + scoring service |
| Admin | health-service.ts | createAlert, updateAlert, muteAlert | Wire to Prisma |
| Admin | audit-service.ts | logAdminAction, queryAuditLog | Wire to Prisma |
| Billing | entitlement-service.ts | findNextTierSlug() | Implement tier comparison |

---

## WEBAPP — Mock Data in Hooks (every hook returns hardcoded data)

| Area | Hook File | Mock Data |
|---|---|---|
| Dashboard | use-active-contests.ts | 2 mock contests |
| Dashboard | use-upcoming-drafts.ts | 1 mock draft |
| Dashboard | use-my-leagues.ts | 3 mock leagues |
| Dashboard | use-recent-activity.ts | 5 mock items |
| Dashboard | use-highlights.ts | Mock stats |
| Contests | use-contest.ts | 1 mock golf contest |
| Contests | use-standings.ts | 12 mock entries |
| Billing | use-billing.ts | Free tier mock, `useBillingEnabled()` hardcoded false |
| Notifications | use-notifications.ts | 7 mock notifications |
| Notifications | use-unread-count.ts | Mock count |
| Notifications | use-notification-preferences.ts | Mock preferences |
| Notifications | use-notification-actions.ts | Mock actions |
| Social | use-feed.ts | Mock feed items, 7 TODO stubs (CRUD, reactions, polls) |
| Social | use-chat.ts | 6 mock chat messages |
| Social | use-messages.ts | Mock DM conversations |
| Social | use-share.ts | Mock share data |
| Social | use-recap.ts | Mock recap |
| Settings | use-profile.ts | Mock user profile |
| Settings | use-consent.ts | Mock consent data |
| Settings | use-data-export.ts | Mock export status |
| Settings | use-linked-accounts.ts | Mock linked accounts |
| Discovery | use-discovery.ts | 10 mock leagues, 5 mock contests |
| Draft Room | use-draft.ts | Mock draft state, 12 mock NFL players |
| History | personal-stats.tsx | Mock stats |
| Leagues | All page files | Inline mock data in every page |
| Contests | All page files | Inline mock data in every page |

## WEBAPP — Non-Functional UI Elements

| Area | File | Issue |
|---|---|---|
| Auth | login.tsx | Mock auth fallback (security concern for prod) |
| Leagues | create.tsx | Navigates to `/leagues/mock-id` |
| Contests | create.tsx | Navigates to `/contests/mock-id` |
| Leagues | role-guard.tsx | Hardcoded to return 'COMMISSIONER' |
| Leagues | entitlement-gate.tsx | Hardcoded to return `{ entitled: true }` |
| Leagues | join-leave-flow.tsx | Join/leave API calls are TODOs |
| Draft Room | commissioner-controls.tsx | All actions are TODOs |
| Contests | commissioner-controls.tsx | All actions are TODOs |
| Settings | All settings cards | Save actions are TODOs |
| Notifications | push-permission.ts | Service worker registration TODO |

## WEBAPP — window.confirm() Instead of Modals (11 instances)

- leagues/members.tsx, leagues/settings.tsx (2)
- contests/detail.tsx (admin), users/detail.tsx, users/merge.tsx, tenants/detail.tsx
- flags/detail.tsx (2), providers/detail.tsx (2)

---

## ADMIN APP — Entirely Mock Data

| Hook File | Mock Objects |
|---|---|
| use-admin-api.ts | mockMetrics, mockServices, mockAlerts, mockAudit, mockTenants, mockTenantDetail, mockUserResults, mockUserDetail |
| use-contests-api.ts | mockContests, mockContestDetail |
| use-providers-api.ts | mockProviders, mockProviderDetail, mockIngestionJobs |
| use-flags-api.ts | mockFlags, mockFlagDetail |
| use-health-api.ts | mockHealthData, mockErrors, mockAlertRules |
| use-audit-api.ts | mockAuditEntries |
| use-announcements-api.ts | mockAnnouncements |
| use-migrations-api.ts | mockMigrations, mockRunDetail |
| use-config-api.ts | All config mocks (templates, triggers, channels, rate limits, etc.) |

## ADMIN APP — console.log() Instead of API Calls (15+ instances)

- config/notifications.tsx: save triggers, templates, rate limits, digest
- config/platform.tsx: save poll intervals, ingestion, dunning, retention
- config/templates.tsx: save/delete templates
- flags/index.tsx: toggle flag
- flags/detail.tsx: toggle, save rollout, delete

## ADMIN APP — window.alert() Mock Actions

- users/detail.tsx: reset password, force logout, disable, send email
- tenants/detail.tsx: change plan, suspend, credit, extend trial, delete
- users/merge.tsx: confirm merge
- contests/detail.tsx: admin actions

---

## SUMMARY BY PRIORITY

### P0 — Security / Production Blockers
1. Mock auth fallback in login.tsx (dev backdoor)
2. Admin auth placeholder (base64 token decode)
3. Entitlement gate hardcoded to `true`
4. Role guard hardcoded to `COMMISSIONER`

### P1 — Core Feature Gaps (blocks real usage)
5. Draft service routes return 501 (no draft functionality)
6. All webapp hooks return mock data (no real API calls)
7. League/contest creation navigates to mock IDs
8. Admin panel entirely mocked (no real API calls from UI)
9. Social system fully mocked (feed, chat, DMs)

### P2 — Infrastructure Gaps (needed for production)
10. 20+ in-memory Map stores need Prisma/DB persistence
11. Event bus is in-process (needs Redis Streams/SQS)
12. Score store is in-memory (needs DynamoDB)
13. Mock Stripe client (needs real Stripe SDK)
14. Ingestion callbacks only log (need DB writes)

### P3 — Polish / UX
15. 11 window.confirm() calls → proper modals
16. 15+ console.log() handlers → real API calls
17. Billing hardcoded to disabled

---

## Action Plan

| ID | Priority | Task | Status | Notes |
|---|---|---|---|---|
| RS-001 | P0 | Remove mock auth fallback from login.tsx | Done | Removed hardcoded mock users; shows proper error messages for network/credential failures |
| RS-002 | P0 | Implement real admin auth (SSO/JWT validation) | Done | Replaced base64 decode with jwt.verify() using JWT_SECRET |
| RS-003 | P0 | Wire entitlement gate to real API | Done | Calls GET /billing/entitlements; fails open on network error |
| RS-004 | P0 | Wire role guard to real membership lookup | Done | Calls GET /leagues/:id/members/me; fails secure to VIEWER |
| RS-005 | P1 | Implement draft service routes (start, pick, state) | Done | 3 routes implemented with DraftStore, snake engine, session manager |
| RS-006 | P1 | Wire all webapp hooks to real API endpoints | Done | 18 hooks wired to real APIs with mock fallback on error |
| RS-007 | P1 | Wire league/contest creation to real API (return real IDs) | Done | League + contest creation call POST APIs and navigate to real IDs |
| RS-008 | P1 | Wire admin app hooks to real admin API endpoints | Done | 9 admin hook files wired to real APIs with mock fallback |
| RS-009 | P1 | Implement social backend (Plan 10 Phase 1) | Done | FeedService with CRUD, reactions, threading, pinning; 8 API routes |
| RS-010 | P2 | Replace billing in-memory stores with Prisma | Done | entitlement, usage, subscription, trial → Prisma; cancellation/dunning kept Map (no model) |
| RS-011 | P2 | Replace admin in-memory stores with Prisma | Done | 8 services converted: flag, announcement, audit, impersonation, export, tenant, user, contest. Export keeps transient Map for job state but queries real DB data. All services accept PrismaClient via constructor. Shared instance created in routes.ts. |
| RS-012 | P2 | ~~Replace event bus with Redis Streams~~ | Removed | Monolith architecture — in-process EventBus is correct, not a mock |
| RS-013 | P2 | Replace score store in-memory Maps with Prisma/Postgres | Done | ScoreStore uses hybrid approach: Prisma for totals (ContestEntry.totalScore) and leaderboard queries, in-memory cache for transient timeline/breakdowns. ContestLookup queries ContestParticipantPool and RosterPick via Prisma. StandingsRollup persists to ContestStanding via upsert and updates ContestEntry.rank. All three classes accept PrismaClient via constructor; singletons moved inside buildApp(). |
| — | — | Deferred tasks moved to [plans/deferred/remove-stubs-deferred.md](deferred/remove-stubs-deferred.md) | — | See deferred file for details |
| RS-015 | P2 | Wire ingestion callbacks + scoring consumer to DB | Done | IngestionPersistence class persists events/participants/rankings via Prisma upserts; callbacks wired in index.ts; ContestLookup still uses mock data (separate task) |
| RS-016 | P2 | Replace history in-memory stores with Prisma | Done | RetentionService → Prisma RetentionConfig; SeasonNotesService → Prisma SeasonNote + Trophy |
| RS-017 | P3 | Replace window.confirm() with modal dialogs | Done | Created ConfirmDialog + useConfirmDialog hook for web and admin apps; replaced all 11 instances |
| RS-018 | P3 | Replace console.log() with real API calls in admin | Done | Replaced 15+ console.log handlers with adminApi calls in notifications, platform, templates, flags pages |
| RS-019 | P3 | Wire billing enabled flag to real feature flag check | Done | Already wired: useBillingEnabled() calls api.get('/v1/billing/plan') with false fallback |
