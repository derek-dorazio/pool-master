# Plan 47 Companion: Notification Feed User Cases

## Purpose

Define the first-pass communication model for PoolMaster as a single in-app
notification feed.

This is intentionally much smaller than the current social + notifications
surface. In the first pass, the product should support:

- site-wide system messages
- league-wide messages
- system-generated event notifications

It should not support a full social product, threaded chat, direct messages,
push delivery, email delivery, or digest workflows.

## Core Model Direction

Use a simple two-part model:

- `Notification`
  - canonical message record
- `NotificationReceipt`
  - per-user read and dismiss tracking

### Notification scope

- site-wide message
  - `leagueId = null`
- league-wide message
  - `leagueId = <league id>`

When a user is viewing one active league, the feed should show:

- messages where `leagueId = activeLeagueId`
- plus messages where `leagueId IS NULL`

## Primary Actors

- League Member
- Commissioner
- System

## Core Use Cases

### N-001: User views in-app notification feed

Actor:
- League Member

Goal:
- see relevant system and league messages in one place

Flow:
1. User opens the notification feed.
2. System loads notifications for the active league.
3. System also loads site-wide notifications with `leagueId = null`.
4. UI shows one merged in-app feed.

Notes:
- users are always in one active league context at a time
- site-wide notifications still appear in every league context

### N-002: System sends a site-wide notification

Actor:
- System

Goal:
- display a platform-wide message to users in-app

Flow:
1. System creates one `Notification` row with `leagueId = null`.
2. Users see that message in the feed regardless of which league they are viewing.

Examples:
- maintenance notice
- platform availability message

### N-003: Commissioner sends a league-wide message

Actor:
- Commissioner

Goal:
- message all members of a league through the in-app feed

Flow:
1. Commissioner composes a message for the active league.
2. Backend creates one `Notification` row for that league.
3. Members of that league see the message in their feed.

Examples:
- draft reminder
- league announcement
- contest reminder

### N-004: Subsystems push event-driven notifications

Actor:
- System

Goal:
- notify users about important workflow events

Flow:
1. A subsystem emits a notification-worthy event.
2. Backend creates a `Notification` row with optional `sourceType` and `sourceId`.
3. UI can later deep-link from the notification back to the source object.

Examples:
- draft approaching in 1 day
- draft approaching in 1 hour
- draft started
- draft completed
- entry won contest prize

### N-005: User opens a notification

Actor:
- League Member

Goal:
- read a notification and automatically mark it as read

Flow:
1. User opens a notification in the feed.
2. System creates or updates the user's `NotificationReceipt`.
3. `readAt` is recorded automatically.

Notes:
- no explicit "mark as read" action is required from the user

### N-006: User dismisses a notification

Actor:
- League Member

Goal:
- hide a notification from their feed

Flow:
1. User clicks the dismiss control on a notification.
2. System creates or updates the user's `NotificationReceipt`.
3. `dismissedAt` is recorded.
4. The notification is hidden from that user's feed.

Notes:
- dismiss is an explicit user action
- read is implicit when the notification is opened

## Deferred Communication Features

These are explicitly deferred and should not influence first-pass design:

- direct person-to-person messaging
- threaded conversations
- contest chat
- league social feed posts/replies/reactions
- push notifications
- email delivery
- SMS delivery
- weekly digest
- delivery analytics
- notification templates
- global announcements as a separate product concept

## Implementation Guidance

Agents implementing first-pass communication should prefer:

- one in-app feed
- one canonical `Notification` model
- one `NotificationReceipt` model for read/dismiss state
- `sourceType` / `sourceId` for future deep links

Agents should avoid:

- rebuilding the current social feed
- introducing direct-message or chat subsystems
- preserving push/email scheduling infrastructure as a requirement
