# PoolMaster — Social & Communication Layer Plan

> **Archived (2026-04-06):** This plan is superseded by the simplified
> notification-feed direction and should not be used for implementation. Use
> [Plan 47 Companion: Notification Feed User Cases](../../47-notification-feed-user-cases.md)
> and [Plan 48: Social And Notification Simplification](../../48-social-and-notification-simplification.md).

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

## Overview

Social features are the primary retention driver in fantasy sports. Sleeper built market dominance largely on superior social experiences. Without this layer, PoolMaster is a score-tracking tool rather than a league home. This plan defines the league activity feed, contest-level chat, direct messaging, automated activity events, weekly recaps, share-to-social, and moderation — the features that keep members coming back between scoring events.

## Current MVP Interpretation

The active MVP only needs a **basic feed/messaging layer**:

- dashboard or league-level feed items
- commissioner announcements
- automated system/module messages such as contest created, draft time, or draft complete

Treat the following as deferred unless a fresh replanning pass promotes them:

- rich contest chat
- direct messages
- weekly recap generation
- public share cards
- full moderation/reporting suite

---

## 1. Communication Surfaces

### Surface Hierarchy

```
Tenant
└── League
    ├── League Activity Feed (primary social surface)
    │   ├── Member posts (threaded)
    │   ├── Commissioner announcements (pinned)
    │   ├── Automated activity events
    │   └── Weekly recaps
    ├── Contest Chat (per-contest, optional)
    │   ├── Live commentary during events
    │   └── Automated score events (interleaved)
    └── Direct Messages (1-to-1 between league members)
```

---

## 2. League Activity Feed

The primary social surface. A persistent, threaded feed at the league level where members post, react, and engage.

### Post Model

```typescript
interface FeedPost {
  id: string;
  league_id: string;
  author_id: string;                   // user ID, or 'SYSTEM' for automated events
  author_type: 'MEMBER' | 'COMMISSIONER' | 'SYSTEM';

  // Content
  content_type: 'TEXT' | 'IMAGE' | 'POLL' | 'ACTIVITY_EVENT' | 'RECAP' | 'ANNOUNCEMENT';
  body: string;                        // text content (markdown-lite: bold, italic, links, @mentions)
  media?: MediaAttachment[];
  poll?: PollData;

  // Display
  pinned: boolean;                     // commissioner can pin
  pinned_at?: Date;
  pinned_by?: string;

  // Threading
  parent_id?: string;                  // null for top-level posts; set for replies
  reply_count: number;
  latest_reply_at?: Date;

  // Reactions
  reactions: ReactionSummary;

  // Mentions
  mentions: string[];                  // user IDs mentioned with @

  // Moderation
  deleted: boolean;
  deleted_by?: string;
  deleted_reason?: string;

  created_at: Date;
  updated_at: Date;
}

interface MediaAttachment {
  id: string;
  type: 'IMAGE' | 'GIF';
  url: string;                         // CDN URL
  thumbnail_url: string;
  width: number;
  height: number;
  alt_text?: string;
}

interface PollData {
  question: string;
  options: PollOption[];
  closes_at?: Date;
  multiple_choice: boolean;
  anonymous: boolean;
}

interface PollOption {
  id: string;
  text: string;
  vote_count: number;
  voter_ids: string[];                 // empty if anonymous
}

interface ReactionSummary {
  total_count: number;
  by_type: Record<string, number>;     // { "👍": 5, "🔥": 3, "😂": 2 }
  user_reactions: string[];            // reaction types the current user has applied
}
```

### Feed API

```
GET    /api/v1/leagues/:id/feed                  # Get feed (paginated, newest first)
POST   /api/v1/leagues/:id/feed                  # Create post
GET    /api/v1/leagues/:id/feed/:postId          # Get post with replies
PUT    /api/v1/leagues/:id/feed/:postId          # Edit post (author only, within 15min)
DELETE /api/v1/leagues/:id/feed/:postId          # Delete post (author or commissioner)

# Replies
POST   /api/v1/leagues/:id/feed/:postId/replies  # Reply to post
GET    /api/v1/leagues/:id/feed/:postId/replies   # Get replies (paginated)

# Reactions
POST   /api/v1/leagues/:id/feed/:postId/reactions # Add reaction
DELETE /api/v1/leagues/:id/feed/:postId/reactions/:type  # Remove reaction

# Polls
POST   /api/v1/leagues/:id/feed/:postId/vote     # Vote on poll

# Pinning (commissioner only)
POST   /api/v1/leagues/:id/feed/:postId/pin      # Pin post
DELETE /api/v1/leagues/:id/feed/:postId/pin      # Unpin post
```

### Text Formatting

Support a minimal markdown subset for post content:

```
**bold text**       → <strong>bold text</strong>
*italic text*       → <em>italic text</em>
@username           → linked mention (triggers notification)
https://example.com → auto-linked URL
```

No full markdown — keep it simple and chat-like.

---

## 3. Automated Activity Events

System-generated feed posts that appear in the league activity feed, keeping the feed alive even when members aren't actively posting.

### Event Catalogue

```typescript
type ActivityEventType =
  // Draft events
  | 'DRAFT_STARTED'           // "Masters Pool draft has begun!"
  | 'DRAFT_COMPLETED'         // "Draft complete! View all rosters →"
  | 'DRAFT_PICK_NOTABLE'      // "Alex picked Tiger Woods #1 overall"

  // Scoring events
  | 'LEAD_CHANGE'             // "Alex just took the lead in Masters Pool!"
  | 'SCORING_MILESTONE'       // "Team Sarah hit 200 points — first team this season"
  | 'PARTICIPANT_PERFORMANCE' // "Scottie Scheffler shot 62 — lowest round of the tournament"
  | 'EVENT_STARTED'           // "The Masters is underway — live scoring is active"
  | 'EVENT_COMPLETED'         // "The Masters has concluded — final standings posted"

  // Contest events
  | 'CONTEST_CREATED'         // "New contest: Masters Pool 2026. Join the draft!"
  | 'CONTEST_COMPLETED'       // "Masters Pool final: Alex wins with 245 points!"
  | 'PRIZE_AWARDED'           // "Jordan won the Round 2 Leader prize ($50)"

  // Member events
  | 'MEMBER_JOINED'           // "Welcome Sarah to the league!"
  | 'MEMBER_ACHIEVEMENT'      // "Mike has won 3 contests this season — on fire!"

  // Records
  | 'RECORD_SET'              // "New league record: highest single-event score (287 pts by Team Alex)";

interface ActivityEvent {
  event_type: ActivityEventType;
  league_id: string;
  contest_id?: string;
  participant_ids?: string[];          // referenced participants
  user_ids?: string[];                 // referenced members
  headline: string;                    // "Alex just took the lead!"
  detail?: string;                     // "Masters Pool — 245 points, up from 3rd"
  image_url?: string;                  // participant photo or generated graphic
  action: {
    screen: string;
    params: Record<string, string>;
  };
}
```

### Event Generation Rules

```typescript
interface ActivityEventConfig {
  // Which events are auto-posted to the feed
  enabled_events: ActivityEventType[];

  // Throttling — prevent feed spam during live events
  throttle: {
    // Max lead change posts per hour per contest
    lead_change_max_per_hour: 3;

    // Only post participant performance if truly notable
    participant_performance_threshold: 'TOP_3_FINISH' | 'RECORD' | 'EAGLE_OR_BETTER';

    // Batch multiple draft picks into one summary post
    draft_pick_batch_window_minutes: 5;
  };

  // Commissioner can disable specific event types per league
  commissioner_overrides: Record<ActivityEventType, boolean>;
}
```

---

## 4. Contest Chat

Optional live chat within an active contest — particularly useful during live draft rooms and live scoring events.

### Chat Model

```typescript
interface ChatMessage {
  id: string;
  contest_id: string;
  author_id: string;
  author_type: 'MEMBER' | 'SYSTEM';
  content: string;                     // plain text, max 500 chars
  message_type: 'USER' | 'SCORE_EVENT' | 'DRAFT_EVENT' | 'SYSTEM';
  mentions: string[];
  deleted: boolean;
  created_at: Date;
}
```

### Chat Characteristics

- **Ephemeral:** Chat messages are retained for 30 days after contest completion, then archived
- **Lightweight:** No threading, no reactions, no media — just text and system events
- **Interleaved:** Automated score events and draft events appear inline with member messages
- **Real-time:** Delivered via WebSocket (see real-time architecture below)

### Chat vs Feed

| | League Feed | Contest Chat |
|---|---|---|
| Scope | League-wide | Single contest |
| Persistence | Permanent | 30-day retention |
| Threading | Yes | No |
| Reactions | Yes | No |
| Media | Images, GIFs, polls | Text only |
| System events | Activity events | Score/draft events |
| Real-time | Polling / WebSocket | WebSocket required |

---

## 5. Direct Messaging

Optional 1-to-1 messaging between league members.

### DM Model

```typescript
interface DirectMessage {
  id: string;
  conversation_id: string;            // deterministic from sorted user IDs
  sender_id: string;
  body: string;                        // plain text, max 2000 chars
  read: boolean;
  read_at?: Date;
  created_at: Date;
}

interface Conversation {
  id: string;
  participant_ids: [string, string];   // exactly two users
  league_id: string;                   // DMs are league-scoped (you can only DM league members)
  last_message_at: Date;
  last_message_preview: string;
  unread_count: Record<string, number>;  // per-participant unread counts
}
```

### DM API

```
GET    /api/v1/leagues/:id/conversations          # List conversations
GET    /api/v1/conversations/:id/messages          # Get messages (paginated)
POST   /api/v1/conversations/:id/messages          # Send message
PUT    /api/v1/conversations/:id/read              # Mark as read
```

### DM Restrictions

- DMs are league-scoped: you can only message members of shared leagues
- Commissioner can disable DMs for the league
- Users can block other users (prevents DMs from that user)
- Muted members cannot send DMs

---

## 6. Weekly Auto-Generated Recap

A rich summary post auto-generated and posted to the league feed.

### Recap Content

```typescript
interface WeeklyRecap {
  league_id: string;
  period: { start: Date; end: Date };

  sections: {
    // Contest standings snapshots
    active_contests: {
      name: string;
      leader: { team_name: string; score: number };
      biggest_mover: { team_name: string; positions_gained: number };
      your_position?: { rank: number; score: number };
    }[];

    // Highlights
    top_performer: {
      participant_name: string;
      stat_line: string;               // "Scottie Scheffler: 66-68-65 (-17)"
      teams_benefited: string[];       // teams who drafted this participant
    };

    // Records and milestones
    records_set: {
      record_name: string;
      holder: string;
      value: string;
    }[];

    // Upcoming
    upcoming_events: {
      event_name: string;
      date: string;
      contest_names: string[];
    }[];

    // Fun stats
    fun_stats: {
      label: string;
      value: string;
    }[];
    // "Most active poster this week: Alex (12 posts)"
    // "Closest contest: Masters Pool — 3 points separate 1st and 2nd"
    // "Biggest comeback: Team Jordan climbed 5 spots this week"
  };
}
```

### Recap Generation

```
Schedule: weekly, on commissioner-configured day (default Monday)
Process:
  1. Query all active contests in the league
  2. Compute standings changes over the past 7 days
  3. Identify notable performances from scoring data
  4. Check for any new records
  5. Compile upcoming events from schedule
  6. Generate fun stats from activity and scoring data
  7. Render as a formatted FeedPost with content_type = 'RECAP'
  8. Post to league feed
  9. Send as email digest to members who have digest enabled
```

---

## 7. Share-to-Social

Generate shareable cards for notable moments that members can share on external platforms.

### Shareable Moments

```typescript
type ShareableMoment =
  | 'CONTEST_WIN'                      // "I won the Masters Pool on PoolMaster!"
  | 'RECORD_SET'                       // "New league record!"
  | 'TROPHY_AWARDED'                   // season-end trophy
  | 'FINAL_STANDINGS'                  // full contest leaderboard
  | 'DRAFT_RECAP'                      // your drafted roster
  | 'SEASON_WRAP'                      // end-of-season summary
  ;
```

### Share Card Generation

```typescript
interface ShareCard {
  moment_type: ShareableMoment;
  data: Record<string, any>;           // context for rendering

  // Generated assets
  og_image_url: string;                // 1200×630 OG image for link previews
  square_image_url: string;            // 1080×1080 for Instagram
  share_url: string;                   // public URL that resolves to a shareable view
  share_text: string;                  // pre-filled share copy

  // Platforms
  share_targets: {
    twitter: { url: string; text: string };
    facebook: { url: string };
    instagram: { image_url: string };  // user downloads and shares manually
    imessage: { url: string; text: string };
    copy_link: { url: string };
  };
}
```

### Share Card Rendering

```
1. Moment triggers card generation (e.g. contest completes, user wins)
2. Server-side image generation (using a template + data):
   - Use a headless renderer (Puppeteer, Satori, or similar)
   - Template includes: PoolMaster branding, contest name, winner name, score, standings
   - Generate OG image (1200×630) and square (1080×1080)
3. Upload images to CDN
4. Create share URL: poolmaster.com/share/{share_id}
   - Resolves to a public page showing the result
   - OG meta tags populated for rich link previews
   - If league is private: shows limited info + invite CTA
5. Present share options in app
```

### Share URL Resolution

```
GET /share/:shareId

Public view:
  ├── Contest name and sport
  ├── Winner name and score
  ├── Final top 5 standings
  ├── PoolMaster branding + "Join a league" CTA
  └── OG meta tags for Twitter/Facebook card preview

Privacy:
  ├── No member email addresses or personal data exposed
  ├── Display names only
  ├── Commissioner can disable sharing per league
  └── Individual members can opt out of appearing in shared cards
```

---

## 8. Real-Time Architecture

### WebSocket Channels

```typescript
interface WebSocketChannels {
  // League feed — real-time updates for new posts, reactions
  league_feed: {
    topic: `league:${string}:feed`;
    events: 'NEW_POST' | 'POST_UPDATED' | 'REACTION_ADDED' | 'REACTION_REMOVED';
  };

  // Contest chat — real-time messages during active contests
  contest_chat: {
    topic: `contest:${string}:chat`;
    events: 'NEW_MESSAGE' | 'SCORE_EVENT' | 'DRAFT_EVENT';
  };

  // Direct messages — real-time DM delivery
  user_dm: {
    topic: `user:${string}:dm`;
    events: 'NEW_MESSAGE' | 'MESSAGE_READ';
  };

  // Presence — who's online in a league/contest
  presence: {
    topic: `league:${string}:presence` | `contest:${string}:presence`;
    events: 'USER_ONLINE' | 'USER_OFFLINE' | 'USER_TYPING';
  };
}
```

### Connection Management

```typescript
interface WebSocketManager {
  // User connects — authenticate and subscribe to relevant channels
  onConnect(userId: string): void;
  // Auto-subscribe to:
  //   - All leagues the user is a member of (feed updates)
  //   - Active contests they're participating in (chat)
  //   - Their DM channel

  // User disconnects — clean up presence
  onDisconnect(userId: string): void;

  // Publish to a channel
  publish(channel: string, event: string, data: any): void;

  // Presence tracking
  getOnlineUsers(channel: string): string[];
}
```

### Scaling Considerations

```
Single server: ws library on Node.js, in-memory channel management
Multi-server: add a dedicated transport only if the deployment topology requires cross-instance fan-out

Expected load:
  - Average league: 12 members, 2-3 online at any time
  - During live draft: all 12 members online, high message rate
  - During live scoring: 5-8 members checking in, moderate message rate

WebSocket server is separate from the REST API server to allow
independent scaling. Draft room WebSocket (from main architecture plan)
and social WebSocket can share the same connection with different
channel subscriptions.
```

---

## 9. Moderation

### Commissioner Moderation Tools

```typescript
interface ModerationActions {
  // Delete a post or message (commissioner or platform admin)
  deletePost(postId: string, reason: string): Promise<void>;
  deleteMessage(messageId: string, reason: string): Promise<void>;

  // Mute a member (prevent posting, chatting, DMs)
  muteMember(leagueId: string, userId: string, duration?: Duration, reason?: string): Promise<void>;
  unmuteMember(leagueId: string, userId: string): Promise<void>;

  // Report content (any member can report)
  reportContent(contentId: string, contentType: 'POST' | 'MESSAGE' | 'DM', reason: string): Promise<void>;
}

interface MuteRecord {
  league_id: string;
  user_id: string;
  muted_by: string;
  reason?: string;
  muted_at: Date;
  expires_at?: Date;                   // null = indefinite
  is_active: boolean;
}
```

### Platform-Level Moderation

```
Content reports flow:
  1. Member reports a post → stored in reports table
  2. Commissioner can view reports in league settings
  3. Commissioner deletes or dismisses
  4. Unresolved or escalated reports visible to platform admin
  5. Platform admin can: warn user, suspend account, IP ban

Automated moderation (future enhancement):
  - Profanity filter (configurable per league — some leagues want it, some don't)
  - Spam detection (repeated identical messages)
  - Link/image scanning
```

---

## 10. Storage Model

Social data is high-volume, append-heavy, and read-heavy. Design for this pattern.

### Storage Strategy

```
Feed posts & replies:     PostgreSQL (structured, needs querying/filtering)
Chat messages:            PostgreSQL (with archival to cold storage after 30 days)
Direct messages:          PostgreSQL
Reactions:                PostgreSQL (denormalised counts on post, detail in reactions table)
Media attachments:        S3 + CDN
Share card images:        S3 + CDN
Read receipts & presence: ephemeral store only if multi-instance scale requires it
```

### Archival

```
Active data (PostgreSQL):
  - Feed posts: permanent
  - Chat messages: 30 days post-contest-completion
  - DMs: 1 year

Archived data (S3 / cold storage):
  - Chat messages older than 30 days: exported as JSON, queryable via admin tools
  - DMs older than 1 year: exported and deleted from primary DB
```

---

## 11. Database Schema

```sql
-- League activity feed posts
CREATE TABLE feed_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id),
  author_id UUID REFERENCES users(id),  -- null for SYSTEM posts
  author_type VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
  content_type VARCHAR(20) NOT NULL DEFAULT 'TEXT',
  body TEXT NOT NULL,
  media JSONB DEFAULT '[]',
  poll_data JSONB,
  pinned BOOLEAN DEFAULT FALSE,
  pinned_at TIMESTAMPTZ,
  pinned_by UUID REFERENCES users(id),
  parent_id UUID REFERENCES feed_posts(id),  -- for replies
  reply_count INTEGER DEFAULT 0,
  latest_reply_at TIMESTAMPTZ,
  reaction_count INTEGER DEFAULT 0,
  reaction_summary JSONB DEFAULT '{}',  -- {"👍": 5, "🔥": 3}
  mentions UUID[] DEFAULT '{}',
  deleted BOOLEAN DEFAULT FALSE,
  deleted_by UUID REFERENCES users(id),
  deleted_reason VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reactions on posts
CREATE TABLE feed_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES feed_posts(id),
  user_id UUID NOT NULL REFERENCES users(id),
  reaction_type VARCHAR(20) NOT NULL,   -- emoji: "👍", "🔥", "😂", "💀", "🏆"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id, reaction_type)
);

-- Contest chat messages
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID NOT NULL,
  author_id UUID REFERENCES users(id),
  author_type VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
  content VARCHAR(500) NOT NULL,
  message_type VARCHAR(20) NOT NULL DEFAULT 'USER',
  mentions UUID[] DEFAULT '{}',
  deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Direct message conversations
CREATE TABLE dm_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_ids UUID[] NOT NULL,      -- exactly 2 user IDs, sorted
  league_id UUID NOT NULL REFERENCES leagues(id),
  last_message_at TIMESTAMPTZ,
  last_message_preview VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Direct messages
CREATE TABLE direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES dm_conversations(id),
  sender_id UUID NOT NULL REFERENCES users(id),
  body VARCHAR(2000) NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mute records
CREATE TABLE member_mutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id),
  user_id UUID NOT NULL REFERENCES users(id),
  muted_by UUID NOT NULL REFERENCES users(id),
  reason VARCHAR(255),
  muted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(league_id, user_id)
);

-- Content reports
CREATE TABLE content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL,
  content_type VARCHAR(20) NOT NULL,    -- POST, MESSAGE, DM
  reported_by UUID NOT NULL REFERENCES users(id),
  reason VARCHAR(500) NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, RESOLVED, ESCALATED
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Poll votes
CREATE TABLE poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES feed_posts(id),
  option_id VARCHAR(100) NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id, option_id)
);

-- Share cards
CREATE TABLE share_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id VARCHAR(100) NOT NULL UNIQUE,  -- short URL slug
  moment_type VARCHAR(50) NOT NULL,
  league_id UUID NOT NULL REFERENCES leagues(id),
  contest_id UUID,
  user_id UUID REFERENCES users(id),
  data JSONB NOT NULL,
  og_image_url TEXT,
  square_image_url TEXT,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_feed_posts_league ON feed_posts(league_id, created_at DESC) WHERE deleted = FALSE;
CREATE INDEX idx_feed_posts_parent ON feed_posts(parent_id, created_at) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_feed_posts_pinned ON feed_posts(league_id, pinned) WHERE pinned = TRUE;
CREATE INDEX idx_reactions_post ON feed_reactions(post_id);
CREATE INDEX idx_chat_messages_contest ON chat_messages(contest_id, created_at);
CREATE INDEX idx_dm_conversations_users ON dm_conversations USING GIN(participant_ids);
CREATE INDEX idx_direct_messages_convo ON direct_messages(conversation_id, created_at);
CREATE INDEX idx_content_reports_status ON content_reports(status, created_at);
CREATE INDEX idx_share_cards_slug ON share_cards(share_id);
```

---

## 12. Implementation Phases

### Phase 1 — League Activity Feed
- Feed post CRUD (create, read, edit, delete)
- Reply threading
- Emoji reactions
- Commissioner pinning
- Basic feed pagination

### Phase 2 — Automated Activity Events
- Activity event generation from scoring, draft, and contest events
- Event throttling and batching
- System post rendering in feed
- Commissioner event type toggles

### Phase 3 — Real-Time & Chat
- WebSocket infrastructure (shared with draft room)
- Real-time feed updates
- Contest chat (messages + interleaved score events)
- Online presence indicators

### Phase 4 — Direct Messaging & Polls
- DM conversations and messaging
- Read receipts
- Poll creation and voting
- @mention parsing and notifications

### Phase 5 — Recaps, Sharing & Moderation
- Weekly auto-generated recap
- Share card generation (OG images, public share URLs)
- Share-to-social integration
- Moderation tools (delete, mute, report)
- Content report queue for commissioners
- Chat message archival pipeline

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 10-001 | 1 | `feed_posts` table + migrations | Done | In-memory Map storage in FeedService; schema defined in plan |
| 10-002 | 1 | `feed_reactions` table + migrations | Done | Reactions stored as Record<emoji, userId[]> on FeedPost |
| 10-003 | 1 | Feed post CRUD API (create, read, edit within 15min, delete) | Done | POST/GET/DELETE routes in social module |
| 10-004 | 1 | Reply threading (parent_id, reply_count, latest_reply_at) | Done | parentId + replyIndex with count tracking |
| 10-005 | 1 | Emoji reactions (add, remove, summary) | Done | Toggle endpoint at POST /:postId/reactions |
| 10-006 | 1 | Commissioner post pinning | Done | POST/DELETE /:postId/pin; pinned posts sort first |
| 10-007 | 1 | Feed pagination (cursor-based, newest first) | Done | Cursor-based pagination with configurable limit |
| 10-008 | 2 | Activity event generation from scoring events | Not Started | |
| 10-009 | 2 | Activity event generation from draft events | Not Started | |
| 10-010 | 2 | Activity event generation from contest lifecycle events | Not Started | |
| 10-011 | 2 | Event throttling (max lead changes/hour, batch draft picks) | Not Started | |
| 10-012 | 2 | System post rendering in feed | Partial | automated-event-card.tsx display component exists, no generation logic |
| 10-013 | 2 | Commissioner event type toggles (per league) | Not Started | |
| 10-014 | 3 | WebSocket infrastructure for feed (shared with draft room) | Not Started | |
| 10-015 | 3 | Real-time feed updates (new post, reaction) via WebSocket | Not Started | |
| 10-016 | 3 | `chat_messages` table + migrations | Not Started | |
| 10-017 | 3 | Contest chat API (messages + interleaved score/draft events) | In Progress | Shared DTO-backed contest chat routes now exist under `/api/v1/social/contests/:contestId/chat`, and the web chat hooks now hit a real backend contract instead of relying on MSW-only behavior. The contract layer and UI wiring are complete; current backend storage is still in-memory, so persistence and interleaved score/draft event injection remain follow-up work |
| 10-018 | 3 | Online presence indicators | Not Started | |
| 10-019 | 4 | `dm_conversations` and `direct_messages` tables | Not Started | |
| 10-020 | 4 | DM API (list conversations, send message, mark read) | In Progress | Shared DTO-backed DM routes now exist for listing conversations, loading messages, sending replies, and marking conversations read. The DM drawer render-time `markRead` bug is fixed on the web side. The contract layer is complete; current backend storage is still in-memory, so league-scoping/persistence restrictions remain follow-up work |
| 10-021 | 4 | `poll_votes` table + poll creation and voting | Not Started | |
| 10-022 | 4 | @mention parsing and notification integration | Not Started | |
| 10-023 | 5 | Weekly auto-generated recap (content generation + feed post) | In Progress | A real recap route now exists under `/api/v1/social/leagues/:leagueId/recap` with shared DTOs and backend handling. The content/response contract is in place, but the implementation is still in-memory and not yet integrated with feed posting or scheduled recap generation |
| 10-024 | 5 | `share_cards` table + share card image generation (OG images) | In Progress | Shared DTO-backed share card routes now exist, but the current implementation serves in-memory share data rather than persisted share-card records or generated OG assets |
| 10-025 | 5 | Public share URL resolution (`/share/:shareId`) | In Progress | Share-card payload resolution now exists behind the social route contract, but still needs true persisted share-link generation and public share-page integration instead of seeded in-memory data |
| 10-026 | 5 | Share-to-social integration (Twitter, Facebook, iMessage) | Not Started | |
| 10-027 | 5 | `member_mutes` table + mute/unmute | Not Started | |
| 10-028 | 5 | `content_reports` table + report mechanism | Not Started | |
| 10-029 | 5 | Moderation tools (delete post, delete message, report queue) | Not Started | |
| 10-030 | 5 | Chat message archival pipeline (30-day retention) | Not Started | |

---

> **MVP scope note:** Keep the active launch surface limited to a simple feed and commissioner/system messaging. Rich social layers listed above remain future work even where partial contracts exist.

*Generated by Claude — PoolMaster Social & Communication Layer Plan v1.0*
