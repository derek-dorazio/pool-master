# PoolMaster — Search & Discovery Plan

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

## Overview

Search and discovery enables users to find participants during drafts, commissioners to build contest pools, and new users to discover public leagues. This plan covers full-text participant search, faceted filtering in contest setup, and a public contest directory for platforms that want open pools alongside private leagues.

---

## 1. Search Contexts

### Three Distinct Search Surfaces

| Context | Who Uses It | What They Search | Performance Requirement |
|---|---|---|---|
| **Draft Room Search** | Managers during drafts | Available participants by name, position, stats | < 100ms — instant as-you-type |
| **Commissioner Pool Setup** | Commissioners configuring contests | Participants to include/exclude from pool | < 500ms — responsive filtering |
| **Public Discovery** | New or browsing users | Public leagues, open contests, commissioners | < 300ms — smooth browsing |

---

## 2. Search Technology

### Phased Approach

**Phase 1 (Launch): PostgreSQL Full-Text Search**

Sufficient for initial scale (< 50K participants, < 1K leagues).

```sql
-- Participant search using tsvector (already defined in participant plan)
SELECT id, display_name, sport, ranking
FROM participants
WHERE search_vector @@ plainto_tsquery('english', $1)
  AND sport = $2
  AND status = 'ACTIVE'
ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC
LIMIT 20;
```

**Phase 2 (Scale): Elasticsearch**

Migrate when PostgreSQL full-text becomes a bottleneck or when typo tolerance and phonetic matching are needed.

```typescript
interface SearchEngineConfig {
  engine: 'POSTGRESQL' | 'ELASTICSEARCH';

  elasticsearch?: {
    cluster_url: string;
    indices: {
      participants: 'poolmaster-participants';
      leagues: 'poolmaster-leagues';
      contests: 'poolmaster-contests';
    };
    replicas: 1;
    shards: 2;
  };
}
```

### Elasticsearch Index Mapping (Participants)

```json
{
  "mappings": {
    "properties": {
      "display_name": {
        "type": "text",
        "analyzer": "name_analyzer",
        "fields": {
          "keyword": { "type": "keyword" },
          "phonetic": { "type": "text", "analyzer": "phonetic_analyzer" }
        }
      },
      "first_name": { "type": "text", "analyzer": "name_analyzer" },
      "last_name": { "type": "text", "analyzer": "name_analyzer" },
      "sport": { "type": "keyword" },
      "status": { "type": "keyword" },
      "position": { "type": "keyword" },
      "team_affiliation": { "type": "keyword" },
      "nationality": { "type": "keyword" },
      "ranking": { "type": "integer" },
      "salary_cap_price": { "type": "integer" },
      "tier_id": { "type": "keyword" },
      "form_rating": { "type": "float" },
      "injury_status": { "type": "keyword" }
    }
  },
  "settings": {
    "analysis": {
      "analyzer": {
        "name_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding", "name_ngram"]
        },
        "phonetic_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "double_metaphone"]
        }
      },
      "filter": {
        "name_ngram": {
          "type": "edge_ngram",
          "min_gram": 2,
          "max_gram": 15
        },
        "double_metaphone": {
          "type": "phonetic",
          "encoder": "double_metaphone"
        }
      }
    }
  }
}
```

### What This Enables

- **Typo tolerance:** "Sheffler" → finds "Scheffler"
- **Phonetic matching:** "Hovland" when searching "Hofland"
- **Partial matching:** "Mc" → McIlroy, McDowell, McCumber
- **Accent handling:** "Olazabal" → "Olazábal"
- **Search-as-you-type:** Results appear after 2 characters

---

## 3. Draft Room Search

The highest-performance search surface. Managers need instant results while on the clock.

### Search Flow

```
User types: "sch"
  ↓ (debounce 150ms)
API call: GET /api/v1/contests/:id/pool/search?q=sch&limit=10
  ↓
Results (< 100ms):
  1. Scottie Scheffler — #1 — $12,500
  2. Xander Schauffele — #4 — $11,000
  3. Tom Schwartz — #89 — $4,200
```

### Draft Search API

```typescript
interface DraftSearchRequest {
  contest_id: string;
  query: string;                       // free-text
  filters?: {
    tier_id?: string;
    position?: string;
    price_range?: [number, number];
    available_only?: boolean;           // exclude already drafted
    healthy_only?: boolean;             // exclude injured/withdrawn
  };
  sort_by?: 'RELEVANCE' | 'RANKING' | 'PRICE_DESC' | 'PRICE_ASC' | 'NAME';
  limit?: number;                      // default 20
}

interface DraftSearchResponse {
  results: DraftSearchResult[];
  total_available: number;             // total undrafted participants
}

interface DraftSearchResult {
  participant_id: string;
  display_name: string;
  photo_url?: string;
  ranking?: number;
  salary_cap_price?: number;
  tier_id?: string;
  tier_name?: string;
  position?: string;
  team_affiliation?: string;
  injury_status: string;
  form_trend: string;
  is_drafted: boolean;
  drafted_by?: string;                 // team name if drafted
  in_your_queue: boolean;              // is this participant in your pre-draft queue
}
```

### Performance Optimisation

```
Draft room search must be < 100ms. Strategies:
  1. Pre-load the entire contest pool into Redis on draft start
     (typical pool: 100-200 participants — fits easily in memory)
  2. Search against Redis in-memory set for instant filtering
  3. Only fall back to PostgreSQL/Elasticsearch if pool > 500
  4. Cache drafted status in Redis (updated on each pick)
```

---

## 4. Commissioner Pool Setup Search

Used when a commissioner is building a contest participant pool — searching across all participants in a sport.

### Pool Setup Search API

```typescript
interface PoolSetupSearchRequest {
  sport: Sport;
  query?: string;
  filters?: {
    status?: string[];
    ranking_range?: [number, number];
    nationality?: string[];
    position?: string[];
    team?: string[];
  };
  sort_by?: 'RANKING' | 'NAME' | 'FORM';
  page: number;
  page_size: number;                   // default 50
}

interface PoolSetupSearchResponse {
  results: ParticipantSearchItem[];
  total_count: number;
  facets: {
    nationalities: FacetBucket[];
    positions: FacetBucket[];
    teams: FacetBucket[];
    ranking_distribution: {
      top_10: number;
      top_25: number;
      top_50: number;
      top_100: number;
      unranked: number;
    };
  };
}

interface FacetBucket {
  value: string;
  label: string;
  count: number;
}
```

### Faceted Filtering UI

```
┌─────────────────────────────────────────────────────────┐
│ Build Participant Pool — Golf                           │
│                                                         │
│ [Search by name...]                                     │
│                                                         │
│ Filters:                                                │
│ ┌─────────────┐ ┌────────────┐ ┌───────────────────┐  │
│ │ Ranking ▼   │ │ Tour ▼     │ │ Nationality ▼     │  │
│ │ Top 50      │ │ PGA Tour   │ │ All               │  │
│ └─────────────┘ └────────────┘ └───────────────────┘  │
│                                                         │
│ Showing 50 of 156 participants                          │
│                                                         │
│ ☑ Scottie Scheffler    #1    PGA    USA    Form: ↑    │
│ ☑ Xander Schauffele    #4    PGA    USA    Form: →    │
│ ☐ Jon Rahm             #5    LIV    ESP    Form: ↓    │
│ ☑ Rory McIlroy         #3    PGA    NIR    Form: ↑    │
│                                                         │
│ Selected: 48 participants              [Add to Pool]    │
└─────────────────────────────────────────────────────────┘
```

---

## 5. Public Discovery

For platforms that enable public/open leagues and contests.

### Discoverable Entities

```typescript
// Leagues with visibility = PUBLIC
interface DiscoverableLeague {
  league_id: string;
  name: string;
  description?: string;
  photo_url?: string;
  member_count: number;
  max_members: number;
  sports: Sport[];
  active_contest_count: number;
  created_at: Date;
  activity_level: 'HIGH' | 'MEDIUM' | 'LOW';  // based on recent feed/contest activity
  join_policy: 'OPEN' | 'REQUEST';
}

// Contests open for joining
interface DiscoverableContest {
  contest_id: string;
  league_id: string;
  league_name: string;
  contest_name: string;
  sport: Sport;
  event_name: string;
  draft_type: DraftType;
  member_count: number;
  max_members: number;
  entry_fee?: number;
  prize_pool?: number;
  draft_start?: Date;
  lock_time: Date;
  status: 'OPEN' | 'DRAFTING';
}
```

### Discovery API

```
# Browse public leagues
GET /api/v1/discover/leagues
  ?sport=GOLF
  &sort=POPULAR|NEWEST|ACTIVITY
  &page=1

# Browse open contests
GET /api/v1/discover/contests
  ?sport=GOLF
  &event=masters-2026
  &draft_type=SNAKE
  &sort=STARTING_SOON|POPULAR|PRIZE_POOL
  &page=1

# Search across everything
GET /api/v1/discover/search
  ?q=masters+pool
  &type=LEAGUE|CONTEST
  &sport=GOLF
```

### Discovery Quality Controls

```typescript
interface DiscoveryQualityConfig {
  // Minimum requirements to appear in discovery
  league_minimum: {
    members: 3;                        // at least 3 members
    contests: 1;                       // at least 1 contest ever created
    last_active_days: 30;              // activity in last 30 days
    profile_complete: true;            // has name and description
  };

  // Spam prevention
  rate_limits: {
    leagues_created_per_day: 3;        // per tenant
    public_leagues_per_tenant: 10;     // max public leagues
  };

  // Reporting
  report_threshold: 3;                 // 3 reports → auto-hide from discovery, flag for admin review
}
```

---

## 6. Search Index Synchronisation

### Keeping Search Index in Sync

```typescript
interface IndexSyncStrategy {
  // Real-time: update index on every write
  real_time_events: [
    'PARTICIPANT_CREATED',
    'PARTICIPANT_UPDATED',
    'PARTICIPANT_STATUS_CHANGED',
    'LEAGUE_VISIBILITY_CHANGED',
    'CONTEST_STATUS_CHANGED',
  ];

  // Batch: periodic full reindex
  batch_reindex: {
    schedule: 'DAILY_AT_0400_UTC';
    sports: 'ALL';
    reason: 'Catch any missed events, rebuild facet counts';
  };

  // On-demand: admin-triggered reindex
  admin_reindex: {
    scope: 'FULL' | 'SPORT' | 'TENANT';
  };
}
```

### Sync Implementation

```
Event-driven sync:
  1. Service writes to PostgreSQL
  2. Service emits event to message bus: "participant.updated"
  3. Search indexer subscribes to these events
  4. Indexer updates Elasticsearch document
  5. If Elasticsearch is down: queue event, retry with backoff

Consistency:
  - PostgreSQL is source of truth
  - Search index is eventually consistent (target: < 5 second lag)
  - If search returns stale results, API layer verifies against PostgreSQL
```

---

## 7. Database Schema (Discovery-Specific)

```sql
-- Public league discovery cache (denormalised for fast browsing)
CREATE TABLE discoverable_leagues (
  league_id UUID PRIMARY KEY REFERENCES leagues(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  photo_url TEXT,
  sports VARCHAR(50)[] NOT NULL,
  member_count INTEGER DEFAULT 0,
  max_members INTEGER,
  active_contest_count INTEGER DEFAULT 0,
  activity_level VARCHAR(20) DEFAULT 'LOW',
  join_policy VARCHAR(20) DEFAULT 'OPEN',
  reported_count INTEGER DEFAULT 0,
  is_hidden BOOLEAN DEFAULT FALSE,      -- hidden by admin or auto-moderation
  last_activity_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Open contest discovery cache
CREATE TABLE discoverable_contests (
  contest_id UUID PRIMARY KEY,
  league_id UUID NOT NULL REFERENCES leagues(id),
  league_name VARCHAR(255),
  contest_name VARCHAR(255) NOT NULL,
  sport VARCHAR(50) NOT NULL,
  event_name VARCHAR(500),
  draft_type VARCHAR(50),
  member_count INTEGER DEFAULT 0,
  max_members INTEGER,
  entry_fee INTEGER,                    -- in cents
  prize_pool INTEGER,                   -- in cents
  draft_start TIMESTAMPTZ,
  lock_time TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'OPEN',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Discovery content reports
CREATE TABLE discovery_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(20) NOT NULL,     -- LEAGUE, CONTEST
  entity_id UUID NOT NULL,
  reported_by UUID NOT NULL REFERENCES users(id),
  reason VARCHAR(500) NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_discoverable_leagues_sports ON discoverable_leagues USING GIN(sports);
CREATE INDEX idx_discoverable_leagues_activity ON discoverable_leagues(activity_level, last_activity_at DESC);
CREATE INDEX idx_discoverable_contests_sport ON discoverable_contests(sport, status, lock_time);
CREATE INDEX idx_discoverable_contests_draft ON discoverable_contests(draft_start) WHERE status = 'OPEN';
```

---

## 8. Implementation Phases

### Phase 1 — Participant Search (PostgreSQL)
- PostgreSQL full-text search on participants table
- Draft room search endpoint (scoped to contest pool)
- Commissioner pool setup search with basic filtering
- Debounced search-as-you-type on frontend

### Phase 2 — Faceted Filtering
- Facet computation for pool setup (nationality, position, team, ranking)
- Filter UI for commissioner pool builder
- Sort options (ranking, name, price, form)
- Draft room filter chips (tier, position, available only)

### Phase 3 — Public Discovery
- Discoverable leagues and contests tables
- Discovery browse API
- Quality controls and spam prevention
- Report mechanism
- Discovery UI (browse, sort, join)

### Phase 4 — Elasticsearch Migration (If Needed)
- Elasticsearch cluster setup
- Index mappings with analysers (name, phonetic, ngram)
- Real-time event-driven index sync
- Typo tolerance and phonetic matching
- Batch reindex tooling
- Admin reindex controls

---

*Generated by Claude — PoolMaster Search & Discovery Plan v1.0*
