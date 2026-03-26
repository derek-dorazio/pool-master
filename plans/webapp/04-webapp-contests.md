# PoolMaster — Contest Pages

**Maps to:** 01 (Core API), 02 (Draft Config), 02a (Contest Structures), 03 (Scoring), 04 (History), 06 (Sports Data Integration), 08 (Commissioner Tooling)

**Tech stack:** React 18+, TypeScript, React Router, TanStack Query, Zustand, shadcn/ui, TailwindCSS, React Hook Form — see [React UI Rules](../../rules/react-ui-rules.md)

---

## Routes Covered

| Route | Page | Auth |
|---|---|---|
| `/contests/create` | Contest Creation Wizard | Commissioner only |
| `/contests/:contestId` | Contest Detail | Authenticated |
| `/contests/:contestId/standings` | Full Standings | Authenticated |
| `/contests/:contestId/scoring` | Score Breakdown | Authenticated |
| `/contests/:contestId/results` | Contest Results | Authenticated |
| `/contests/:contestId/head-to-head` | Head-to-Head Comparison | Authenticated |

---

## 1. Contest Creation Wizard (`/contests/create`)

Commissioner-only multi-step wizard for creating a new contest within a league. The wizard adapts its steps based on the sport and contest type selected, hiding irrelevant configuration. Built with React Hook Form for step persistence and validation.

### Route & Access

```
/contests/create?leagueId=:leagueId
```

Requires `contest.create` permission (OWNER or COMMISSIONER with grant). Redirects to `/leagues` if no `leagueId` param. The league context determines which sports are available (league sport setting).

### Wizard Steps

#### Step 1: Select Sport + Sporting Event

Select the sport and a real-world sporting event from ingested event data (plan 06). The event picker queries `GET /api/v1/events` with sport and date range filters.

**Components:**
- `SportSelector` — grid of sport icons (NFL, NBA, Golf, F1, NCAA, Tennis, Horse Racing, Soccer); highlights the league's default sport
- `EventPicker` — searchable list of upcoming events from the ingestion pipeline; grouped by date; shows event name, venue, start date, field status (locked/open); supports "Custom Event" for commissioner-created events not in the data feed

**Data:**
- `GET /api/v1/events?sport={sport}&status=SCHEDULED&from={now}&to={+90d}` — upcoming events
- Query key: `['events', sport, dateRange]`

**Text wireframe:**
```
┌─────────────────────────────────────────────────────┐
│  Create Contest          Step 1 of 7    [Cancel]    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Select Sport                                       │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐     │
│  │ NFL  │ │ NBA  │ │ Golf │ │  F1  │ │ NCAA │     │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘     │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐               │
│  │Tennis│ │Horse │ │Soccer│ │NASCAR│               │
│  └──────┘ └──────┘ └──────┘ └──────┘               │
│                                                     │
│  Select Event                        [🔍 Search]   │
│  ┌─────────────────────────────────────────────┐   │
│  │ ● The Masters 2026                          │   │
│  │   Augusta National · Apr 9–12 · Field: 90   │   │
│  ├─────────────────────────────────────────────┤   │
│  │ ○ PGA Championship 2026                     │   │
│  │   Aronimink GC · May 14–17 · Field: TBD    │   │
│  ├─────────────────────────────────────────────┤   │
│  │ ○ US Open 2026                              │   │
│  │   Shinnecock Hills · Jun 18–21 · Field: TBD│   │
│  └─────────────────────────────────────────────┘   │
│  + Create custom event                              │
│                                                     │
│                                       [Next →]      │
└─────────────────────────────────────────────────────┘
```

#### Step 2: Contest Type Selection

Select the contest duration and selection mechanic. The available selection types depend on the sport and event chosen in Step 1, per the compatibility matrix in plan 02a.

**Components:**
- `ContestTypeSelector` — two-phase selector:
  1. Duration: `SINGLE_EVENT` or `SEASON_LONG` (radio group)
  2. Selection type: `SNAKE_DRAFT`, `TIERED`, `BUDGET_PICK`, `OPEN_SELECTION`, `PICK_EM`, `BRACKET_PICK_EM`, `SURVIVOR` (card grid, only eligible types shown)
- Each selection type card shows: name, icon, one-line description, tags (exclusive/non-exclusive, draft required, etc.)

**Data:**
- No additional API call; type compatibility is determined client-side from a config map matching plan 02a's compatibility table

**Text wireframe:**
```
┌─────────────────────────────────────────────────────┐
│  Create Contest          Step 2 of 7    [← Back]    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Contest Duration                                   │
│  ○ Single Event — one tournament, race, or playoff  │
│  ● Season Long — spans the full competition season  │
│                                                     │
│  Selection Type                                     │
│  ┌─────────────────┐ ┌─────────────────┐           │
│  │ 🐍 Snake Draft  │ │ 📊 Tiered Pick  │           │
│  │ Turn-based,     │ │ Pick from tiers,│           │
│  │ exclusive picks │ │ non-exclusive   │           │
│  └─────────────────┘ └─────────────────┘           │
│  ┌─────────────────┐ ┌─────────────────┐           │
│  │ 💰 Budget Pick  │ │ 📋 Open Select  │           │
│  │ Build within a  │ │ Pick N from     │           │
│  │ salary budget   │ │ full field      │           │
│  └─────────────────┘ └─────────────────┘           │
│  ┌─────────────────┐ ┌─────────────────┐           │
│  │ 🏆 Pick'em      │ │ 🗑 Survivor     │           │
│  │ Predict winners │ │ Wrong pick =    │           │
│  │ each round      │ │ eliminated      │           │
│  └─────────────────┘ └─────────────────┘           │
│  ┌─────────────────┐                               │
│  │ 🏅 Bracket      │  (shown only for NCAA, NBA)   │
│  │ Fill tournament │                               │
│  │ bracket         │                               │
│  └─────────────────┘                               │
│                                                     │
│                              [← Back]  [Next →]     │
└─────────────────────────────────────────────────────┘
```

#### Step 3: Scoring Rules

Select a scoring template or build custom rules. Templates are loaded from the scoring service (plan 03). The commissioner can preview how rules translate to points with an example scorecard.

**Components:**
- `ScoringTemplateSelector` — list of pre-built templates for the selected sport (e.g. "NFL Standard", "NFL PPR", "Golf Stroke Play"); each shows a summary of key rules
- `ScoringRuleEditor` — collapsible sections for stat rules, position rules, bonus rules, penalty rules, multiplier rules; each rule row has stat key, points, condition, and description fields
- `ScoringPreviewTable` — read-only table showing all rules in the current config as a scoring reference card; includes example point calculations
- `TiebreakerConfig` — ordered list of tiebreaker methods (drag to reorder); options from plan 03: `TOTAL_SCORE`, `HEAD_TO_HEAD`, `BEST_INDIVIDUAL`, `MOST_WINS`, `TIEBREAKER_QUESTION`, etc.

**Data:**
- `GET /api/v1/scoring/templates?sport={sport}` — available templates
- Query key: `['scoringTemplates', sport]`

**Text wireframe:**
```
┌─────────────────────────────────────────────────────┐
│  Create Contest          Step 3 of 7    [← Back]    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Scoring Rules                                      │
│                                                     │
│  Start from a template:                             │
│  ┌─────────────────────────────────────────────┐   │
│  │ ● Golf — Stroke Play (Office Pool)          │   │
│  │   Actual strokes; best 4 of 6 count;        │   │
│  │   missed cut = 80 per round                  │   │
│  ├─────────────────────────────────────────────┤   │
│  │ ○ Golf — DFS Points                         │   │
│  │   Eagle +4, Birdie +3, Par +0.5, ...        │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ▼ Stat Rules                    [+ Add Rule]       │
│  ┌──────────────┬────────┬──────────────────┐      │
│  │ Stat Key     │ Points │ Condition        │      │
│  ├──────────────┼────────┼──────────────────┤      │
│  │ TOTAL_SCORE  │ 1/unit │ (strokes)        │      │
│  │ HOLE_IN_ONE  │ -5     │ per occurrence   │      │
│  └──────────────┴────────┴──────────────────┘      │
│                                                     │
│  ► Position Rules                                   │
│  ► Bonus Rules                                      │
│  ► Penalty Rules                                    │
│  ► Multiplier Rules                                 │
│  ► Tiebreaker Chain                                 │
│                                                     │
│  Preview Scoring Card                               │
│  ┌─────────────────────────────────────────────┐   │
│  │ Example: Golfer shoots 68-70-72-69 = 279    │   │
│  │ Total score: 279 pts (stroke play)           │   │
│  │ Finish: T3 → no position bonus              │   │
│  │ Hole-in-one: 1 → -5 bonus                   │   │
│  │ Final: 274 pts                               │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│                              [← Back]  [Next →]     │
└─────────────────────────────────────────────────────┘
```

#### Step 4: Draft Configuration

Shown only for draft-based contest types (SNAKE_DRAFT, and optionally for sequential TIERED). Configures the live or async draft session. Maps directly to plan 02 draft config parameters.

**Components:**
- `DraftConfigPanel` — form fields grouped by section:
  - **Mode:** `LIVE` or `ASYNC` toggle
  - **Order:** draft order method (RANDOM, COMMISSIONER, REVERSE_STANDINGS, SIGNUP_ORDER)
  - **Timing (Live):** seconds per pick (slider 15-300, default 60), auto-pick policy (BEST_AVAILABLE, QUEUE_THEN_BEST, RANDOM)
  - **Timing (Async):** hours per pick (1-168, default 24), auto-pick on expiry toggle
  - **Commissioner Controls:** allow pause, allow pick trade, allow commissioner reorder toggles
  - **Round Robin variant:** straight draft toggle (for snake draft)
- `DraftSchedulePicker` — date/time picker for draft start; timezone-aware with league timezone shown

**Data:**
- No additional API call; configuration is stored in form state and submitted with the full contest payload

**Text wireframe:**
```
┌─────────────────────────────────────────────────────┐
│  Create Contest          Step 4 of 7    [← Back]    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Draft Configuration                                │
│                                                     │
│  Draft Mode                                         │
│  [  LIVE  |  ASYNC  ]                               │
│                                                     │
│  Draft Order                                        │
│  [Random ▼]                                         │
│                                                     │
│  Seconds Per Pick          [======●====] 60s        │
│  Auto-Pick Policy          [Queue then Best ▼]      │
│                                                     │
│  ☑ Allow commissioner to pause draft                │
│  ☑ Allow pick position trades                       │
│  ☐ Straight draft (no snake reversal)               │
│                                                     │
│  Draft Date & Time                                  │
│  [Apr 7, 2026]  [7:00 PM]  (EDT — league TZ)       │
│                                                     │
│                              [← Back]  [Next →]     │
└─────────────────────────────────────────────────────┘
```

#### Step 5: Participant Pool

Configure which real-world participants (players, teams, drivers) are available for selection. Options depend on the contest type. Data comes from the sports data integration layer (plan 06).

**Components:**
- `PoolBuilder` — the main container, adapts UI based on selection type:
  - **Full Field:** toggle on/off; uses the entire event field from the data feed; default for non-exclusive types
  - **Custom Pool:** search and add/remove individual participants from the event field; used for snake drafts where commissioner wants to limit the player pool
  - **Tier Assignments (TIERED type):** drag-and-drop participants into tier groups; supports auto-assignment by world ranking, seed, or odds (plan 02 tier assignment methods); tier names and pick counts editable
  - **Pricing (BUDGET_PICK type):** assign cost to each participant; supports auto-pricing from odds, seed, or ranking; manual override per participant; shows total budget and average cost
- `ParticipantSearch` — search bar with typeahead; filters by name, ranking, nationality; shows injury/withdrawal status from plan 06 ingestion
- `ParticipantCard` — compact card: name, ranking, photo, nationality flag, injury status badge, tier/price assignment

**Data:**
- `GET /api/v1/events/:eventId/participants` — full participant field for the event
- `GET /api/v1/participants?sport={sport}&search={query}` — search participants
- `GET /api/v1/odds?eventId={eventId}` — odds data for auto-pricing (The Odds API via plan 06)
- Query keys: `['eventParticipants', eventId]`, `['participants', sport, query]`, `['odds', eventId]`

**Text wireframe:**
```
┌─────────────────────────────────────────────────────┐
│  Create Contest          Step 5 of 7    [← Back]    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Participant Pool                                   │
│                                                     │
│  Pool Source                                        │
│  ● Full Event Field (156 participants)              │
│  ○ Custom Selection                                 │
│                                                     │
│  Tier Configuration           [Auto-assign: Odds ▼] │
│  ┌─────────────────────────────────────────────┐   │
│  │ Tier 1 — Favorites (Pick 1)   [Edit name]   │   │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐     │   │
│  │ │S.Scheffler│ │R.McIlroy │ │J.Rahm    │     │   │
│  │ │#1 · +600  │ │#3 · +900 │ │#5 · +1100│     │   │
│  │ └──────────┘ └──────────┘ └──────────┘     │   │
│  ├─────────────────────────────────────────────┤   │
│  │ Tier 2 — Contenders (Pick 1)                │   │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐     │   │
│  │ │C.Morikawa│ │V.Hovland │ │L.Aberg   │     │   │
│  │ │#7 · +1400│ │#9 · +1800│ │#4 · +1200│     │   │
│  │ └──────────┘ └──────────┘ └──────────┘     │   │
│  ├─────────────────────────────────────────────┤   │
│  │ Tier 3 — Dark Horses (Pick 1)              │   │
│  │ ...                                         │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│                              [← Back]  [Next →]     │
└─────────────────────────────────────────────────────┘
```

#### Step 6: Entry Settings

Configure how members join the contest: entry limits, deadlines, roster sizes, and survivor-specific settings.

**Components:**
- `EntrySettings` — form with fields:
  - **Max entries per member:** number input (1-10, default 1)
  - **Total entry cap:** number input (optional, for large pools)
  - **Roster size:** number input; auto-calculated for tiered (sum of picks per tier) and budget (commissioner sets)
  - **Entry deadline:** date/time picker; defaults to event start time; timezone-aware
  - **Allow late entries:** toggle (commissioner can admit entries after deadline)
  - **Survivor settings (SURVIVOR type only):** picks per period (1-2), one entity per season toggle, strikes before elimination (0-3), buyback toggle
  - **Confidence weighting (PICK_EM type only):** enable/disable confidence weights; confidence range auto-calculated from number of picks

**Text wireframe:**
```
┌─────────────────────────────────────────────────────┐
│  Create Contest          Step 6 of 7    [← Back]    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Entry Settings                                     │
│                                                     │
│  Max Entries Per Member       [1 ▼]                 │
│  Total Entry Cap              [Unlimited ▼]         │
│  Roster Size                  [6]                   │
│                                                     │
│  Entry Deadline                                     │
│  [Apr 9, 2026]  [8:00 AM]  (EDT — league TZ)       │
│  ☐ Allow late entries (commissioner approval)       │
│                                                     │
│  Counting Method                                    │
│  ● Best 4 of 6 count         [4] of [6]            │
│  ○ All count                                        │
│  ○ Drop lowest N              [__]                  │
│                                                     │
│                              [← Back]  [Next →]     │
└─────────────────────────────────────────────────────┘
```

#### Step 7: Review & Create

Summary of all configuration. Commissioner reviews and submits. On success, navigates to the new contest detail page.

**Components:**
- `ReviewSummary` — read-only summary of all wizard steps; each section is a collapsible card with an "Edit" link that jumps back to the relevant step:
  - Event: sport, event name, dates
  - Type: contest type, selection mechanic, exclusive/non-exclusive
  - Scoring: template name (if used) or "Custom", rule count summary, counting method
  - Draft: mode, order, timing, schedule (if applicable)
  - Pool: participant count, tier count (if tiered), budget (if budget pick)
  - Entries: max entries, deadline, roster size
- `CreateContestButton` — submit button; shows loading spinner during API call; disabled until all required fields pass validation

**Data:**
- `POST /api/v1/contests` — create the contest with the full configuration payload
- On success: `POST /api/v1/drafts` (if draft-based type) to create the associated draft session
- Mutation key: `['createContest']`
- On success, invalidate: `['contests', leagueId]`, `['league', leagueId]`

**Text wireframe:**
```
┌─────────────────────────────────────────────────────┐
│  Create Contest          Step 7 of 7    [← Back]    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Review Your Contest                                │
│                                                     │
│  ▼ Event                                 [Edit]     │
│    Golf — The Masters 2026                          │
│    Augusta National · Apr 9–12, 2026                │
│                                                     │
│  ▼ Contest Type                          [Edit]     │
│    Single Event · Tiered Pick · Non-exclusive       │
│                                                     │
│  ▼ Scoring                               [Edit]     │
│    Golf — Stroke Play (Office Pool)                 │
│    Best 4 of 6 count · Missed cut = 80/round       │
│    7 stat rules · 2 bonus rules                     │
│                                                     │
│  ▼ Participant Pool                      [Edit]     │
│    Full field · 6 tiers · 156 participants          │
│                                                     │
│  ▼ Entry Settings                        [Edit]     │
│    1 entry/member · Roster: 6 · Deadline: Apr 9     │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │           [ Create Contest ]                 │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Wizard State Management

- Form state managed by React Hook Form with a Zod schema per step
- Wizard progress persisted to Zustand store (survives accidental navigation)
- Step validation: each step validates on "Next" click before advancing
- Conditional steps: Step 4 (Draft Config) is skipped for non-draft types (TIERED simultaneous, BUDGET_PICK, PICK_EM, BRACKET_PICK_EM, SURVIVOR); Step 5 adapts its UI per selection type

### Zustand Store

```typescript
interface ContestWizardStore {
  currentStep: number;
  leagueId: string | null;
  sport: Sport | null;
  eventId: string | null;
  contestType: 'SINGLE_EVENT' | 'SEASON_LONG' | null;
  selectionType: SelectionType | null;
  scoringConfig: Partial<ScoringConfig> | null;
  draftConfig: Partial<DraftConfig> | null;
  poolConfig: Partial<PoolConfig> | null;
  entrySettings: Partial<EntrySettings> | null;
  setStep: (step: number) => void;
  updateField: <K extends keyof ContestWizardStore>(key: K, value: ContestWizardStore[K]) => void;
  reset: () => void;
}
```

---

## 2. Contest Detail (`/contests/:contestId`)

The primary contest page. Content varies dynamically based on contest status. Uses a shared `ContestHeader` and swaps the body content per status.

### Route & Access

```
/contests/:contestId
```

Authenticated. Any league member can view. Non-members see a join CTA if the contest is open.

### Contest Status States

| Status | Body Content |
|---|---|
| `OPEN` / `PRE_DRAFT` | Contest info, entry list, countdown to draft/entry deadline, join CTA |
| `DRAFTING` | Link to draft room, draft progress indicator, current pick info |
| `IN_PROGRESS` | Live standings, my entry scorecard, scoring timeline, stale score indicator |
| `COMPLETED` | Final results summary, winner highlight, link to full results page |
| `CANCELLED` | Cancellation notice with reason |

### Components

- **`ContestHeader`** — sport icon, event name, contest type badge (e.g. "Tiered Pick"), status badge (colour-coded: green=active, yellow=drafting, blue=open, grey=completed), entry count, league link
- **`ContestInfoCard`** — scoring summary, entry deadline, roster size, draft date (if applicable), selection type description
- **`JoinContestCTA`** — "Enter Contest" button; disabled if deadline passed, entry cap reached, or user at max entries; shows entry count and spots remaining
- **`EntryList`** — list of current entries with owner name and avatar; expandable to show roster (if picks are public)
- **`DraftProgressIndicator`** — during DRAFTING status: current round, current pick, on-the-clock team, link to draft room
- **`StandingsTable`** (compact) — top 10 entries by score; rank, entry name, owner, total score, rank movement indicator (arrow up/down with delta); "View Full Standings" link
- **`MyEntryCard`** — current user's entry: rank, score, roster list with per-participant score, scoring breakdown link
- **`ScoringTimeline`** (compact) — last 5 scoring events; shows participant name, stat, points earned, timestamp; "View Full Timeline" link
- **`StaleScoreIndicator`** — shown when scores are older than the sport-specific threshold (plan 06); displays "Scores last updated X minutes ago" with a warning icon
- **`ContestCountdown`** — countdown timer to draft start or entry deadline; switches to "Started" badge when elapsed

### Data Requirements

| Endpoint | Polling | Query Key |
|---|---|---|
| `GET /api/v1/contests/:id` | 60s (for status changes) | `['contest', contestId]` |
| `GET /api/v1/contests/:id/standings?limit=10` | 10s (IN_PROGRESS only) | `['standings', contestId, 'compact']` |
| `GET /api/v1/contests/:id/entries` | 30s (OPEN status) | `['entries', contestId]` |
| `GET /api/v1/contests/:id/entries/mine` | 10s (IN_PROGRESS) | `['myEntry', contestId]` |
| `GET /api/v1/contests/:id/history/timeline?limit=5` | 10s (IN_PROGRESS) | `['timeline', contestId, 'compact']` |

### Text Wireframe (IN_PROGRESS state)

```
┌─────────────────────────────────────────────────────┐
│  ← League Name                                      │
│                                                     │
│  🏌️ The Masters 2026       [Tiered Pick]  [● LIVE]  │
│  Augusta National · Apr 9–12 · 24 entries           │
├─────────────────────────────────────────────────────┤
│                                                     │
│  My Entry                                           │
│  ┌─────────────────────────────────────────────┐   │
│  │  Rank: 5th (↑2)    Total: 283 pts          │   │
│  │                                              │   │
│  │  T1: S. Scheffler    68-70 = 138            │   │
│  │  T2: C. Morikawa     69-71 = 140    ★best4 │   │
│  │  T3: T. Finau        72-73 = 145            │   │
│  │  T4: A. Scott        71-74 = 145            │   │
│  │  T5: K. Bradley      CUT — 80+80 = 160     │   │
│  │  T6: L. Herbert      73-70 = 143    ★best4 │   │
│  │                                              │   │
│  │  Best 4 total: 283                          │   │
│  │  [View Full Scorecard →]                    │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Standings                     [View Full →]        │
│  ┌───┬──────────────┬──────────┬───────┬──────┐    │
│  │ # │ Entry        │ Owner    │ Score │  +/- │    │
│  ├───┼──────────────┼──────────┼───────┼──────┤    │
│  │ 1 │ Tiger's Team │ Mike D.  │  275  │  —   │    │
│  │ 2 │ Par Busters  │ Sarah K. │  278  │  ↑1  │    │
│  │ 3 │ Green Jacket │ Tom H.   │  280  │  ↓1  │    │
│  │ 4 │ Ace Squad    │ Jen P.   │  281  │  —   │    │
│  │ 5 │ My Entry     │ You      │  283  │  ↑2  │    │
│  └───┴──────────────┴──────────┴───────┴──────┘    │
│                                                     │
│  Recent Scoring              [View Timeline →]      │
│  ┌─────────────────────────────────────────────┐   │
│  │ 12:34 PM  Scheffler birdie #14  (-1 stroke) │   │
│  │ 12:28 PM  Morikawa bogey #13   (+1 stroke)  │   │
│  │ 12:15 PM  Finau par #12                     │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ⚠ Scores last updated 2 minutes ago               │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Text Wireframe (PRE_DRAFT state)

```
┌─────────────────────────────────────────────────────┐
│  ← League Name                                      │
│                                                     │
│  🏈 NFL Survivor Pool 2026   [Survivor]  [○ OPEN]   │
│  Regular Season · Sep–Jan · 8 entries / 20 max      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Contest Info                                       │
│  ┌─────────────────────────────────────────────┐   │
│  │  Type: Season-Long Survivor (Live Pick)     │   │
│  │  Scoring: Knockout — wrong pick eliminated   │   │
│  │  One team per season: Yes                    │   │
│  │  Strikes: 0 (instant elimination)            │   │
│  │  Entry deadline: Sep 5, 2026 12:00 PM EDT    │   │
│  │  Max entries: 1 per member                   │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ⏰ Entry closes in 3 days, 14 hours               │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │           [ Enter Contest ]                  │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Entries (8 / 20)                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │  Mike D.  │ │  Sarah K. │ │  Tom H.  │           │
│  └──────────┘ └──────────┘ └──────────┘           │
│  ┌──────────┐ ┌──────────┐ ...                     │
│  │  Jen P.   │ │  Alex R.  │                        │
│  └──────────┘ └──────────┘                         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 3. Full Standings (`/contests/:contestId/standings`)

Detailed leaderboard with sorting, filtering, expandable rows, and CSV export for commissioners.

### Components

- **`StandingsTable`** (full) — sortable columns: rank, entry name, owner, total score, movement (arrows + delta since last poll), per-round breakdown (columns per round/period), per-participant scores (expandable row)
  - Click column header to sort (ascending/descending)
  - Click row to expand entry detail: full roster, per-participant scores, scoring rule breakdown
  - Highlighted row for current user's entry
  - Eliminated entries shown with strikethrough and "ELIMINATED" badge (survivor contests)
- **`StandingsFilter`** — filter controls:
  - Status: All / Still Alive / Eliminated (survivor contests)
  - Tier: filter by tier assignment (tiered contests)
  - Search: filter by entry name or owner name
- **`StandingsExport`** — "Export CSV" button (commissioner only); triggers `GET /api/v1/contests/:id/standings?format=csv`
- **`MovementArrow`** — small coloured arrow component: green up-arrow for rank improvement, red down-arrow for rank drop, grey dash for no change; shows numeric delta

### Data Requirements

| Endpoint | Polling | Query Key |
|---|---|---|
| `GET /api/v1/contests/:id/standings` | 10s (IN_PROGRESS) | `['standings', contestId, 'full']` |
| `GET /api/v1/contests/:id/standings?format=csv` | On demand | N/A (file download) |

### Text Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│  ← The Masters 2026                                         │
│  Full Standings                              [Export CSV ↓]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Filter: [All ▼]  [Search entries...]                       │
│                                                             │
│  ┌───┬──────────────┬──────────┬──────┬──────┬───┬───┬───┐ │
│  │ # │ Entry        │ Owner    │Total │ +/-  │R1 │R2 │R3 │ │
│  ├───┼──────────────┼──────────┼──────┼──────┼───┼───┼───┤ │
│  │ 1 │ Tiger's Team │ Mike D.  │ 275  │  —   │68 │69 │70 │ │
│  │ 2 │ Par Busters  │ Sarah K. │ 278  │  ↑1  │70 │68 │71 │ │
│  │ 3 │ Green Jacket │ Tom H.   │ 280  │  ↓1  │69 │72 │70 │ │
│  ├───┴──────────────┴──────────┴──────┴──────┴───┴───┴───┤ │
│  │  ▼ Tiger's Team — Expanded                             │ │
│  │  ┌────────────────┬──────┬──────┬──────┬────────┐     │ │
│  │  │ Participant    │  R1  │  R2  │  R3  │ Total  │     │ │
│  │  ├────────────────┼──────┼──────┼──────┼────────┤     │ │
│  │  │ S. Scheffler   │  66  │  68  │  69  │  203 ★ │     │ │
│  │  │ R. McIlroy     │  68  │  69  │  70  │  207 ★ │     │ │
│  │  │ C. Morikawa    │  70  │  71  │  72  │  213 ★ │     │ │
│  │  │ T. Finau       │  72  │  73  │  74  │  219 ★ │     │ │
│  │  │ K. Bradley     │  CUT │  80  │  80  │  232   │     │ │
│  │  │ L. Herbert     │  73  │  70  │  71  │  214   │     │ │
│  │  └────────────────┴──────┴──────┴──────┴────────┘     │ │
│  │  ★ = counts toward Best 4                              │ │
│  ├───┬──────────────┬──────────┬──────┬──────┬───┬───┬───┤ │
│  │ 4 │ Ace Squad    │ Jen P.   │ 281  │  —   │71 │70 │71 │ │
│  │ 5 │ My Entry     │ You      │ 283  │  ↑2  │70 │72 │72 │ │
│  │...│              │          │      │      │   │   │   │ │
│  └───┴──────────────┴──────────┴──────┴──────┴───┴───┴───┘ │
│                                                             │
│  Showing 1–24 of 24 entries                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Score Breakdown (`/contests/:contestId/scoring`)

Per-entry view showing exactly which participants scored how many points and why. Maps scoring rules to actual stat events.

### Components

- **`EntrySelector`** — dropdown or tab bar to select which entry to view; defaults to current user's entry
- **`EntryScorecard`** — summary card: entry name, rank, total score, counting method applied
- **`ParticipantScoreRow`** — one row per participant in the roster:
  - Participant name, photo, ranking, tier/cost
  - Total score for this participant
  - Expandable: individual stat-to-score mapping showing which scoring rules triggered
  - "Counts" indicator (for BEST_N counting method)
  - DNF/Cut badge (if applicable)
- **`ScoringRuleChip`** — small badge showing: stat key, raw stat value, rule applied, points earned; colour-coded (green for bonus, red for penalty, blue for standard)
- **`ScoringRuleLegend`** — reference table at the bottom showing all active scoring rules for this contest

### Data Requirements

| Endpoint | Polling | Query Key |
|---|---|---|
| `GET /api/v1/contests/:id/entries/:entryId/scoring` | 30s (IN_PROGRESS) | `['entryScoring', contestId, entryId]` |
| `GET /api/v1/contests/:id/scoring-config` | None (static) | `['scoringConfig', contestId]` |

### Text Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│  ← The Masters 2026                                         │
│  Score Breakdown                                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Entry: [My Entry ▼]     Rank: 5th     Total: 283 pts      │
│  Counting: Best 4 of 6                                      │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  T1: Scottie Scheffler        138 pts  ★ counts     │  │
│  │  #1 World · Tier 1                                   │  │
│  │                                                       │  │
│  │  ▼ Scoring Detail                                    │  │
│  │  ┌───────────────────┬────────┬──────┬───────────┐  │  │
│  │  │ Stat              │ Value  │ Rule │ Points    │  │  │
│  │  ├───────────────────┼────────┼──────┼───────────┤  │  │
│  │  │ R1 Score          │ 68     │ 1/st │ 68        │  │  │
│  │  │ R2 Score          │ 70     │ 1/st │ 70        │  │  │
│  │  │ Eagles            │ 1      │ -2   │ -2 bonus  │  │  │
│  │  │ Birdies           │ 8      │ -0.5 │ -4 bonus  │  │  │
│  │  │ Bogeys            │ 3      │ +0.5 │ +1.5      │  │  │
│  │  │ Hole-in-one       │ 0      │ -5   │ 0         │  │  │
│  │  └───────────────────┴────────┴──────┴───────────┘  │  │
│  │  Subtotal after R2: 138                              │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  T5: Keegan Bradley           CUT  160 pts          │  │
│  │  #45 World · Tier 5          ✗ does not count       │  │
│  │                                                       │  │
│  │  ► Scoring Detail                                    │  │
│  │  R1: 78 · R2: 82 · Missed Cut → R3: 80 · R4: 80    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Scoring Rules Reference                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Stroke play: 1 pt per stroke (lower is better)      │   │
│  │ Eagle: -2 pts · Birdie: -0.5 pts · Bogey: +0.5 pts │   │
│  │ Hole-in-one: -5 pts · Missed cut: 80 per round     │   │
│  │ Counting: Best 4 of 6 participants                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Contest Results (`/contests/:contestId/results`)

Final results page for completed contests. Focuses on celebration, sharing, and historical context.

### Components

- **`WinnerHighlight`** — large banner with winner's entry name, owner avatar, final score, margin of victory; optional confetti animation on first load (using `canvas-confetti` library, 3-second burst)
- **`FinalStandingsTable`** — full standings table (reuses `StandingsTable` from section 3) with final=true flag; no polling; shows prize distribution column if applicable
- **`PrizeDistribution`** — table showing prize payouts by position (if the league has prizes configured); shows amount per position
- **`ShareCardButton`** — generates and downloads a share card image (OG-compatible); calls `POST /api/v1/share/generate` with contest results; shows preview modal before download; includes "Copy Link" for the public `/share/:shareId` URL
- **`PlayAgainCTA`** — "Create Similar Contest" button; pre-fills the creation wizard with the same sport, event type, scoring rules, and selection type
- **`HistoricalContext`** — contextual stats from plan 04: "This was [owner]'s 3rd win this season", "Best score in league history", "5th straight podium finish"; data from the analytics engine (04-019 to 04-023)

### Data Requirements

| Endpoint | Polling | Query Key |
|---|---|---|
| `GET /api/v1/contests/:id` | None | `['contest', contestId]` |
| `GET /api/v1/contests/:id/standings` | None | `['standings', contestId, 'final']` |
| `GET /api/v1/contests/:id/history/summary` | None | `['contestSummary', contestId]` |
| `GET /api/v1/leagues/:leagueId/history/members/:memberId/stats` | None | `['memberStats', leagueId, memberId]` |
| `POST /api/v1/share/generate` | On demand | N/A (mutation) |

### Text Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│  ← The Masters 2026                                         │
│  Contest Results                           [● COMPLETED]     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              🏆  WINNER  🏆                          │   │
│  │                                                      │   │
│  │       Tiger's Team — Mike D.                        │   │
│  │       Final Score: 275                               │   │
│  │       Won by 3 strokes                               │   │
│  │                                                      │   │
│  │       📊 Mike's 3rd win this season                  │   │
│  │       🏅 Best Masters pool score in league history   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [Share Results 📤]    [Create Similar Contest →]           │
│                                                             │
│  Final Standings                                            │
│  ┌───┬──────────────┬──────────┬───────┬─────────────┐     │
│  │ # │ Entry        │ Owner    │ Score │ Prize       │     │
│  ├───┼──────────────┼──────────┼───────┼─────────────┤     │
│  │ 1 │ Tiger's Team │ Mike D.  │  275  │ 1st ($100)  │     │
│  │ 2 │ Par Busters  │ Sarah K. │  278  │ 2nd ($50)   │     │
│  │ 3 │ Green Jacket │ Tom H.   │  280  │ 3rd ($25)   │     │
│  │ 4 │ Ace Squad    │ Jen P.   │  281  │             │     │
│  │ 5 │ My Entry     │ You      │  283  │             │     │
│  │...│              │          │       │             │     │
│  └───┴──────────────┴──────────┴───────┴─────────────┘     │
│                                                             │
│  Scoring Summary                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Average score: 289 · Median: 287                    │   │
│  │ Best participant: Scheffler (avg 69.0 across pools)  │   │
│  │ Most-picked: McIlroy (18 of 24 entries)             │   │
│  │ Biggest surprise: L. Herbert T6 (started Tier 6)    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Head-to-Head (`/contests/:contestId/head-to-head`)

Compare two entries side by side with participant-by-participant scoring comparison and historical H2H record.

### Components

- **`EntryPairSelector`** — two dropdowns (or autocomplete) to select two entries to compare; defaults to current user's entry vs. the #1 ranked entry
- **`HeadToHeadComparison`** — side-by-side layout:
  - Header: entry name, owner, rank, total score for each side
  - Per-participant row: participant name in the middle, score on each side (green highlight for the higher scorer); shows tier/slot label
  - Bottom: total score comparison bar (visual bar showing relative scores)
- **`HistoricalH2HRecord`** — card showing the all-time record between the two entry owners within this league (from plan 04 RivalryEngine):
  - Overall record: "Mike D. leads 5-3 vs Sarah K."
  - Current streak: "Mike on a 2-contest win streak"
  - Closest finish, biggest margin
  - Contests played together count
- **`ComparisonChart`** — optional line chart showing scoring progression over rounds/periods for both entries; uses a lightweight chart library

### Data Requirements

| Endpoint | Polling | Query Key |
|---|---|---|
| `GET /api/v1/contests/:id/entries/:entryId/scoring` | None | `['entryScoring', contestId, entryId]` |
| `GET /api/v1/leagues/:leagueId/history/rivalry?member1={id1}&member2={id2}` | None | `['rivalry', leagueId, member1Id, member2Id]` |

### Text Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│  ← The Masters 2026                                         │
│  Head-to-Head                                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [My Entry ▼]              vs            [Tiger's Team ▼]   │
│                                                             │
│  ┌──────────────┬───────────────┬──────────────────┐       │
│  │   My Entry   │  Participant  │  Tiger's Team    │       │
│  │   #5 · 283   │               │  #1 · 275        │       │
│  ├──────────────┼───────────────┼──────────────────┤       │
│  │     138      │ T1: Scheffler │     138          │       │
│  │     140      │ T2: Morikawa  │     135  ✓       │       │
│  │     145      │ T3 picks      │     142  ✓       │       │
│  │     145      │ T4 picks      │     140  ✓       │       │
│  │     160 (CUT)│ T5 picks      │     148          │       │
│  │     143      │ T6 picks      │     145          │       │
│  ├──────────────┼───────────────┼──────────────────┤       │
│  │ Best 4: 283  │               │ Best 4: 275  ✓   │       │
│  └──────────────┴───────────────┴──────────────────┘       │
│                                                             │
│  ━━━━━━━━━━━━━━━━━━━━●━━━━ 283                             │
│  ━━━━━━━━━━━━━━━━●━━━━━━━━ 275    Winner: Tiger's Team     │
│                                                             │
│  Historical Record (in this league)                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Mike D. leads 5-3 vs You                           │   │
│  │  Current streak: Mike on 2-contest win streak        │   │
│  │  Closest finish: 1 point (NFL Survivor, Sep 2025)    │   │
│  │  Biggest margin: 42 points (NBA Playoffs, May 2025)  │   │
│  │  Contests together: 8                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Commissioner Contest Controls

Commissioner-only controls appear as a collapsible panel on the Contest Detail page when the current user has commissioner permissions. These map to plan 08 commissioner capabilities.

### Components

- **`CommissionerPanel`** — collapsible panel at the top of the contest detail page (below header); only rendered if user has OWNER or COMMISSIONER role
  - **Score Override:** manually override a participant's score or an entry's total; requires confirmation modal with reason field; creates an audit log entry
  - **Recalculate Scores:** trigger a full score recalculation from raw stat data; useful after a data correction (plan 06 correction pipeline); shows a progress indicator
  - **Close/Cancel Contest:** close the contest early (with final standings as-is) or cancel entirely; confirmation modal with reason; notifies all participants
  - **Extend Deadline:** push the entry deadline forward; date/time picker
  - **Lock/Unlock Entries:** toggle whether new entries can be submitted
  - **Edit Contest Settings:** opens a modal with editable contest settings (scoring rules, entry limits); changes after contest start require confirmation warning

### Data

- `POST /api/v1/contests/:id/scoring/override` — score override
- `POST /api/v1/contests/:id/scoring/recalculate` — trigger recalculation
- `PATCH /api/v1/contests/:id` — update contest settings
- `POST /api/v1/contests/:id/close` — close contest
- `POST /api/v1/contests/:id/cancel` — cancel contest

---

## Polling Infrastructure

Contest pages are the most polling-intensive pages in the app. The polling strategy uses TanStack Query's `refetchInterval` with intelligent adaptations.

### Polling Strategy

```typescript
const POLL_INTERVALS = {
  standings: {
    IN_PROGRESS: 10_000,   // 10s during live event
    DRAFTING: 30_000,      // 30s during draft
    default: 0,            // no polling for other statuses
  },
  myEntry: {
    IN_PROGRESS: 10_000,
    default: 0,
  },
  timeline: {
    IN_PROGRESS: 10_000,
    default: 0,
  },
  contestStatus: {
    OPEN: 60_000,          // 60s to detect status changes
    PRE_DRAFT: 60_000,
    DRAFTING: 10_000,
    IN_PROGRESS: 60_000,
    default: 0,
  },
  entries: {
    OPEN: 30_000,          // 30s to see new entrants
    default: 0,
  },
} as const;
```

### Optimisations

- **Pause polling when tab is hidden** — use `document.visibilityState` to stop polling when the browser tab is in the background; resume on focus
- **ETag support** — all polled endpoints return ETag headers; TanStack Query sends `If-None-Match` to avoid re-rendering on 304 responses
- **Stale-while-revalidate** — standings show cached data immediately while background fetch runs; no loading spinner on poll refreshes
- **Connection-aware** — reduce polling frequency on slow connections (via `navigator.connection.effectiveType`)

### Custom Hook

```typescript
function useContestPolling(contestId: string, status: ContestStatus) {
  const standings = useQuery({
    queryKey: ['standings', contestId, 'compact'],
    queryFn: () => fetchStandings(contestId, { limit: 10 }),
    refetchInterval: POLL_INTERVALS.standings[status] ?? POLL_INTERVALS.standings.default,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });

  const myEntry = useQuery({
    queryKey: ['myEntry', contestId],
    queryFn: () => fetchMyEntry(contestId),
    refetchInterval: POLL_INTERVALS.myEntry[status] ?? POLL_INTERVALS.myEntry.default,
    refetchIntervalInBackground: false,
    enabled: status === 'IN_PROGRESS',
  });

  return { standings, myEntry };
}
```

---

## Shared Components Summary

| Component | Used In | Description |
|---|---|---|
| `ContestHeader` | Detail, Standings, Scoring, Results, H2H | Sport icon, event name, type badge, status badge, entry count |
| `StandingsTable` | Detail (compact), Standings (full), Results | Sortable standings with rank, name, score, movement arrows |
| `MovementArrow` | StandingsTable | Green/red arrow with numeric rank change delta |
| `MyEntryCard` | Detail | Current user's entry with rank, score, roster |
| `ScoringTimeline` | Detail | Recent scoring events list |
| `StaleScoreIndicator` | Detail, Standings | Warning when score data is older than threshold |
| `EntryScorecard` | Scoring, H2H | Full scoring breakdown per entry |
| `ParticipantScoreRow` | Scoring, H2H | One participant with stat-to-score detail |
| `ScoringRuleChip` | Scoring | Inline badge showing rule application |
| `WinnerHighlight` | Results | Celebration banner for winner |
| `ShareCardButton` | Results | Generate and share results card |
| `CommissionerPanel` | Detail | Commissioner-only controls |
| `ContestCountdown` | Detail | Countdown timer to deadline |
| `SportSelector` | Wizard Step 1 | Sport icon grid |
| `EventPicker` | Wizard Step 1 | Searchable event list |
| `ContestTypeSelector` | Wizard Step 2 | Duration + selection type picker |
| `ScoringTemplateSelector` | Wizard Step 3 | Template list |
| `ScoringRuleEditor` | Wizard Step 3 | Editable scoring rules form |
| `ScoringPreviewTable` | Wizard Step 3 | Read-only scoring reference |
| `DraftConfigPanel` | Wizard Step 4 | Draft settings form |
| `PoolBuilder` | Wizard Step 5 | Participant pool configuration |
| `ParticipantSearch` | Wizard Step 5 | Typeahead participant search |
| `ParticipantCard` | Wizard Step 5 | Compact participant info card |
| `EntrySettings` | Wizard Step 6 | Entry limits and deadline form |
| `ReviewSummary` | Wizard Step 7 | Full configuration summary |
| `EntryPairSelector` | H2H | Two-entry selector for comparison |
| `HeadToHeadComparison` | H2H | Side-by-side scoring comparison |
| `HistoricalH2HRecord` | H2H | All-time rivalry stats |

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| W-C-001 | 1 | Contest creation wizard shell (multi-step form, routing, Zustand state) | Done | 7-step wizard with React Hook Form + zod in `pages/contests/create.tsx`; steps 1-3 fully interactive, steps 4-7 simplified with mock data |
| W-C-002 | 1 | Event picker component (sport selector + event list from ingested data) | Done | Sport grid (9 sports) + event list with mock data per sport + custom event option; part of create wizard step 1 |
| W-C-003 | 1 | Contest type selector (duration + selection type with compatibility filter) | Done | Duration radio + selection type card grid with bracket filtering for NCAA/NBA; part of create wizard step 2 |
| W-C-004 | 2 | Scoring rule editor (template selector + custom rule editing + preview) | Done | Template selector with preview table + customize toggle (read-only placeholder); part of create wizard step 3 |
| W-C-005 | 2 | Draft config panel (mode, order, timing, commissioner controls) | Done | Static mock UI with mode toggle, seconds-per-pick slider, draft date picker; part of create wizard step 4 |
| W-C-006 | 2 | Pool builder (full field, custom, tier assignment, budget pricing) | Done | Simplified info card showing full field selected (90 participants); part of create wizard step 5 |
| W-C-007 | 2 | Entry settings form (max entries, deadline, roster size, survivor/confidence config) | Done | Functional form fields for max entries, entry deadline, roster size; part of create wizard step 6 |
| W-C-008 | 2 | Review & create step (summary + POST /contests + POST /drafts) | Done | Summary card of all steps + Create Contest button with toast + navigate; part of create wizard step 7 |
| W-C-009 | 3 | Contest detail page — pre-draft/open state (info card, countdown, entry list, join CTA) | Not Started | |
| W-C-010 | 3 | Contest detail page — in-progress state (live standings, my entry, timeline, stale indicator) | Done | Contest header, My Entry card with picks, standings snapshot, contest info sidebar; uses `useContest` hook with mock data |
| W-C-011 | 3 | Contest detail page — completed state (results summary, winner highlight, link to results) | Done | Winner spotlight card, final standings table, contest summary; implemented in `pages/contests/results.tsx` |
| W-C-012 | 3 | Full standings table (sortable, expandable rows, movement arrows, filters, CSV export) | Done | 12-entry table with sortable columns, rank badges, movement indicators, eliminated/user highlighting; `pages/contests/standings.tsx` with `useStandings` hook |
| W-C-013 | 4 | Score breakdown view (entry scorecard, participant score rows, rule chips, legend) | Done | Entry selector, expandable participant rows with stat-to-score mapping, collapsible scoring rules reference; `pages/contests/scoring.tsx` |
| W-C-014 | 4 | Contest polling infrastructure (useContestPolling hook, visibility-aware, ETag support) | Not Started | Depends on W-016 |
| W-C-015 | 4 | Commissioner contest controls (score override, recalculate, close/cancel, extend deadline) | Not Started | Depends on plan 08 API endpoints |

---

*PoolMaster Webapp Contest Pages Plan v1.0*
