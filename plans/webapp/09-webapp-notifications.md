# PoolMaster — Notifications

**Routes:** `/notifications`, `/settings/notifications`
**Layout:** Authenticated (sidebar + top nav)
**Maps to:** 09 (Notifications & Alerts)

The notification system keeps users informed about drafts, scoring, contests, leagues, social activity, and account events. It consists of a full-page notification centre, a global dropdown in the top nav, a preferences matrix for per-category/per-channel control, and browser push permission handling.

---

## Components

### 1. Notification Centre (`/notifications`)

A full-page persistent inbox of all notifications the user has received, with category filtering, bulk actions, and infinite scroll.

**Component:** `NotificationCentrePage`
**File:** `clients/web/src/features/notifications/notification-centre-page.tsx`

**Layout:**
- Page heading: "Notifications"
- Category filter bar (horizontal pills/tabs)
- Bulk actions row (mark all read, select mode)
- Notification list with infinite scroll
- Empty state when no notifications match

**Subcomponents:**

#### NotificationList

**Component:** `NotificationList`
**File:** `clients/web/src/features/notifications/notification-list.tsx`

Renders an infinite-scrolling list of `NotificationItem` components. Uses TanStack Query `useInfiniteQuery` with cursor-based pagination. Triggers the next page fetch when the user scrolls within 200px of the bottom (Intersection Observer).

**Behaviour:**
- Groups notifications by date ("Today", "Yesterday", "This Week", "Older")
- Smooth transition when items are marked as read (opacity change, not removal)
- Loads 20 notifications per page
- Shows a loading spinner at the bottom while fetching the next page

**API:** `GET /notifications?category=X&cursor=X&limit=20`

#### NotificationItem

**Component:** `NotificationItem`
**File:** `clients/web/src/features/notifications/notification-item.tsx`

**Data displayed per notification:**
- Category icon (mapped from notification category — see icon mapping below)
- Title (bold if unread, regular if read)
- Body text (truncated to 2 lines)
- Relative timestamp ("2m ago", "1h ago", "3d ago")
- Read/unread indicator (blue dot on the left edge for unread)
- Action link arrow (chevron right) indicating the item is clickable

**Icon mapping:**
| Category | Icon |
|---|---|
| Draft | `ClipboardList` |
| Scoring | `Trophy` |
| Contest | `Flag` |
| League | `Users` |
| Social | `MessageCircle` |
| Account | `Settings` |

**Behaviour:**
- Clicking a notification navigates to the relevant page (contest, draft, league, settings) and marks it as read via `PATCH /notifications/:id/read`
- Hover state: subtle background highlight
- Unread items have a slightly darker background tint
- Long-press or right-click context menu: "Mark as read", "Delete"

**API (on click):** `PATCH /notifications/:id/read`

#### CategoryFilter

**Component:** `CategoryFilter`
**File:** `clients/web/src/features/notifications/category-filter.tsx`

**Categories:**
- All (default, no filter)
- Draft
- Scoring
- Contest
- League
- Social
- Account

**Behaviour:**
- Rendered as a horizontal row of pill-style toggle buttons (shadcn/ui `Toggle` or `Tabs`)
- Active category is visually highlighted
- Changing the category resets the infinite query cursor and refetches
- Each pill shows an unread count badge for that category (fetched from `GET /notifications/unread-count?grouped=true`)
- "All" pill shows the total unread count
- Scrollable on mobile with horizontal overflow

**API:** Query parameter `category` appended to the notifications endpoint.

#### BulkActions

**Component:** `BulkActions`
**File:** `clients/web/src/features/notifications/bulk-actions.tsx`

**Actions:**
- "Mark all as read" button — marks all notifications in the current category as read
- Confirmation dialog for "mark all as read" when unread count exceeds 50

**Behaviour:**
- "Mark all as read" calls `PATCH /notifications/read-all?category=X`
- After bulk action, invalidates notification queries to refetch
- Button is disabled when there are no unread notifications in the current category
- Optimistic update: immediately sets all visible items to read state, rolls back on error

**API:** `PATCH /notifications/read-all?category=X`

#### EmptyState

**Component:** `NotificationEmptyState`
**File:** `clients/web/src/features/notifications/notification-empty-state.tsx`

**Variations:**
- No notifications at all: illustration + "You're all caught up!" + "We'll notify you when something happens."
- No notifications in filtered category: "No [category] notifications" + "Try a different category or check back later."

---

### 2. Notification Dropdown (global, in top nav)

The notification dropdown is accessible from every authenticated page via the bell icon in the top navigation bar.

**Component:** `NotificationBell`
**File:** `clients/web/src/features/notifications/notification-bell.tsx`

**Component:** `NotificationDropdown`
**File:** `clients/web/src/features/notifications/notification-dropdown.tsx`

**Component:** `UnreadBadge`
**File:** `clients/web/src/features/notifications/unread-badge.tsx`

#### NotificationBell

- Bell icon (`Bell` from lucide-react)
- Renders `UnreadBadge` when unread count > 0
- Clicking toggles the `NotificationDropdown`
- `aria-label="Notifications, N unread"` (dynamic)

#### UnreadBadge

- Red circle badge overlaid on the top-right of the bell icon
- Displays the unread count number
- Counts above 99 display as "99+"
- Hidden entirely when count is 0
- Subtle scale-in animation when count changes from 0 to > 0

#### NotificationDropdown

- Popover rendered below the bell icon (shadcn/ui `Popover`)
- Header row: "Notifications" label + "Mark all as read" text button
- List of the latest 5 notifications (same layout as `NotificationItem` but more compact)
- Footer: "View all notifications" link navigating to `/notifications`
- If no unread: "You're all caught up!" inline message

**Behaviour:**
- Opens on click (not hover)
- Closes on outside click or Escape key
- Clicking a notification item navigates to its target and closes the dropdown
- "Mark all as read" calls `PATCH /notifications/read-all` and invalidates queries
- Dropdown fetches `GET /notifications?status=unread&limit=5` when opened (staleTime: 10s to avoid refetching on rapid open/close)

**Polling:**
- `GET /notifications/unread-count` polled every 30 seconds via TanStack Query `refetchInterval`
- Polling pauses when the browser tab is not visible (`refetchIntervalInBackground: false`)

---

### 3. Notification Preferences (`/settings/notifications`)

A matrix UI for controlling which notifications the user receives and through which channels.

**Component:** `NotificationPreferencesPage`
**File:** `clients/web/src/features/notifications/notification-preferences-page.tsx`

**Layout:**
- Page heading: "Notification Preferences"
- Preferences matrix (categories x channels)
- Do-Not-Disturb scheduler section
- Save button (or auto-save with debounce)

#### PreferencesMatrix

**Component:** `PreferencesMatrix`
**File:** `clients/web/src/features/notifications/preferences-matrix.tsx`

**Structure:** A table/grid with categories as rows and channels as columns.

**Categories (rows):**
| Category | Description |
|---|---|
| Draft Reminders | Draft starting soon, pick timer warnings, draft results |
| Score Alerts | Score updates, rank changes, scoring corrections |
| Contest Updates | Contest created, entry deadlines, contest results |
| League Activity | Member joined/left, commissioner announcements, season events |
| Social | Mentions, direct messages, comments on your entries |
| Account & Billing | Password changes, payment confirmations, subscription reminders |

**Channels (columns):**
| Channel | Description |
|---|---|
| In-App | Notifications in the notification centre and dropdown |
| Push | Browser push notifications (requires permission) |
| Email | Email notifications to the user's registered address |

**Behaviour:**
- Each intersection is a checkbox (shadcn/ui `Checkbox`)
- Account & Billing > In-App and Email are always enabled and cannot be toggled off (safety requirement)
- Push column checkboxes are disabled with a tooltip "Enable browser notifications first" if push permission has not been granted
- Changes auto-save with a 1-second debounce after the last toggle
- Toast confirmation: "Preferences saved" on successful save
- Optimistic updates: checkbox toggles immediately, rolls back on error
- Column header checkboxes toggle all categories for that channel
- Row header toggles all channels for that category

**API:**
- `GET /notifications/preferences` — loads current preference state
- `PUT /notifications/preferences` — saves updated preferences (full matrix payload)

**Data shape:**
```typescript
interface NotificationPreferences {
  categories: {
    [category: string]: {
      inApp: boolean;
      push: boolean;
      email: boolean;
    };
  };
  dnd: {
    enabled: boolean;
    startTime: string;  // HH:mm format
    endTime: string;    // HH:mm format
    timezone: string;   // IANA timezone
  };
}
```

#### CategoryRow

**Component:** `CategoryRow`
**File:** `clients/web/src/features/notifications/category-row.tsx`

Renders a single row in the preferences matrix: category label, description, and three channel checkboxes. Handles the locked state for Account & Billing.

#### ChannelToggle

**Component:** `ChannelToggle`
**File:** `clients/web/src/features/notifications/channel-toggle.tsx`

A single checkbox cell in the matrix. Handles disabled state, tooltip for push permission, and optimistic toggle.

#### DNDScheduler

**Component:** `DNDScheduler`
**File:** `clients/web/src/features/notifications/dnd-scheduler.tsx`

**Fields:**
- Enable/disable toggle (shadcn/ui `Switch`)
- Start time picker (e.g. "10:00 PM")
- End time picker (e.g. "7:00 AM")
- Timezone selector (dropdown of IANA timezones, defaulting to the user's detected timezone)

**Behaviour:**
- When disabled, time pickers and timezone selector are visually dimmed and non-interactive
- Quiet hours explanation text: "During quiet hours, in-app and push notifications are silenced. You'll still receive emails, and all notifications will be waiting in your inbox when quiet hours end."
- Validation: start time must not equal end time
- Time pickers use 12-hour format with AM/PM toggle (respects user locale if available)
- Changes auto-save with the same debounce as the preferences matrix

---

### 4. Push Notification Permission (browser)

Handles the browser Notification API permission flow with a value-first approach.

#### PushPermissionBanner

**Component:** `PushPermissionBanner`
**File:** `clients/web/src/features/notifications/push-permission-banner.tsx`

A dismissible banner shown at the top of the notification centre (or dashboard) when the user has not yet granted or denied push permission.

**Content:**
- Icon: bell with a sparkle
- Text: "Stay in the loop — enable push notifications to get real-time alerts for scores, drafts, and contest updates."
- Primary button: "Enable Notifications"
- Secondary button: "Not now" (dismisses the banner for the session)

**Behaviour:**
- Only shown when `Notification.permission === 'default'`
- Not shown if already granted or denied
- Clicking "Enable Notifications" opens the `PushPermissionDialog`
- Clicking "Not now" sets a session flag in Zustand (not persisted — will show again next session)
- Banner is not shown on the preferences page (that page has its own inline prompt)

#### PushPermissionDialog

**Component:** `PushPermissionDialog`
**File:** `clients/web/src/features/notifications/push-permission-dialog.tsx`

A modal dialog that explains the value of push notifications before triggering the browser permission prompt.

**Content:**
- Heading: "Enable Push Notifications"
- Bullet list of benefits:
  - "Know instantly when your draft is about to start"
  - "Get real-time score alerts as games happen"
  - "Never miss a contest entry deadline"
- Primary button: "Allow Notifications" — calls `Notification.requestPermission()`
- Secondary button: "Maybe Later" — closes dialog

**Behaviour:**
- On permission granted: close dialog, show success toast "Push notifications enabled!", register the service worker push subscription, send subscription to `POST /notifications/push-subscriptions`
- On permission denied: close dialog, show info toast "You can enable notifications anytime in Settings > Notifications"
- If `Notification` API is not supported: button shows "Not supported in this browser" (disabled)

**Fallback in Preferences:**
- On the `/settings/notifications` page, if push permission is denied, show an inline alert:
  - "Push notifications are blocked. To re-enable, update your browser's site notification settings."
  - Link to browser-specific instructions (or generic guidance)

---

## Data Requirements

### API Endpoints

| Endpoint | Method | Purpose | Poll Interval |
|---|---|---|---|
| `GET /notifications` | GET | Paginated notification list with category filter | On mount / scroll |
| `GET /notifications/unread-count` | GET | Total unread count (and optionally grouped by category) | 30s |
| `GET /notifications?status=unread&limit=5` | GET | Latest unread for dropdown | On dropdown open |
| `PATCH /notifications/:id/read` | PATCH | Mark single notification as read | On click |
| `PATCH /notifications/read-all` | PATCH | Mark all (or category-filtered) notifications as read | On click |
| `GET /notifications/preferences` | GET | Load user's notification preferences | On mount |
| `PUT /notifications/preferences` | PUT | Save updated notification preferences | On change (debounced) |
| `POST /notifications/push-subscriptions` | POST | Register browser push subscription | On permission grant |

### TanStack Query Keys

```typescript
const notificationKeys = {
  all: ['notifications'] as const,
  list: (category?: string) => [...notificationKeys.all, 'list', { category }] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
  unreadCountGrouped: () => [...notificationKeys.all, 'unread-count', 'grouped'] as const,
  unreadList: () => [...notificationKeys.all, 'unread', 'list'] as const,
  preferences: () => [...notificationKeys.all, 'preferences'] as const,
};
```

### Infinite Query Configuration

```typescript
// Notification centre — infinite scroll
useInfiniteQuery({
  queryKey: notificationKeys.list(category),
  queryFn: ({ pageParam }) => fetchNotifications({ category, cursor: pageParam, limit: 20 }),
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  staleTime: 30_000,
});

// Unread count — 30s polling
useQuery({
  queryKey: notificationKeys.unreadCount(),
  queryFn: fetchUnreadCount,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
});

// Dropdown notifications — on demand
useQuery({
  queryKey: notificationKeys.unreadList(),
  queryFn: () => fetchNotifications({ status: 'unread', limit: 5 }),
  staleTime: 10_000,
  enabled: isDropdownOpen,
});
```

---

## State Management

### Server State (TanStack Query)

All notification data (list, unread count, preferences) is server state managed by TanStack Query.

### Client State (Zustand)

**Store:** `useNotificationUiStore`
**File:** `clients/web/src/stores/notification-ui-store.ts`

```typescript
interface NotificationUiState {
  isDropdownOpen: boolean;
  activeCategory: string | null;
  pushBannerDismissed: boolean;
  toggleDropdown: () => void;
  setActiveCategory: (category: string | null) => void;
  dismissPushBanner: () => void;
}
```

**Persisted:** No (session-only state). The `pushBannerDismissed` flag resets on new sessions intentionally.

---

## Interactions

| Interaction | Trigger | Effect |
|---|---|---|
| Click notification item | NotificationItem | Navigate to target page, mark as read |
| Click category pill | CategoryFilter | Filter notification list, reset infinite scroll |
| Click "Mark all as read" | BulkActions | `PATCH /notifications/read-all`, invalidate queries |
| Click bell icon | NotificationBell | Toggle dropdown open/closed |
| Click dropdown notification | NotificationDropdown | Navigate to target, mark as read, close dropdown |
| Click "View all notifications" | NotificationDropdown | Navigate to `/notifications`, close dropdown |
| Toggle preference checkbox | PreferencesMatrix | Optimistic update, debounced `PUT /notifications/preferences` |
| Toggle column header | PreferencesMatrix | Toggle all categories for that channel |
| Toggle DND switch | DNDScheduler | Enable/disable quiet hours, save preferences |
| Change DND times | DNDScheduler | Update quiet hours, debounced save |
| Click "Enable Notifications" | PushPermissionBanner | Open PushPermissionDialog |
| Click "Allow Notifications" | PushPermissionDialog | Call `Notification.requestPermission()`, register subscription |
| Click "Not now" | PushPermissionBanner | Dismiss banner for session |

---

## Text Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Logo]  PoolMaster          [Search...]       [🔔 3]  [Avatar ▾]         │
├───────────┬─────────────────────────────────────────────────────────────────┤
│           │                                                                 │
│  Dashboard│  Notifications                            [Mark all as read]   │
│  Leagues  │                                                                 │
│  Discover │  [All (7)] [Draft (2)] [Scoring (3)] [Contest] [League (1)]   │
│  Notifs   │  [Social (1)] [Account]                                        │
│  Settings │                                                                 │
│  Billing  │  ── Today ──────────────────────────────────────────────────── │
│           │                                                                 │
│           │  ● 🏈 Draft Starting Soon                             2m ago  │
│           │    Your NFL Fantasy Draft begins in 15 minutes.               │
│           │    Tap to enter the draft room.                                │
│           │                                                                 │
│           │  ● 🏆 Score Update: Premier League Picks              25m ago │
│           │    Your entry moved up to 2nd place (+12 pts).                │
│           │                                                                 │
│           │  ● 👥 New Member in Weekend Warriors                  1h ago  │
│           │    JaneDoe has joined your league.                             │
│           │                                                                 │
│           │  ── Yesterday ──────────────────────────────────────────────── │
│           │                                                                 │
│           │    🏆 Contest Results: March Madness Bracket           18h ago │
│           │    Final standings are in — you finished 1st!                  │
│           │                                                                 │
│           │    💬 JohnDoe mentioned you                            20h ago │
│           │    "Great picks this week @Dave!"                              │
│           │                                                                 │
│           │  ── This Week ──────────────────────────────────────────────── │
│           │                                                                 │
│           │    🚩 Entry Deadline: NFL Survivor Pool                 2d ago │
│           │    Submissions close tomorrow at 1:00 PM EDT.                  │
│           │                                                                 │
│           │    ⚙ Password Changed                                  3d ago │
│           │    Your account password was successfully updated.             │
│           │                                                                 │
│           │  [Loading more...]                                             │
│           │                                                                 │
├───────────┴─────────────────────────────────────────────────────────────────┤
│  Footer: About · Privacy · Terms · Responsible Gaming          v1.0.0      │
└─────────────────────────────────────────────────────────────────────────────┘

● = unread indicator (blue dot)


Notification Preferences (/settings/notifications):

┌─────────────────────────────────────────────────────────────────────────────┐
│  Notification Preferences                                                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Category              │  In-App   │  Push     │  Email            │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  Draft Reminders       │  [x]      │  [x]      │  [ ]              │   │
│  │  Score Alerts          │  [x]      │  [x]      │  [x]              │   │
│  │  Contest Updates       │  [x]      │  [ ]      │  [x]              │   │
│  │  League Activity       │  [x]      │  [ ]      │  [ ]              │   │
│  │  Social                │  [x]      │  [ ]      │  [ ]              │   │
│  │  Account & Billing     │  [x] 🔒  │  [ ]      │  [x] 🔒           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  🔒 = Cannot be disabled                                                    │
│                                                                             │
│  ┌─ Do Not Disturb ───────────────────────────────────────────────────┐   │
│  │  [Toggle: ON]                                                       │   │
│  │                                                                     │   │
│  │  Start: [10:00 PM ▾]    End: [7:00 AM ▾]    Timezone: [US/Eastern] │   │
│  │                                                                     │   │
│  │  During quiet hours, in-app and push notifications are silenced.   │   │
│  │  You'll still receive emails, and all notifications will be         │   │
│  │  waiting in your inbox when quiet hours end.                        │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
clients/web/src/
├── features/notifications/
│   ├── notification-centre-page.tsx     # Full-page notification inbox
│   ├── notification-list.tsx            # Infinite-scrolling notification list
│   ├── notification-item.tsx            # Single notification row
│   ├── category-filter.tsx              # Category pill filter bar
│   ├── bulk-actions.tsx                 # Mark all read, bulk operations
│   ├── notification-empty-state.tsx     # Empty state illustrations
│   ├── notification-bell.tsx            # Bell icon in top nav
│   ├── notification-dropdown.tsx        # Popover dropdown with latest 5
│   ├── unread-badge.tsx                 # Red count badge on bell
│   ├── notification-preferences-page.tsx # Preferences settings page
│   ├── preferences-matrix.tsx           # Category x channel grid
│   ├── category-row.tsx                 # Single row in preferences matrix
│   ├── channel-toggle.tsx               # Single checkbox cell
│   ├── dnd-scheduler.tsx                # Do-Not-Disturb time picker
│   ├── push-permission-banner.tsx       # Dismissible banner prompt
│   ├── push-permission-dialog.tsx       # Modal before browser permission
│   └── hooks/
│       ├── use-notifications.ts         # Infinite query for notification list
│       ├── use-unread-count.ts          # Polled unread count query (30s)
│       ├── use-notification-actions.ts  # Mark read, mark all read mutations
│       ├── use-notification-preferences.ts # Preferences query + mutation
│       └── use-push-permission.ts       # Browser Notification API wrapper
├── stores/
│   └── notification-ui-store.ts         # Zustand: dropdown, category, banner
```

---

## Loading & Error States

| Component | Loading State | Error State | Empty State |
|---|---|---|---|
| NotificationList | Skeleton: 5 notification rows with shimmer | "Couldn't load notifications" + retry button | "You're all caught up!" illustration |
| CategoryFilter | Skeleton: 7 pill placeholders | Counts hidden, pills still functional | N/A |
| NotificationDropdown | Spinner inside popover | "Couldn't load" message in popover | "All caught up!" inline |
| PreferencesMatrix | Skeleton: 6 rows x 3 columns of checkbox placeholders | "Couldn't load preferences" + retry button | N/A (always has categories) |
| DNDScheduler | Skeleton: toggle + 2 time pickers | Inline error message | Default state (DND off) |

All skeleton screens use the shadcn/ui `Skeleton` component. Error states include a "Try again" button that calls `queryClient.invalidateQueries()` for the relevant query key.

---

## Responsive Behaviour

| Breakpoint | Layout |
|---|---|
| `sm` (< 640px) | Full-width notification list. Category filter scrolls horizontally. Preferences matrix stacks: each category becomes a card with three toggles listed vertically. DND fields stack vertically. |
| `md` (640-1023px) | Same as `sm` but with more comfortable spacing. Preferences matrix remains stacked. |
| `lg` (1024-1279px) | Full table layout for preferences matrix. Notification list with comfortable margins. |
| `xl` (>= 1280px) | Full layout as shown in wireframes. Preferences matrix at full width. |

---

## Accessibility

- Notification list uses `role="feed"` with `aria-busy` during loading
- Each notification item uses `role="article"` with `aria-label` describing the notification
- Unread notifications announced with `aria-label` including "unread" prefix
- Bell icon has `aria-label="Notifications, N unread"` (dynamic count)
- Dropdown uses `role="menu"` with `role="menuitem"` children, keyboard navigable with arrow keys
- Category filter uses `role="tablist"` with `role="tab"` children
- Preferences matrix uses a proper `<table>` element with `<th>` headers for screen readers
- Locked checkboxes have `aria-disabled="true"` and `aria-describedby` pointing to explanation text
- DND time pickers are labeled with `aria-label="Quiet hours start time"` and `aria-label="Quiet hours end time"`
- All interactive elements have visible focus indicators
- Push permission dialog traps focus while open

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| W-N-001 | 1 | Notification centre page — page shell, route setup, responsive layout, date-grouped sections | Done | `notification-centre-page.tsx`, `notification-list.tsx` with date grouping (Today/Yesterday/This Week/Older), infinite scroll via IntersectionObserver |
| W-N-002 | 1 | Notification item component — icon mapping, read/unread styling, truncated body, relative timestamp, click navigation | Done | `notification-item.tsx` — 6 category icons, blue dot unread indicator, line-clamp-2 body, relative time, click marks read + navigates. Mock data in hooks until API ready |
| W-N-003 | 1 | Category filter — pill bar with unread count badges, horizontal scroll on mobile, query parameter integration | Done | `category-filter.tsx` — pill buttons with Badge counts, horizontal overflow scroll, resets infinite query on change via Zustand store |
| W-N-004 | 1 | Bulk actions — mark all read button, confirmation dialog for large counts, optimistic update with rollback | Done | `bulk-actions.tsx` — confirmation prompt when >50 unread, disabled when 0 unread, uses `useMarkAllAsRead` mutation |
| W-N-005 | 2 | Notification dropdown (top nav) — bell icon, popover with latest 5, compact notification items, close on outside click | Done | `notification-bell.tsx`, `notification-dropdown.tsx` — compact items, mark all read, outside click/Escape close, staleTime 10s. Replaced plain Link in AuthenticatedLayout |
| W-N-006 | 2 | Unread count badge with polling — 30s TanStack Query poll, badge rendering, pause on background tab, animation on change | Done | `unread-badge.tsx`, `use-unread-count.ts` — 30s refetchInterval, refetchIntervalInBackground:false, 99+ cap, zoom-in animation |
| W-N-007 | 2 | Notification preferences matrix — category x channel grid, auto-save with debounce, locked cells, column/row header toggles | Done | `preferences-matrix.tsx`, `category-row.tsx`, `channel-toggle.tsx` — desktop table + mobile cards, column/row header toggles, 1s debounce auto-save, locked account cells, push disabled tooltip, optimistic updates |
| W-N-008 | 2 | DND scheduler — enable/disable toggle, time pickers, timezone selector, quiet hours explanation, validation | Done | `dnd-scheduler.tsx` — checkbox toggle, 12h time selects, 10 common timezones, dimmed when disabled, explanation text, debounced save |

---

*PoolMaster Notifications Page Plan v1.0*
