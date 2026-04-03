# PoolMaster Mobile Client Architecture — Deferred (Entire Plan)

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

> These tasks are explicitly deferred and should NOT be implemented until the web platform and backend contracts are much more mature, reviewable, and stable end to end. The entire mobile client plan was moved here to prevent accidental implementation. The original plan file was at `plans/12-poolmaster-mobile-client.md`.

## Deferred Tasks

| ID | Phase | Task | Original Status | Reason |
|---|---|---|---|---|
| 12-001 | 1 | Expo project setup in `clients/mobile/` | Deferred | Mobile after web platform complete |
| 12-002 | 1 | Shared API client package (`clients/shared/api-client/`) | Deferred | Mobile after web platform complete |
| 12-003 | 1 | Authentication flow (login, register, token management) | Deferred | Mobile after web platform complete |
| 12-004 | 1 | Secure token storage (Keychain iOS, EncryptedSharedPreferences Android) | Deferred | Mobile after web platform complete |
| 12-005 | 1 | Navigation architecture (React Navigation: tabs, stacks) | Deferred | Mobile after web platform complete |
| 12-006 | 1 | Home screen (league list, active contests) | Deferred | Mobile after web platform complete |
| 12-007 | 1 | API version checking and minimum version enforcement | Deferred | Mobile after web platform complete |
| 12-008 | 2 | League detail screen (members, settings) | Deferred | Mobile after web platform complete |
| 12-009 | 2 | Contest list and detail screens | Deferred | Mobile after web platform complete |
| 12-010 | 2 | Standings/leaderboard view | Deferred | Mobile after web platform complete |
| 12-011 | 2 | Participant profile view | Deferred | Mobile after web platform complete |
| 12-012 | 2 | Offline caching with SQLite (standings, rosters) | Deferred | Mobile after web platform complete |
| 12-013 | 2 | Pull-to-refresh pattern | Deferred | Mobile after web platform complete |
| 12-014 | 3 | Push notification registration (APNs + FCM via Expo) | Deferred | Mobile after web platform complete |
| 12-015 | 3 | Notification handling (foreground toast, background, tap) | Deferred | Mobile after web platform complete |
| 12-016 | 3 | In-app notification centre screen | Deferred | Mobile after web platform complete |
| 12-017 | 3 | Deep linking setup (universal links, custom scheme) | Deferred | Mobile after web platform complete |
| 12-018 | 3 | Notification → screen navigation mapping | Deferred | Mobile after web platform complete |
| 12-019 | 4 | WebSocket connection management (connect, heartbeat, reconnect) | Deferred | Mobile after web platform complete |
| 12-020 | 4 | Draft room UI (available list, queue, board, teams tabs) | Deferred | Mobile after web platform complete |
| 12-021 | 4 | Pick submission flow with confirmation dialog | Deferred | Mobile after web platform complete |
| 12-022 | 4 | Timer with haptic feedback and audio alerts | Deferred | Mobile after web platform complete |
| 12-023 | 4 | Reconnection handling and full state recovery | Deferred | Mobile after web platform complete |
| 12-024 | 4 | Landscape draft board view | Deferred | Mobile after web platform complete |
| 12-025 | 5 | League activity feed (posts, replies, reactions) | Deferred | Mobile after web platform complete |
| 12-026 | 5 | Contest chat | Deferred | Mobile after web platform complete |
| 12-027 | 5 | Direct messaging | Deferred | Mobile after web platform complete |
| 12-028 | 5 | Share card viewing and sharing | Deferred | Mobile after web platform complete |
| 12-029 | 5 | Biometric authentication (Face ID, fingerprint) | Deferred | Mobile after web platform complete |
| 12-030 | 5 | App Store submission preparation (Apple + Google) | Deferred | Mobile after web platform complete |
