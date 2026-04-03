# PoolMaster — iOS App Plan Overview

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

> **Rules:** iOS implementation follows [Swift Rules](../../rules/swift-rules.md). Architecture decisions follow [Architecture Rules](../../rules/architecture-rules.md).

## Overview

Native iOS app built with Swift + SwiftUI, targeting iOS 17+. The app consumes the same REST API as the web client. All business logic lives in the backend — the iOS app is a presentation and interaction layer.

## Technology Stack

| Component | Technology |
|---|---|
| Language | Swift 5.9+ |
| UI Framework | SwiftUI |
| State Management | @Observable, @State, @Environment |
| Navigation | NavigationStack |
| Networking | URLSession + async/await |
| Push | APNs (via notification-service backend) |
| Deep Linking | Universal Links |
| Local Storage | SwiftData (offline cache) |
| Testing | XCTest + Swift Testing |

## Plan Files

| Plan | Scope |
|---|---|
| [01 — Auth & Onboarding](01-ios-auth.md) | Login, registration, biometrics, onboarding |
| [02 — Home & Navigation](02-ios-home-navigation.md) | Tab bar, home dashboard, navigation stack |
| [03 — Leagues & Members](03-ios-leagues.md) | League list, detail, members, invitations |
| [04 — Contests & Standings](04-ios-contests.md) | Contest list, detail, standings, results |
| [05 — Draft Room](05-ios-draft-room.md) | Live/async draft, pick submission, auto-pick |
| [06 — Push & Deep Linking](06-ios-push-deeplinks.md) | APNs registration, notification handling, universal links |
| [07 — Social & Chat](07-ios-social.md) | League feed, contest chat, DMs |
| [08 — Settings & Profile](08-ios-settings.md) | Profile, notification prefs, timezone, privacy |

## Relationship to Backend Plans

The iOS app does NOT duplicate backend logic. Every screen maps to existing API endpoints:

| iOS Screen | Backend API | Backend Plan |
|---|---|---|
| Login | `POST /api/v1/auth/login` | Plan 01 |
| League list | `GET /api/v1/leagues` | Plan 01 |
| Contest detail | `GET /api/v1/contests/:id` | Plan 02 |
| Draft room | Draft service WebSocket | Plan 02 |
| Standings | `GET /api/v1/contests/:id/history/standings` | Plan 04 |
| Notifications | `GET /api/v1/notifications` | Plan 09 |
| Push registration | `POST /api/v1/devices` | Plan 09 |

## Implementation Priority

1. Auth + home + leagues (MVP — read-only browsing)
2. Contests + standings (core value)
3. Draft room (highest engagement feature)
4. Push + deep linking (re-engagement)
5. Social + polish (retention)
