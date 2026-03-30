# PoolMaster — Mobile Client Architecture Plan

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

## Overview

PoolMaster targets Web, iOS, and Android from day one. The backend and web client are covered by the main architecture plan; this document defines the mobile client architecture — technology choice, API contract, authentication, offline behaviour, push notifications, deep linking, real-time WebSocket management, and the draft room mobile experience. Getting these decisions right early prevents expensive rewrites when live draft and real-time scoring features are built.

---

## 1. Technology Choice

### Recommendation: React Native

```
Decision: React Native (with Expo managed workflow)

Rationale:
  ├── Code sharing with React web client (shared types, API layer, business logic)
  ├── Single codebase for iOS and Android
  ├── Strong WebSocket support (needed for draft room and live scoring)
  ├── Mature push notification libraries (expo-notifications)
  ├── Active ecosystem and community
  ├── Adequate performance for PoolMaster's UI complexity
  └── Faster iteration than maintaining two native codebases

Trade-offs accepted:
  ├── Slightly less "native feel" than SwiftUI/Kotlin — acceptable for a
  │   content/data app (not a game or camera app)
  ├── Occasional dependency on native module updates for new OS features
  └── Large bundle size compared to native (mitigated by Hermes engine)

Rejected alternatives:
  ├── Native (Swift + Kotlin): too expensive to maintain two codebases
  │   with a small team; no code sharing with web
  └── Flutter: different language (Dart) from web stack (TypeScript);
      no code sharing benefit
```

### Shared Code Strategy

```
packages/
├── shared/                    # Already exists in monorepo
│   ├── types/                 # TypeScript types (Sport, Contest, User, etc.)
│   ├── validation/            # Zod schemas for form validation
│   ├── constants/             # Enums, sport configs, scoring constants
│   └── utils/                 # Date formatting, score calculation helpers
│
├── api-client/                # NEW: shared API client
│   ├── client.ts              # HTTP client with auth, retry, error handling
│   ├── endpoints/             # Typed endpoint functions
│   ├── types/                 # Request/response types
│   └── websocket.ts           # WebSocket client
│
├── web/                       # React web app
└── mobile/                    # React Native app
    ├── src/
    │   ├── screens/           # Screen components
    │   ├── components/        # Mobile-specific UI components
    │   ├── navigation/        # React Navigation stack
    │   ├── hooks/             # Mobile-specific hooks
    │   ├── services/          # Push notifications, deep linking, storage
    │   └── stores/            # State management (Zustand or similar)
    ├── ios/
    ├── android/
    └── app.json               # Expo config
```

---

## 2. API Contract & Versioning

### Versioning Strategy

```
Approach: Header-based versioning

Client sends: Accept-Version: 2026-03-01
Server reads header and routes to appropriate handler

Why header-based (not URL-based):
  - Same endpoint URL across versions — cleaner
  - Mobile apps update slower than web; need to support older versions
  - Sunset policy: support current + 2 previous versions (6 months)
```

### API Client Configuration

```typescript
interface ApiClientConfig {
  baseUrl: string;                     // https://api.poolmaster.com
  version: string;                     // "2026-03-01"
  platform: 'IOS' | 'ANDROID' | 'WEB';
  appVersion: string;                  // "1.2.0"
  deviceId: string;

  // Auth
  getAccessToken: () => Promise<string | null>;
  onTokenExpired: () => Promise<string>;  // refresh token flow

  // Network
  timeout: number;                     // 30000ms
  retryConfig: {
    maxRetries: 3;
    retryDelay: 1000;
    retryOn: [408, 429, 500, 502, 503, 504];
  };
}
```

### Minimum Version Enforcement

```typescript
// Server response header when client version is too old:
// X-Minimum-Version: 1.3.0
// X-Update-Required: true

interface VersionCheck {
  minimum_version: string;             // oldest supported app version
  recommended_version: string;         // latest available version
  force_update: boolean;               // if true, block app until updated
  update_url: {
    ios: string;                       // App Store URL
    android: string;                   // Play Store URL
  };
  message?: string;                    // "Please update for the best experience"
}

// App checks on launch:
// GET /api/v1/app/version-check?platform=IOS&version=1.2.0
```

---

## 3. Authentication Flow

### Login Flow

```
1. User opens app → show login screen
2. Options: Email/password, Google SSO, Apple Sign-In
3. On success:
   a. Receive access_token (JWT, 15 min TTL) + refresh_token (90 day TTL)
   b. Store refresh_token in secure storage:
      - iOS: Keychain (kSecClassGenericPassword)
      - Android: EncryptedSharedPreferences
   c. Store access_token in memory (not persisted)
   d. Register push notification device token
4. On subsequent app opens:
   a. Check for refresh_token in secure storage
   b. If present: silently refresh access_token
   c. If absent or expired: show login screen
```

### Token Refresh

```typescript
interface TokenManager {
  // Get current access token (refreshes if expired)
  getAccessToken(): Promise<string>;

  // Force refresh
  refreshAccessToken(): Promise<string>;

  // Clear all tokens (logout)
  clearTokens(): Promise<void>;

  // Token state
  isAuthenticated(): boolean;
  getRefreshTokenExpiry(): Date | null;
}

// Refresh flow:
// POST /api/v1/auth/refresh
// Body: { refresh_token: "..." }
// Response: { access_token: "...", refresh_token: "...", expires_in: 900 }
```

### Biometric Authentication

```
Optional convenience feature:
  1. User enables biometric auth in settings
  2. App stores a biometric-protected key in Keychain/Keystore
  3. On app open: prompt Face ID / Touch ID / fingerprint
  4. On success: retrieve refresh token and auto-login
  5. On failure: fall back to email/password login
```

---

## 4. Offline Behaviour & Caching

### Offline-Available Features

| Feature | Offline Behaviour | Cache Strategy |
|---|---|---|
| View leaderboard | Show last-known standings with "offline" indicator | Cache in SQLite, refresh on connect |
| View roster | Show drafted participants | Cache in SQLite |
| View league feed | Show cached posts | Cache recent 50 posts |
| Draft picks | NOT AVAILABLE — requires real-time connection | Show "reconnecting" UI |
| Score updates | NOT AVAILABLE — show stale indicator | Cache last scores |
| Post to feed | Queue locally, send when online | Optimistic UI + sync queue |
| Notifications | NOT AVAILABLE until push arrives | |

### Caching Architecture

```typescript
interface CacheConfig {
  // SQLite for structured data
  database: {
    name: 'poolmaster.db';
    tables: [
      'cached_contests',              // contest metadata + current standings
      'cached_rosters',               // user's drafted teams
      'cached_participants',          // participant profiles
      'cached_feed_posts',            // recent feed posts
      'sync_queue',                   // actions queued while offline
    ];
  };

  // Cache invalidation
  invalidation: {
    // Invalidate on app foreground if stale
    stale_threshold_seconds: 300;      // 5 minutes

    // Full refresh triggers
    on_push_notification: true;        // scoring update → refresh standings
    on_websocket_reconnect: true;      // fetch missed updates
    on_app_foreground: true;           // if stale
  };

  // Size limits
  max_cache_size_mb: 50;
  max_feed_posts_cached: 200;
  max_participants_cached: 2000;
}
```

### Sync Queue (Offline Actions)

```typescript
interface SyncQueueItem {
  id: string;
  action: 'POST_TO_FEED' | 'ADD_REACTION' | 'VOTE_POLL';
  payload: Record<string, any>;
  created_at: Date;
  retry_count: number;
  status: 'PENDING' | 'SYNCING' | 'COMPLETED' | 'FAILED';
}

// When connectivity returns:
// 1. Process sync queue in order
// 2. For each item: call API, mark as completed or failed
// 3. Update local cache with server response
// 4. Show sync status indicator briefly
```

---

## 5. Push Notification Registration

### Registration Flow

```
1. App requests push permission from OS
   - iOS: requestAuthorization (alert, badge, sound)
   - Android: POST_NOTIFICATIONS permission (Android 13+)
2. If granted:
   a. Get device token from Expo Notifications
   b. Send to backend: POST /api/v1/devices
   c. Backend stores token associated with user
3. If denied:
   a. Store preference locally
   b. Show in-app notifications only
   c. Periodically prompt to enable (max once per month)
```

### Token Lifecycle

```typescript
interface PushTokenManager {
  // Register token on login
  registerToken(userId: string): Promise<void>;

  // Re-register on token refresh (OS may issue new token)
  refreshToken(): Promise<void>;

  // Deregister on logout
  deregisterToken(): Promise<void>;

  // Handle token invalidation
  onTokenInvalidated(): Promise<void>;
}
```

### Notification Handling

```typescript
// Notification received while app is in foreground
function onForegroundNotification(notification: Notification) {
  // Don't show OS notification — show in-app toast instead
  // Exception: draft.on_the_clock always shows OS notification for urgency
  if (notification.data.type === 'draft.on_the_clock') {
    showOSNotification(notification);
  } else {
    showInAppToast(notification);
  }
  // Update badge count
  updateBadgeCount();
}

// Notification tapped — user interacted
function onNotificationTapped(notification: Notification) {
  // Navigate to the correct screen
  const { screen, params } = notification.data.action;
  navigation.navigate(screen, params);
}

// Background notification received
function onBackgroundNotification(notification: Notification) {
  // Update local cache with new data
  if (notification.data.type.startsWith('scoring.')) {
    refreshContestStandings(notification.data.contest_id);
  }
}
```

---

## 6. Deep Linking

### Link Structure

```
Universal Links (iOS) / App Links (Android):
  poolmaster.com/league/{id}                    → League home
  poolmaster.com/contest/{id}                   → Contest standings
  poolmaster.com/contest/{id}/draft             → Draft room
  poolmaster.com/contest/{id}/standings          → Leaderboard
  poolmaster.com/invite/{code}                  → League invite acceptance
  poolmaster.com/share/{id}                     → Shared result card

Custom scheme (fallback):
  poolmaster://league/{id}
  poolmaster://contest/{id}
  poolmaster://draft/{id}
```

### Deep Link Resolution

```typescript
interface DeepLinkRouter {
  // Parse incoming link and determine target screen
  resolve(url: string): NavigationTarget;

  // Handle notification tap → deep link
  handleNotificationDeepLink(data: NotificationData): void;

  // Handle universal link from browser/email
  handleUniversalLink(url: string): void;
}

interface NavigationTarget {
  screen: string;
  params: Record<string, string>;
  requiresAuth: boolean;               // if true and not logged in, show login first
}

// Deep link flow:
// 1. Link received (from notification, email, or browser)
// 2. If app not installed: redirect to App Store / Play Store
// 3. If app installed but not logged in: store target, show login, navigate after
// 4. If app installed and logged in: navigate directly to target screen
```

### Notification → Screen Mapping

| Notification Type | Target Screen | Params |
|---|---|---|
| `draft.on_the_clock` | DraftRoom | `{ contest_id }` |
| `draft.completed` | ContestRoster | `{ contest_id }` |
| `scoring.taken_the_lead` | ContestStandings | `{ contest_id }` |
| `contest.completed` | ContestResults | `{ contest_id }` |
| `contest.you_won` | ContestResults | `{ contest_id }` |
| `league.announcement` | LeagueFeed | `{ league_id }` |
| `league.invitation_received` | InviteAccept | `{ invite_code }` |
| `social.reply_to_your_post` | FeedPost | `{ league_id, post_id }` |
| `social.direct_message` | DirectMessage | `{ conversation_id }` |

---

## 7. Real-Time WebSocket Management

### Mobile-Specific Connection Challenges

Mobile devices have unique constraints: backgrounding kills connections, cellular networks are unreliable, and aggressive reconnection drains battery.

### Connection Lifecycle

```typescript
interface WebSocketConfig {
  url: string;                         // wss://ws.poolmaster.com
  auth_token: string;

  // Reconnection
  reconnect: {
    enabled: true;
    initial_delay_ms: 1000;
    max_delay_ms: 30000;               // cap at 30 seconds
    backoff_multiplier: 2;
    max_attempts: 50;                  // then give up until manual refresh
    jitter: true;                      // prevent thundering herd
  };

  // Heartbeat
  heartbeat: {
    interval_ms: 30000;                // ping every 30 seconds
    timeout_ms: 10000;                 // if no pong in 10s, consider disconnected
  };

  // Mobile-specific
  mobile: {
    disconnect_on_background: false;    // keep alive for short backgrounds
    background_grace_period_ms: 30000;  // disconnect after 30s in background
    reconnect_on_foreground: true;      // always reconnect when app returns
    use_reduced_frequency_in_background: true;  // lower heartbeat rate
  };
}
```

### Connection States

```
┌──────────┐    ┌──────────────┐    ┌──────────┐
│CONNECTING│───▶│  CONNECTED   │───▶│  CLOSING │
└──────────┘    └──────┬───────┘    └──────────┘
     ▲                 │                  │
     │                 ▼                  │
     │          ┌──────────────┐         │
     └──────────│RECONNECTING  │◀────────┘
                └──────┬───────┘
                       │
                       ▼
                ┌──────────────┐
                │ DISCONNECTED │
                └──────────────┘
```

### Subscription Management

```typescript
interface SubscriptionManager {
  // Subscribe to channels based on user's current context
  subscribeToLeague(leagueId: string): void;     // feed updates
  subscribeToContest(contestId: string): void;   // scores, chat
  subscribeToDraft(contestId: string): void;     // draft room events

  // Unsubscribe when leaving context
  unsubscribeFromContest(contestId: string): void;
  unsubscribeFromDraft(contestId: string): void;

  // Auto-management
  onAppForeground(): void;   // re-subscribe to active channels
  onAppBackground(): void;   // reduce subscriptions
  onReconnect(): void;       // re-subscribe to all active channels + fetch missed events
}
```

### Draft Room WebSocket (Aggressive Mode)

During an active draft, the WebSocket connection is critical:

```typescript
interface DraftRoomConnectionPolicy {
  // Keep connection alive even when backgrounded
  background_keepalive: true;

  // Faster heartbeat during active draft
  heartbeat_interval_ms: 15000;

  // Immediate reconnection with no backoff
  reconnect_delay_ms: 500;
  max_reconnect_delay_ms: 5000;

  // If disconnected > 10 seconds during user's pick:
  // show "Connection lost — your auto-pick will engage" warning
  auto_pick_warning_threshold_ms: 10000;

  // Fetch full draft state on reconnect (catches missed picks)
  fetch_full_state_on_reconnect: true;
}
```

---

## 8. Draft Room on Mobile

The live draft experience is the most complex real-time UI on mobile.

### Mobile Draft Room Layout

```
┌─────────────────────────────────────────┐
│ Masters Pool Draft          Round 3/5   │
│ Pick 24 of 60              🟢 Connected │
├─────────────────────────────────────────┤
│                                         │
│  ON THE CLOCK: You!         ⏱ 0:45     │
│  ═══════════════════════════            │
│                                         │
│  [Search participants...]               │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ 🏌️ Scottie Scheffler  #1       │   │
│  │    World Rank: 1 | $12,500     │   │
│  │                      [PICK]    │   │
│  ├─────────────────────────────────┤   │
│  │ 🏌️ Rory McIlroy      #3       │   │
│  │    World Rank: 3 | $11,200     │   │
│  │                      [PICK]    │   │
│  ├─────────────────────────────────┤   │
│  │ 🏌️ Jon Rahm           #5       │   │
│  │    World Rank: 5 | $10,800     │   │
│  │                      [PICK]    │   │
│  └─────────────────────────────────┘   │
│                                         │
│  [My Queue (3)]  [Draft Board]  [Teams] │
│                                         │
└─────────────────────────────────────────┘
```

### Mobile-Specific Draft Features

```typescript
interface MobileDraftConfig {
  // Pre-draft queue
  pick_queue: {
    enabled: true;
    max_queue_size: 10;
    auto_pick_from_queue: true;        // if timer expires, pick top of queue
    drag_to_reorder: true;             // mobile-friendly reordering
  };

  // Timer
  timer: {
    show_countdown: true;
    vibrate_at_seconds: [30, 10, 5];   // haptic feedback for urgency
    sound_at_seconds: [30, 10];        // audio alert
    full_screen_warning_at_seconds: 10; // take over screen at 10s
  };

  // Pick confirmation
  confirm_pick: true;                  // require tap + confirm (prevent accidental picks)
  confirm_timeout_seconds: 5;          // auto-confirm if not cancelled

  // Landscape support
  landscape_mode: 'OPTIONAL';          // allow but don't require
  draft_board_landscape_only: true;    // full draft board grid only in landscape
}
```

### Draft Board Views (Mobile)

```
Tab 1: Available (default)
  - Searchable, filterable list of available participants
  - Sort by ranking, price, tier
  - Quick-pick button on each row

Tab 2: My Queue
  - Pre-ranked participant preference list
  - Drag to reorder
  - Swipe to remove

Tab 3: Draft Board
  - Grid view: rounds × teams
  - Scroll horizontally for teams, vertically for rounds
  - Tap a cell to see pick details
  - Landscape recommended for this view

Tab 4: Teams
  - View any team's roster so far
  - Highlight your team
```

---

## 9. Navigation Architecture

### Screen Structure (React Navigation)

```typescript
type RootStackParamList = {
  // Auth
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;

  // Main tabs
  MainTabs: undefined;

  // Deep-linked screens (can be reached from any context)
  DraftRoom: { contestId: string };
  ContestStandings: { contestId: string };
  ContestResults: { contestId: string };
  FeedPost: { leagueId: string; postId: string };
  InviteAccept: { inviteCode: string };
  ShareView: { shareId: string };
};

type MainTabParamList = {
  Home: undefined;                     // Dashboard: your leagues, active contests
  Leagues: undefined;                  // League list
  Notifications: undefined;           // Notification centre
  Profile: undefined;                  // Settings, preferences, account
};

type LeagueStackParamList = {
  LeagueHome: { leagueId: string };    // League dashboard
  LeagueFeed: { leagueId: string };
  LeagueMembers: { leagueId: string };
  ContestList: { leagueId: string };
  ContestDetail: { contestId: string };
  DirectMessage: { conversationId: string };
};
```

### Navigation Patterns

```
Bottom tabs: Home | Leagues | Notifications | Profile
  └── Each tab has its own navigation stack

Modal presentations:
  - Draft room (full screen modal, prevents accidental back)
  - Pick confirmation
  - Share card preview
  - Notification preferences

Push navigation:
  - League → Contest → Standings → Team Detail
  - Notification tap → target screen
```

---

## 10. App Store Compliance

### Apple App Store Considerations

```
Key review guideline areas:

1. Real-money / gambling (Guideline 5.3):
   - PoolMaster v1 does NOT facilitate real-money transactions
   - Entry fees and payouts happen outside the app
   - Display payout amounts as "tracking" not "payment"
   - If future in-app payments added: requires Apple's gambling entitlement

2. In-App Purchases (Guideline 3.1):
   - Platform subscription (tenant billing) does NOT go through IAP
     because it's a SaaS business tool, not a consumer digital good
   - If selling directly to consumers: may need IAP for subscriptions

3. Push notifications (Guideline 4.5.4):
   - Must not use push for advertising or promotions
   - Push content must be relevant to the user
   - Must provide opt-out mechanism

4. Account deletion (Guideline 5.1.1):
   - Must provide in-app account deletion option
   - Must delete all user data within reasonable timeframe
```

### Google Play Store Considerations

```
1. Real-money gambling:
   - Similar restrictions; must comply with local gambling laws
   - Fantasy sports apps have additional requirements in some regions

2. Subscription billing:
   - B2B subscriptions can use external payment
   - B2C may require Google Play Billing Library

3. Data safety section:
   - Must accurately declare data collection and sharing
   - Must declare use of push notifications
```

---

## 11. Performance Targets

| Metric | Target | Measurement |
|---|---|---|
| App launch to interactive | < 2 seconds | Cold start on mid-range device |
| Screen transition | < 300ms | React Navigation transition animation |
| API response render | < 500ms | From tap to data displayed |
| WebSocket message to UI | < 100ms | Real-time event to screen update |
| Draft pick submission | < 1 second | Tap "pick" to confirmation |
| Feed scroll | 60 FPS | No frame drops while scrolling |
| Bundle size (iOS) | < 30 MB | Compressed IPA |
| Bundle size (Android) | < 25 MB | Compressed APK |
| Memory usage | < 200 MB | Active usage, no leaks |
| Battery impact | < 5%/hour | During live scoring (polling) |

---

## 12. Implementation Phases

### Phase 1 — Foundation
- Expo project setup in monorepo
- Shared API client package
- Authentication flow (login, register, token management, secure storage)
- Navigation architecture (tabs, stacks)
- Home screen (league list, active contests)
- API version checking and minimum version enforcement

### Phase 2 — Core Features
- League detail screen (members, settings)
- Contest list and detail screens
- Standings/leaderboard view
- Participant profile view
- Offline caching (SQLite) for standings and rosters
- Pull-to-refresh pattern

### Phase 3 — Push & Deep Linking
- Push notification registration (APNs + FCM via Expo)
- Notification handling (foreground, background, tap)
- In-app notification centre screen
- Deep linking setup (universal links, custom scheme)
- Notification → screen navigation

### Phase 4 — Draft Room
- WebSocket connection management
- Draft room UI (available list, queue, board, teams)
- Pick submission flow with confirmation
- Timer with haptic and audio alerts
- Reconnection handling and state recovery
- Landscape draft board view

### Phase 5 — Social & Polish
- League activity feed (posts, replies, reactions)
- Contest chat
- Direct messaging
- Share card viewing and sharing
- Biometric authentication
- App Store submission preparation

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| — | — | All 30 mobile client tasks deferred to [plans/deferred/12-mobile-client-deferred.md](deferred/12-mobile-client-deferred.md) | — | Mobile after web platform complete; see deferred file for details |

---

*Generated by Claude — PoolMaster Mobile Client Architecture Plan v1.0*
