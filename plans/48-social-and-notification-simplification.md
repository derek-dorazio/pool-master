# Plan 48: Social And Notification Simplification

## Purpose

Simplify PoolMaster communication down to a single in-app notification feed for
the first pass.

This plan replaces the current combination of:

- social feed
- direct conversations
- contest chat
- in-app notifications
- push/email scheduling infrastructure
- digest and delivery analytics scaffolding

with a smaller core model centered on:

- `Notification`
- `NotificationReceipt`

## First-Pass Product Definition

The first pass only needs:

- site-wide messages
- league-wide messages
- system-generated workflow notifications
- in-app feed delivery only

The first pass does **not** need:

- direct messages
- social feed posts/replies/reactions
- contest chat
- push delivery
- email delivery
- digests
- delivery analytics
- template management

## Target Model

### Notification

Canonical message record.

Recommended fields:

- `id`
- `leagueId?`
  - `null` means site-wide
- `senderUserId?`
- `senderDisplayName`
- `type`
- `subject`
- `body`
- `sourceType?`
- `sourceId?`
- `createdAt`
- `updatedAt`

### NotificationReceipt

Per-user state for a notification.

Recommended fields:

- `id`
- `notificationId`
- `userId`
- `readAt?`
- `dismissedAt?`
- `createdAt`
- `updatedAt`

## Locked Direction

The following is considered settled for the first pass:

- `Notification` is the canonical communication object
- `NotificationReceipt` stores per-user feed state
- site-wide messages use `leagueId = null`
- active league feeds should load:
  - notifications for the active league
  - plus notifications where `leagueId IS NULL`
- `readAt` is updated automatically when the user opens a notification
- `dismissedAt` is updated when the user explicitly dismisses a notification
- person-to-person messaging is deferred
- delivery outside the app is deferred
- `sourceType` and `sourceId` should remain available for future deep-link behavior

## Current Model Areas To Remove Or Defer

### Social module

These should be removed or deferred from first-pass implementation:

- feed posts
- feed replies
- reactions
- direct conversations
- direct messages
- contest chat
- share cards
- recap/social summary objects

### Notification subsystem

These should be removed or deferred from first-pass implementation:

- `NotificationPreference`
- `NotificationTemplate`
- `DeviceRegistration`
- `ScheduledNotification`
- `NotificationDeliveryLog`
- channel factory
- push channel
- email channel
- scheduled runner
- weekly digest
- template renderer
- event grouping and rate limiting infrastructure

### Admin communication surfaces

These should be removed or deferred:

- platform-wide announcements as a separate concept
- notification analytics and delivery dashboards

## Source Of Notifications

First-pass notification sources should include:

- commissioner-created league-wide messages
- site-wide system messages
- subsystem-generated workflow events

Examples:

- draft approaching in 1 day
- draft approaching in 1 hour
- draft started
- draft completed
- entry won contest prize

## Implementation Guidance

When implementing first-pass communication:

- build the in-app feed around `Notification` + `NotificationReceipt`
- do not fan out one full notification row per user for league-wide or site-wide messages
- use `NotificationReceipt` for per-user read/dismiss state instead
- keep system-generated and commissioner-authored messages in the same feed

## Task Outline

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 48-001 | 1 | Define first-pass communication as a single in-app notification feed | Done | Captured in Plan 47 |
| 48-002 | 1 | Introduce canonical `Notification` plus `NotificationReceipt` direction | Pending | Replace user-recipient fanout thinking |
| 48-003 | 1 | Defer person-to-person messaging and all broader social features | Pending | No DM/chat/feed in first pass |
| 48-004 | 2 | Remove or defer current social feed, conversation, and chat subsystems | Pending | Not part of first-pass product |
| 48-005 | 2 | Remove or defer notification templates, device registration, scheduled notifications, delivery logs, and channel infrastructure | Pending | In-app only first pass |
| 48-006 | 2 | Redesign notification APIs and DTOs around the simplified feed model | Pending | Align backend contract to minimal feed |
| 48-007 | 3 | Revisit email/push/digest only after the in-app feed is stable and useful | Pending | Explicitly out of scope now |

## Acceptance Criteria

- first-pass communication is defined as a single in-app feed
- league-wide and site-wide messages are both supported
- per-user read/dismiss state is modeled without duplicating full notification rows
- direct messaging, chat, and broader social features are clearly deferred
