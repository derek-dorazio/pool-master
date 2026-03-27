# PoolMaster — Standings & Scoring

This plan covers the standings and scoring components for the PoolMaster React webapp. These are primarily **embedded components** used within contest pages (`/contests/:contestId`, `/contests/:contestId/standings`, `/contests/:contestId/scoring`), not standalone routes. They provide the leaderboard, score breakdowns, scoring rule display, and live update indicators that form the core gameplay experience.

**Related service plans:**

- **03 — Scoring Rules:** Scoring engine, templates, stat-to-score mappings, multipliers
- **04 — History:** Contest history, score timelines, replays, progression data
- **01 — Core API:** Contest endpoints, entry data, standings queries, polling infrastructure

---

## Components

### 1. Leaderboard / Standings Table

**Embedded in:** `/contests/:contestId`, `/contests/:contestId/standings`

**Purpose:** Sortable, real-time standings table showing all entries in a contest ranked by score. This is the primary view users interact with during an active contest. Supports expandable rows for drill-down into participant-level scoring detail.

**Key Components:**

- **StandingsTable** — Top-level wrapper. Accepts contest ID, fetches standings data via TanStack Query. Manages sort state (column + direction), expanded row state, and pagination. Uses `<Table>` from shadcn/ui.
- **StandingsRow** — Single entry row. Displays rank, movement indicator, entry name, owner avatar + display name, total score, and per-round score cells. Highlights the current user's entry with a distinct left-border accent. Greyed-out styling for eliminated entries (survivor pools). Top 3 entries receive gold/silver/bronze rank badge styling. Clickable to expand and show ParticipantScorecard inline.
- **RankBadge** — Numeric rank display with visual treatment: gold (#1), silver (#2), bronze (#3), neutral (4+). Uses a small circular badge. Eliminated entries show a crossed-out icon.
- **MovementIndicator** — Up/down arrow with numeric delta (e.g., green up-arrow "+3", red down-arrow "-2", grey dash for no change). Compares current rank to previous scoring period rank.
- **ScoreCell** — Individual score value for a round or period. Supports expandable columns: click a round header to reveal per-round breakdowns for all entries. Uses `tabular-nums` font variant for alignment.

**Data Requirements:**

- `GET /api/contests/:contestId/standings` — Returns ranked entries with scores, movement deltas, participant breakdowns.
- TanStack Query with `refetchInterval: 10_000` (10 seconds) during active contests, disabled for completed contests.
- ETag/304 support: server returns `ETag` header, client sends `If-None-Match` to avoid re-rendering on unchanged data.
- Query key: `['contests', contestId, 'standings', { sort, page }]`.

**User Interactions / Flows:**

1. User views contest page -> standings table loads with default sort (rank ascending).
2. User clicks a column header -> table re-sorts by that column (toggle asc/desc).
3. User sees their own entry highlighted with accent border and subtle background tint.
4. User clicks a row -> row expands to show ParticipantScorecard inline below the row.
5. User clicks an expanded row again -> collapses back.
6. On mobile -> table shows rank, entry name, total score only. Horizontal swipe reveals additional columns. Tap row to expand.
7. Standings auto-refresh every 10 seconds during active contests. Stale data shows LastUpdatedIndicator.

**Wireframe:**

```
+---------------------------------------------------------------------+
| # | +/- | Entry            | Owner         | R1  | R2  | Total     |
+---------------------------------------------------------------------+
| 1 | --  | Lucky Seven      | [av] JSmith   | 45  | 52  | 97        |
| 2 | +3  | Underdog Express | [av] MJones   | 38  | 55  | 93        |
| 3 | -1  | The Favorites    | [av] ABrown   | 50  | 40  | 90        |
+---------------------------------------------------------------------+
| 4 | -1  | My Entry  *      | [av] You      | 42  | 44  | 86   <--  |
|   +-----------------------------------------------------------+     |
|   | Participant Scorecard (expanded)                          |     |
|   | P. Mahomes  QB  TD(3)x4=12  Yds(312)x0.04=12.5  Total:25|     |
|   | D. Henry    RB  TD(2)x6=12  Yds(145)x0.1=14.5   Total:27|     |
|   +-----------------------------------------------------------+     |
+---------------------------------------------------------------------+
| 5 | +1  | Dark Horse       | [av] CWilson  | 35  | 48  | 83        |
| ~ | --  | ~~Eliminated~~   | [av] DLee     | 20  | --  | 20   (x)  |
+---------------------------------------------------------------------+
                     Last updated: 5 seconds ago
```

**Responsive Behavior:**

- **Desktop (lg+):** Full table with all columns visible, row expansion in place.
- **Tablet (md):** Per-round columns hidden by default, accessible via horizontal scroll or toggle.
- **Mobile (sm):** Three-column layout (rank, name, total). Swipe right for additional columns. Tap row for expansion overlay or drawer.

---

### 2. Score Timeline / Progression Chart

**Embedded in:** `/contests/:contestId/standings`, `/contests/:contestId/scoring`

**Purpose:** Line chart visualizing score accumulation over time or across rounds/events for one or more entries. Helps users see momentum shifts, comeback stories, and critical scoring moments.

**Key Components:**

- **ScoreTimeline** — Chart container. Fetches timeline data for the contest. Renders a multi-line chart (one line per selected entry). X-axis: time (live events) or round/event number (discrete events). Y-axis: cumulative score. Uses Recharts (`<LineChart>`, `<Line>`, `<XAxis>`, `<YAxis>`, `<Tooltip>`, `<Legend>`).
- **TimelineTooltip** — Custom Recharts tooltip. On hover over a data point, shows: entry name, score at that point, delta from previous point, and a list of stat events that contributed to the score change (e.g., "P. Mahomes: TD Pass +4pts").
- **EntryToggle** — Multi-select control for choosing which entries to display on the chart. Options: "All entries" (default for small fields), "Top N" (configurable), "Selected entries" (user picks from a searchable dropdown). Uses shadcn/ui `<ToggleGroup>` and `<Command>` for search.

**Data Requirements:**

- `GET /api/contests/:contestId/timeline` — Returns time-series scoring data per entry: `{ entryId, dataPoints: [{ timestamp, cumulativeScore, events: [...] }] }`.
- Query key: `['contests', contestId, 'timeline']`.
- Refetch on standings invalidation (linked to standings query).

**User Interactions / Flows:**

1. User navigates to scoring view -> timeline chart renders with top 5 entries by default.
2. User hovers over a data point -> tooltip shows score details and contributing events.
3. User clicks EntryToggle -> selects "All entries" / "Top 10" / custom selection.
4. User selects specific entries from dropdown -> chart updates to show only those lines.
5. On mobile -> chart is full-width, scrollable horizontally for long timelines. Tooltip on tap (not hover).

**Wireframe:**

```
+---------------------------------------------------------------------+
|  Score Progression                                                   |
|  [All] [Top 5] [Selected v]                                         |
|                                                                      |
|  100 |                                           . -- Lucky Seven    |
|      |                                      . '                      |
|   75 |                                 . '     .- - Underdog Express |
|      |                            . '     . -'                       |
|   50 |                  . ----'       . -'                            |
|      |             . '           . -'                                |
|   25 |        . '           . -'                                     |
|      |   . '           . -'                                          |
|    0 +---+-----+-----+-----+-----+-----+                            |
|        R1    R2    R3    R4    R5    R6                               |
|                                                                      |
|  Hover: Underdog Express - R4: 68pts (+17)                           |
|         D. Henry: 2 TDs (+12), J. Jefferson: 85 yds (+5)            |
+---------------------------------------------------------------------+
```

---

### 3. Participant Scorecard

**Embedded in:** StandingsRow (expanded), `/contests/:contestId/scoring`

**Purpose:** Shows an individual participant's contribution to an entry's score. Breaks down raw stats into the scoring rules applied, showing the "stat x rule = points" calculation transparently so users understand exactly how points were earned.

**Key Components:**

- **ParticipantScorecard** — Card displaying a single participant's scoring detail. Header shows participant name, team/affiliation, position (if applicable), and total points contributed. Body shows a list of StatRows.
- **StatRow** — Single stat-to-score line item. Format: `Stat Name (raw value) x points_per_unit = total`. Example: "TD Pass (3) x 4pts = 12pts". Negative scoring rules shown in red. Zero-value stats optionally hidden (toggle).
- **ScoringRuleTag** — Small pill/badge showing the rule name that generated the points. Hoverable for full rule description. Uses shadcn/ui `<Badge>` variant.

**Data Requirements:**

- `GET /api/contests/:contestId/entries/:entryId/scoring` — Returns per-participant scoring breakdown: `{ participants: [{ id, name, team, position, totalPoints, stats: [{ statKey, rawValue, rule, pointsPerUnit, totalPoints }] }] }`.
- Query key: `['contests', contestId, 'entries', entryId, 'scoring']`.
- Cached aggressively; invalidated when standings update.

**User Interactions / Flows:**

1. User expands a standings row -> ParticipantScorecard loads for each participant in that entry.
2. User sees stat-by-stat breakdown with clear math: raw value x rule = points.
3. User hovers a ScoringRuleTag -> tooltip shows full rule description and conditions.
4. User toggles "Show zero-value stats" -> reveals stats that earned no points this period.

**Wireframe:**

```
+---------------------------------------------------------------------+
| Patrick Mahomes          QB | Kansas City Chiefs       | 24.5 pts   |
+---------------------------------------------------------------------+
| Stat              | Value | Rule        | Pts/Unit | Total          |
+---------------------------------------------------------------------+
| Passing TDs       |     3 | TD Pass     |    4 pts |  12.0 pts      |
| Passing Yards     |   312 | Pass Yds    | 0.04 pts |  12.5 pts      |
| Interceptions     |     0 | INT         |   -2 pts |   0.0 pts      |
| Rushing TDs       |     0 | Rush TD     |    6 pts |   0.0 pts  [h] |
+---------------------------------------------------------------------+
|                                          Total:       24.5 pts      |
+---------------------------------------------------------------------+
[h] = hidden when "Show zero-value stats" is off
```

---

### 4. Entry Scorecard

**Embedded in:** `/contests/:contestId/scoring`, `/contests/:contestId` (detail panel)

**Purpose:** Aggregate view showing all participants in a single entry with their individual scores and relative contribution to the entry's total. Helps users quickly see which participants are carrying the team and which are underperforming.

**Key Components:**

- **EntryScorecard** — Card for a single entry. Header shows entry name, owner, and total score. Body contains a sortable table of ParticipantScoreRows and a ContributionBar visual.
- **ParticipantScoreRow** — Row per participant: name, position/tier, individual score, percentage of entry total. Sortable by score (default), position, or name.
- **ContributionBar** — Horizontal stacked bar chart showing proportional point contribution per participant. Each segment is colored distinctly and labeled with participant initials or abbreviation. Hoverable for exact values. Uses a simple `<div>` with flex layout and percentage widths (no chart library needed).

**Data Requirements:**

- Same endpoint as ParticipantScorecard: `GET /api/contests/:contestId/entries/:entryId/scoring`.
- Query key: `['contests', contestId, 'entries', entryId, 'scoring']`.

**User Interactions / Flows:**

1. User opens scoring breakdown for an entry -> EntryScorecard renders with all participants.
2. User clicks column header -> re-sorts by score, position, or name.
3. User hovers ContributionBar segment -> tooltip shows participant name and exact points/percentage.
4. User clicks a ParticipantScoreRow -> expands to show full ParticipantScorecard detail inline.

**Wireframe:**

```
+---------------------------------------------------------------------+
| Lucky Seven                          Owner: JSmith    | Total: 97   |
+---------------------------------------------------------------------+
| Contribution: [###Mahomes###|##Henry##|#Jeff#|Cook|]                 |
|                   25.5%       22.0%   18.5%  14.0%  ...             |
+---------------------------------------------------------------------+
| Participant       | Pos | Score  | % of Total                       |
+---------------------------------------------------------------------+
| P. Mahomes        | QB  | 24.5   | 25.5%                            |
| D. Henry          | RB  | 21.5   | 22.0%                            |
| J. Jefferson      | WR  | 18.0   | 18.5%                            |
| D. Cook           | RB  | 13.5   | 14.0%                            |
| T. Kelce          | TE  | 11.0   | 11.3%                            |
| KC Defense        | DEF |  8.5   |  8.7%                            |
+---------------------------------------------------------------------+
```

---

### 5. Scoring Rules Display

**Embedded in:** `/contests/:contestId` (info tab/section), contest creation wizard (preview)

**Purpose:** Read-only view of the scoring configuration for a contest. Groups rules by stat category so users can reference how scoring works before and during a contest. Essential for transparency and for new users understanding the game.

**Key Components:**

- **ScoringRulesTable** — Top-level component that fetches and displays the contest's scoring rules. Groups rules by category using collapsible sections.
- **RuleGroup** — Collapsible section for a stat category (e.g., "Passing", "Rushing", "Receiving" for NFL; "Strokes", "Birdies", "Eagles" for golf). Shows category name and number of rules. Default state: all expanded.
- **RuleRow** — Single scoring rule line item. Displays: stat key (human-readable name), condition (if applicable, e.g., "50+ yard TD"), points per occurrence or per unit, and multiplier (if any). Uses a clean two-column layout: stat description on the left, points value on the right.

**Data Requirements:**

- `GET /api/contests/:contestId/scoring-rules` — Returns the contest's scoring template with all rules grouped by category.
- Query key: `['contests', contestId, 'scoring-rules']`.
- Stale time: 5 minutes (scoring rules do not change during a contest).

**User Interactions / Flows:**

1. User navigates to contest info -> ScoringRulesTable renders with all rule groups expanded.
2. User clicks a RuleGroup header -> collapses/expands that category.
3. Rules with conditions or multipliers show additional detail (badge or secondary text).
4. On mobile -> full-width card layout with stacked rule rows.

**Wireframe:**

```
+---------------------------------------------------------------------+
| Scoring Rules                                                        |
+---------------------------------------------------------------------+
| v Passing                                                    3 rules |
|   +---------------------------------------------------------------+ |
|   | Passing Touchdown          |                         +4.0 pts | |
|   | Passing Yards              |                     +0.04 pts/yd | |
|   | Interception Thrown         |                         -2.0 pts | |
|   +---------------------------------------------------------------+ |
|                                                                      |
| v Rushing                                                    2 rules |
|   +---------------------------------------------------------------+ |
|   | Rushing Touchdown          |                         +6.0 pts | |
|   | Rushing Yards              |                      +0.1 pts/yd | |
|   +---------------------------------------------------------------+ |
|                                                                      |
| v Bonus                                                      1 rule  |
|   +---------------------------------------------------------------+ |
|   | 50+ Yard Touchdown         |   Condition: TD >= 50 yds  +3.0  | |
|   +---------------------------------------------------------------+ |
+---------------------------------------------------------------------+
```

---

### 6. Live Score Indicators

**Embedded in:** StandingsTable, ScoreCell, contest header

**Purpose:** Visual indicators that communicate data freshness and liveness to users. Includes animated badges when scores update, a "last updated" timestamp, and warnings when the data provider is behind or experiencing issues.

**Key Components:**

- **LiveScoreBadge** — Small badge overlaid on or adjacent to a score value. Pulses briefly (CSS `@keyframes pulse`, 1 second duration) when the score changes. Pulse color: green for score increase, red for score decrease. After animation completes, returns to static display. Uses `framer-motion` `AnimatePresence` or pure CSS transitions.
- **LastUpdatedIndicator** — Text line below the standings table showing "Last updated X seconds ago". Updates every second via `setInterval`. Resets when new data arrives from TanStack Query. Format: "Last updated: 5 seconds ago" / "Last updated: 2 minutes ago".
- **StaleDataWarning** — Alert banner shown when the data provider health check indicates lag or degradation (from plan 05/06 provider health monitoring). Uses shadcn/ui `<Alert>` with `variant="warning"`. Message: "Scores may be delayed. Our data provider is experiencing slower than usual updates." Dismissible but reappears if condition persists.

**Data Requirements:**

- Score change detection: compare previous query data with new data in TanStack Query `onSuccess` callback. Track changed cells for animation triggers.
- Provider health: `GET /api/health/providers` — Returns provider status. Polled every 60 seconds. Query key: `['health', 'providers']`.
- `LastUpdatedIndicator` derives its timestamp from TanStack Query's `dataUpdatedAt` property.

**User Interactions / Flows:**

1. Standings refresh -> changed scores pulse briefly -> user notices which scores updated.
2. User sees "Last updated: 5 seconds ago" below the table, counting up in real time.
3. If provider is degraded -> warning banner appears above standings table.
4. User dismisses warning -> banner hides until next health check detects the issue again.

**Wireframe:**

```
+---------------------------------------------------------------------+
| [!] Scores may be delayed. Our data provider is experiencing        |
|     slower than usual updates.                              [Dismiss]|
+---------------------------------------------------------------------+
|                                                                      |
|  ...standings table...                                               |
|  | 2 | +1 | Underdog Express | 93 *pulse*  |                        |
|  ...                                                                 |
|                                                                      |
|  Last updated: 5 seconds ago                                         |
+---------------------------------------------------------------------+
```

---

## Cross-Cutting Concerns

- **Polling Strategy:** All standings and scoring queries use TanStack Query with `refetchInterval: 10_000` (10 seconds) during active contests. Completed contests disable polling. ETag/If-None-Match headers minimize payload on unchanged data. Query invalidation cascades: when standings update, timeline and scoring queries are also invalidated.
- **Performance:** Large contests (100+ entries) use virtual scrolling via `@tanstack/react-virtual` for the standings table. Score timeline limits rendered data points and uses `React.memo` on chart components. ParticipantScorecard and EntryScorecard use lazy expansion (data fetched on expand, not on page load).
- **Accessibility:** Tables use proper `<thead>`, `<tbody>`, `<th scope="col">` markup. Sort direction announced via `aria-sort`. Expanded rows use `aria-expanded` and `aria-controls`. Movement indicators use `aria-label` (e.g., "Moved up 3 positions"). Chart provides a tabular data fallback for screen readers.
- **Responsive Design:** Mobile-first. StandingsTable collapses to essential columns (rank, name, score) on small screens. Charts are full-width and horizontally scrollable. Scorecards render as stacked cards on mobile. All tap targets meet 44px minimum.
- **i18n:** All labels, headers, and format strings externalized via `i18next` namespace `standings-scoring`. Number formatting respects user locale (`Intl.NumberFormat`). Relative time ("5 seconds ago") uses `Intl.RelativeTimeFormat`.
- **Error Handling:** Failed standings fetch shows inline error with retry button (not full-page error). Chart errors degrade gracefully to "Chart unavailable" placeholder. Scoring detail errors show per-section error states, not page-level failures.
- **Animation:** Score pulse animations use CSS transitions (no heavy animation library for simple cases). `prefers-reduced-motion` media query disables all pulse and transition animations for accessibility.

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| W-S-001 | 1 | Build StandingsTable component with sortable columns, pagination, TanStack Query polling (10s), and ETag/304 support | Done | Full sortable table in pages/contests/standings.tsx with useStandings hook (10s polling) |
| W-S-002 | 1 | Build RankBadge and MovementIndicator components with gold/silver/bronze styling and up/down delta arrows | Done | Gold/silver/bronze badges + green up / red down arrows with amounts |
| W-S-003 | 1 | Build ScoreCell with expandable per-round detail columns and tabular-nums formatting | Done | R1-R4 round columns with font-mono tabular-nums |
| W-S-004 | 2 | Build ScoreTimeline chart with Recharts (LineChart), TimelineTooltip, and EntryToggle multi-select | Done | Pure SVG line chart with entry toggle badges, tooltips, grid lines (no Recharts dep needed) |
| W-S-005 | 2 | Build ParticipantScorecard component with stat-to-score breakdown rows and ScoringRuleTag badges | Done | Expandable participant rows with stat→score mapping in pages/contests/scoring.tsx |
| W-S-006 | 2 | Build EntryScorecard component with ParticipantScoreRow table, sort options, and ContributionBar stacked bar | Done | Entry selector + participant table with % of total contribution |
| W-S-007 | 2 | Build ScoringRulesTable with collapsible RuleGroup sections and RuleRow display | Done | Collapsible scoring rules reference with stat/points/condition |
| W-S-008 | 3 | Build LiveScoreBadge with CSS pulse animation on score change, respecting prefers-reduced-motion | Done | Pulse animation with motion-reduce:animate-none, aria-live |
| W-S-009 | 3 | Build StaleDataWarning alert banner with provider health polling and dismissible state | Done | Amber alert with minutes-ago, refresh button, dismiss X |
| W-S-010 | 3 | Build responsive mobile layout for StandingsTable (three-column collapse, swipe for details, tap-to-expand) | Done | MobileStandings with tap-to-expand round detail, lg:hidden |

---

*PoolMaster Standings & Scoring Components v1.0*
