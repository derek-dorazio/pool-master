# PoolMaster — Dashboard Page

**Route:** `/dashboard`
**Layout:** Authenticated (sidebar + top nav)
**Maps to:** 01 (Core API), 04 (History), 08 (Commissioner Tooling), 09 (Notifications & Alerts)

The dashboard is the authenticated user's home page — the first screen they see after login. It aggregates the most important information from all of the user's leagues, contests, and drafts into a single view with real-time polling.

---

## Components

### 1. Active Contests Card

Displays all contests the user currently has entries in that are in progress.

**Component:** `ActiveContestsCard`
**File:** `clients/web/src/features/dashboard/active-contests-card.tsx`

**Data displayed per contest:**
- Sport icon (mapped from contest sport type)
- Contest name (linked to `/contests/:contestId`)
- League name (secondary text)
- User's current rank (e.g. "3rd of 12")
- User's current score
- Score delta since last poll (green up arrow / red down arrow)
- Contest status badge (e.g. "In Progress", "Scoring")

**Behaviour:**
- Polls every 10 seconds via TanStack Query `refetchInterval`
- Empty state: "No active contests. Browse open contests or create one." with link to `/discover/contests`
- Sorted by most recently updated first
- Clicking a row navigates to `/contests/:contestId`
- Subtle highlight animation on rank/score change between polls

**API:** `GET /contests?status=active&userId=me`

---

### 2. Upcoming Drafts Card

Shows drafts the user is registered for that have not yet started.

**Component:** `UpcomingDraftsCard`
**File:** `clients/web/src/features/dashboard/upcoming-drafts-card.tsx`

**Data displayed per draft:**
- Draft name
- Sport icon
- League name
- Scheduled start time displayed in dual timezone format (user's local timezone + league timezone, per plan 14)
- Countdown timer (live, updates every second client-side)
- Draft type badge (Snake, Auction, etc.)
- "Enter Draft Room" button (enabled when draft is within 5 minutes of start, or already open)

**Behaviour:**
- Countdown timer runs client-side, synced on each poll
- "Enter Draft Room" button navigates to `/drafts/:draftId`
- Button is disabled with tooltip "Opens 5 minutes before start" when not yet available
- Empty state: "No upcoming drafts scheduled."
- Sorted by soonest start time first

**API:** `GET /drafts?status=scheduled&userId=me`

---

### 3. My Leagues Summary

Card grid showing all leagues the user belongs to.

**Component:** `MyLeaguesSummary`
**File:** `clients/web/src/features/dashboard/my-leagues-summary.tsx`

**Data displayed per league card:**
- League name (linked to `/leagues/:leagueId`)
- Sport icon
- Member count (e.g. "12 members")
- Active contests count (e.g. "2 active contests")
- Commissioner badge (crown icon) if the user is commissioner of this league
- League avatar/colour (if configured)

**Behaviour:**
- Displayed as a responsive card grid (1 col mobile, 2 col tablet, 3 col desktop)
- Clicking a card navigates to `/leagues/:leagueId`
- Empty state: "You're not in any leagues yet." with buttons for "Create League" and "Join League"
- Maximum 6 shown; "View all leagues" link to `/leagues` if more exist

**API:** `GET /leagues?userId=me`

---

### 4. Recent Activity Feed

Shows the latest activity across all of the user's leagues.

**Component:** `RecentActivityFeed`
**File:** `clients/web/src/features/dashboard/recent-activity-feed.tsx`

**Activity item types:**
- Score update (e.g. "Your entry gained 15 pts in NFL Survivor")
- Draft pick (e.g. "Round 3 pick made in Fantasy NBA Draft")
- League announcement (e.g. "Commissioner posted in Premier League Pool")
- Contest completed (e.g. "March Madness Bracket — Final results posted")
- Member joined (e.g. "JohnDoe joined your league Weekend Warriors")

**Data displayed per item:**
- Activity icon (type-specific)
- Description text with inline links
- Relative timestamp ("2m ago", "1h ago")
- League context (which league this pertains to)

**Behaviour:**
- Shows latest 5 items
- "View full activity" link at bottom navigates to a combined feed (or `/leagues` if no dedicated feed route)
- Items are clickable, navigating to the relevant detail page
- Loaded once on page mount, refreshed on manual pull or page focus

**API:** `GET /activity?userId=me&limit=5`

---

### 5. Notifications Preview

Unread notification count in the top nav bar, with a dropdown showing the latest notifications.

**Component:** `NotificationsPreview` (top nav integration)
**File:** `clients/web/src/features/dashboard/notifications-preview.tsx`

**Top nav badge:**
- Bell icon with unread count badge (red dot with number)
- Badge hidden when count is 0

**Dropdown contents:**
- Latest 5 unread notifications
- Each shows: icon, title, body preview (truncated), relative timestamp
- "Mark all as read" button at top of dropdown
- "View all notifications" link at bottom navigates to `/notifications`

**Behaviour:**
- Polls unread count every 30 seconds via TanStack Query `refetchInterval`
- Dropdown opens on click (not hover)
- Clicking a notification navigates to its target (e.g. contest, league, draft) and marks it as read
- Accessible: keyboard navigable, proper ARIA roles for dropdown

**APIs:**
- `GET /notifications/unread-count` (polled every 30s)
- `GET /notifications?status=unread&limit=5` (fetched when dropdown opens)
- `PATCH /notifications/:id/read` (on click)
- `PATCH /notifications/read-all` (mark all as read)

---

### 6. Quick Actions Bar

A row of action buttons for common tasks, contextually adjusted based on the user's roles.

**Component:** `QuickActionsBar`
**File:** `clients/web/src/features/dashboard/quick-actions-bar.tsx`

**Default actions (all users):**
- "Create League" button -> `/leagues/create`
- "Join League" button -> `/discover/leagues`
- "Browse Contests" button -> `/discover/contests`

**Commissioner actions (shown if user is commissioner of any league):**
- "Create Contest" button -> `/contests/create`
- "Manage Leagues" button -> `/leagues` (with commissioner filter)

**Behaviour:**
- Rendered as a horizontal button group with icons
- On mobile, wraps to 2x2 or 3x2 grid
- Actions are shadcn/ui `Button` components with variant `outline`
- Commissioner actions visually separated with a subtle divider

**API:** No dedicated API; derived from user profile and leagues data already fetched.

---

### 7. Season Highlights Card

Shows personal achievements from completed contests, sourced from plan 04 history data.

**Component:** `SeasonHighlightsCard`
**File:** `clients/web/src/features/dashboard/season-highlights-card.tsx`

**Data displayed:**
- Recent wins (contest name, date, final rank)
- Personal best score (contest name, score, sport)
- Current winning streak (if any)
- Season win/loss record summary

**Behaviour:**
- Only shown if the user has at least one completed contest
- Hidden entirely for new users with no history (no empty state, the card simply does not render)
- Stats are clickable, linking to the relevant contest results page (`/contests/:contestId/results`)
- Data is not polled (loaded once on mount, stale time of 5 minutes)

**API:** `GET /users/me/highlights` (aggregated stats from history service)

---

## Data Requirements

### API Endpoints

| Endpoint | Method | Purpose | Poll Interval |
|---|---|---|---|
| `GET /leagues?userId=me` | GET | User's leagues with member counts | On mount |
| `GET /contests?status=active&userId=me` | GET | Active contests with user entries | 10s |
| `GET /drafts?status=scheduled&userId=me` | GET | Upcoming drafts | On mount |
| `GET /notifications/unread-count` | GET | Unread notification count | 30s |
| `GET /notifications?status=unread&limit=5` | GET | Latest unread notifications | On dropdown open |
| `GET /activity?userId=me&limit=5` | GET | Recent activity feed | On mount |
| `GET /users/me/highlights` | GET | Season highlights / personal bests | On mount (staleTime: 5m) |
| `PATCH /notifications/:id/read` | PATCH | Mark single notification as read | On click |
| `PATCH /notifications/read-all` | PATCH | Mark all notifications as read | On click |

### TanStack Query Keys

```typescript
// Query key factory
const dashboardKeys = {
  all: ['dashboard'] as const,
  leagues: () => [...dashboardKeys.all, 'leagues'] as const,
  activeContests: () => [...dashboardKeys.all, 'active-contests'] as const,
  upcomingDrafts: () => [...dashboardKeys.all, 'upcoming-drafts'] as const,
  activity: () => [...dashboardKeys.all, 'activity'] as const,
  highlights: () => [...dashboardKeys.all, 'highlights'] as const,
};

const notificationKeys = {
  all: ['notifications'] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
  unreadList: () => [...notificationKeys.all, 'unread', 'list'] as const,
};
```

### Polling Configuration

```typescript
// Active contests — 10s polling
useQuery({
  queryKey: dashboardKeys.activeContests(),
  queryFn: fetchActiveContests,
  refetchInterval: 10_000,
  refetchIntervalInBackground: false,
});

// Notification count — 30s polling
useQuery({
  queryKey: notificationKeys.unreadCount(),
  queryFn: fetchUnreadCount,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
});
```

---

## State Management

### Server State (TanStack Query)

All data on the dashboard is server state managed by TanStack Query. No data is duplicated into Zustand.

### Client State (Zustand)

**Store:** `useDashboardPreferencesStore`
**File:** `clients/web/src/stores/dashboard-preferences-store.ts`

```typescript
interface DashboardPreferencesState {
  collapsedWidgets: Set<string>;
  widgetOrder: string[];
  toggleWidget: (widgetId: string) => void;
  reorderWidgets: (order: string[]) => void;
}
```

**Persisted:** Yes, via `zustand/middleware/persist` with `localStorage`.

Widget IDs: `active-contests`, `upcoming-drafts`, `my-leagues`, `recent-activity`, `quick-actions`, `season-highlights`.

---

## Interactions

| Interaction | Trigger | Effect |
|---|---|---|
| Click contest row | Active Contests Card | Navigate to `/contests/:contestId` |
| Click "Enter Draft Room" | Upcoming Drafts Card | Navigate to `/drafts/:draftId` |
| Click league card | My Leagues Summary | Navigate to `/leagues/:leagueId` |
| Click activity item | Recent Activity Feed | Navigate to relevant detail page |
| Click notification bell | Top Nav | Toggle notifications dropdown |
| Click notification item | Notifications Dropdown | Navigate to target, mark as read |
| Click "Mark all as read" | Notifications Dropdown | `PATCH /notifications/read-all`, invalidate queries |
| Click quick action button | Quick Actions Bar | Navigate to target route |
| Click highlight stat | Season Highlights | Navigate to `/contests/:contestId/results` |
| Collapse/expand widget | Widget header chevron | Toggle in Zustand store, persisted |

---

## Text Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Logo]  PoolMaster          [Search...]       [🔔 3]  [Avatar ▾]         │
├───────────┬─────────────────────────────────────────────────────────────────┤
│           │                                                                 │
│  Dashboard│  Welcome back, Dave                                            │
│  Leagues  │                                                                 │
│  Discover │  ┌─ Quick Actions ──────────────────────────────────────────┐  │
│  Settings │  │ [+ Create League]  [🔍 Join League]  [📋 Browse Contests]│  │
│  Billing  │  │ [+ Create Contest]  [⚙ Manage Leagues]  (commissioner)  │  │
│           │  └──────────────────────────────────────────────────────────┘  │
│           │                                                                 │
│           │  ┌─ Active Contests (2) ─────────────── [↻ Polling: 10s] ──┐  │
│           │  │ 🏈  NFL Survivor Pool          3rd of 12    Score: 47   │  │
│           │  │     Weekend Warriors                        ▲ +5        │  │
│           │  │ ⚽  Premier League Picks        1st of 8     Score: 82   │  │
│           │  │     Soccer Fanatics                         — +0        │  │
│           │  └─────────────────────────────────────────────────────────┘  │
│           │                                                                 │
│           │  ┌─ Upcoming Drafts (1) ───────────────────────────────────┐  │
│           │  │ 🏀  NBA Fantasy Draft                                    │  │
│           │  │     Hoops League · Snake Draft                           │  │
│           │  │     Starts: Mar 28 7:00 PM EDT (11:00 PM UTC)           │  │
│           │  │     Countdown: 1d 14h 32m                               │  │
│           │  │     [Enter Draft Room] (disabled — opens 5 min before)  │  │
│           │  └─────────────────────────────────────────────────────────┘  │
│           │                                                                 │
│           │  ┌─ My Leagues (3) ───────────── [View all →] ─────────────┐  │
│           │  │ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │  │
│           │  │ │ Weekend      │ │ Soccer       │ │ Hoops League │      │  │
│           │  │ │ Warriors 🏈  │ │ Fanatics ⚽  │ │          🏀  │      │  │
│           │  │ │ 12 members   │ │ 8 members    │ │ 6 members    │      │  │
│           │  │ │ 1 active     │ │ 1 active     │ │ 0 active     │      │  │
│           │  │ │ 👑 Commish   │ │              │ │              │      │  │
│           │  │ └──────────────┘ └──────────────┘ └──────────────┘      │  │
│           │  └─────────────────────────────────────────────────────────┘  │
│           │                                                                 │
│           │  ┌─ Recent Activity ──────────── [View full activity →] ───┐  │
│           │  │ ⬆ Your entry gained 15 pts in NFL Survivor       2m ago │  │
│           │  │ 📢 Commissioner posted in Weekend Warriors       1h ago │  │
│           │  │ 🏆 March Madness Bracket — Final results posted  3h ago │  │
│           │  │ 👤 JohnDoe joined Soccer Fanatics                5h ago │  │
│           │  │ 🎯 Round 3 pick made in NBA Fantasy Draft       1d ago │  │
│           │  └─────────────────────────────────────────────────────────┘  │
│           │                                                                 │
│           │  ┌─ Season Highlights ─────────────────────────────────────┐  │
│           │  │ 🏆 Recent Win: March Madness Bracket (1st place)        │  │
│           │  │ 📈 Personal Best: 142 pts — NFL Week 14 Picks           │  │
│           │  │ 🔥 Current Streak: 3 wins in a row                      │  │
│           │  │ 📊 Season Record: 7W - 3L across all contests           │  │
│           │  └─────────────────────────────────────────────────────────┘  │
│           │                                                                 │
├───────────┴─────────────────────────────────────────────────────────────────┤
│  Footer: About · Privacy · Terms · Responsible Gaming          v1.0.0      │
└─────────────────────────────────────────────────────────────────────────────┘

Notifications Dropdown (when bell clicked):
┌──────────────────────────────────────┐
│  Notifications           [Mark all ✓]│
│  ─────────────────────────────────── │
│  🏈 Score update: NFL Survivor  2m   │
│  📢 New announcement           1h   │
│  🏆 Contest completed           3h   │
│  👤 New member joined           5h   │
│  🎯 Draft pick made            1d   │
│  ─────────────────────────────────── │
│  [View all notifications →]          │
└──────────────────────────────────────┘
```

---

## File Structure

```
clients/web/src/
├── features/dashboard/
│   ├── dashboard-page.tsx              # Main page component, widget layout
│   ├── active-contests-card.tsx        # Active contests with polling
│   ├── upcoming-drafts-card.tsx        # Upcoming drafts with countdown
│   ├── my-leagues-summary.tsx          # League card grid
│   ├── recent-activity-feed.tsx        # Activity feed list
│   ├── notifications-preview.tsx       # Bell icon + dropdown
│   ├── quick-actions-bar.tsx           # Action buttons
│   ├── season-highlights-card.tsx      # Personal stats/achievements
│   └── hooks/
│       ├── use-active-contests.ts      # TanStack Query hook (10s poll)
│       ├── use-upcoming-drafts.ts      # TanStack Query hook
│       ├── use-my-leagues.ts           # TanStack Query hook
│       ├── use-recent-activity.ts      # TanStack Query hook
│       ├── use-unread-count.ts         # TanStack Query hook (30s poll)
│       ├── use-notifications.ts        # TanStack Query hook (on demand)
│       └── use-highlights.ts           # TanStack Query hook (stale 5m)
├── stores/
│   └── dashboard-preferences-store.ts  # Zustand: collapsed widgets, order
```

---

## Loading & Error States

| Widget | Loading State | Error State | Empty State |
|---|---|---|---|
| Active Contests | Skeleton: 2 rows with shimmer | "Couldn't load contests" + retry button | "No active contests" + discover CTA |
| Upcoming Drafts | Skeleton: 1 card with shimmer | "Couldn't load drafts" + retry button | "No upcoming drafts" |
| My Leagues | Skeleton: 3 card placeholders | "Couldn't load leagues" + retry button | "No leagues yet" + create/join CTAs |
| Recent Activity | Skeleton: 5 line items | "Couldn't load activity" + retry button | "No recent activity" |
| Notifications | Spinner in dropdown | "Couldn't load" in dropdown | "All caught up!" |
| Season Highlights | Skeleton: 4 stat rows | "Couldn't load highlights" + retry | Card hidden (not rendered) |

All skeleton screens use the shadcn/ui `Skeleton` component. Error states include a "Try again" button that calls `queryClient.invalidateQueries()` for the relevant query key.

---

## Responsive Behaviour

| Breakpoint | Layout |
|---|---|
| `sm` (< 640px) | Single column, full-width widgets stacked vertically. Quick actions in 2-column grid. Sidebar collapses to bottom nav. |
| `md` (640-1023px) | Single column with slightly wider widgets. League cards in 2-column grid. |
| `lg` (1024-1279px) | Two-column layout: Active Contests + Upcoming Drafts in left column, Leagues + Activity in right column. |
| `xl` (>= 1280px) | Full two-column layout as shown in wireframe. All widgets at comfortable widths. |

---

## Accessibility

- All widgets have proper `aria-label` attributes (e.g. "Active contests list")
- Notification bell has `aria-label="Notifications, 3 unread"` (dynamic count)
- Notification dropdown uses `role="menu"` with `role="menuitem"` children
- Countdown timers have `aria-live="polite"` for screen reader updates (throttled to every 60 seconds to avoid noise)
- Score changes in Active Contests use `aria-live="polite"` regions
- All interactive elements are keyboard accessible with visible focus indicators
- Colour is not the only indicator of score change direction (arrows used alongside colour)

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| W-D-001 | 1 | Dashboard layout shell — page component, responsive grid, widget collapse/reorder with Zustand persistence | Done | 2-column responsive grid, welcome header, all widgets wired |
| W-D-002 | 1 | Active Contests widget — card component, 10s TanStack Query polling, rank/score display with delta indicators | Done | Sport emoji, ordinal rank, delta arrows, empty state with discover CTA. Mock data — swap to real API |
| W-D-003 | 1 | Upcoming Drafts widget — card component, dual timezone display, client-side countdown timer, draft room entry button | Done | Live countdown, draft type badge, "Enter Draft Room" enabled at 5min. Mock data |
| W-D-004 | 1 | My Leagues Summary — responsive card grid, commissioner badge, member/contest counts, empty state CTAs | Done | 1/2/3 col grid, crown badge, create/join CTAs, "View all" link. Mock data |
| W-D-005 | 2 | Recent Activity Feed — activity item component, type-specific icons, relative timestamps, navigation on click | Done | 5 activity types with emoji, clickable links, empty state. Mock data |
| W-D-006 | 2 | Quick Actions bar — action button row, commissioner-conditional actions, responsive grid layout | Done | Outline buttons, conditional commissioner actions |
| W-D-007 | 2 | Season Highlights widget — personal stats from history data, conditional rendering, links to contest results | Done | 4-stat grid, hidden when no data. Mock data |

---

*PoolMaster Dashboard Page Plan v1.0*
