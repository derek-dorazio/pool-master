# PoolMaster — Participant & Player Data Management Plan

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

## Overview

Participants — golfers, F1 drivers, NFL players, college basketball teams, tennis players, racehorses — are a first-class domain object referenced by nearly every feature in the system. The draft selects them, the scoring engine tracks them, tiers and budget picks price them, and the history system records their performance over time. This plan defines how participant records are created, maintained, enriched, searched, and served across all sports.

---

## 1. Participant Domain Model

### Core Participant Schema

```typescript
interface Participant {
  id: string;                              // PoolMaster canonical UUID
  sport: Sport;
  participant_type: 'INDIVIDUAL' | 'TEAM';

  // Identity
  display_name: string;                    // "Tiger Woods", "Red Bull Racing", "Duke"
  first_name?: string;                     // null for teams
  last_name?: string;                      // null for teams
  short_name?: string;                     // "T. Woods", "RBR", "DUKE"

  // Classification
  nationality?: string;                    // ISO 3166-1 alpha-2
  position?: string;                       // NFL: "QB", "WR"; Tennis: null; Golf: null
  team_affiliation?: string;               // NFL: "Kansas City Chiefs"; F1: "Red Bull Racing"

  // Status
  status: 'ACTIVE' | 'INACTIVE' | 'RETIRED' | 'SUSPENDED';
  injury_status: InjuryStatus;

  // Media
  photo_url?: string;                      // CDN URL for headshot/logo
  photo_last_updated?: Date;

  // External mappings (denormalised for quick access; canonical in mapping table)
  external_ids: Record<string, string>;    // { sportsdataio: "123", sportradar: "sr:456" }

  // Metadata (sport-specific, schemaless)
  metadata: ParticipantMetadata;

  // Timestamps
  created_at: Date;
  updated_at: Date;
}

interface InjuryStatus {
  status: 'HEALTHY' | 'QUESTIONABLE' | 'DOUBTFUL' | 'OUT' | 'WITHDRAWN' | 'SUSPENDED' | 'SCRATCHED';
  detail?: string;                         // "Knee — questionable for Sunday"
  expected_return?: Date;
  updated_at: Date;
  source: string;                          // provider that reported this
}

interface ParticipantMetadata {
  // Golf-specific
  world_ranking?: number;
  owgr_points?: number;
  tour?: string;                           // "PGA", "LIV", "DP World"

  // NFL-specific
  jersey_number?: number;
  draft_year?: number;
  experience_years?: number;
  depth_chart_position?: number;

  // F1-specific
  car_number?: number;
  constructor?: string;
  championship_points?: number;

  // NCAA-specific
  conference?: string;
  seed?: number;
  region?: string;

  // Tennis-specific
  atp_ranking?: number;
  wta_ranking?: number;
  preferred_surface?: string;

  // Horse Racing-specific
  trainer?: string;
  jockey?: string;
  sire?: string;
  dam?: string;
  age?: number;
  morning_line_odds?: number;
}
```

---

## 2. Season-Specific Data

Rankings, pricing, and performance stats are season-bound. A golfer's world ranking in 2025 differs from 2026. This data is stored separately from the core participant profile.

### Season Participant Record

```typescript
interface ParticipantSeasonRecord {
  id: string;
  participant_id: string;
  sport: Sport;
  season: string;                          // "2025-2026" or "2026"

  // Rankings (refreshed from provider)
  rankings: SeasonRanking[];

  // Pricing (for budget pick contests)
  budget_price: number;                // calculated from rankings + form
  price_tier?: string;                     // auto-assigned tier: "ELITE", "MID", "VALUE"
  price_updated_at: Date;

  // Aggregate stats for the season
  events_entered: number;
  events_completed: number;
  wins: number;
  top_5_finishes: number;
  top_10_finishes: number;
  top_25_finishes: number;

  // Sport-specific season aggregates
  season_stats: Record<string, number>;    // { avg_score: 70.2, fairways_pct: 0.68 }

  // Form indicator (rolling last N events)
  form_rating: number;                     // 0-100 composite form score
  form_trend: 'RISING' | 'STABLE' | 'FALLING';

  last_updated: Date;
}

interface SeasonRanking {
  ranking_type: string;                    // "OWGR", "FEDEX_CUP", "ATP", "F1_CHAMPIONSHIP"
  rank: number;
  points?: number;
  as_of_date: Date;
}
```

---

## 3. Budget Pick Pricing Engine

For budget pick draft formats, each participant needs a price. Prices are derived from rankings, recent form, and event-specific factors.

### Pricing Model

```typescript
interface PricingConfig {
  sport: Sport;
  contest_id?: string;                     // if null, applies as default for sport

  // Budget and range
  total_budget: number;                    // e.g. 50000
  min_price: number;                       // floor — every participant costs at least this
  max_price: number;                       // ceiling
  price_increment: number;                 // prices round to this increment (e.g. 100)

  // Pricing formula weights
  ranking_weight: number;                  // how much world ranking influences price (0-1)
  form_weight: number;                     // how much recent form influences price (0-1)
  odds_weight: number;                     // how much betting odds influence price (0-1)

  // Manual adjustments
  manual_overrides: PriceOverride[];       // commissioner can override specific prices
}

interface PriceOverride {
  participant_id: string;
  override_price: number;
  reason: string;
  set_by: string;                          // commissioner user ID
  set_at: Date;
}
```

### Pricing Calculation Flow

```
1. Fetch current ranking for participant in this sport
2. Fetch form_rating from season record
3. Fetch current odds from odds provider (if available)
4. Compute raw score:
   raw = (ranking_weight × normalised_rank) +
         (form_weight × normalised_form) +
         (odds_weight × normalised_odds)
5. Map raw score to price range [min_price, max_price] using linear interpolation
6. Round to price_increment
7. Apply manual override if one exists
8. Store as budget_price on ParticipantSeasonRecord
```

### Price Refresh Schedule

```
Default:    Weekly (Monday 06:00 UTC) — recalculates all prices from latest rankings
Pre-event:  24 hours before contest lock — final price refresh
During draft: Prices are FROZEN at lock time — no mid-draft price changes
Commissioner: Can trigger manual refresh from contest setup UI
```

---

## 4. Tier Assignment

For tiered draft formats, participants are grouped into tiers. Tier assignment can be automatic (ranking-based) or manual (commissioner-defined).

### Tier Configuration

```typescript
interface TierConfig {
  contest_id: string;
  sport: Sport;
  assignment_mode: 'AUTO_RANKING' | 'AUTO_PRICE' | 'MANUAL';

  tiers: TierDefinition[];
}

interface TierDefinition {
  tier_id: string;
  tier_name: string;                       // "Tier 1 — Elite", "Tier 2 — Contenders"
  tier_number: number;                     // 1 = top tier
  picks_from_tier: number;                 // how many picks managers must make from this tier

  // Auto-assignment rules (used when assignment_mode != MANUAL)
  ranking_range?: [number, number];        // e.g. [1, 20] for top-20 ranked
  price_range?: [number, number];          // e.g. [10000, 15000]
  max_participants?: number;               // cap tier size regardless of range

  // Populated after assignment
  participant_ids: string[];
}
```

### Auto-Assignment Flow

```
1. Retrieve all participants in the contest's participant pool
2. Sort by ranking (AUTO_RANKING) or price (AUTO_PRICE)
3. Assign to tiers based on tier definition ranges
4. Handle edge cases:
   - Tied rankings: assign to higher tier (more generous)
   - Participant count exceeds tier max: overflow to next tier
   - Unranked participants: assign to lowest tier
5. Store tier assignments
6. Commissioner can review and manually adjust individual assignments
```

---

## 5. Contest Participant Pool

When a commissioner creates a contest, they define which participants are eligible. This is the contest participant pool.

### Pool Configuration

```typescript
interface ContestParticipantPool {
  contest_id: string;
  sport: Sport;
  event_id?: string;                       // if tied to a specific sporting event

  // Pool definition
  pool_type: 'EVENT_FIELD' | 'CUSTOM' | 'RANKING_CUTOFF' | 'FULL_SPORT';

  // For EVENT_FIELD: use the event's registered participant list
  event_field_config?: {
    include_alternates: boolean;
    auto_update_on_field_change: boolean;  // add late entries, remove withdrawals
  };

  // For RANKING_CUTOFF: top N ranked participants
  ranking_cutoff_config?: {
    ranking_type: string;
    max_rank: number;
  };

  // For CUSTOM: commissioner hand-picks participants
  custom_participant_ids?: string[];

  // Exclusions (apply on top of any pool type)
  excluded_participant_ids: string[];       // commissioner removed these

  // Resolved pool (populated after pool is built)
  resolved_participants: PoolParticipant[];
  pool_locked: boolean;                    // true once draft begins
  pool_locked_at?: Date;
}

interface PoolParticipant {
  participant_id: string;
  display_name: string;
  ranking?: number;
  budget_price?: number;
  tier_id?: string;
  injury_status: InjuryStatus;
  is_available: boolean;                   // false if withdrawn/scratched after pool creation
}
```

### Pool Lifecycle

```
1. Commissioner creates contest → selects pool type
2. Pool is RESOLVED: participant list generated from source
3. Pricing and tiers are applied (if budget pick or tiered draft)
4. Commissioner reviews pool, makes manual adjustments
5. Pool is LOCKED when draft begins
6. Post-lock updates:
   - Withdrawals/scratches: participant marked unavailable, auto-pick skips them
   - Late entries: NOT added to locked pool (prevents unfairness)
   - Injury status: updated in real-time for display, but participant stays in pool
```

---

## 6. Participant Ingestion & Refresh

### Ingestion Sources (via Sports Data Integration layer)

| Data Type | Source | Frequency | Destination |
|---|---|---|---|
| Profiles (name, nationality, photo) | Primary provider | Daily at 04:00 UTC | PostgreSQL participants table |
| Rankings | Primary provider | Weekly (Mon 06:00 UTC) + post-event | ParticipantSeasonRecord |
| Injury/availability | Primary provider | Hourly during active events | InjuryStatus on participant |
| Odds/pricing inputs | Odds provider | Every 5 minutes pre-event | ParticipantSeasonRecord |
| Event field (who's playing) | Primary provider | Daily + on-demand for active events | ContestParticipantPool |

### New Participant Detection

```
1. Provider returns a participant ID not in the mapping table
2. Create new Participant record with status = ACTIVE
3. Create ParticipantIdMapping for this provider
4. Attempt cross-provider matching (see deduplication below)
5. Queue for admin review if confidence < HIGH
6. Participant is immediately available for contest pools
```

### Retirement & Status Changes

```
1. Provider reports participant as inactive/retired
2. Update participant status
3. Check active contests:
   - If participant is in an active draft: flag for commissioner
   - If participant is on a drafted team in active contest:
     mark as unavailable, do not remove from team
4. Emit PARTICIPANT_STATUS_CHANGED event for notifications
```

---

## 7. Participant Deduplication

### The Problem

The same person may appear from multiple providers with different IDs and slightly different names:
- SportsDataIO: `{ id: "40000123", name: "Rory McIlroy" }`
- Sportradar: `{ id: "sr:competitor:12345", name: "McIlroy, Rory" }`

### Matching Algorithm

```typescript
interface DeduplicationResult {
  canonical_participant_id: string;
  matched_records: MatchedRecord[];
  confidence: 'EXACT' | 'HIGH' | 'LOW' | 'AMBIGUOUS';
  needs_manual_review: boolean;
}

// Matching pipeline (run in order, stop at first match)
const MATCHING_STEPS = [
  // Step 1: Exact external ID match (same provider, known ID)
  { type: 'EXACT_ID', confidence: 'EXACT' },

  // Step 2: Cross-provider exact name + sport match
  { type: 'NAME_SPORT_EXACT', confidence: 'HIGH' },

  // Step 3: Fuzzy name match (handles "McIlroy, Rory" vs "Rory McIlroy")
  { type: 'NAME_FUZZY', confidence: 'HIGH', threshold: 0.90 },

  // Step 4: Name + nationality + sport (for common names)
  { type: 'NAME_NATIONALITY_SPORT', confidence: 'HIGH' },

  // Step 5: No confident match — queue for manual resolution
  { type: 'MANUAL_QUEUE', confidence: 'AMBIGUOUS' },
];
```

### Name Normalisation

```typescript
function normaliseName(raw: string): string {
  // "McIlroy, Rory" → "rory mcilroy"
  // "Rory McIlroy" → "rory mcilroy"
  // "José María Olazábal" → "jose maria olazabal"

  let name = raw.toLowerCase();
  name = name.replace(/,\s*/g, ' ');           // remove comma formatting
  name = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');  // strip diacritics
  name = name.replace(/\s+/g, ' ').trim();     // normalise whitespace

  // Handle "Last, First" format
  const parts = raw.split(',').map(s => s.trim());
  if (parts.length === 2) {
    name = `${parts[1]} ${parts[0]}`.toLowerCase();
  }

  return name;
}
```

### Manual Resolution Queue (Admin Dashboard)

When automatic matching fails or confidence is LOW:

```
Admin sees:
  ┌──────────────────────────────────────────────────────────┐
  │ Unresolved Participant Match                              │
  │                                                          │
  │ New record:  "R. McIlroy" (sportradar, golf)             │
  │                                                          │
  │ Possible matches:                                        │
  │   ○ Rory McIlroy (ID: pm-12345) — 92% confidence        │
  │   ○ Create as new participant                            │
  │                                                          │
  │ [Link to Existing]  [Create New]  [Skip]                 │
  └──────────────────────────────────────────────────────────┘
```

---

## 8. Participant Search & Filtering

### Search Requirements

Two primary search contexts:
1. **Commissioner pool setup** — filtering participants to build a contest pool
2. **Draft room** — managers searching for a participant to draft

### Search Interface

```typescript
interface ParticipantSearchRequest {
  query?: string;                          // free-text search on name
  sport: Sport;
  filters: ParticipantFilters;
  sort_by: 'RANKING' | 'NAME' | 'PRICE' | 'FORM';
  sort_order: 'ASC' | 'DESC';
  page: number;
  page_size: number;
}

interface ParticipantFilters {
  status?: ('ACTIVE' | 'INACTIVE')[];
  injury_status?: InjuryStatus['status'][];
  position?: string[];                     // NFL positions
  team?: string[];                         // team affiliation
  nationality?: string[];
  ranking_range?: [number, number];
  price_range?: [number, number];
  tier_id?: string;                        // within a specific contest's tier
  available_only?: boolean;                // exclude withdrawn/scratched
  in_pool?: string;                        // contest_id — only show pool members
  not_drafted?: string;                    // contest_id — exclude already-drafted
}

interface ParticipantSearchResult {
  participants: ParticipantSearchItem[];
  total_count: number;
  facets: SearchFacets;
}

interface ParticipantSearchItem {
  participant_id: string;
  display_name: string;
  photo_url?: string;
  sport: Sport;
  ranking?: number;
  budget_price?: number;
  tier_id?: string;
  tier_name?: string;
  injury_status: InjuryStatus;
  form_rating: number;
  form_trend: 'RISING' | 'STABLE' | 'FALLING';
  season_stats_summary: Record<string, number>;  // top 3-5 stats for display
  is_drafted?: boolean;                           // in draft context
  drafted_by?: string;                            // team name, if drafted
}

interface SearchFacets {
  positions: FacetBucket[];
  teams: FacetBucket[];
  tiers: FacetBucket[];
  nationalities: FacetBucket[];
  injury_statuses: FacetBucket[];
}

interface FacetBucket {
  value: string;
  count: number;
}
```

### Search Implementation

**Phase 1 (Launch):** PostgreSQL full-text search with `tsvector` on participant name + team + nationality. Sufficient for pools of up to ~2,000 participants per sport.

**Phase 2 (Scale):** Elasticsearch or Algolia for:
- Typo tolerance ("Sheffler" → "Scheffler")
- Phonetic matching ("Hovland" when searching "Hofland")
- Instant search-as-you-type in draft room
- Faceted filtering with counts

### Search Index Fields

```typescript
// Fields indexed for full-text search
const SEARCH_INDEX_FIELDS = [
  'display_name',          // primary search field, boosted 3x
  'first_name',            // boosted 2x
  'last_name',             // boosted 2x
  'short_name',            // boosted 1x
  'team_affiliation',      // boosted 1x
  'nationality',           // boosted 0.5x
];

// Fields indexed for filtering (not full-text)
const FILTER_FIELDS = [
  'sport', 'status', 'position', 'team_affiliation',
  'ranking', 'budget_price', 'tier_id', 'form_rating',
  'injury_status',
];
```

---

## 9. Photo & Media Management

### Photo Pipeline

```
1. Provider returns photo_url for a participant
2. Ingestion worker downloads the image
3. Image is processed:
   - Resize to standard dimensions: 100×100 (thumb), 200×200 (card), 400×400 (profile)
   - Convert to WebP (with JPEG fallback)
   - Strip EXIF data
4. Upload to S3 bucket (or equivalent)
5. Serve via CDN (CloudFront)
6. Store CDN URL on participant record
```

### Fallback Images

```typescript
const FALLBACK_PHOTOS: Record<Sport, Record<string, string>> = {
  GOLF: {
    default: '/assets/participants/golf-silhouette.webp',
  },
  NFL: {
    QB: '/assets/participants/nfl-qb-silhouette.webp',
    WR: '/assets/participants/nfl-wr-silhouette.webp',
    default: '/assets/participants/nfl-player-silhouette.webp',
  },
  F1: {
    default: '/assets/participants/f1-helmet-silhouette.webp',
  },
  NCAA_BASKETBALL: {
    default: '/assets/participants/ncaa-team-logo-placeholder.webp',
  },
  TENNIS: {
    default: '/assets/participants/tennis-silhouette.webp',
  },
  HORSE_RACING: {
    default: '/assets/participants/horse-silhouette.webp',
  },
};
```

### Photo Refresh

- **Frequency:** Monthly for all participants; immediately when provider returns a new URL
- **Cache busting:** Photo URLs include a version hash parameter (`?v=abc123`) so CDN cache is invalidated on update

---

## 10. Database Schema

```sql
-- Core participant table
CREATE TABLE participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport VARCHAR(50) NOT NULL,
  participant_type VARCHAR(20) NOT NULL DEFAULT 'INDIVIDUAL',
  display_name VARCHAR(500) NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  short_name VARCHAR(100),
  nationality VARCHAR(10),
  position VARCHAR(50),
  team_affiliation VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  injury_status JSONB DEFAULT '{"status": "HEALTHY"}',
  photo_url TEXT,
  photo_last_updated TIMESTAMPTZ,
  external_ids JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Full-text search index
ALTER TABLE participants ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(display_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(first_name, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(last_name, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(team_affiliation, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(nationality, '')), 'D')
  ) STORED;

CREATE INDEX idx_participants_search ON participants USING GIN(search_vector);
CREATE INDEX idx_participants_sport_status ON participants(sport, status);
CREATE INDEX idx_participants_sport_ranking ON participants(sport, (metadata->>'world_ranking'));

-- Season-specific records
CREATE TABLE participant_season_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id),
  sport VARCHAR(50) NOT NULL,
  season VARCHAR(20) NOT NULL,
  rankings JSONB DEFAULT '[]',
  budget_price INTEGER DEFAULT 0,
  price_tier VARCHAR(50),
  price_updated_at TIMESTAMPTZ,
  events_entered INTEGER DEFAULT 0,
  events_completed INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  top_5_finishes INTEGER DEFAULT 0,
  top_10_finishes INTEGER DEFAULT 0,
  top_25_finishes INTEGER DEFAULT 0,
  season_stats JSONB DEFAULT '{}',
  form_rating DECIMAL(5,2) DEFAULT 50.0,
  form_trend VARCHAR(20) DEFAULT 'STABLE',
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(participant_id, season)
);

CREATE INDEX idx_season_records_sport_season ON participant_season_records(sport, season);
CREATE INDEX idx_season_records_price ON participant_season_records(budget_price);

-- Contest participant pools
CREATE TABLE contest_participant_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID NOT NULL,
  sport VARCHAR(50) NOT NULL,
  event_id UUID REFERENCES sport_events(id),
  pool_type VARCHAR(50) NOT NULL,
  config JSONB DEFAULT '{}',
  excluded_participant_ids UUID[] DEFAULT '{}',
  pool_locked BOOLEAN DEFAULT FALSE,
  pool_locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pool membership (resolved participants in a contest pool)
CREATE TABLE contest_pool_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES contest_participant_pools(id),
  participant_id UUID NOT NULL REFERENCES participants(id),
  ranking INTEGER,
  budget_price INTEGER,
  tier_id VARCHAR(100),
  is_available BOOLEAN DEFAULT TRUE,
  unavailable_reason VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pool_id, participant_id)
);

CREATE INDEX idx_pool_participants_pool ON contest_pool_participants(pool_id);
CREATE INDEX idx_pool_participants_tier ON contest_pool_participants(pool_id, tier_id);
```

---

## 11. API Endpoints

```
# Participant CRUD (internal + admin)
GET    /api/v1/participants                    # Search/list participants
GET    /api/v1/participants/:id                # Get participant profile
GET    /api/v1/participants/:id/season/:season # Get season record

# Contest pool management (commissioner)
POST   /api/v1/contests/:id/pool              # Create/configure pool
GET    /api/v1/contests/:id/pool              # Get resolved pool with participants
PUT    /api/v1/contests/:id/pool              # Update pool config
POST   /api/v1/contests/:id/pool/refresh      # Re-resolve pool from source
POST   /api/v1/contests/:id/pool/lock         # Lock pool (usually automatic at draft start)
DELETE /api/v1/contests/:id/pool/participants/:pid  # Exclude participant from pool

# Draft room search
GET    /api/v1/contests/:id/pool/search       # Search within contest pool (draft context)

# Pricing (commissioner)
GET    /api/v1/contests/:id/pricing           # Get pricing config
PUT    /api/v1/contests/:id/pricing           # Update pricing config
POST   /api/v1/contests/:id/pricing/refresh   # Recalculate prices
PUT    /api/v1/contests/:id/pricing/override/:pid  # Manual price override

# Tier management (commissioner)
GET    /api/v1/contests/:id/tiers             # Get tier assignments
PUT    /api/v1/contests/:id/tiers             # Update tier config
POST   /api/v1/contests/:id/tiers/assign      # Run auto-assignment
PUT    /api/v1/contests/:id/tiers/:tid/participants/:pid  # Manual tier move

# Admin
GET    /api/v1/admin/participants/duplicates   # View deduplication queue
POST   /api/v1/admin/participants/merge        # Merge duplicate participants
POST   /api/v1/admin/participants/import       # Bulk import
```

---

## 12. Implementation Phases

### Phase 1 — Core Participant Model
- Database schema and migrations
- Participant CRUD service
- Ingestion integration (consume from Sports Data Integration layer)
- Basic participant search (PostgreSQL full-text)
- Provider ID mapping table

### Phase 2 — Contest Pool Management
- Contest participant pool creation and resolution
- Pool lifecycle (create → resolve → review → lock)
- Pool refresh on field changes
- Withdrawal/scratch handling post-lock

### Phase 3 — Pricing & Tiers
- Salary cap pricing engine
- Price calculation from rankings + form + odds
- Commissioner price overrides
- Tier auto-assignment
- Commissioner tier review and manual adjustments

### Phase 4 — Search & Media
- Photo ingestion pipeline and CDN storage
- Fallback image system
- Enhanced search (Elasticsearch migration if needed)
- Faceted filtering
- Draft room search optimisation (sub-100ms response)

### Phase 5 — Deduplication & Enrichment
- Cross-provider participant matching
- Manual resolution queue in admin dashboard
- Participant merge tooling
- Form rating calculation engine
- Season stat aggregation pipeline

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 05-001 | 1 | `participants` table + migrations (core schema) | Done | Prisma schema enriched with full profile fields, indexes |
| 05-002 | 1 | `participant_season_records` table + migrations | Done | Prisma model + adapter + season record API endpoints |
| 05-003 | 1 | Participant CRUD service + API endpoints | Done | Service, handler, routes at /api/v1/participants |
| 05-004 | 1 | Ingestion integration (consume from sports data layer) | Not Started | Depends on 06-004 |
| 05-005 | 1 | PostgreSQL full-text search on participants (`tsvector`) | Done | Case-insensitive search on name, firstName, lastName, shortName, teamAffiliation |
| 05-006 | 1 | Provider ID mapping table and resolution | Done | ParticipantProviderMapping model + adapter + findByProvider |
| 05-007 | 2 | `contest_participant_pools` table + migrations | Done | ContestPool Prisma model + adapter for pool config |
| 05-008 | 2 | `contest_pool_participants` table + migrations | Done | Enhanced ContestParticipantPool with poolId, ranking, unavailableReason |
| 05-009 | 2 | Contest pool creation and resolution (EVENT_FIELD, RANKING_CUTOFF, CUSTOM) | Done | ContestPoolService.resolvePool — CUSTOM, FULL_SPORT, RANKING_CUTOFF; EVENT_FIELD deferred to Plan 06 |
| 05-010 | 2 | Pool lifecycle (create → resolve → review → lock) | Done | Full lifecycle: create → resolve → refresh → lock |
| 05-011 | 2 | Pool refresh on field changes | Done | refreshPool re-resolves from source |
| 05-012 | 2 | Withdrawal/scratch handling post-lock | Done | markUnavailable/markAvailable on locked pools |
| 05-013 | 3 | Salary cap pricing engine (ranking + form + odds → price) | Done | PricingEngine pure functions + PricingAndTierService |
| 05-014 | 3 | Price calculation and refresh schedule | Done | calculateAndApplyPrices via POST /pool/pricing/calculate; schedule deferred to cron |
| 05-015 | 3 | Commissioner price overrides | Done | PUT /pool/pricing/override/:participantId |
| 05-016 | 3 | Tier auto-assignment (AUTO_RANKING, AUTO_PRICE) | Done | TierAssignmentEngine + POST /pool/tiers/assign |
| 05-017 | 3 | Commissioner tier review and manual adjustments | Done | PUT /pool/tiers/:tierId/participants/:participantId |
| 05-018 | 4 | Photo ingestion pipeline (download, resize, WebP, S3, CDN) | Not Started | Deferred — needs S3/CDN infrastructure |
| 05-019 | 4 | Fallback image system per sport/position | Done | fallback-photos.ts with per-sport, per-position silhouette map |
| 05-020 | 4 | Enhanced search — Elasticsearch migration (if needed) | Not Started | Deferred — PostgreSQL search sufficient for launch |
| 05-021 | 4 | Faceted filtering (nationality, position, team, ranking) | Done | DraftSearchService returns facet counts |
| 05-022 | 4 | Draft room search optimisation (< 100ms) | Done | GET /pool/search — in-memory filtering over pool participants |
| 05-023 | 5 | Cross-provider participant matching (fuzzy name + sport) | Done | Levenshtein-based fuzzy matching with name normalisation (diacritics, Last/First) |
| 05-024 | 5 | Manual resolution queue in admin dashboard | Not Started | Deferred — admin UI |
| 05-025 | 5 | Participant merge tooling | Done | ParticipantMergeService — transfers mappings, external IDs, season records |
| 05-026 | 5 | Form rating calculation engine | Done | Recency-weighted percentile-based form rating (0-100) with trend detection |
| 05-027 | 5 | Season stat aggregation pipeline | Not Started | Deferred — needs sports data provider integration |

---

*Generated by Claude — PoolMaster Participant & Player Data Management Plan v1.0*
