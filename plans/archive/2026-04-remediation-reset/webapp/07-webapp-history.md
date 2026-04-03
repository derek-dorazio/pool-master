# PoolMaster — History & Analytics Pages

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

This plan covers the league record book, season archive, contest results, head-to-head rivalry view, and personal stats pages for the PoolMaster React webapp. These pages surface historical contest data, comparative analytics, and individual performance tracking for league members.

**Maps to:** 04 (Contest History)

**Related service plans:**

- **01 — Architecture:** API endpoints for history queries, pagination, caching strategy for historical data
- **04 — Contest History:** Backend scoring timelines, record computation, rivalry tracking, season aggregation
- **06 — Participant Data:** Member profiles, StandingsTable component (reused on Contest Results page)
- **10 — Social & Communication:** Share card generation for contest results
- **14 — i18n:** All user-facing strings externalized for localization

---

## Pages

### 1. League Record Book

**Route:** `/leagues/:leagueId/records`

**Purpose:** Displays the all-time record book for a league, showcasing the best individual performances across all historical contests. Serves as a hall-of-fame view that drives engagement and friendly competition among league members.

**Categories:**

- **Best Single-Contest Score** — Highest score achieved in any single contest
- **Most Contest Wins** — Total number of first-place finishes
- **Longest Win Streak** — Most consecutive contest wins
- **Highest Season Total** — Cumulative score across all contests in a single season
- **Best Draft Pick** — Highest value over expectation (actual points minus projected points for a draft selection)
- **Most Head-to-Head Wins** — Most wins in direct head-to-head matchups across all contests

**Key Components:**

- **RecordBook** — Page-level container that fetches record data and manages filter state. Renders a grid of RecordCard components grouped by category. Includes a header with the league name and "Record Book" title.
- **RecordCard** — Individual record display card. Shows the record category name, the current holder (RecordHolder), the record value, the contest name and date, and a link to the contest results page. Uses a trophy icon for emphasis. Supports an "expand" interaction to show the top 5 holders for that category.
- **RecordHolder** — Inline display of the record holder: avatar thumbnail, display name, and a link to their profile. Reused across all record categories.
- **RecordFilters** — Filter bar positioned below the page header. Supports filtering by sport (dropdown of all sports the league has played), season (dropdown of years), and contest type (e.g., Pick'em, Survivor, Bracket). Filters are applied as query parameters for deep-linking. Reset button clears all filters.

**Data Requirements:**

- `GET /api/leagues/:leagueId/records` — Fetches all record categories with current holders. Accepts query params: `sport`, `season`, `contestType`.
- `GET /api/leagues/:leagueId/records/:category` — Fetches top N holders for a specific record category (used when expanding a RecordCard).
- TanStack Query cache key: `['league-records', leagueId, filters]`.
- Stale time: 5 minutes (records change infrequently).

**User Interactions / Flows:**

1. User navigates to `/leagues/:leagueId/records` -> sees all record categories with current holders.
2. User applies a sport filter -> records update to show only records from that sport's contests.
3. User clicks "expand" on a RecordCard -> card expands to show the top 5 all-time holders for that category.
4. User clicks the contest name/date link on a record -> navigates to `/contests/:contestId/results`.
5. User clicks a record holder's name -> navigates to that member's profile.

**Wireframe:**

```
+----------------------------------------------------------+
| [<- Back to League]        League Record Book             |
+----------------------------------------------------------+
| Sport: [All Sports v]  Season: [All v]  Type: [All v]    |
| [Reset Filters]                                           |
+----------------------------------------------------------+
|                                                          |
|  +------------------------+  +------------------------+  |
|  | [trophy] Best Single-  |  | [trophy] Most Contest  |  |
|  |   Contest Score         |  |   Wins                  |  |
|  |                        |  |                        |  |
|  | [avatar] John D.       |  | [avatar] Sarah K.      |  |
|  | 187 pts                |  | 12 wins                |  |
|  | NFL Week 14, 2025      |  | 2024-2025 Seasons      |  |
|  | [View Contest ->]      |  | [Expand v]             |  |
|  +------------------------+  +------------------------+  |
|                                                          |
|  +------------------------+  +------------------------+  |
|  | [trophy] Longest Win   |  | [trophy] Highest       |  |
|  |   Streak               |  |   Season Total          |  |
|  |                        |  |                        |  |
|  | [avatar] Mike R.       |  | [avatar] Lisa T.       |  |
|  | 5 consecutive          |  | 1,247 pts              |  |
|  | Mar-May 2025           |  | 2025 Season            |  |
|  | [Expand v]             |  | [Expand v]             |  |
|  +------------------------+  +------------------------+  |
|                                                          |
|  +------------------------+  +------------------------+  |
|  | [trophy] Best Draft    |  | [trophy] Most H2H      |  |
|  |   Pick                 |  |   Wins                  |  |
|  |                        |  |                        |  |
|  | [avatar] Tom B.        |  | [avatar] Anna P.       |  |
|  | +42.5 over expected    |  | 38 wins                |  |
|  | Golf Masters 2025      |  | All-Time                |  |
|  | [View Contest ->]      |  | [View Rivalry ->]      |  |
|  +------------------------+  +------------------------+  |
+----------------------------------------------------------+
```

---

### 2. League History / Season Archive

**Route:** `/leagues/:leagueId/history`

**Purpose:** Provides a chronological timeline of all past seasons in the league. Each season can be expanded to view the list of contests, final standings summary, and the season champion. Serves as the primary historical browsing interface for the league.

**Key Components:**

- **SeasonTimeline** — Page-level container that fetches season history and renders an accordion-style timeline. Most recent season appears at the top. Each season is rendered as a collapsible SeasonCard. Includes the league name and "League History" title in the header.
- **SeasonCard** — Collapsible card representing a single season. Header shows the season year/label, the season champion (name + avatar), and the number of contests. When expanded, shows the full contest list and season summary stats. Uses Radix UI Accordion primitive.
- **ContestResultPreview** — Compact row shown within an expanded SeasonCard for each contest. Displays the contest name, sport icon, date, winner name, and winning score. Click navigates to the full contest results page. Shows a "Top 5" expandable section that lists the top 5 finishers inline.
- **SeasonSummaryStats** — Stats bar at the top of each expanded SeasonCard. Shows: total contests played, number of unique winners, closest finish (smallest margin of victory), and season champion with their total score.

**Data Requirements:**

- `GET /api/leagues/:leagueId/seasons` — Fetches list of all seasons with summary data (year, champion, contest count).
- `GET /api/leagues/:leagueId/seasons/:seasonId` — Fetches full season detail including contest list, standings, and stats.
- TanStack Query cache key: `['league-seasons', leagueId]` for the list, `['season-detail', seasonId]` for expanded season data.
- Season detail is fetched lazily when the user expands a SeasonCard.
- Stale time: 10 minutes (historical data changes very rarely).

**User Interactions / Flows:**

1. User navigates to `/leagues/:leagueId/history` -> sees a timeline of all seasons, most recent first.
2. User clicks on a season header -> SeasonCard accordion expands to show contests and summary stats.
3. User clicks on a contest row -> navigates to `/contests/:contestId/results`.
4. User clicks "Top 5" on a ContestResultPreview -> inline expansion shows the top 5 finishers without navigating away.
5. User clicks the season champion's name -> navigates to that member's profile.

**Wireframe:**

```
+----------------------------------------------------------+
| [<- Back to League]        League History                 |
+----------------------------------------------------------+
|                                                          |
| v  2025-2026 Season                                      |
|    Champion: [avatar] Sarah K.    |    14 Contests       |
|  +------------------------------------------------------+|
|  | Contests: 14 | Unique Winners: 8 | Closest: 0.5 pts ||
|  +------------------------------------------------------+|
|  |                                                      ||
|  | [NFL] Week 17 Pick'em    Dec 28   Sarah K.   142 pts ||
|  |    > Top 5                                           ||
|  | [NFL] Week 16 Pick'em    Dec 21   John D.    138 pts ||
|  |    > Top 5                                           ||
|  | [NBA] Christmas Day Pool Dec 25   Mike R.    97 pts  ||
|  |    > Top 5                                           ||
|  | ... (11 more)                                        ||
|  +------------------------------------------------------+|
|                                                          |
| >  2024-2025 Season                                      |
|    Champion: [avatar] John D.     |    18 Contests       |
|                                                          |
| >  2023-2024 Season                                      |
|    Champion: [avatar] Mike R.     |    12 Contests       |
|                                                          |
+----------------------------------------------------------+
```

---

### 3. Contest Results

**Route:** `/contests/:contestId/results`

**Purpose:** Displays the complete final results for a single contest. Includes the full standings table, a winner spotlight section, and a contest summary. This is the canonical results page that record entries and history items link to.

**Key Components:**

- **ContestResults** — Page-level container that orchestrates the layout. Fetches contest result data and renders the WinnerSpotlight, ContestSummary, standings table, and share controls. Includes breadcrumb navigation back to the league and season.
- **WinnerSpotlight** — Prominent hero-style banner at the top of the page. Displays the winner's avatar (large), display name, final score, and margin of victory over second place. Uses a celebratory visual treatment (subtle confetti gradient or gold accent). If the contest is tied, shows co-winners.
- **ContestSummary** — Compact info bar below the WinnerSpotlight. Shows: total number of entries, sport and event name (e.g., "NFL Week 14"), contest type (e.g., "Pick'em"), and a brief scoring summary (e.g., "Correct picks x 10 pts, bonus for upsets").
- **StandingsTable** — Reused from plan 06 (Participant Data). Full final standings with rank, player name, score, and any tiebreaker information. Supports sorting by column. Paginated if the contest has many entries.
- **ShareButton** — Button that triggers share card generation (plan 10). Opens a modal with a preview of the shareable image/card. Supports copy-link, share-to-social, and download options.

**Data Requirements:**

- `GET /api/contests/:contestId/results` — Fetches full contest results including winner data, standings, and contest metadata.
- `POST /api/contests/:contestId/share` — Generates a share card image (delegated to plan 10 service).
- TanStack Query cache key: `['contest-results', contestId]`.
- Stale time: Infinity for completed contests (results never change once finalized).

**User Interactions / Flows:**

1. User navigates to `/contests/:contestId/results` -> sees winner spotlight, contest summary, and full standings.
2. User scrolls down to the StandingsTable -> can sort by rank, score, or name.
3. User clicks "Share" button -> share modal opens with a preview of the shareable contest card.
4. User copies the share link or downloads the card image.
5. User clicks a player's name in the standings -> navigates to that member's profile.
6. User clicks breadcrumb "Back to Season" -> navigates to `/leagues/:leagueId/history`.

**Wireframe:**

```
+----------------------------------------------------------+
| League Name > 2025 Season > NFL Week 14 Pick'em          |
+----------------------------------------------------------+
|                                                          |
|  +------------------------------------------------------+|
|  |                  [large avatar]                       ||
|  |                   Sarah K.                            ||
|  |                  WINNER                               ||
|  |              142 pts (+4 over 2nd)                    ||
|  +------------------------------------------------------+|
|                                                          |
|  +------------------------------------------------------+|
|  | 24 entries | NFL Week 14 | Pick'em | 10 pts/pick     ||
|  +------------------------------------------------------+|
|                                                          |
|  +------------------------------------------------------+|
|  | Rank | Player       | Score | Correct | Bonus         ||
|  |------|-------------|-------|---------|--------------- ||
|  |  1   | Sarah K.    | 142   |   12    |  22            ||
|  |  2   | John D.     | 138   |   11    |  28            ||
|  |  3   | Mike R.     | 135   |   11    |  25            ||
|  |  4   | Lisa T.     | 130   |   10    |  30            ||
|  |  5   | Tom B.      | 128   |   10    |  28            ||
|  | ...  | ...         | ...   |   ...   |  ...           ||
|  +------------------------------------------------------+|
|                                                          |
|                    [ Share Results ]                       |
+----------------------------------------------------------+
```

---

### 4. Head-to-Head / Rivalry View

**Route:** `/leagues/:leagueId/head-to-head`

**Purpose:** Enables two league members to be compared across all contests they have both participated in. Shows the overall head-to-head record, a per-contest breakdown, and a trend chart of score differentials over time. Drives engagement through rivalry narratives.

**Key Components:**

- **RivalryView** — Page-level container. Manages the selection of two members and fetches comparison data. Renders the MemberPicker, H2HRecord, H2HContestTable, and H2HTrendChart. Shows an empty state prompt when fewer than two members are selected.
- **MemberPicker** — Side-by-side member selection UI. Each side is a searchable dropdown (Combobox) listing all league members with avatars. Once both members are selected, the comparison data loads. Supports URL query params (`?p1=userId1&p2=userId2`) for deep-linking.
- **H2HRecord** — Summary card showing the overall record between the two selected members. Displays: Player 1 wins, Player 2 wins, ties, total shared contests, and win percentage for each side. Uses a visual bar (proportional fill) to illustrate the split.
- **H2HContestTable** — Detailed table listing every contest both members entered. Columns: contest name, date, Player 1 score, Player 2 score, winner (highlighted), margin. Sortable by date or margin. Most recent contests first by default.
- **H2HTrendChart** — Line chart (built with Recharts) showing the score differential over time. X-axis is contest date, Y-axis is score difference (positive = Player 1 advantage, negative = Player 2 advantage). Zero line is emphasized. Hovering a data point shows the contest name and scores.

**Data Requirements:**

- `GET /api/leagues/:leagueId/members` — Fetches member list for the MemberPicker dropdowns.
- `GET /api/leagues/:leagueId/head-to-head?p1=userId1&p2=userId2` — Fetches the full head-to-head comparison data including overall record, per-contest breakdown, and trend data.
- TanStack Query cache key: `['h2h', leagueId, userId1, userId2]`.
- Stale time: 5 minutes.

**User Interactions / Flows:**

1. User navigates to `/leagues/:leagueId/head-to-head` -> sees two empty MemberPicker slots with a prompt to select two members.
2. User selects Player 1 from the left dropdown -> avatar and name appear.
3. User selects Player 2 from the right dropdown -> comparison data fetches and renders.
4. User views the H2HRecord summary -> sees who leads the rivalry.
5. User scrolls to the H2HContestTable -> sees every shared contest with scores and winners.
6. User views the H2HTrendChart -> sees how the rivalry has evolved over time.
7. User clicks a contest row in the table -> navigates to `/contests/:contestId/results`.
8. User changes a member in the picker -> new comparison loads.
9. URL updates with query params on member selection -> enables sharing a specific rivalry link.

**Wireframe:**

```
+----------------------------------------------------------+
| [<- Back to League]        Head-to-Head                   |
+----------------------------------------------------------+
|                                                          |
|  +------------+    VS    +------------+                  |
|  | [avatar]   |          | [avatar]   |                  |
|  | Sarah K.   |          | John D.    |                  |
|  | [Change v] |          | [Change v] |                  |
|  +------------+          +------------+                  |
|                                                          |
|  +------------------------------------------------------+|
|  |        Sarah K.  8 - 5 - 1  John D.                  ||
|  |  [========||||||||||||=====]                          ||
|  |    57%      14 contests      36%                      ||
|  +------------------------------------------------------+|
|                                                          |
|  +------------------------------------------------------+|
|  | Contest           | Date    | Sarah | John | Winner   ||
|  |-------------------|---------|-------|------|--------- ||
|  | NFL Week 17       | Dec 28  | 142   | 138  | Sarah   ||
|  | NFL Week 16       | Dec 21  | 130   | 135  | John    ||
|  | NBA Christmas     | Dec 25  | 97    | 92   | Sarah   ||
|  | ...               | ...     | ...   | ...  | ...     ||
|  +------------------------------------------------------+|
|                                                          |
|  +------------------------------------------------------+|
|  | Score Differential Over Time                          ||
|  |     +10 |    *              *                         ||
|  |      +5 |  *   *     *        *                       ||
|  |       0 |-----*--*---------*-----                    ||
|  |      -5 |          *                                  ||
|  |     -10 |                                             ||
|  |         Oct   Nov   Dec   Jan   Feb   Mar             ||
|  +------------------------------------------------------+|
+----------------------------------------------------------+
```

---

### 5. Personal Stats

**Embedded in:** User profile page (`/profile`) and league dashboard (`/leagues/:leagueId/dashboard`)

**Purpose:** Displays a user's personal performance statistics across all contests they have entered. Provides a quick snapshot of their track record including win rate, average finish, streaks, and sport-by-sport breakdown. Shown as a widget that can be embedded in the user profile page or the league dashboard sidebar.

**Key Components:**

- **PersonalStats** — Container widget that fetches and renders all personal stat data. Accepts a `userId` and optional `leagueId` prop (when league-scoped, only shows stats from that league). Renders a grid of StatCard components and a StreakIndicator.
- **StatCard** — Small card displaying a single statistic. Contains a label, a large numeric value, and an optional secondary line (e.g., "out of 42 contests"). Used for: win rate (%), average finish position, total wins, best contest score, worst contest score, and total contests entered.
- **StreakIndicator** — Visual indicator for active streaks. Shows current winning streak (if any), current top-3 streak, and longest-ever win streak. Uses a flame/fire icon for active hot streaks. If no active streak, shows the most recent streak with a "last streak" label.
- **SportBreakdown** — Horizontal bar chart or segmented bar showing the user's contest participation and performance by sport. Each sport shows: number of contests entered, win rate, and average finish. Sorted by number of contests (most played first).

**Data Requirements:**

- `GET /api/users/:userId/stats` — Fetches personal stats across all leagues and contests.
- `GET /api/users/:userId/stats?leagueId=xxx` — Fetches personal stats scoped to a specific league.
- TanStack Query cache key: `['personal-stats', userId, leagueId?]`.
- Stale time: 2 minutes (stats update after each contest finalization).

**User Interactions / Flows:**

1. User views their own profile or league dashboard -> PersonalStats widget loads with their data.
2. User sees their win rate, average finish, and other summary stats at a glance.
3. User views active streaks in the StreakIndicator -> motivated to maintain their streak.
4. User views the SportBreakdown -> sees which sports they perform best in.
5. On the league dashboard, stats are scoped to that league only.
6. On the user profile page, stats are aggregated across all leagues.

**Wireframe:**

```
+----------------------------------------------------------+
| Personal Stats                                            |
+----------------------------------------------------------+
|                                                          |
|  +----------+  +----------+  +----------+  +----------+ |
|  | Win Rate |  | Avg.     |  | Total    |  | Contests | |
|  |   24%    |  | Finish   |  |  Wins    |  | Entered  | |
|  | 10 of 42 |  |  3.2     |  |   10     |  |   42     | |
|  +----------+  +----------+  +----------+  +----------+ |
|                                                          |
|  +----------+  +----------+                              |
|  | Best     |  | Worst    |                              |
|  |  Score   |  |  Score   |                              |
|  |  187 pts |  |  45 pts  |                              |
|  +----------+  +----------+                              |
|                                                          |
|  +------------------------------------------------------+|
|  | [fire] Active Win Streak: 3 contests                  ||
|  |        Longest Ever: 5 contests (Mar-May 2025)        ||
|  +------------------------------------------------------+|
|                                                          |
|  +------------------------------------------------------+|
|  | Sport Breakdown                                       ||
|  | NFL     [============] 18 contests  28% win rate      ||
|  | NBA     [========]     12 contests  17% win rate      ||
|  | Soccer  [=====]         7 contests  29% win rate      ||
|  | Golf    [===]           5 contests  20% win rate      ||
|  +------------------------------------------------------+|
+----------------------------------------------------------+
```

---

## Cross-Cutting Concerns

- **Authenticated Layout:** All pages listed above use the Authenticated layout (sidebar navigation, league context). The league record book, season archive, and head-to-head views are scoped to a specific league and require league membership.
- **Breadcrumb Navigation:** Contest Results and nested views use breadcrumbs to show the navigation path (League > Season > Contest). Breadcrumb data is derived from the contest metadata response.
- **Empty States:** Each page handles the case where no data exists (new league with no completed contests). Empty states show encouraging messaging and suggest creating the first contest.
- **Loading States:** All data-driven sections use skeleton loaders (Shadcn Skeleton component) that match the layout of the final rendered content. Accordion-expanded content uses inline spinners.
- **Error States:** API failures render an inline error message with a "Retry" button. Uses TanStack Query's `isError` and `refetch` for retry logic.
- **Mobile Responsive:** Record cards stack to a single column on small screens. The H2H member pickers stack vertically. Tables switch to a card-based layout on mobile viewports. The trend chart adjusts its aspect ratio for narrow screens.
- **i18n:** All user-facing strings are externalized via `i18next`. Number formatting (scores, percentages) uses `Intl.NumberFormat` for locale-aware display.
- **Accessibility:** Tables use proper `<thead>`, `<th scope="col">`, and `aria-sort` attributes. Charts include `aria-label` descriptions summarizing the data trend. Accordion sections use `aria-expanded` and keyboard navigation.
- **Deep Linking:** Filter states (record book filters, H2H member selections) are persisted in URL query parameters, enabling bookmarking and sharing of specific views.
- **Performance:** Historical data is aggressively cached with long stale times. Season detail data is loaded lazily on accordion expand. The StandingsTable component is virtualized for contests with many entries.

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| W-H-001 | 1 | Build Record Book page with RecordBook container, RecordFilters, and record category grid layout | Done | 131 lines — 6 record types with icon grid in leagues/records.tsx |
| W-H-002 | 1 | Build RecordCard and RecordHolder components with expand-to-top-5 interaction | Done | Card with icon, value, holder name, date, "View Details" button |
| W-H-003 | 1 | Build Season Archive timeline with SeasonTimeline and SeasonCard accordion components | Done | 189 lines — accordion with season expand/collapse in leagues/history.tsx |
| W-H-004 | 1 | Build ContestResultPreview component with inline top-5 expansion | Done | Winner, score, date per contest within season accordion |
| W-H-005 | 2 | Build Contest Results page with ContestResults container, breadcrumb navigation, and StandingsTable integration | Done | 169 lines — full standings table with rank badges in contests/results.tsx |
| W-H-006 | 2 | Build WinnerSpotlight and ContestSummary components for the contest results page | Done | Trophy spotlight card with winner, runner-up, margin |
| W-H-007 | 2 | Build Head-to-Head Rivalry View with RivalryView container and URL-driven member selection | Done | 233 lines — member picker dropdowns + comparison in contests/head-to-head.tsx |
| W-H-008 | 2 | Build MemberPicker combobox, H2HRecord summary, H2HContestTable, and H2HTrendChart (Recharts) | Done | Two select dropdowns, participant-by-participant comparison table, score summary |
| W-H-009 | 2 | Build PersonalStats widget with StatCard, StreakIndicator, and SportBreakdown components | Done | 8 stat cards (wins, top3, avg score, percentile, streak, best, winnings) + sport breakdown table |
