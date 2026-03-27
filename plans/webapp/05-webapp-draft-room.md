# PoolMaster — Draft Room

This plan covers the draft room and draft recap pages for the PoolMaster React webapp. The draft room is the most complex page in the application: a full-screen, four-panel layout that adapts its UI to five distinct draft types (snake, salary cap/auction, tiered, pick'em, bracket pick'em). It must handle both live and async drafts with real-time-feeling updates, participant search under 100ms, and commissioner controls.

**Related service plans:**

- **02 — Draft Config:** Draft types, pick order, timer rules, auto-pick, commissioner controls
- **06 — Participant Data:** Participant pool, rankings, injury status, form ratings, team metadata
- **13 — Search & Discovery:** Participant search with faceted filters, sub-100ms response times

---

## Pages

### 1. Draft Room

**Route:** `/drafts/:draftId`

**Purpose:** Full-screen interactive draft interface where league members make their picks in real time or asynchronously. The layout adapts based on draft type (snake, salary cap/auction, tiered, pick'em, bracket pick'em) and draft mode (live with timer, async at your own pace). Uses a four-panel layout to maximise information density while keeping the current action front and centre.

**Layout:** Full-screen (no sidebar, no standard top nav). Four panels arranged as top bar, left panel, centre panel, right panel, with an optional collapsible bottom panel for chat.

---

#### Top Bar

**Components:**

- **DraftHeader** — Displays draft name, sport icon, league name (linked), and draft status badge (Upcoming, Live, Paused, Complete).
- **RoundPickIndicator** — Shows current round and pick number (e.g., "Round 3, Pick 7 of 12"). In auction mode, shows "Nomination Phase" or "Bidding on: [Participant Name]".
- **DraftTimer** — Countdown timer for the current pick. Configurable per-draft (e.g., 60s, 90s, 120s). Flashes red when under 10 seconds. Displays "No time limit" for async drafts. For auction drafts, shows bidding countdown (e.g., 15s going-once timer).
- **DraftStatusControls** — Minimal controls: "Leave Draft" button, fullscreen toggle, sound toggle (for pick notifications and timer alerts).

---

#### Left Panel: Available Participants

**Components:**

- **ParticipantSearchBar** — Text input with search icon. Debounced at 200ms, targets sub-100ms server response (plan 13). Shows result count and clears with an X button. Keyboard shortcut: `/` to focus.
- **ParticipantFilters** — Collapsible faceted filter panel below the search bar. Filters include:
  - Position (e.g., QB, RB, WR for NFL; Forward, Midfielder for soccer)
  - Team / nationality
  - Tier (for tiered drafts only)
  - Price range slider (for salary cap/auction drafts only)
  - Injury status toggle (hide injured)
  - Sort dropdown: Ranking (default), Price (auction), Form Rating, Alphabetical
- **ParticipantList** — Virtualised scrollable list of undrafted participants. Each row is a `ParticipantCard`.
- **ParticipantCard** — Compact card showing: participant name, team logo + abbreviation, position badge, ranking number, form rating (1-10 bar or stars), injury indicator (icon + tooltip), price or tier label (contextual to draft type). Click opens `ParticipantDetailPopup`. "Draft" button on hover (snake/tiered) or "Nominate" button (auction).

---

#### Centre Panel: Pick Board / Draft Grid

**Components (vary by draft type):**

**Snake Draft:**

- **PickBoardGrid** — 2D grid with rounds as rows and teams as columns. Each cell represents a pick slot. Snake order is visually indicated with directional arrows or alternating row shading. Current pick cell is highlighted with a pulsing border. Completed picks show participant name, team abbreviation, and position badge. Empty cells in past rounds show "skipped" or "auto-picked" if applicable. Click on any empty future slot to see whose pick it is (tooltip).
- **CurrentPickBanner** — Prominent banner above the grid: "It's [Team Name]'s pick" or "It's YOUR pick!" with team colour accent. When it is the current user's pick, the banner is visually distinct (e.g., green background, animation).

**Salary Cap / Auction:**

- **AuctionStage** — Centre stage showing the currently nominated participant with large avatar, name, team, position, and key stats. Displays current highest bid, current high bidder name, and time remaining on the bid clock.
- **BiddingControls** — Row of increment buttons (+1, +5, +10, custom) and a "Bid" submit button. Shows "Your bid: $X" preview. Disabled when user is the current high bidder or when budget is insufficient. "Nominate" button appears when it is the user's turn to nominate (replaces bidding controls).
- **AuctionLog** — Scrollable log of all completed auctions: participant name, winning bidder, winning price. Sortable by recency or price.

**Tiered Draft:**

- **TieredPickBoard** — Similar to snake grid but with tier groupings. Rows are grouped by tier with tier header labels (e.g., "Tier 1 — Elite", "Tier 2 — Starters"). Columns are teams. Within each tier, the pick order follows the configured pattern (snake or straight). Visual indicators show which tier is currently active.

**Pick'em:**

- **PickEmList** — List of events/games with two sides (e.g., Team A vs Team B). Each row has radio buttons or clickable team cards to select a winner. Optional confidence point assignment (drag or number input). Shows pick deadline per event. Greyed-out events past their deadline.

**Bracket Pick'em:**

- **BracketVisualisation** — Full bracket layout (single elimination). Rounds displayed left-to-right (or top-to-bottom on mobile). Each matchup is a clickable pair: click a team to advance them to the next round. Completed picks show the selected team filled in; unselected team is dimmed. Championship game is centred/highlighted. "Reset bracket" and "Auto-fill (by seed)" buttons available.

---

#### Right Panel: My Roster

**Components:**

- **RosterSummary** — Header showing team name, total picks made vs total picks available, and contextual budget/tier info:
  - Snake draft: "Picks: 5 / 15"
  - Salary cap: "Budget: $42 / $200 remaining" with progress bar
  - Tiered: "Tier 1: 1/2, Tier 2: 2/3, Tier 3: 0/4" with slot indicators
  - Pick'em: "Picks: 8 / 16 games"
  - Bracket: "Bracket: 75% complete"
- **RosterList** — My drafted participants organised by position group (snake/auction) or tier (tiered). Each row shows participant name, team, position, and the round/pick or price they were selected at. Empty slots shown as dashed placeholder rows.
- **AutoPickQueue** — Expandable section titled "Auto-Pick Queue". Drag-and-drop sortable list of pre-ranked participants. When the timer expires and the user has not picked, the top available participant from this queue is automatically selected. Add participants by clicking "Add to Queue" from the participant detail popup or dragging from the available list. Remove with X button. Reorder with drag handles. "Clear Queue" and "Auto-fill from Rankings" buttons.

---

#### Bottom Panel: Draft Chat

**Components:**

- **DraftChatPanel** — Collapsible panel anchored to the bottom of the screen. Toggle button shows unread message count badge. When expanded, shows a scrollable message feed interleaving:
  - **User messages** — League member chat messages with avatar, name, timestamp.
  - **Pick announcements** — System-generated messages: "[Team] selected [Participant] with pick #X" styled distinctly (e.g., bold, coloured border).
  - **Commissioner actions** — "[Commissioner] paused the draft", "[Commissioner] undid the last pick" styled as system messages.
- **ChatInput** — Text input with send button. Enter to send, Shift+Enter for newline. Character limit of 500. Emoji picker button (optional, v2).

---

#### Key Interactions

1. **Search participants** — User types in the search bar. Input is debounced at 200ms. TanStack Query fires `GET /drafts/:id/available?q=search&filters=...` and caches results. Results update the participant list reactively. Target: sub-100ms server response (plan 13).
2. **View participant detail** — Click on a `ParticipantCard` to open a `ParticipantDetailPopup` (modal or drawer). Shows full stats: season stats, recent form (last 5 events), injury details, career history summary, draft ranking, salary cap price. Includes "Draft" / "Nominate" / "Add to Queue" action buttons.
3. **Make a pick (snake/tiered)** — Click "Draft" on a participant card or in the detail popup. A confirmation dialog appears: "Draft [Name] with pick #X?" with Confirm and Cancel buttons. On confirm, `POST /drafts/:id/pick` fires with optimistic update: the participant moves to My Roster, is removed from Available, and the pick board cell fills in. If the API returns an error (e.g., someone else picked them in a race condition), the optimistic update is rolled back and a toast error is shown.
4. **Nominate and bid (auction)** — When it is the user's turn to nominate, click "Nominate" on a participant. The participant appears on the auction stage with a starting bid. Other users see the nomination and can bid. Click increment buttons to set bid amount, then "Bid" to submit. The auction timer resets on each new bid. When the timer expires, the highest bidder wins. `POST /drafts/:id/bid` for bids, `POST /drafts/:id/nominate` for nominations.
5. **Auto-pick queue management** — Drag participants in the Auto-Pick Queue to reorder priority. Drop participants from the Available list into the queue. Remove with X. Queue is saved via `POST /drafts/:id/auto-pick` on every change (debounced). If the user's timer expires, the server auto-picks from this queue.
6. **Commissioner controls** — If the current user is the league commissioner, a "Commissioner" dropdown appears in the top bar with: Pause Draft (pauses the timer for all), Resume Draft, Undo Last Pick (reverts the most recent pick with confirmation), Skip Pick (advances past the current pick, marking it as skipped). All actions require confirmation dialogs.
7. **Async draft flow** — For async drafts, there is no live timer. The top bar shows "Async Draft — Pick when ready" and "Waiting for [Team Name]" when it is not the user's turn. Push notifications (plan 09) alert the user when it is their turn. The page polls at 10-second intervals via TanStack Query `refetchInterval` to keep the draft state current.

---

#### Data Requirements

| Endpoint | Method | Purpose | Polling |
|---|---|---|---|
| `/drafts/:id` | GET | Full draft state: config, picks, current pick, timer, status | 10s (async) or future WebSocket (live) |
| `/drafts/:id/available` | GET | Available participants with search and filter params | On search/filter change |
| `/drafts/:id/available?q=search&position=X&team=Y&sort=ranking` | GET | Filtered/searched participants | Debounced 200ms |
| `/drafts/:id/pick` | POST | Submit a pick (snake, tiered) | — |
| `/drafts/:id/nominate` | POST | Nominate a participant (auction) | — |
| `/drafts/:id/bid` | POST | Place a bid on current nomination (auction) | — |
| `/drafts/:id/auto-pick` | POST | Save auto-pick queue order | Debounced on reorder |
| `/drafts/:id/chat` | GET | Chat messages (polled with draft state) | 10s |
| `/drafts/:id/chat` | POST | Send chat message | — |
| `/drafts/:id/commissioner/pause` | POST | Pause the draft (commissioner only) | — |
| `/drafts/:id/commissioner/resume` | POST | Resume the draft (commissioner only) | — |
| `/drafts/:id/commissioner/undo` | POST | Undo the last pick (commissioner only) | — |
| `/drafts/:id/commissioner/skip` | POST | Skip the current pick (commissioner only) | — |

---

#### State Management

| Layer | Tool | What it manages |
|---|---|---|
| Server state | TanStack Query | Draft state, available participants (with search/filter cache), chat messages |
| Client state | Zustand | Active panel focus, search filter values, auto-pick queue local order, chat panel open/closed, sound preferences, fullscreen state |
| Optimistic updates | TanStack Query `useMutation` | Pick submission (show immediately in roster and board, rollback on error), bid submission, chat send |
| URL state | React Router | `draftId` from route params |

**TanStack Query key structure:**

```
['drafts', draftId]                          // draft state
['drafts', draftId, 'available', filters]    // available participants (filters in key for caching)
['drafts', draftId, 'chat']                  // chat messages
```

**Polling strategy:**

- Async drafts: `refetchInterval: 10_000` on the draft state query. Chat polled at the same interval.
- Live drafts (v1): Same polling. V2: Replace with WebSocket subscription for draft state changes and chat.
- Available participants: Not polled; refetched on search/filter change and after each pick (via query invalidation on pick mutation success).

---

#### Wireframe

```
+====================================================================+
|  [Logo] NFL Keeper League Draft   Round 3, Pick 7/12   [01:23]     |
|  Live  |  It's YOUR pick!                   [Sound] [FS] [Leave]   |
+====================================================================+
|  AVAILABLE            |  PICK BOARD                  |  MY ROSTER   |
|                       |                              |              |
|  [/ Search________X]  |  Rd  Team1  Team2  Team3 ...|  Picks: 5/15 |
|                       |  1   Adams  Jones  Smith     |              |
|  Filters: [v]         |  2   Brown  White  Clark     |  QB:         |
|   Pos: [All   v]      |  3   Lee    [>>>PICKING<<<]  |   P. Mahomes |
|   Team: [All  v]      |       ^         ^         ^  |  RB:         |
|   Sort: [Rank v]      |       |  snake direction  |  |   D. Henry   |
|   [ ] Hide injured    |  ...                         |   J. Taylor  |
|                       |                              |  WR:         |
|  120 available        |                              |   J. Chase   |
|  -------------------  |                              |   ---        |
|  1. P. Mahomes  KC    |                              |  TE:         |
|     QB  #1  Form: 9.2 |                              |   T. Kelce   |
|           [Draft]     |                              |  ---         |
|  -------------------  |                              |              |
|  2. J. Jefferson MIN  |                              | AUTO-PICK    |
|     WR  #2  Form: 8.8 |                              | QUEUE [v]    |
|           [Draft]     |                              |  1. C. Lamb  |
|  -------------------  |                              |  2. A. Brown |
|  3. T. Hill  MIA      |                              |  3. S. Diggs |
|     WR  #3  Form: 8.5 |                              |  [drag to    |
|           [Draft]     |                              |   reorder]   |
|  ...                  |                              |              |
+==============================================+======================+
|  [-] CHAT  (3 new)                                                  |
|  [Team2] selected D. Adams with pick #1                             |
|  @mike: Nice pick!                                                  |
|  [Team3] selected T. Hill with pick #2                              |
|  [Type a message...                                        ] [Send] |
+=====================================================================+
```

**Auction variant wireframe:**

```
+====================================================================+
|  [Logo] EPL Auction Draft   Bidding   Budget: $142 / $200          |
|  Live  |  Bidding on: M. Salah                [Sound] [FS] [Leave] |
+====================================================================+
|  AVAILABLE            |  AUCTION STAGE               |  MY ROSTER   |
|                       |                              |              |
|  [/ Search________X]  |  +------------------------+  |  Budget:     |
|                       |  |    [Avatar]            |  |  $142 / $200 |
|  Filters: [v]         |  |    Mohamed Salah       |  |  [$$$$$----] |
|   Pos: [All   v]      |  |    Liverpool / FWD     |  |              |
|   Team: [All  v]      |  |                        |  |  FWD:        |
|   Price: [$0-$50]     |  |    Current Bid: $47    |  |   H. Kane $38|
|   Sort: [Price v]     |  |    High Bidder: @dan   |  |   ---        |
|                       |  |    Time Left: [00:12]  |  |  MID:        |
|  85 available         |  |                        |  |   K. De Bruyne|
|  -------------------  |  +------------------------+  |              $32|
|  1. M. Salah  LIV     |                              |   ---        |
|     FWD  Est: $45      |  Your bid: $48               |  DEF:        |
|        [Nominate]     |  [+1] [+5] [+10] [Custom]   |   ---        |
|  -------------------  |  [         BID         ]     |  GK:         |
|  2. E. Haaland  MCI   |                              |   ---        |
|     FWD  Est: $52      |  AUCTION LOG                 |              |
|        [Nominate]     |  H. Kane -> @you ($38)       |              |
|  ...                  |  K. De Bruyne -> @you ($32)  |              |
|                       |  B. Saka -> @mike ($29)      |              |
+==============================================+======================+
```

**Bracket pick'em variant wireframe:**

```
+====================================================================+
|  [Logo] March Madness Bracket   Bracket: 75% complete              |
|  Open until: Mar 20, 12:00pm ET               [Sound] [FS] [Leave]|
+====================================================================+
|                         BRACKET                         | MY PICKS  |
|                                                         |           |
|  ROUND 1       ROUND 2       SWEET 16    ELITE 8  FF   | Complete: |
|  ----------    ----------    ----------  -------  ----  | 48 / 63   |
|  [Duke    ]    |             |           |        |     |           |
|  [-----   ]---->[Duke    ]  |           |        |     | Champion: |
|  [UNCW    ]    |[-------]--->[Duke   ]  |        |     |  Duke     |
|  [--------]---->[Vermont ]  |[------]-->[    ]   |     |           |
|  [Vermont ]    |             |           |[---]-->|     | [Reset]   |
|  [--------]                              |        |     | [Auto-fill|
|  ...                                     |  [  ]  |     |  by seed] |
|                                          |        |     |           |
|                         CHAMPIONSHIP: [ ??? ]     |     |           |
|                                                         |           |
+==========================================================+==========+
```

---

#### Draft Type — UI Variations Summary

| Draft Type | Centre Panel | Left Panel Extras | Right Panel Extras | Timer Behaviour |
|---|---|---|---|---|
| **Snake** | Pick board grid with snake order arrows | Standard filters | Picks by position | Per-pick countdown; auto-pick on expire |
| **Salary Cap / Auction** | Auction stage + bidding controls + log | Price range filter, sort by price | Budget bar, price paid per pick | Bid clock (15s); resets on each bid |
| **Tiered** | Tier-grouped pick board | Tier filter, grouped available list | Tier slot counters | Per-pick countdown; auto-pick on expire |
| **Pick'em** | Event/game list with pick selectors | Position/team filters, event date filter | Picks per event, confidence pts | Per-event deadline (no live timer) |
| **Bracket Pick'em** | Bracket visualisation | Region filter, seed sort | Bracket completion %, champion pick | Single deadline for full bracket |

---

#### Responsive Behaviour

- **Desktop (1280px+):** Full four-panel layout as described.
- **Tablet (768px-1279px):** Left and right panels become togglable drawers (slide in from left/right). Centre panel takes full width. Tab bar at top switches between Available, Board, Roster.
- **Mobile (< 768px):** Single panel view with bottom tab navigation: Available, Board, Roster, Chat. Each tab shows one panel full-screen. "Draft" and "Bid" actions use bottom sheet confirmation.

---

#### Accessibility

- All panels are navigable via keyboard. Tab cycles through panels; arrow keys navigate within lists and grids.
- Pick board grid cells have `aria-label` describing the pick (e.g., "Round 1, Pick 3: D. Adams, Wide Receiver, Las Vegas Raiders").
- Timer announces remaining time at 30s, 10s, and 5s via `aria-live` region.
- Drag-and-drop in auto-pick queue has keyboard alternative (select item, use arrow keys to move position).
- Colour is never the sole indicator of state; icons and text labels accompany all status indicators.
- Chat messages are announced via `aria-live="polite"` region.

---

#### Error Handling

- **Pick conflict (race condition):** Optimistic update is rolled back. Toast: "That participant was already drafted. Please select another."
- **Budget exceeded (auction):** Bid button disabled when bid would exceed remaining budget. If server rejects: toast with budget details.
- **Timer expired:** If user did not pick and has an auto-pick queue, top available participant is selected. If no queue, pick is skipped (commissioner notified). Toast: "Time expired. [Participant] was auto-picked for you." or "Time expired. Your pick was skipped."
- **Network disconnect:** Banner at top: "Connection lost. Reconnecting..." with retry. Draft state reconciles on reconnect via full refetch.
- **Draft not found / access denied:** Redirect to `/dashboard` with toast: "Draft not found or you don't have access."

---

### 2. Draft Recap

**Route:** `/drafts/:draftId/results`

**Purpose:** Post-draft summary page showing all picks, team rosters, and draft analysis. Available after a draft is complete. Uses the standard authenticated layout (not full-screen).

**Key Components:**

- **DraftRecapHeader** — Draft name, sport, date completed, total participants drafted, total teams.
- **PickGridView** — All picks displayed in the same grid format as the draft board (rounds x teams). Each cell shows participant name, team, and position. Colour-coded by position for quick scanning.
- **TeamRosterCards** — Expandable cards for each team showing their full drafted roster grouped by position/tier. Includes total spend (auction) or pick numbers used.
- **DraftAnalysis** — Algorithmic analysis section:
  - "Best Value Picks" — Participants drafted significantly later than their ranking suggested (ranking vs actual pick position delta).
  - "Biggest Reaches" — Participants drafted significantly earlier than their ranking.
  - "Steals" — Auction participants won well below their estimated value.
  - "Most Expensive" — Top 5 highest-priced auction picks.
- **ShareButton** — "Share Draft Results" button that generates a shareable link or social media card (plan 10). Options: copy link, share to Twitter/X, download as image.
- **ExportButton** — "Export to CSV" for the full pick list.

**Data Requirements:**

| Endpoint | Method | Purpose |
|---|---|---|
| `/drafts/:id` | GET | Complete draft state (all picks, rosters, config) |
| `/drafts/:id/analysis` | GET | Pre-computed draft analysis (best value, reaches, steals) |
| `/share` | POST | Generate shareable link/card |

**User Interactions / Flows:**

1. User navigates to `/drafts/:draftId/results` after draft completion (linked from dashboard, contest page, or draft room redirect).
2. Sees the full pick grid and can scroll/zoom to review all picks.
3. Clicks on a team card to expand and see their full roster.
4. Reviews draft analysis for interesting picks.
5. Clicks "Share" to generate and copy a shareable link or post to social media.
6. Clicks "Export" to download the pick list as CSV.

**Wireframe:**

```
+----------------------------------------------------------+
| [Logo]  [Nav]                        [Notifications] [U] |
+----------------------------------------------------------+
|                                                          |
|  NFL Keeper League Draft — Results                       |
|  Completed Mar 15, 2026  |  180 participants  |  12 teams|
|                                                          |
|  [Share Results]  [Export CSV]                            |
|                                                          |
|  ALL PICKS                                               |
|  +------------------------------------------------------+|
|  | Rd | Team1   | Team2    | Team3   | Team4   | ...    ||
|  |----|---------|----------|---------|---------|--------||
|  | 1  | Adams   | Mahomes  | Chase   | Hill    |        ||
|  |    | WR LV   | QB KC    | WR CIN  | WR MIA  |        ||
|  | 2  | Henry   | Kelce    | Jefferson| Lamb   |        ||
|  |    | RB TEN  | TE KC    | WR MIN  | WR DAL  |        ||
|  | .. | ...     | ...      | ...     | ...     |        ||
|  +------------------------------------------------------+|
|                                                          |
|  TEAM ROSTERS                                            |
|  +------------------+ +------------------+ +----------+  |
|  | Team 1           | | Team 2           | | Team 3   |  |
|  | QB: P. Mahomes   | | QB: J. Hurts     | | QB: ...  |  |
|  | RB: D. Henry     | | RB: A. Ekeler    | | RB: ...  |  |
|  | WR: D. Adams     | | WR: J. Jefferson | | WR: ...  |  |
|  |     J. Chase     | |     C. Lamb      | |          |  |
|  | TE: T. Kelce     | | TE: M. Andrews   | |          |  |
|  +------------------+ +------------------+ +----------+  |
|                                                          |
|  DRAFT ANALYSIS                                          |
|  +------------------------------------------------------+|
|  | Best Value Picks              | Biggest Reaches       ||
|  | 1. J. Addison (Rank 25,      | 1. R. Stevenson       ||
|  |    Pick 48) +23 spots        |    (Rank 40, Pick 15) ||
|  | 2. ...                       | 2. ...                ||
|  +------------------------------------------------------+|
|                                                          |
+----------------------------------------------------------+
```

---

## Cross-Cutting Concerns

- **Full-screen Layout:** The draft room uses a dedicated full-screen layout with no sidebar and no standard navigation. The only way out is the "Leave Draft" button, which prompts confirmation if the draft is in progress.
- **Sound Effects:** Pick notifications, timer warnings (10s, 5s), and "your turn" alerts play audio cues. Sound toggle in the top bar. Sounds are off by default and preference is persisted in Zustand (localStorage).
- **Keyboard Shortcuts:** `/` to focus search, `Escape` to close modals/drawers, `Enter` to confirm pick in the confirmation dialog.
- **i18n:** All strings externalized. Draft type labels, button text, timer formats, and system messages all use i18next keys under the `draft-room` namespace.
- **Mobile Responsive:** On mobile, the four-panel layout collapses to a tabbed single-panel view. Critical actions (Draft, Bid) use bottom sheet dialogs for touch-friendly interaction.
- **Performance:** Available participants list uses virtualisation (e.g., `@tanstack/react-virtual`) for smooth scrolling with hundreds of participants. Pick board grid uses CSS Grid with fixed cell sizes to avoid layout recalculation. Search results are cached per filter combination via TanStack Query key structure.
- **Reconnection:** If the browser tab loses focus and returns, the draft state query is immediately refetched (`refetchOnWindowFocus: true` in TanStack Query) to catch up on any missed picks.

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| W-DR-001 | 1 | Draft room full-screen layout shell — four-panel responsive layout with top bar, left/centre/right panels, collapsible bottom chat panel | Done | 4-panel layout: top header, left available, centre pick board, right roster, bottom chat |
| W-DR-002 | 1 | Available participants panel — virtualised list with ParticipantCard components, loading skeletons | Done | Position badge, team, ranking, form rating, injury indicator, hover "Draft" button, 8-row skeleton |
| W-DR-003 | 1 | Participant search with filters — debounced search input, faceted filter panel, sort options, TanStack Query integration (plan 13) | Done | Search input, position filter chips, sort dropdown, collapsible filter panel, TanStack Query per-filter caching |
| W-DR-004 | 1 | Participant detail popup — modal/drawer with full stats, form, injury details, draft/nominate/queue actions | Done | Slide-out drawer with stats grid + "Draft" action button |
| W-DR-005 | 1 | Pick board / draft grid (snake) — 2D grid with snake order visualisation, current pick highlight, completed pick display | Done | Rounds x teams grid, snake arrows, current pick ring highlight, position-coloured badges |
| W-DR-006 | 1 | My roster panel — drafted participants by position/tier, roster completeness indicator, budget/tier summary | Done | Position-grouped roster, progress bar, empty slot placeholders, auto-pick badge |
| W-DR-007 | 2 | Auto-pick queue (drag-and-drop) — sortable preference list with drag handles, add/remove, auto-fill from rankings, API sync | Not Started | |
| W-DR-008 | 2 | Draft chat panel — collapsible chat with message feed, pick announcements, commissioner action messages, unread badge | Done | Collapsible bottom panel with message input. Pick announcements and system messages deferred to real API |
| W-DR-009 | 2 | Draft timer component — configurable countdown, visual warnings at 10s/5s, audio alerts, aria-live announcements | Done | Timer in header, red flash at 10s, aria-live, "Your Pick!" badge pulse |
| W-DR-010 | 2 | Commissioner draft controls — pause/resume, undo last pick, skip pick with confirmation dialogs | Not Started | |
| W-DR-011 | 3 | Salary cap / auction UI variant — auction stage, bidding controls, bid clock, nomination flow, auction log, budget tracker | Not Started | |
| W-DR-012 | 3 | Tiered draft UI variant — tier-grouped pick board, tier filters, tier slot indicators on roster panel | Not Started | |
| W-DR-013 | 3 | Pick'em UI variant — event/game list with pick selectors, confidence points, per-event deadlines | Not Started | |
| W-DR-014 | 3 | Bracket pick'em UI variant — bracket visualisation, click-to-advance, auto-fill by seed, reset, completion tracking | Not Started | |
| W-DR-015 | 2 | Async draft polling — 10s refetchInterval, push notification integration (plan 09), "your turn" detection and alerts | Done | 10s polling via TanStack Query, isMyPick detection, "Your Pick!" banner |
| W-DR-016 | 3 | Draft recap page — pick grid, team roster cards, draft analysis (best value, reaches, steals), share and export buttons | Done | Full recap: picks table, expandable team rosters, best value/reaches analysis, share/export buttons |

---

*PoolMaster Webapp Draft Room Plan v1.0*
