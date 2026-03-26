# PoolMaster — Notifications & Alerts System Plan

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

## Overview

Notifications are the primary re-engagement mechanism for PoolMaster. They drive users back into the app at the right moments — when it's their turn to draft, when scores change, when they win a prize. Every service in the system emits events that the Notification Service subscribes to and routes through the appropriate channel. This plan defines the event taxonomy, channel architecture, user preference model, template system, and delivery infrastructure.

---

## 1. Notification Channels

### Channel Definitions

| Channel | Transport | Latency | Use Case | Opt-out Default |
|---|---|---|---|---|
| **Push** | APNs (iOS) + FCM (Android) | < 5s | Time-sensitive: draft picks, score milestones | Opt-in at install |
| **In-App** | Persistent notification centre | Instant | All events; the canonical record | Always on |
| **Email** | Transactional email (SES/SendGrid) | < 60s | Summaries, digests, account events | On by default |
| **SMS** | Twilio (optional) | < 10s | Draft clock urgency only | Opt-in only |

### Channel Provider Abstraction

```typescript
interface NotificationChannel {
  channel_type: 'PUSH' | 'IN_APP' | 'EMAIL' | 'SMS';

  send(notification: RenderedNotification): Promise<DeliveryResult>;
  sendBatch(notifications: RenderedNotification[]): Promise<DeliveryResult[]>;
}

interface RenderedNotification {
  recipient_user_id: string;
  channel: 'PUSH' | 'IN_APP' | 'EMAIL' | 'SMS';
  title: string;
  body: string;
  data: Record<string, any>;           // payload for deep linking / in-app routing
  image_url?: string;                  // rich push / email header image
  action_url?: string;                 // deep link or web URL
  priority: 'HIGH' | 'NORMAL' | 'LOW';
  ttl_seconds?: number;               // time-to-live for push (don't deliver stale picks)
  collapse_key?: string;               // group/replace notifications on device
}

interface DeliveryResult {
  notification_id: string;
  channel: string;
  status: 'SENT' | 'DELIVERED' | 'FAILED' | 'SUPPRESSED' | 'BOUNCED';
  provider_message_id?: string;
  error?: string;
  timestamp: Date;
}
```

### Provider Abstraction Layer

```typescript
interface PushProvider {
  sendToDevice(token: string, payload: PushPayload): Promise<DeliveryResult>;
  sendToTopic(topic: string, payload: PushPayload): Promise<DeliveryResult>;
}

interface EmailProvider {
  sendTransactional(to: string, template: string, data: Record<string, any>): Promise<DeliveryResult>;
  sendBatch(recipients: EmailRecipient[], template: string): Promise<DeliveryResult[]>;
}

// Implementations: APNs, FCM, SES, SendGrid, Twilio
// Swap provider by changing the registered implementation — no business logic changes
```

---

## 2. Notification Event Taxonomy

Every triggerable event in the system, organised by source service.

### Draft Events

| Event | Channels | Priority | Description |
|---|---|---|---|
| `draft.starting_soon` | Push, Email, In-App | HIGH | Draft starts in 1h/15m |
| `draft.on_the_clock` | Push, SMS, In-App | HIGH | It's your turn to pick |
| `draft.clock_warning` | Push, In-App | HIGH | 5 min / 1 min remaining on your pick |
| `draft.pick_made` | In-App | NORMAL | A pick was made (by anyone in draft) |
| `draft.your_pick_confirmed` | Push, In-App | NORMAL | Your pick was successfully submitted |
| `draft.auto_picked` | Push, In-App | HIGH | Auto-pick triggered for you (you missed your window) |
| `draft.completed` | Push, Email, In-App | NORMAL | Draft is complete — view your roster |
| `draft.paused` | Push, In-App | HIGH | Commissioner paused the draft |
| `draft.resumed` | Push, In-App | HIGH | Draft has resumed |

### Scoring Events

| Event | Channels | Priority | Description |
|---|---|---|---|
| `scoring.taken_the_lead` | Push, In-App | HIGH | You've moved into first place |
| `scoring.overtaken` | Push, In-App | NORMAL | You've dropped from first place |
| `scoring.position_change` | In-App | LOW | Your standings position changed |
| `scoring.milestone` | Push, In-App | NORMAL | Your team hit a scoring milestone |
| `scoring.participant_performance` | In-App | LOW | Notable performance by your drafted participant |
| `scoring.event_started` | Push, In-App | NORMAL | The sporting event has begun — live scoring active |
| `scoring.event_completed` | Push, In-App | NORMAL | The sporting event has ended |
| `scoring.correction_applied` | Push, In-App | NORMAL | A score correction was applied |

### Contest Events

| Event | Channels | Priority | Description |
|---|---|---|---|
| `contest.created` | Push, Email, In-App | NORMAL | New contest available in your league |
| `contest.lock_approaching` | Push, Email, In-App | HIGH | Picks lock in 24h / 1h |
| `contest.locked` | In-App | NORMAL | Contest is locked — no more changes |
| `contest.completed` | Push, Email, In-App | HIGH | Contest final results are in |
| `contest.you_won` | Push, Email, In-App | HIGH | Congratulations — you won! |
| `contest.payout_confirmed` | Push, Email, In-App | HIGH | Your payout has been confirmed |
| `contest.intermediate_prize` | Push, In-App | NORMAL | You won an intermediate prize |

### League Events

| Event | Channels | Priority | Description |
|---|---|---|---|
| `league.member_joined` | In-App | LOW | A new member joined the league |
| `league.member_left` | In-App | LOW | A member left the league |
| `league.invitation_received` | Push, Email, In-App | HIGH | You've been invited to a league |
| `league.announcement` | Push, Email, In-App | HIGH | Commissioner posted an announcement |
| `league.weekly_recap` | Email, In-App | NORMAL | Weekly league summary digest |

### Social Events

| Event | Channels | Priority | Description |
|---|---|---|---|
| `social.reply_to_your_post` | Push, In-App | NORMAL | Someone replied to your post |
| `social.reaction_to_your_post` | In-App | LOW | Someone reacted to your post |
| `social.mentioned` | Push, In-App | NORMAL | You were @mentioned |
| `social.direct_message` | Push, In-App | NORMAL | You received a direct message |

### Account Events

| Event | Channels | Priority | Description |
|---|---|---|---|
| `account.welcome` | Email | NORMAL | Welcome to PoolMaster |
| `account.password_reset` | Email | HIGH | Password reset requested |
| `account.email_changed` | Email | HIGH | Email address updated |
| `account.payment_failed` | Email, In-App | HIGH | Subscription payment failed |
| `account.plan_changed` | Email, In-App | NORMAL | Subscription plan updated |
| `account.trial_ending` | Email, Push, In-App | HIGH | Trial ends in 3 days / 1 day |

---

## 3. Event Schema

All services emit notification events to the message bus using a standardised schema.

```typescript
interface NotificationEvent {
  id: string;                          // unique event ID (idempotency)
  type: string;                        // e.g. "draft.on_the_clock"
  source_service: string;              // e.g. "draft-service"
  timestamp: Date;

  // Targeting
  tenant_id: string;
  league_id?: string;
  contest_id?: string;
  recipient_user_ids?: string[];       // specific recipients
  recipient_scope?: 'ALL_LEAGUE' | 'ALL_CONTEST' | 'COMMISSIONERS' | 'SPECIFIC';

  // Template data
  data: Record<string, any>;          // variables for template rendering
  // e.g. { team_name: "Tiger's Team", position: 1, score: 245, prize_amount: 500 }

  // Routing hints
  priority: 'HIGH' | 'NORMAL' | 'LOW';
  channels?: ('PUSH' | 'IN_APP' | 'EMAIL' | 'SMS')[];  // override default channels
  ttl_seconds?: number;               // expire if not delivered within this window
  collapse_key?: string;              // group/replace on device

  // Deep linking
  action: {
    type: 'NAVIGATE';
    screen: string;                    // e.g. "draft_room", "contest_standings", "league_feed"
    params: Record<string, string>;    // e.g. { contest_id: "abc123" }
  };
}
```

### Event Bus Integration

```
Services emit events to:
  Redis Streams topic: "notifications:{event_type}"

Notification Service subscribes to:
  "notifications:*" (wildcard consumer group)

Processing:
  1. Receive event from bus
  2. Resolve recipients (expand scopes → user IDs)
  3. For each recipient:
     a. Check user preference for this event type + channel
     b. Check suppression rules
     c. Render template per channel
     d. Enqueue for delivery
```

---

## 4. User Preference Model

Users control which notifications they receive and on which channels.

### Preference Schema

```typescript
interface NotificationPreferences {
  user_id: string;

  // Global controls
  do_not_disturb: boolean;
  do_not_disturb_schedule?: {
    enabled: boolean;
    start_time: string;                // "22:00" (local time)
    end_time: string;                  // "07:00"
    timezone: string;
  };

  // Per-category preferences
  categories: Record<NotificationCategory, CategoryPreference>;
}

type NotificationCategory =
  | 'DRAFT'
  | 'SCORING'
  | 'CONTEST'
  | 'LEAGUE'
  | 'SOCIAL'
  | 'ACCOUNT';

interface CategoryPreference {
  enabled: boolean;                    // master toggle for this category
  channels: {
    push: boolean;
    email: boolean;
    in_app: boolean;                   // in-app is always true; UI may hide toggle
    sms: boolean;
  };
}

// Fine-grained overrides (optional — for power users)
interface NotificationOverride {
  user_id: string;
  event_type: string;                  // e.g. "scoring.overtaken"
  channels: {
    push?: boolean;
    email?: boolean;
    sms?: boolean;
  };
}
```

### Default Preferences (New User)

```typescript
const DEFAULT_PREFERENCES: Record<NotificationCategory, CategoryPreference> = {
  DRAFT: {
    enabled: true,
    channels: { push: true, email: true, in_app: true, sms: false },
  },
  SCORING: {
    enabled: true,
    channels: { push: true, email: false, in_app: true, sms: false },
  },
  CONTEST: {
    enabled: true,
    channels: { push: true, email: true, in_app: true, sms: false },
  },
  LEAGUE: {
    enabled: true,
    channels: { push: false, email: false, in_app: true, sms: false },
  },
  SOCIAL: {
    enabled: true,
    channels: { push: true, email: false, in_app: true, sms: false },
  },
  ACCOUNT: {
    enabled: true,
    channels: { push: false, email: true, in_app: true, sms: false },
  },
};
```

### Commissioner Override

Commissioners can send league-wide announcements that bypass user notification preferences (except for fully unsubscribed / blocked users):

```typescript
interface CommissionerAnnouncement {
  league_id: string;
  title: string;
  body: string;
  bypass_preferences: true;            // always delivered to all league members
  channels: ('PUSH' | 'EMAIL' | 'IN_APP')[];
}
```

---

## 5. In-App Notification Centre

A persistent, dismissable notification inbox within the app.

### Notification Model

```typescript
interface InAppNotification {
  id: string;
  user_id: string;
  event_type: string;
  title: string;
  body: string;
  image_url?: string;
  action: {
    type: 'NAVIGATE';
    screen: string;
    params: Record<string, string>;
  };
  read: boolean;
  read_at?: Date;
  dismissed: boolean;
  created_at: Date;
  group_key?: string;                  // for grouping related notifications
}
```

### Grouping & Collapsing

To prevent notification overload, related notifications are grouped:

```
Scoring events during a live event:
  Instead of 20 individual "position changed" notifications →
  One grouped notification: "Your position changed 5 times during Round 2"
  with latest position shown

Draft picks in a live draft:
  Instead of 12 "pick made" notifications →
  One grouped notification: "12 picks made in Masters Pool draft"
  Your picks shown individually
```

### Notification Centre API

```
GET    /api/v1/notifications                    # List notifications (paginated)
GET    /api/v1/notifications/unread-count        # Badge count
PUT    /api/v1/notifications/:id/read            # Mark as read
PUT    /api/v1/notifications/read-all            # Mark all as read
DELETE /api/v1/notifications/:id                 # Dismiss
GET    /api/v1/notifications/preferences         # Get preferences
PUT    /api/v1/notifications/preferences         # Update preferences
```

---

## 6. Template System

Notification copy is data-driven, not hardcoded. Templates support variable substitution and are versioned.

### Template Structure

```typescript
interface NotificationTemplate {
  id: string;
  event_type: string;                  // maps to NotificationEvent.type
  version: number;

  // Per-channel templates
  push: {
    title: string;                     // "It's your pick!"
    body: string;                      // "{{team_name}}, you're on the clock in {{contest_name}}"
  };
  email: {
    subject: string;
    html_template: string;            // Handlebars/Mustache template
    text_template: string;            // plain text fallback
  };
  in_app: {
    title: string;
    body: string;
    icon?: string;                     // icon type for the notification centre
  };
  sms: {
    body: string;                      // max 160 chars
  };

  // Template metadata
  category: NotificationCategory;
  description: string;
  variables: TemplateVariable[];       // documented variables available
  active: boolean;
}

interface TemplateVariable {
  name: string;                        // e.g. "team_name"
  type: 'string' | 'number' | 'date' | 'currency';
  description: string;
  example: string;
}
```

### Example Templates

```typescript
// draft.on_the_clock
{
  event_type: 'draft.on_the_clock',
  push: {
    title: "You're on the clock!",
    body: "{{team_name}}, it's your pick in {{contest_name}}. {{time_remaining}} remaining.",
  },
  email: {
    subject: "It's your turn to pick — {{contest_name}}",
    html_template: "...",  // full email with draft board preview
  },
  in_app: {
    title: "Your pick — {{contest_name}}",
    body: "You're on the clock! Pick {{pick_number}} of {{total_picks}}. {{time_remaining}} remaining.",
  },
  sms: {
    body: "PoolMaster: Your pick in {{contest_name}}! {{time_remaining}} left. Tap to pick: {{action_url}}",
  },
}

// contest.you_won
{
  event_type: 'contest.you_won',
  push: {
    title: "You won {{contest_name}}!",
    body: "Congratulations! Final score: {{score}} points. Prize: {{prize_amount}}.",
  },
  email: {
    subject: "🏆 You won {{contest_name}}!",
    html_template: "...",  // celebratory email with final standings
  },
  in_app: {
    title: "Winner — {{contest_name}}",
    body: "Congratulations! You finished 1st with {{score}} points. Prize: {{prize_amount}}.",
  },
}
```

---

## 7. Suppression & Rate Limiting

Prevent notification storms during live scoring events and protect against abuse.

### Rate Limits

```typescript
interface RateLimitConfig {
  // Per-user limits
  push_per_hour: 20;                   // max push notifications per user per hour
  email_per_day: 10;                   // max emails per user per day
  sms_per_day: 5;                      // max SMS per user per day

  // Per-event-type limits (collapse window)
  scoring_position_change: {
    max_per_hour: 3;                   // max 3 "position changed" notifications per hour
    collapse_window_minutes: 15;       // group changes within 15 minutes
  };

  // Global limits
  email_per_minute_global: 500;        // SES/SendGrid rate limit
  push_per_second_global: 1000;        // FCM/APNs throughput
}
```

### Suppression Rules

```typescript
interface SuppressionRules {
  // Don't send push during do-not-disturb hours
  respect_dnd: true;

  // Don't send scoring notifications for inactive contests
  suppress_for_inactive_contests: true;

  // Batch low-priority notifications into digest
  digest_low_priority: {
    enabled: true;
    batch_window_minutes: 60;          // collect for 1 hour, send as one notification
    channels: ['EMAIL'];               // only batch emails; push stays real-time
  };

  // De-duplicate identical notifications within window
  dedup_window_seconds: 300;           // don't send the same notification twice in 5 min

  // Suppress if user has the app open and is on the relevant screen
  suppress_if_active_on_screen: true;  // don't push "your pick" if they're in the draft room
}
```

---

## 8. Scheduled Notifications

Some notifications are time-based and require a job scheduler.

### Scheduled Event Types

```typescript
interface ScheduledNotification {
  id: string;
  event_type: string;
  fire_at: Date;                       // when to send
  context: Record<string, any>;        // data needed to render at fire time

  // Source
  source_type: 'CONTEST' | 'DRAFT' | 'TRIAL' | 'SYSTEM';
  source_id: string;

  // Status
  status: 'PENDING' | 'FIRED' | 'CANCELLED';
  cancelled_reason?: string;
}

// Examples:
// - "Draft starts in 1 hour" → scheduled for (draft_start - 1h)
// - "Picks lock in 24 hours" → scheduled for (lock_time - 24h)
// - "Trial ends in 3 days" → scheduled for (trial_end - 3d)
// - "Weekly recap" → recurring every Monday at configured time
```

### Scheduler Implementation

```
Job queue (BullMQ on Redis):
  1. When a contest/draft is created, enqueue scheduled notifications
  2. Each job has a delay (fire_at - now)
  3. At fire time: job executes, checks if still relevant (contest not cancelled?)
  4. If relevant: emit NotificationEvent to the bus
  5. If no longer relevant: mark as CANCELLED, skip

Cancellation:
  - When a contest is cancelled/deleted: cancel all pending scheduled notifications
  - When a draft time changes: reschedule associated notifications
```

---

## 9. Push Notification Device Management

### Device Token Registration

```typescript
interface DeviceRegistration {
  id: string;
  user_id: string;
  platform: 'IOS' | 'ANDROID' | 'WEB';
  token: string;                       // APNs token, FCM token, or web push subscription
  app_version: string;
  os_version: string;
  device_model?: string;
  last_active_at: Date;
  registered_at: Date;
  is_active: boolean;
}
```

### Token Lifecycle

```
Registration:
  1. App obtains push token from OS (APNs/FCM)
  2. App sends token to backend: POST /api/v1/devices
  3. Backend stores token, associates with authenticated user

Refresh:
  1. OS issues new token → app re-registers
  2. Backend updates existing device record

Deregistration:
  1. User logs out → deactivate device token
  2. Push fails with "invalid token" → remove device record
  3. User uninstalls → token becomes invalid, cleaned up on next failed delivery

Multi-device:
  - A user may have multiple active devices
  - Push notifications sent to ALL active devices
  - In-app notification centre syncs read state across devices
```

---

## 10. Delivery Tracking & Analytics

### Delivery States

```
QUEUED → SENT → DELIVERED → OPENED/TAPPED
                    ↓
                 BOUNCED (email) / FAILED (push)
                    ↓
                SUPPRESSED (rate limit, preference, DND)
```

### Tracking Schema

```typescript
interface DeliveryRecord {
  id: string;
  notification_event_id: string;
  user_id: string;
  channel: 'PUSH' | 'EMAIL' | 'IN_APP' | 'SMS';
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'OPENED' | 'TAPPED' | 'BOUNCED' | 'FAILED' | 'SUPPRESSED';
  suppression_reason?: string;
  provider_message_id?: string;
  sent_at?: Date;
  delivered_at?: Date;
  opened_at?: Date;
  tapped_at?: Date;
  failed_reason?: string;
  created_at: Date;
}
```

### Analytics Dashboard (Internal)

| Metric | Description |
|---|---|
| Delivery rate | % of notifications successfully delivered per channel |
| Open rate | % of emails opened, push tapped |
| Suppression rate | % blocked by preferences, rate limits, or DND |
| Bounce rate | % of emails bounced (hard/soft) |
| Notification volume | Notifications sent per hour/day, by type |
| Engagement by type | Which notification types drive the most taps/opens |
| Channel effectiveness | Delivery + open rates compared across channels |
| Opt-out rate | Users disabling notification categories over time |

---

## 11. Weekly Digest

A configurable automated email summary sent to league members.

### Digest Content

```typescript
interface WeeklyDigest {
  league_id: string;
  league_name: string;
  period_start: Date;
  period_end: Date;

  sections: {
    // Active contest standings snapshot
    standings: {
      contest_name: string;
      top_3: { team_name: string; score: number; rank: number }[];
      your_position: { rank: number; score: number; movement: number };
    }[];

    // Notable events this week
    highlights: string[];
    // "Alex took the lead in Masters Pool"
    // "Jordan won the Round 2 leader prize ($50)"
    // "New record: highest single-round score by Team Sarah"

    // Upcoming events
    upcoming: {
      event: string;
      date: string;
      action_needed?: string;
    }[];

    // League activity summary
    activity: {
      posts: number;
      reactions: number;
      new_members: number;
    };
  };
}
```

### Digest Configuration

```
Commissioner controls:
  ├── Enabled/disabled per league
  ├── Day of week (default: Monday)
  ├── Time of day (default: 9am league timezone)
  └── Sections to include (all by default)

User controls:
  ├── Opt out of digest entirely (notification preferences)
  └── Digest is always available in-app notification centre regardless
```

---

## 12. Database Schema

```sql
-- In-app notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  event_type VARCHAR(100) NOT NULL,
  title VARCHAR(500) NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT,
  action_screen VARCHAR(100),
  action_params JSONB DEFAULT '{}',
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  dismissed BOOLEAN DEFAULT FALSE,
  group_key VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User notification preferences
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  do_not_disturb BOOLEAN DEFAULT FALSE,
  dnd_schedule JSONB,
  category_preferences JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fine-grained overrides
CREATE TABLE notification_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  event_type VARCHAR(100) NOT NULL,
  channel_overrides JSONB NOT NULL,
  UNIQUE(user_id, event_type)
);

-- Device registrations
CREATE TABLE device_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  platform VARCHAR(20) NOT NULL,
  token TEXT NOT NULL,
  app_version VARCHAR(50),
  os_version VARCHAR(50),
  device_model VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, token)
);

-- Notification templates
CREATE TABLE notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  push_title VARCHAR(255),
  push_body TEXT,
  email_subject VARCHAR(255),
  email_html TEXT,
  email_text TEXT,
  in_app_title VARCHAR(255),
  in_app_body TEXT,
  in_app_icon VARCHAR(50),
  sms_body VARCHAR(160),
  category VARCHAR(50) NOT NULL,
  variables JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_type, version)
);

-- Scheduled notifications
CREATE TABLE scheduled_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  fire_at TIMESTAMPTZ NOT NULL,
  context JSONB NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  source_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  cancelled_reason VARCHAR(255),
  fired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Delivery tracking
CREATE TABLE notification_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_event_id VARCHAR(255) NOT NULL,
  user_id UUID NOT NULL,
  channel VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  suppression_reason VARCHAR(255),
  provider_message_id VARCHAR(255),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  tapped_at TIMESTAMPTZ,
  failed_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, read, created_at DESC);
CREATE INDEX idx_notifications_group ON notifications(user_id, group_key);
CREATE INDEX idx_devices_user ON device_registrations(user_id, is_active);
CREATE INDEX idx_devices_token ON device_registrations(token);
CREATE INDEX idx_scheduled_fire ON scheduled_notifications(status, fire_at);
CREATE INDEX idx_delivery_event ON notification_delivery_log(notification_event_id);
CREATE INDEX idx_delivery_user ON notification_delivery_log(user_id, created_at);
```

---

## 13. Architecture Diagram

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Draft      │  │   Scoring   │  │   Contest   │  │   Social    │
│   Service    │  │   Engine    │  │   Service   │  │   Service   │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │                │
       └────────────────┼────────────────┼────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │   Message Bus    │
              │ (Redis Streams)  │
              │ topic:           │
              │  notifications:* │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────────────────────────────┐
              │         Notification Service              │
              │                                          │
              │  ┌──────────┐  ┌───────────────────┐    │
              │  │ Recipient │  │    Preference     │    │
              │  │ Resolver  │  │    Checker        │    │
              │  └─────┬────┘  └────────┬──────────┘    │
              │        │               │                │
              │        ▼               ▼                │
              │  ┌──────────────────────────────┐       │
              │  │    Suppression Engine         │       │
              │  │ (rate limits, DND, dedup)     │       │
              │  └──────────────┬───────────────┘       │
              │                 │                        │
              │  ┌──────────────▼───────────────┐       │
              │  │    Template Renderer          │       │
              │  └──────────────┬───────────────┘       │
              │                 │                        │
              │     ┌───────────┼───────────┐           │
              │     ▼           ▼           ▼           │
              │  ┌──────┐  ┌──────┐  ┌──────┐         │
              │  │ Push  │  │Email │  │In-App│  ...    │
              │  │Channel│  │Channel│  │Channel│        │
              │  └───┬──┘  └───┬──┘  └───┬──┘         │
              │      │         │         │              │
              └──────┼─────────┼─────────┼──────────────┘
                     │         │         │
                     ▼         ▼         ▼
                   APNs/     SES/      PostgreSQL
                   FCM     SendGrid   (notifications
                                       table)
```

---

## 14. Implementation Phases

### Phase 1 — Foundation
- NotificationEvent schema in shared events package
- Notification Service skeleton (message bus consumer)
- In-app notification centre (database + API + basic UI)
- User preference model with defaults
- Template system with initial templates for draft events

### Phase 2 — Push Notifications
- Device registration API
- APNs integration (iOS)
- FCM integration (Android)
- Push delivery for draft events (on-the-clock, clock warnings)
- Deep linking from push to correct app screen

### Phase 3 — Email
- Email provider integration (SES or SendGrid)
- Transactional email templates (draft, contest results, account)
- Email delivery tracking (open, click)
- Unsubscribe handling

### Phase 4 — Suppression & Scheduling
- Rate limiting engine
- Suppression rules (DND, dedup, batching)
- Scheduled notification job queue
- Scoring event grouping/collapsing

### Phase 5 — Digest & Analytics
- Weekly digest generation and delivery
- Delivery analytics dashboard
- Notification preference UI (granular controls)
- Commissioner announcement bypass
- SMS channel (optional, if demand warrants)

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 09-001 | 1 | NotificationEvent schema in `poolmaster_shared/events/` | Done | Full event schema + 35 event type constants |
| 09-002 | 1 | Notification Service skeleton (message bus consumer) | Done | Fastify app on port 3004, InAppChannel wired |
| 09-003 | 1 | `notifications` table (in-app notification centre) | Done | + NotificationPreference, NotificationTemplate, DeviceRegistration, ScheduledNotification models |
| 09-004 | 1 | In-app notification API (list, unread count, mark read, dismiss) | Done | Full CRUD at /api/v1/notifications |
| 09-005 | 1 | `notification_preferences` table + default preferences | Done | Upsert preferences + per-category defaults |
| 09-006 | 1 | `notification_templates` table + initial draft event templates | Done | 14 seed templates across all categories |
| 09-007 | 1 | Template renderer (variable substitution) | Done | Mustache-style {{var}} rendering per channel |
| 09-008 | 2 | `device_registrations` table | Not Started | |
| 09-009 | 2 | Device registration API (`POST /api/v1/devices`) | Not Started | |
| 09-010 | 2 | APNs push channel integration (iOS) | Not Started | |
| 09-011 | 2 | FCM push channel integration (Android) | Not Started | |
| 09-012 | 2 | Push delivery for draft events (on-the-clock, clock warnings) | Not Started | |
| 09-013 | 2 | Deep linking from push notification to correct app screen | Not Started | |
| 09-014 | 3 | Email channel integration (SES or SendGrid) | Not Started | |
| 09-015 | 3 | Transactional email templates (draft, contest results, account) | Not Started | |
| 09-016 | 3 | Email delivery tracking (sent, delivered, opened, clicked) | Not Started | |
| 09-017 | 3 | Unsubscribe handling (per-category opt-out) | Not Started | |
| 09-018 | 4 | Rate limiting engine (per-user, per-channel, per-event-type) | Not Started | |
| 09-019 | 4 | Suppression rules (DND schedule, dedup, batch low-priority) | Not Started | |
| 09-020 | 4 | `scheduled_notifications` table + job queue (BullMQ) | Not Started | |
| 09-021 | 4 | Scheduled notifications (24h before lock, 1h before draft) | Not Started | |
| 09-022 | 4 | Scoring event grouping/collapsing | Not Started | |
| 09-023 | 5 | Weekly digest generation and email delivery | Not Started | |
| 09-024 | 5 | `notification_delivery_log` table + analytics | Not Started | |
| 09-025 | 5 | Delivery analytics dashboard (rates, suppression, engagement) | Not Started | |
| 09-026 | 5 | Notification preference UI (granular per-category per-channel) | Not Started | |
| 09-027 | 5 | Commissioner announcement bypass | Not Started | |
| 09-028 | 5 | SMS channel via Twilio (optional) | Not Started | |

---

*Generated by Claude — PoolMaster Notifications & Alerts System Plan v1.0*
