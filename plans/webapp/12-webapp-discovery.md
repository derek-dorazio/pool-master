# PoolMaster — Discovery & Search

**Routes:** `/discover`, `/discover/leagues`, `/discover/contests`, `/discover/search`
**Layout:** Authenticated (sidebar + top nav)
**Maps to:** 13 (Search & Discovery)

The Discovery pages are the primary way users find and join new leagues, contests, and events. They combine a curated hub experience with powerful search and filtering, enabling users to browse public content and grow their PoolMaster activity.

---

## Components

### 1. Discovery Hub (`/discover`)

The landing page for discovery — a hero-driven experience surfacing trending and featured content across all sports.

**Component:** `DiscoveryHubPage`
**File:** `clients/web/src/features/discovery/discovery-hub-page.tsx`

**Sections:**
- **Hero search bar:** Prominent, centered search input with placeholder "Find leagues, contests, or events..." Submitting navigates to `/discover/search?q=X`.
- **Sport filter tabs:** Horizontal tab bar filtering all featured sections by sport. Options: All, NFL, Golf, F1, NCAA, NBA, Tennis, Soccer, NASCAR, Horse Racing. Selecting a sport filters the sections below without a page reload.
- **Trending Leagues:** Horizontal scrolling row of league cards, ranked by recent join activity and contest creation.
- **Popular Contests This Week:** Horizontal scrolling row of contest cards, ranked by entry count and engagement this week.
- **Upcoming Events by Sport:** Vertical list grouped by sport showing upcoming real-world events that have associated contests users can enter.

**Subcomponents:**
- `DiscoveryHero` — Full-width hero banner with search bar, tagline ("Discover your next competition"), and subtle background graphic.
- `SearchBar` — Reusable search input with magnifying glass icon, clear button, and keyboard shortcut hint (Cmd+K / Ctrl+K). Used in hero and top nav.
- `FeaturedSection` — Generic horizontal scrolling row with title, "View all" link, and card slots. Supports keyboard arrow navigation.
- `SportTabs` — Horizontal tab bar using shadcn/ui `Tabs` component. Sticky below the hero on scroll. Active tab highlighted with underline.
- `TrendingCard` — Compact card used in featured rows. Displays name, sport icon, key metric (members, entries), and a subtle trend indicator.

**Behaviour:**
- Hero search bar auto-focuses on page mount (desktop only, not on mobile to avoid keyboard popup)
- Sport tabs filter all sections simultaneously via URL search param `?sport=nfl`
- Featured sections load independently; each has its own loading skeleton
- "View all" in Trending Leagues navigates to `/discover/leagues?sort=trending`
- "View all" in Popular Contests navigates to `/discover/contests?sort=popular`
- Horizontal scroll rows support mouse drag, touch swipe, and keyboard arrows

**APIs:**
- `GET /discover/trending-leagues?sport=X&limit=10`
- `GET /discover/popular-contests?sport=X&limit=10`
- `GET /discover/upcoming-events?sport=X&limit=10`

---

### 2. Browse Public Leagues (`/discover/leagues`)

A searchable, filterable directory of all public leagues accepting new members.

**Component:** `LeagueBrowserPage`
**File:** `clients/web/src/features/discovery/league-browser-page.tsx`

**Subcomponents:**
- `LeagueBrowser` — Main container managing filter state, search, sort, and pagination. Coordinates the filter bar with the results grid.
- `LeagueFilterBar` — Horizontal filter bar with dropdowns and toggles:
  - **Sport:** Dropdown with all supported sports (multi-select)
  - **League size:** Small (2-8), Medium (9-20), Large (21+)
  - **Activity level:** Active (contest in last 7 days), Moderate (contest in last 30 days), Any
  - **Join type:** Open (instant join) vs Approval Required
  - **Clear all** button to reset filters
- `LeagueDiscoveryCard` — Card displaying league details:
  - League name (bold, linked)
  - Sport icon and sport name
  - Member count (e.g. "14 / 20 members" or "14 members" if no cap)
  - Active contests count
  - Commissioner name with small avatar
  - Join type badge: "Open" (green) or "Approval Required" (amber)
  - Join button (right-aligned)
- `JoinLeagueButton` — Contextual button:
  - "Join" for open leagues (immediate `POST /leagues/:id/join`)
  - "Request to Join" for approval-required leagues (`POST /leagues/:id/join-request`)
  - "Joined" (disabled, checkmark) if user is already a member
  - "Pending" (disabled, clock icon) if user has a pending request
- `LeagueSortSelect` — Sort dropdown: Most Active, Newest, Most Members, Alphabetical

**Sort options:**
| Value | API Param | Description |
|---|---|---|
| Most Active | `sort=active` | Leagues with most recent contest activity |
| Newest | `sort=newest` | Most recently created leagues |
| Most Members | `sort=members` | Largest leagues first |
| Alphabetical | `sort=alpha` | A-Z by league name |

**Behaviour:**
- Search input with 150ms debounce filters results by league name (matches plan 13 debounce spec)
- Filters update URL search params for shareable/bookmarkable URLs (e.g. `/discover/leagues?sport=nfl&size=large&sort=active`)
- Infinite scroll pagination: loads 20 leagues per page, fetches next page when user scrolls within 200px of bottom
- Quality controls: leagues must meet minimum activity threshold to appear (per plan 13) — enforced server-side
- Join button shows loading spinner during API call, then updates to "Joined" or "Pending" state
- After successful join, the league appears in the user's My Leagues on the dashboard

**API:** `GET /discover/leagues?sport=X&size=X&activity=X&joinType=X&sort=X&q=X&page=X&limit=20`

---

### 3. Browse Open Contests (`/discover/contests`)

A searchable, filterable directory of all open contests currently accepting entries.

**Component:** `ContestBrowserPage`
**File:** `clients/web/src/features/discovery/contest-browser-page.tsx`

**Subcomponents:**
- `ContestBrowser` — Main container managing filter state, search, sort, and pagination.
- `ContestFilterBar` — Horizontal filter bar with dropdowns:
  - **Sport:** Dropdown with all supported sports (multi-select)
  - **Contest type:** Survivor, Pick'em, Bracket, Fantasy, Custom
  - **Event:** Specific sporting event (dynamic based on sport selection)
  - **Draft type:** Snake, Auction, Autopick, None
  - **Entry deadline:** Today, This Week, This Month
  - **Clear all** button to reset filters
- `ContestDiscoveryCard` — Card displaying contest details:
  - Contest name (bold, linked to `/contests/:contestId`)
  - Sport icon and event name (e.g. "NFL - Week 14")
  - Contest type badge (e.g. "Survivor", "Pick'em")
  - Entry count with capacity bar (e.g. "8 / 16 entries" with progress bar)
  - Draft date and time (if applicable), displayed in user's local timezone
  - Entry deadline with relative time (e.g. "Closes in 2 days")
  - League name (secondary text, linked to league page)
  - "View & Enter" button
- `EntryDeadlineCountdown` — Inline countdown component:
  - Shows "Closes in Xd Xh" for deadlines more than 24 hours away
  - Shows "Closes in Xh Xm" for deadlines under 24 hours
  - Shows "Closing soon!" with red text for deadlines under 1 hour
  - Shows "Closed" with grey text and strikethrough when deadline has passed
  - Updates every 60 seconds client-side
- `ContestSortSelect` — Sort dropdown: Soonest Draft, Most Entries, Newest

**Sort options:**
| Value | API Param | Description |
|---|---|---|
| Soonest Draft | `sort=draft-date` | Contests with the nearest upcoming draft |
| Most Entries | `sort=entries` | Contests with the most entries (popularity) |
| Newest | `sort=newest` | Most recently created contests |

**Behaviour:**
- Search input with 150ms debounce filters by contest name or event name
- Filters update URL search params for shareable/bookmarkable URLs (e.g. `/discover/contests?sport=golf&type=bracket&sort=draft-date`)
- Infinite scroll pagination: loads 20 contests per page
- Clicking "View & Enter" navigates to `/contests/:contestId` where the full contest detail page handles the join/entry flow
- Contests past their entry deadline are hidden by default (server-side filter); a "Show closed" toggle can reveal them greyed out
- Contest cards with fewer than 25% of spots remaining show an "Almost full!" badge

**API:** `GET /discover/contests?sport=X&type=X&event=X&draftType=X&deadline=X&sort=X&q=X&page=X&limit=20`

---

### 4. Global Search Results (`/discover/search`)

Cross-entity search results page with tabbed navigation across all searchable content types.

**Component:** `GlobalSearchResultsPage`
**File:** `clients/web/src/features/discovery/global-search-results-page.tsx`

**Subcomponents:**
- `GlobalSearchResults` — Main container managing the search query state, tab selection, and result rendering.
- `SearchResultTabs` — Tab bar with result counts: Leagues (X) | Contests (X) | Members (X) | Events (X). Uses shadcn/ui `Tabs`. The "All" tab shows a mixed view with top 3 results from each category.
- `SearchHighlight` — Inline component that wraps matching text in `<mark>` elements with a yellow highlight background. Used within all result item components.
- `LeagueSearchResult` — Result row for a league: name (highlighted), sport, member count, commissioner, join button.
- `ContestSearchResult` — Result row for a contest: name (highlighted), event, entries, deadline, view button.
- `MemberSearchResult` — Result row for a member: display name (highlighted), avatar, league count, profile link.
- `EventSearchResult` — Result row for an event: event name (highlighted), sport, date, associated contest count.

**Behaviour:**
- Search query is driven by the `q` URL param (e.g. `/discover/search?q=fantasy+nba`)
- Search-as-you-type with 150ms debounce in the search bar (per plan 13 specification)
- On initial load, the "All" tab is active showing mixed results
- Switching tabs filters to that entity type; tab selection is reflected in URL param `?q=X&tab=leagues`
- Each tab shows a count badge with the number of results for that category
- Empty state per tab: "No [leagues/contests/members/events] matching 'query'" with suggestions
- Global empty state (no results in any category): "No results for 'query'. Try a different search term or browse by sport." with link to `/discover`
- Results are paginated (20 per page per tab) with "Load more" button at bottom
- Search query is shared with the global search bar in the top nav — typing in either location updates both

**API:** `GET /discover/search?q=X&tab=X&page=X&limit=20`

Response shape:
```json
{
  "query": "fantasy nba",
  "results": {
    "leagues": { "items": [...], "total": 12 },
    "contests": { "items": [...], "total": 5 },
    "members": { "items": [...], "total": 23 },
    "events": { "items": [...], "total": 3 }
  }
}
```

---

## Data Requirements

### API Endpoints

| Endpoint | Method | Purpose | Cache |
|---|---|---|---|
| `GET /discover/trending-leagues` | GET | Trending leagues for hub | staleTime: 2m |
| `GET /discover/popular-contests` | GET | Popular contests for hub | staleTime: 2m |
| `GET /discover/upcoming-events` | GET | Upcoming events for hub | staleTime: 5m |
| `GET /discover/leagues` | GET | Browse/filter public leagues | staleTime: 30s |
| `GET /discover/contests` | GET | Browse/filter open contests | staleTime: 30s |
| `GET /discover/search` | GET | Cross-entity search | staleTime: 0 (always fresh) |
| `POST /leagues/:id/join` | POST | Join an open league | Invalidates leagues queries |
| `POST /leagues/:id/join-request` | POST | Request to join approval league | Invalidates leagues queries |

### TanStack Query Keys

```typescript
// Query key factory
const discoveryKeys = {
  all: ['discovery'] as const,
  trendingLeagues: (sport?: string) =>
    [...discoveryKeys.all, 'trending-leagues', { sport }] as const,
  popularContests: (sport?: string) =>
    [...discoveryKeys.all, 'popular-contests', { sport }] as const,
  upcomingEvents: (sport?: string) =>
    [...discoveryKeys.all, 'upcoming-events', { sport }] as const,
  leagues: (filters: LeagueFilters) =>
    [...discoveryKeys.all, 'leagues', filters] as const,
  contests: (filters: ContestFilters) =>
    [...discoveryKeys.all, 'contests', filters] as const,
  search: (query: string, tab?: string) =>
    [...discoveryKeys.all, 'search', { query, tab }] as const,
};
```

### Infinite Query Configuration

```typescript
// Browse leagues — infinite scroll
useInfiniteQuery({
  queryKey: discoveryKeys.leagues(filters),
  queryFn: ({ pageParam = 1 }) => fetchDiscoverLeagues({ ...filters, page: pageParam }),
  getNextPageParam: (lastPage, pages) =>
    lastPage.items.length === 20 ? pages.length + 1 : undefined,
  staleTime: 30_000,
});

// Browse contests — infinite scroll
useInfiniteQuery({
  queryKey: discoveryKeys.contests(filters),
  queryFn: ({ pageParam = 1 }) => fetchDiscoverContests({ ...filters, page: pageParam }),
  getNextPageParam: (lastPage, pages) =>
    lastPage.items.length === 20 ? pages.length + 1 : undefined,
  staleTime: 30_000,
});

// Search — debounced
const debouncedQuery = useDebounce(query, 150);
useQuery({
  queryKey: discoveryKeys.search(debouncedQuery, tab),
  queryFn: () => fetchSearchResults(debouncedQuery, tab),
  enabled: debouncedQuery.length >= 2,
  staleTime: 0,
});
```

---

## State Management

### Server State (TanStack Query)

All discovery data is server state managed by TanStack Query. Filter and sort state is derived from URL search params via a custom `useDiscoveryFilters` hook, keeping the URL as the single source of truth.

### Client State (Zustand)

**Store:** `useSearchHistoryStore`
**File:** `clients/web/src/stores/search-history-store.ts`

```typescript
interface SearchHistoryState {
  recentSearches: string[];
  addSearch: (query: string) => void;
  removeSearch: (query: string) => void;
  clearHistory: () => void;
}
```

**Persisted:** Yes, via `zustand/middleware/persist` with `localStorage`.

- Stores the last 10 unique search queries
- Displayed as suggestions in the search bar dropdown when the input is focused and empty
- Each item has an "X" button to remove it from history
- "Clear history" link at the bottom of the suggestions dropdown

### URL State

All filter, sort, and search state lives in URL search params:

```typescript
// Custom hook to sync filters with URL
function useDiscoveryFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => ({
    sport: searchParams.get('sport'),
    size: searchParams.get('size'),
    activity: searchParams.get('activity'),
    joinType: searchParams.get('joinType'),
    sort: searchParams.get('sort') ?? 'active',
    q: searchParams.get('q'),
  }), [searchParams]);

  const setFilter = useCallback((key: string, value: string | null) => {
    setSearchParams(prev => {
      if (value) prev.set(key, value);
      else prev.delete(key);
      prev.delete('page'); // Reset pagination on filter change
      return prev;
    });
  }, [setSearchParams]);

  return { filters, setFilter };
}
```

---

## Interactions

| Interaction | Trigger | Effect |
|---|---|---|
| Type in hero search bar | Discovery Hub | Updates input; on Enter, navigate to `/discover/search?q=X` |
| Click sport tab | Discovery Hub | Filter all featured sections by sport; update URL param `?sport=X` |
| Click "View all" on featured section | Discovery Hub | Navigate to browse page with relevant sort pre-applied |
| Click trending card | Discovery Hub | Navigate to league or contest detail page |
| Change filter dropdown | League/Contest Browser | Update URL params, reset pagination, refetch results |
| Change sort dropdown | League/Contest Browser | Update URL `sort` param, reset pagination, refetch |
| Type in browser search | League/Contest Browser | 150ms debounce, update URL `q` param, refetch |
| Click "Join" button | League Discovery Card | `POST /leagues/:id/join`, update button state, invalidate queries |
| Click "Request to Join" | League Discovery Card | `POST /leagues/:id/join-request`, update button to "Pending" |
| Click "View & Enter" | Contest Discovery Card | Navigate to `/contests/:contestId` |
| Scroll near bottom | League/Contest Browser | Trigger next page fetch via infinite scroll |
| Click search result tab | Global Search Results | Switch tab, update URL `tab` param |
| Click search result item | Global Search Results | Navigate to entity detail page |
| Clear filters | Filter Bar | Remove all filter URL params, refetch with defaults |

---

## Text Wireframe

```
Discovery Hub (/discover)
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Logo]  PoolMaster          [Search...]       [Bell]  [Avatar]            │
├───────────┬─────────────────────────────────────────────────────────────────┤
│           │                                                                 │
│  Dashboard│  ┌─────────────────────────────────────────────────────────┐   │
│  Leagues  │  │                                                         │   │
│  Discover │  │       Discover your next competition                    │   │
│  Settings │  │                                                         │   │
│  Billing  │  │   ┌─────────────────────────────────────────────┐      │   │
│           │  │   │  Find leagues, contests, or events...   [Q] │      │   │
│           │  │   └─────────────────────────────────────────────┘      │   │
│           │  │                                                         │   │
│           │  └─────────────────────────────────────────────────────────┘   │
│           │                                                                 │
│           │  [All] [NFL] [Golf] [F1] [NCAA] [NBA] [Tennis] [Soccer] [...]  │
│           │                                                                 │
│           │  Trending Leagues                          [View all ->]       │
│           │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│           │  │ Weekend   │ │ Fantasy  │ │ Masters  │ │ Euro     │          │
│           │  │ Warriors  │ │ Kings    │ │ Pool     │ │ Pickers  │          │
│           │  │ NFL       │ │ NBA      │ │ Golf     │ │ Soccer   │          │
│           │  │ 24 members│ │ 16 mbrs  │ │ 32 mbrs  │ │ 12 mbrs  │          │
│           │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   [->]   │
│           │                                                                 │
│           │  Popular Contests This Week                [View all ->]       │
│           │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│           │  │ NFL Wk 14│ │ NBA All  │ │ Masters  │ │ March    │          │
│           │  │ Survivor │ │ Star Pick│ │ Bracket  │ │ Madness  │          │
│           │  │ 12/16    │ │ 8/20     │ │ 48/64    │ │ 120/128  │          │
│           │  │ 2d left  │ │ 5d left  │ │ 1d left  │ │ Closing! │          │
│           │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   [->]   │
│           │                                                                 │
│           │  Upcoming Events by Sport                                      │
│           │  ┌─────────────────────────────────────────────────────────┐   │
│           │  │ NFL  - Week 14 Games           Dec 12-15   3 contests  │   │
│           │  │ Golf - The Masters              Apr 10-13   5 contests  │   │
│           │  │ NBA  - All-Star Weekend         Feb 14-16   2 contests  │   │
│           │  │ F1   - Monaco Grand Prix        May 25      1 contest   │   │
│           │  └─────────────────────────────────────────────────────────┘   │
│           │                                                                 │
├───────────┴─────────────────────────────────────────────────────────────────┤
│  Footer: About | Privacy | Terms | Responsible Gaming          v1.0.0      │
└─────────────────────────────────────────────────────────────────────────────┘

Browse Public Leagues (/discover/leagues)
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Logo]  PoolMaster          [Search...]       [Bell]  [Avatar]            │
├───────────┬─────────────────────────────────────────────────────────────────┤
│           │                                                                 │
│  Dashboard│  Browse Leagues                                                │
│  Leagues  │                                                                 │
│  Discover │  [Search leagues...]                                           │
│  Settings │  Sport: [All v]  Size: [Any v]  Activity: [Any v]  Join: [v]  │
│  Billing  │  Sort by: [Most Active v]                    [Clear filters]   │
│           │                                                                 │
│           │  ┌─────────────────────────────────────────────────────────┐   │
│           │  │ Weekend Warriors                              [Join]   │   │
│           │  │ NFL  |  14/20 members  |  2 active contests            │   │
│           │  │ Commissioner: Dave M.  |  Open                         │   │
│           │  ├─────────────────────────────────────────────────────────┤   │
│           │  │ Fantasy Kings                          [Request Join]  │   │
│           │  │ NBA  |  16 members  |  1 active contest                │   │
│           │  │ Commissioner: Sarah K.  |  Approval Required           │   │
│           │  ├─────────────────────────────────────────────────────────┤   │
│           │  │ Masters Pool 2026                             [Join]   │   │
│           │  │ Golf  |  28/32 members  |  3 active contests           │   │
│           │  │ Commissioner: Mike T.  |  Open                         │   │
│           │  └─────────────────────────────────────────────────────────┘   │
│           │                                                                 │
│           │                  (scroll for more...)                           │
│           │                                                                 │
├───────────┴─────────────────────────────────────────────────────────────────┤
│  Footer                                                                     │
└─────────────────────────────────────────────────────────────────────────────┘

Browse Open Contests (/discover/contests)
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Logo]  PoolMaster          [Search...]       [Bell]  [Avatar]            │
├───────────┬─────────────────────────────────────────────────────────────────┤
│           │                                                                 │
│  Dashboard│  Browse Contests                                               │
│  Leagues  │                                                                 │
│  Discover │  [Search contests...]                                          │
│  Settings │  Sport: [All v]  Type: [Any v]  Draft: [Any v]  Deadline: [v] │
│  Billing  │  Sort by: [Soonest Draft v]                  [Clear filters]   │
│           │                                                                 │
│           │  ┌─────────────────────────────────────────────────────────┐   │
│           │  │ NFL Week 14 Survivor                  [View & Enter]   │   │
│           │  │ NFL - Week 14  |  Survivor  |  Weekend Warriors        │   │
│           │  │ Entries: [=========---] 12/16                          │   │
│           │  │ Draft: Dec 11 @ 7:00 PM  |  Closes in 2d 5h           │   │
│           │  ├─────────────────────────────────────────────────────────┤   │
│           │  │ NBA All-Star Picks                    [View & Enter]   │   │
│           │  │ NBA - All-Star Weekend  |  Pick'em  |  Fantasy Kings   │   │
│           │  │ Entries: [====--------] 8/20                           │   │
│           │  │ No draft  |  Closes in 5d 12h                          │   │
│           │  ├─────────────────────────────────────────────────────────┤   │
│           │  │ Masters Bracket Challenge   [Almost full!] [View]      │   │
│           │  │ Golf - The Masters  |  Bracket  |  Masters Pool 2026   │   │
│           │  │ Entries: [==============] 60/64                        │   │
│           │  │ No draft  |  Closing soon!                             │   │
│           │  └─────────────────────────────────────────────────────────┘   │
│           │                                                                 │
│           │                  (scroll for more...)                           │
│           │                                                                 │
├───────────┴─────────────────────────────────────────────────────────────────┤
│  Footer                                                                     │
└─────────────────────────────────────────────────────────────────────────────┘

Global Search Results (/discover/search?q=fantasy+nba)
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Logo]  PoolMaster    [fantasy nba          X]   [Bell]  [Avatar]         │
├───────────┬─────────────────────────────────────────────────────────────────┤
│           │                                                                 │
│  Dashboard│  Search results for "fantasy nba"                              │
│  Leagues  │                                                                 │
│  Discover │  [All] [Leagues (3)] [Contests (2)] [Members (8)] [Events (1)]│
│  Settings │                                                                 │
│  Billing  │  Leagues                                                       │
│           │  ┌─────────────────────────────────────────────────────────┐   │
│           │  │ **Fantasy** **NBA** Elite League           [Join]      │   │
│           │  │ NBA  |  12 members  |  Commissioner: Alex P.           │   │
│           │  ├─────────────────────────────────────────────────────────┤   │
│           │  │ **Fantasy** Hoops **NBA**                  [Joined]    │   │
│           │  │ NBA  |  8 members  |  Commissioner: Chris W.           │   │
│           │  └─────────────────────────────────────────────────────────┘   │
│           │                                                                 │
│           │  Contests                                                      │
│           │  ┌─────────────────────────────────────────────────────────┐   │
│           │  │ **NBA** **Fantasy** Draft 2026         [View & Enter]  │   │
│           │  │ NBA - Regular Season  |  Fantasy  |  5/12 entries      │   │
│           │  └─────────────────────────────────────────────────────────┘   │
│           │                                                                 │
│           │  Members                                                       │
│           │  ┌─────────────────────────────────────────────────────────┐   │
│           │  │ [Av] **Fantasy**Fan42          3 leagues  [View]       │   │
│           │  │ [Av] **NBA**Guru                5 leagues  [View]       │   │
│           │  └─────────────────────────────────────────────────────────┘   │
│           │                                                                 │
│           │  [Load more results]                                           │
│           │                                                                 │
├───────────┴─────────────────────────────────────────────────────────────────┤
│  Footer                                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
clients/web/src/
├── features/discovery/
│   ├── discovery-hub-page.tsx            # Discovery hub with hero and featured sections
│   ├── league-browser-page.tsx           # Browse public leagues with filters
│   ├── contest-browser-page.tsx          # Browse open contests with filters
│   ├── global-search-results-page.tsx    # Cross-entity search results
│   ├── components/
│   │   ├── discovery-hero.tsx            # Hero banner with search bar
│   │   ├── search-bar.tsx                # Reusable search input (hero + nav)
│   │   ├── featured-section.tsx          # Horizontal scrolling card row
│   │   ├── sport-tabs.tsx                # Sport filter tab bar
│   │   ├── trending-card.tsx             # Compact card for featured rows
│   │   ├── league-filter-bar.tsx         # League browse filter controls
│   │   ├── league-discovery-card.tsx     # League result card
│   │   ├── join-league-button.tsx        # Contextual join/request button
│   │   ├── contest-filter-bar.tsx        # Contest browse filter controls
│   │   ├── contest-discovery-card.tsx    # Contest result card
│   │   ├── entry-deadline-countdown.tsx  # Countdown timer for entry deadlines
│   │   ├── search-result-tabs.tsx        # Tabbed search result navigation
│   │   └── search-highlight.tsx          # Text match highlighting
│   └── hooks/
│       ├── use-trending-leagues.ts       # TanStack Query hook (staleTime: 2m)
│       ├── use-popular-contests.ts       # TanStack Query hook (staleTime: 2m)
│       ├── use-upcoming-events.ts        # TanStack Query hook (staleTime: 5m)
│       ├── use-discover-leagues.ts       # TanStack infinite query hook
│       ├── use-discover-contests.ts      # TanStack infinite query hook
│       ├── use-global-search.ts          # TanStack Query hook (debounced)
│       ├── use-discovery-filters.ts      # URL search param sync hook
│       ├── use-join-league.ts            # Mutation hook for join/request
│       └── use-debounce.ts              # Generic debounce hook (150ms)
├── stores/
│   └── search-history-store.ts           # Zustand: recent search history
```

---

## Loading & Error States

| Page/Component | Loading State | Error State | Empty State |
|---|---|---|---|
| Discovery Hub | Skeleton hero + 3 skeleton card rows | "Couldn't load discovery" + retry button | N/A (always has content) |
| Featured Section | 4 skeleton cards in horizontal row | "Couldn't load section" inline message | "No [trending leagues / contests] right now" |
| League Browser | Skeleton: 5 league card placeholders | "Couldn't load leagues" + retry button | "No leagues match your filters. Try adjusting your search." |
| Contest Browser | Skeleton: 5 contest card placeholders | "Couldn't load contests" + retry button | "No open contests match your filters. Try adjusting your search." |
| Global Search | Skeleton: 3 result rows per tab | "Search failed" + retry button | "No results for 'query'. Try a different term or browse by sport." |
| Join League Button | Loading spinner replacing button text | Toast: "Failed to join league" + retry | N/A |

All skeleton screens use the shadcn/ui `Skeleton` component. Error states include a "Try again" button that calls `queryClient.invalidateQueries()` for the relevant query key.

---

## Responsive Behaviour

| Breakpoint | Layout |
|---|---|
| `sm` (< 640px) | Single column. Hero search bar full-width. Sport tabs horizontally scrollable. Featured sections single card visible with swipe. Filter bars stack vertically as accordion. League/contest cards full-width stacked. |
| `md` (640-1023px) | Single column with wider cards. Featured sections show 2 cards. Filter bars in 2-column grid. Search result tabs scroll horizontally if needed. |
| `lg` (1024-1279px) | Full layout. Featured sections show 3-4 cards. Filter bars in single horizontal row. League/contest cards with comfortable spacing. |
| `xl` (>= 1280px) | Full layout as shown in wireframes. Featured sections show 4+ cards. All filters visible in one row. |

---

## Accessibility

- Hero search bar has `role="search"` with `aria-label="Search leagues, contests, and events"`
- Sport tabs use `role="tablist"` with `role="tab"` and `aria-selected` attributes
- Search results have `aria-live="polite"` region announcing result count on query change (e.g. "12 results found for fantasy nba")
- Filter dropdowns use proper `aria-label` attributes (e.g. "Filter by sport")
- Infinite scroll has a "Load more" button as fallback for keyboard/screen reader users (not scroll-only)
- League and contest cards are keyboard navigable with visible focus rings
- Join/Request buttons have descriptive `aria-label` including league name (e.g. "Join Weekend Warriors league")
- Entry deadline countdown has `aria-label` with full text (e.g. "Entry deadline: 2 days and 5 hours remaining")
- Search highlight uses `<mark>` element which is announced by screen readers
- All filter changes announce the updated result count via `aria-live` region

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| W-DIS-001 | 1 | Discovery hub page — hero banner, sport tabs, featured sections with horizontal scroll, trending/popular data loading | Done | Hero search, sport filter tabs, trending leagues grid, popular contests grid, skeleton loading |
| W-DIS-002 | 1 | Global search bar with debounce — reusable SearchBar component, 150ms debounce, Cmd+K shortcut, recent search history via Zustand | Done | Reusable SearchBar with Cmd+K, clear button, sm/lg sizes |
| W-DIS-003 | 2 | Browse leagues page with filters — LeagueBrowser, LeagueFilterBar, URL param sync, infinite scroll, sort options | Done | Sport badge filters, sort dropdown, URL param sync, search, skeleton loading |
| W-DIS-004 | 2 | Browse contests page with filters — ContestBrowser, ContestFilterBar, URL param sync, infinite scroll, sort options | Done | Sport badges, sort (starting soon/popular/newest), URL params, search |
| W-DIS-005 | 2 | League discovery card — LeagueDiscoveryCard component with sport icon, member count, commissioner, join type badge | Done | Sport emoji, member count, active contests, join policy badge, commissioner name |
| W-DIS-006 | 2 | Contest discovery card — ContestDiscoveryCard component with entry progress bar, deadline countdown, capacity badge | Done | Entry progress bar, days-until-lock countdown, draft type badge, member capacity |
| W-DIS-007 | 3 | Join league flow — JoinLeagueButton with open join, approval request, pending/joined states, mutation hooks, optimistic updates | Done | Join/Request/Joined/Pending states, loading spinner, mutation with query invalidation |
| W-DIS-008 | 3 | Global search results with tabs — GlobalSearchResultsPage, tabbed results, SearchHighlight, cross-entity search, result counts per tab | Done | Tabbed results (All/Leagues/Contests), per-tab counts, empty states, URL param sync |

---

*PoolMaster Discovery & Search Page Plan v1.0*
