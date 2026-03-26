# PoolMaster — Sports Data Provider Integration Plan

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

## Overview

This document defines the architecture for ingesting, normalising, and serving real-world sports data within PoolMaster. The sports data layer is the foundation of the scoring engine — without reliable, normalised data flowing into the system, no contest can produce scores, standings, or results. The design must be provider-agnostic, sport-agnostic, and resilient to outages and data corrections.

---

## 1. Provider Evaluation & Selection

### Evaluation Criteria

| Criterion | Weight | Description |
|---|---|---|
| Sport coverage | High | Must cover all launch sports (golf, F1, NFL, NCAA basketball, tennis, horse racing) |
| Update latency | High | How quickly stat events are available after they occur in the real world |
| Historical data depth | Medium | Seasons of historical data available for seeding participant profiles and history features |
| API quality | Medium | REST vs streaming, documentation quality, SDK availability, rate limits |
| Cost | High | Per-request pricing, monthly minimums, overage charges, cost at projected scale |
| Reliability | High | Uptime SLA, outage history, redundancy |
| Data correction policy | Medium | How and when corrections are published, whether corrections are flagged as such |

### Recommended Provider Strategy

Use a **primary + fallback** approach per sport rather than a single provider for all sports:

```
Provider Assignment (Recommended)
├── Golf:       SportsDataIO (primary) + PGA Tour official feed (schedule/rankings)
├── NFL:        SportsDataIO (primary) + ESPN public API (fallback/validation)
├── F1:         Sportradar (primary) + Ergast/OpenF1 (fallback)
├── NCAA BBall: SportsDataIO (primary)
├── Tennis:     Sportradar (primary)
├── Horse Racing: Equibase (primary) — specialist provider, general providers lack depth
└── Odds/Pricing: the-odds-api (for budget pick and tier assignment pricing)
```

### Provider Contract Model

```typescript
interface ProviderContract {
  provider_id: string;
  provider_name: string;
  sports_covered: Sport[];
  api_base_url: string;
  auth_type: 'API_KEY' | 'OAUTH2' | 'HMAC';
  rate_limit: RateLimit;
  supports_webhooks: boolean;
  supports_streaming: boolean;
  polling_minimum_interval_ms: number;
  cost_model: CostModel;
  sla_uptime_percent: number;
}

interface RateLimit {
  requests_per_second: number;
  requests_per_minute: number;
  requests_per_day: number;
  burst_limit?: number;
}

interface CostModel {
  pricing_type: 'PER_REQUEST' | 'MONTHLY_FLAT' | 'TIERED';
  base_monthly_cost_usd: number;
  per_request_cost_usd?: number;
  included_requests?: number;
  overage_cost_usd?: number;
}
```

---

## 2. Adapter Pattern Architecture

Every provider implements a common `SportDataProvider` interface. The ingestion layer calls this interface — never the provider directly. Swapping or adding a provider requires only a new adapter implementation.

### Provider Interface

```typescript
interface SportDataProvider {
  provider_id: string;

  // Schedule & fixture data
  getUpcomingEvents(sport: Sport, dateRange: DateRange): Promise<SportEvent[]>;
  getEventDetails(eventId: string): Promise<SportEventDetail>;

  // Participant data
  getParticipants(sport: Sport, filters?: ParticipantFilter): Promise<Participant[]>;
  getParticipantProfile(participantId: string): Promise<ParticipantProfile>;
  getRankings(sport: Sport, rankingType: string): Promise<Ranking[]>;

  // Live scoring data
  getLiveScores(eventId: string): Promise<StatEvent[]>;
  getEventResults(eventId: string): Promise<EventResult>;

  // Historical data
  getHistoricalResults(sport: Sport, season: string, eventId?: string): Promise<EventResult[]>;
  getHistoricalStats(participantId: string, season: string): Promise<SeasonStats>;

  // Health
  healthCheck(): Promise<ProviderHealthStatus>;
}

interface ProviderHealthStatus {
  provider_id: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  last_successful_poll: Date;
  error_rate_last_hour: number;
  latency_ms_p95: number;
}
```

### Adapter Registration

```typescript
interface ProviderRegistry {
  // Register an adapter for a sport
  register(sport: Sport, provider: SportDataProvider, priority: 'PRIMARY' | 'FALLBACK'): void;

  // Get the active provider for a sport (tries primary, falls back)
  getProvider(sport: Sport): SportDataProvider;

  // Get health for all registered providers
  getHealthReport(): ProviderHealthStatus[];
}
```

### Adapter Implementation Example (Golf — SportsDataIO)

```typescript
class SportsDataIOGolfAdapter implements SportDataProvider {
  provider_id = 'sportsdataio-golf';

  private client: SportsDataIOClient;
  private rateLimiter: RateLimiter;

  async getLiveScores(eventId: string): Promise<StatEvent[]> {
    const raw = await this.rateLimiter.execute(() =>
      this.client.get(`/golf/v2/json/Leaderboard/${eventId}`)
    );
    return this.normalise(raw);
  }

  private normalise(raw: SportsDataIORawLeaderboard): StatEvent[] {
    // Map provider-specific fields to PoolMaster's StatEvent schema
    return raw.Players.map(player => ({
      event_id: raw.TournamentID.toString(),
      participant_external_id: player.PlayerID.toString(),
      stat_key: 'TOTAL_SCORE',
      stat_value: player.TotalScore,
      round: player.CurrentRound,
      timestamp: new Date(raw.Updated),
      provider_id: this.provider_id,
      raw_data: player,  // preserve raw for debugging
    }));
  }
}
```

---

## 3. Ingestion Pipelines

Three distinct ingestion pipelines serve different data types with different freshness requirements.

### 3.1 Schedule & Fixture Ingestion

**Purpose:** Populate upcoming events so commissioners can create contests.

```
Frequency:  Daily at 02:00 UTC + on-demand trigger from admin
Data flow:  Provider API → Adapter → Normalised SportEvent → PostgreSQL (events table)
Scope:      All sports, next 90 days of events
```

```typescript
interface SportEvent {
  id: string;                        // PoolMaster internal ID
  external_id: string;               // Provider's event ID
  provider_id: string;
  sport: Sport;
  name: string;                      // "The Masters 2026", "Monaco Grand Prix"
  venue: string;
  location: string;
  start_date: Date;
  end_date: Date;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'POSTPONED';
  rounds?: number;                   // e.g. 4 for golf, number of race sessions for F1
  participant_count?: number;
  field_locked: boolean;             // true when the participant field is finalised
  metadata: Record<string, any>;     // sport-specific (e.g. course name, track layout)
  last_updated: Date;
}
```

### 3.2 Participant & Ranking Ingestion

**Purpose:** Maintain the participant database — profiles, rankings, availability.

```
Frequency:  Daily at 04:00 UTC for profiles/rankings
            Hourly during active events for injury/withdrawal updates
Data flow:  Provider API → Adapter → Normalised Participant → PostgreSQL + search index
```

```typescript
interface ParticipantIngestionRecord {
  participant_id: string;
  sport: Sport;
  external_ids: Record<string, string>;  // { sportsdataio: "123", sportradar: "sr:456" }
  name: string;
  nationality?: string;
  photo_url?: string;
  active: boolean;
  rankings: RankingEntry[];
  injury_status?: InjuryStatus;
  metadata: Record<string, any>;
  last_updated: Date;
}

interface InjuryStatus {
  status: 'HEALTHY' | 'QUESTIONABLE' | 'OUT' | 'WITHDRAWN' | 'SUSPENDED';
  detail?: string;
  updated_at: Date;
  source: string;
}
```

### 3.3 Live Scoring Ingestion

**Purpose:** Feed real-time stat events into the scoring engine during active contests.

```
Frequency:  Variable per sport (see polling strategy below)
Data flow:  Provider API → Adapter → StatEvent → Message Bus (Redis Streams / SQS) → Scoring Engine
```

```typescript
interface StatEvent {
  id: string;                          // unique event ID (idempotency key)
  event_id: string;                    // which sporting event
  participant_external_id: string;     // provider's participant ID
  participant_id?: string;             // resolved PoolMaster participant ID
  stat_key: string;                    // normalised stat name
  stat_value: number;
  stat_unit?: string;
  round?: number;                      // round/session/quarter
  hole?: number;                       // golf-specific
  lap?: number;                        // F1-specific
  timestamp: Date;
  is_correction: boolean;              // true if this revises a prior stat
  corrects_event_id?: string;          // ID of the stat event being corrected
  provider_id: string;
  ingested_at: Date;
}
```

### Normalised Stat Keys Per Sport

```typescript
// Golf
'TOTAL_SCORE' | 'ROUND_SCORE' | 'HOLE_SCORE' | 'EAGLES' | 'BIRDIES' | 'PARS' |
'BOGEYS' | 'DOUBLE_BOGEYS' | 'HOLE_IN_ONE' | 'POSITION' | 'CUT_STATUS' |
'FAIRWAYS_HIT' | 'GREENS_IN_REGULATION' | 'PUTTS'

// NFL
'PASSING_YARDS' | 'PASSING_TOUCHDOWNS' | 'INTERCEPTIONS' | 'RUSHING_YARDS' |
'RUSHING_TOUCHDOWNS' | 'RECEIVING_YARDS' | 'RECEIVING_TOUCHDOWNS' | 'RECEPTIONS' |
'FUMBLES_LOST' | 'FIELD_GOALS_MADE' | 'SACKS' | 'DEFENSIVE_TOUCHDOWNS'

// F1
'FINISH_POSITION' | 'GRID_POSITION' | 'FASTEST_LAP' | 'LAPS_COMPLETED' |
'RETIREMENT' | 'POSITIONS_GAINED' | 'PIT_STOPS' | 'QUALIFYING_POSITION'

// NCAA Basketball
'POINTS' | 'REBOUNDS' | 'ASSISTS' | 'STEALS' | 'BLOCKS' | 'TURNOVERS' |
'THREE_POINTERS_MADE' | 'FREE_THROWS_MADE' | 'SEED' | 'ROUND_REACHED'

// Tennis
'SETS_WON' | 'MATCH_WON' | 'ACES' | 'DOUBLE_FAULTS' | 'BREAK_POINTS_WON' |
'ROUND_REACHED' | 'STRAIGHT_SETS_WIN'

// Horse Racing
'FINISH_POSITION' | 'WIN' | 'PLACE' | 'SHOW' | 'LENGTHS_BEHIND' |
'ODDS_MORNING_LINE' | 'ODDS_FINAL' | 'SCRATCHED'
```

---

## 4. Polling vs Webhooks vs Streaming Strategy

The ingestion strategy varies per sport based on update frequency needs and provider capabilities.

| Sport | Strategy | Interval (Active) | Interval (Idle) | Rationale |
|---|---|---|---|---|
| Golf | Polling | 60s | 300s | Scores change hole-by-hole; 60s is sufficient. Webhooks rarely available |
| NFL | Polling + Webhook | 10s | N/A (game-scoped) | Play-by-play needs fast updates during games |
| F1 | Streaming (if available) / Polling | 5s | 300s | Lap-by-lap data changes rapidly during a race |
| NCAA BBall | Polling | 15s | N/A (game-scoped) | Basketball scores change frequently during games |
| Tennis | Polling | 30s | 300s | Point-by-point updates desirable but not critical |
| Horse Racing | Polling | 30s pre-race, 5s during race | 3600s | Races are short; pre-race odds updates matter |

### Adaptive Polling

```typescript
interface PollingConfig {
  sport: Sport;
  event_id: string;
  base_interval_ms: number;
  active_interval_ms: number;        // when event is in progress
  idle_interval_ms: number;          // when no event is active
  backoff_multiplier: number;        // increase interval on repeated no-change responses
  max_interval_ms: number;           // ceiling for backoff
  jitter_ms: number;                 // random jitter to prevent thundering herd
}
```

### Webhook Handler

For providers that support webhooks, a dedicated endpoint receives push updates:

```
POST /api/v1/internal/webhooks/{provider_id}
Headers: X-Provider-Signature (HMAC verification)
Body: provider-specific payload

Flow: Verify signature → Parse → Route to adapter.normalise() → Publish to message bus
```

---

## 5. Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Ingestion Workers                         │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Schedule  │  │Participant│  │   Live   │  │ Webhook  │  │
│  │ Worker    │  │  Worker   │  │ Scoring  │  │ Receiver │  │
│  │ (cron)    │  │  (cron)   │  │  Worker  │  │  (HTTP)  │  │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘  │
│        │             │             │             │         │
│  ┌─────▼─────────────▼─────────────▼─────────────▼─────┐  │
│  │              Provider Registry                       │  │
│  │    ┌─────────────────────────────────────────┐      │  │
│  │    │  Adapter: SportsDataIO  (golf, NFL, NCAA)│      │  │
│  │    │  Adapter: Sportradar    (F1, tennis)     │      │  │
│  │    │  Adapter: Equibase      (horse racing)   │      │  │
│  │    │  Adapter: TheOddsAPI    (pricing)        │      │  │
│  │    └─────────────────────────────────────────┘      │  │
│  └──────────────────────┬──────────────────────────────┘  │
│                         │                                  │
└─────────────────────────┼──────────────────────────────────┘
                          │
                ┌─────────▼─────────┐
                │  Stat Normaliser  │
                │  (StatEvent →     │
                │   internal schema)│
                └─────────┬─────────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
     ┌────────▼──┐  ┌────▼────┐  ┌──▼───────────┐
     │ PostgreSQL │  │ Message │  │  Redis Cache  │
     │ (events,   │  │   Bus   │  │ (latest scores│
     │ participants│  │(StatEvent│  │  per event)   │
     │ schedules) │  │ stream) │  │               │
     └────────────┘  └────┬────┘  └───────────────┘
                          │
                ┌─────────▼─────────┐
                │  Scoring Engine   │
                │  (subscribes to   │
                │   StatEvent stream)│
                └───────────────────┘
```

---

## 6. Provider Outage Handling

### Health Monitoring

Each provider is continuously monitored. The ingestion worker tracks:

```typescript
interface ProviderHealthMetrics {
  provider_id: string;
  consecutive_failures: number;
  last_success_at: Date;
  last_failure_at: Date;
  error_rate_1h: number;            // percentage of failed requests in last hour
  avg_latency_ms_5m: number;        // rolling 5-minute average response time
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
}

// Thresholds
const DEGRADED_THRESHOLD = {
  error_rate: 0.10,                  // 10% error rate
  consecutive_failures: 3,
  latency_ms: 5000,
};

const DOWN_THRESHOLD = {
  error_rate: 0.50,                  // 50% error rate
  consecutive_failures: 10,
  minutes_since_success: 15,
};
```

### Outage Response Flow

```
Provider status: HEALTHY
  → Normal polling/ingestion

Provider status: DEGRADED
  → Increase polling interval (reduce load on struggling provider)
  → Attempt fallback provider if available
  → Emit platform alert to admin dashboard
  → No user-facing impact yet

Provider status: DOWN
  → Switch entirely to fallback provider (if registered)
  → If no fallback: mark affected events as STALE in cache
  → Display "scores last updated X minutes ago" in UI
  → Emit high-priority admin alert
  → If outage > 30 minutes during active contest:
      emit notification to affected commissioners
  → Continue retrying primary at reduced frequency

Provider recovery detected
  → Gradually shift traffic back to primary
  → Validate data consistency between primary and fallback
  → Clear stale warnings in UI
```

### Stale Score Indicator

```typescript
interface ScoreFreshness {
  event_id: string;
  last_stat_event_at: Date;
  staleness_seconds: number;
  is_stale: boolean;                  // true if > sport-specific threshold
  stale_message?: string;            // "Scores last updated 12 minutes ago"
}

// Staleness thresholds per sport (seconds)
const STALENESS_THRESHOLDS: Record<Sport, number> = {
  GOLF: 300,          // 5 minutes — scores change slowly
  NFL: 60,            // 1 minute — play-by-play is expected fast
  F1: 30,             // 30 seconds — laps are short
  NCAA_BASKETBALL: 60,
  TENNIS: 120,
  HORSE_RACING: 60,
};
```

---

## 7. Data Correction Handling

Sports data providers occasionally issue corrections — an official scorer changes a ruling, a stat is recounted, a position is revised after a penalty. PoolMaster must handle these gracefully.

### Correction Flow

```
1. Provider publishes a corrected stat
2. Adapter normalises it with is_correction = true, corrects_event_id = original ID
3. StatEvent published to message bus with CORRECTION type
4. Scoring Engine:
   a. Retrieves all contests affected by this participant + event
   b. Recalculates scores for affected teams
   c. Updates standings
   d. If standings order changed:
      - Emit STANDINGS_CHANGED notification
      - If contest is COMPLETED and correction changes payout-relevant positions:
        - Flag contest for commissioner review
        - Do NOT auto-adjust payouts (commissioner must confirm)
5. Correction logged in audit trail with before/after scores
```

### Correction Policy Configuration

```typescript
interface CorrectionPolicy {
  // How long after contest completion corrections are accepted
  correction_window_hours: number;     // default: 72 hours

  // Whether corrections auto-apply or require commissioner approval
  auto_apply_during_contest: boolean;  // default: true (live corrections auto-apply)
  auto_apply_after_close: boolean;     // default: false (post-close needs review)

  // Notification settings
  notify_commissioner_on_correction: boolean;  // default: true
  notify_affected_managers: boolean;            // default: true (if standings changed)
}
```

---

## 8. Cost Management

Sports data APIs are expensive. At scale, uncontrolled polling can balloon costs.

### Caching Strategy

```typescript
interface CachingConfig {
  // Redis cache TTLs per data type
  live_scores_ttl_seconds: 30;          // very short — scores must be fresh
  event_schedule_ttl_seconds: 3600;     // schedules change rarely
  participant_profile_ttl_seconds: 86400; // daily refresh is sufficient
  rankings_ttl_seconds: 86400;
  odds_ttl_seconds: 300;               // odds shift frequently pre-event
}
```

### Request Batching

Where providers support batch endpoints, combine multiple lookups:

```
Instead of:  GET /player/1, GET /player/2, ... GET /player/150
Use:         GET /players?ids=1,2,...,150
```

### Cost Budget & Alerts

```typescript
interface CostBudget {
  provider_id: string;
  monthly_budget_usd: number;
  alert_thresholds: number[];          // e.g. [0.50, 0.75, 0.90] — alert at 50%, 75%, 90%
  hard_limit: boolean;                 // if true, stop non-critical requests at 100%
  current_month_spend_usd: number;
  estimated_month_end_usd: number;     // projected based on current rate
}
```

### Smart Polling Optimisation

- **Only poll for active events.** If no contest in PoolMaster references a sporting event, don't poll for its scores
- **Scale polling frequency to contest count.** An event referenced by 50 contests justifies aggressive polling; one referenced by 1 contest can poll less frequently
- **Suspend polling during event gaps.** Golf has overnight breaks; NFL has halftime. Don't poll at active frequency during known gaps

---

## 9. Historical Data Seeding

Before launch, historical data must be ingested to populate:

- Participant profiles and career records
- Past event results (for history features)
- Historical rankings (for pricing model calibration in budget pick contests)

### Seeding Pipeline

```
1. For each sport, identify seasons to seed (recommended: last 3 seasons)
2. Run one-time bulk ingestion via adapter.getHistoricalResults()
3. Store in PostgreSQL (events, results) and NoSQL (participant season stats)
4. Build initial ranking and pricing models from historical data
5. Validate: spot-check 10 events per sport against known results
```

### Seeding Data Volume Estimates

| Sport | Seasons | Events/Season | Participants/Event | Estimated Records |
|---|---|---|---|---|
| Golf (PGA) | 3 | 45 | 156 | ~21,000 results |
| NFL | 3 | 272 | 53/team × 32 | ~46,000 player-games |
| F1 | 3 | 23 | 20 | ~1,400 results |
| NCAA BBall | 3 | 67 (tournament) | 68 teams | ~600 tournament results |
| Tennis (Grand Slams) | 3 | 16 | 128/draw | ~6,000 match results |

---

## 10. Participant ID Mapping & Deduplication

Different providers use different IDs for the same participant. PoolMaster maintains a canonical participant record with a mapping table.

```typescript
interface ParticipantIdMapping {
  participant_id: string;              // PoolMaster canonical ID
  provider_id: string;                 // e.g. "sportsdataio"
  external_id: string;                 // provider's ID for this participant
  confidence: 'EXACT' | 'HIGH' | 'MANUAL';  // how the mapping was established
  mapped_at: Date;
}
```

### Matching Strategy

```
1. Exact match on provider external_id (if participant was created from this provider)
2. Fuzzy match on name + sport + nationality (for cross-provider matching)
3. Manual resolution queue in admin dashboard for ambiguous matches
```

---

## 11. Monitoring & Observability

### Key Metrics to Track

| Metric | Alert Threshold | Description |
|---|---|---|
| `ingestion.poll.latency_ms` | > 5000ms p95 | Time to complete a poll request |
| `ingestion.poll.error_rate` | > 5% over 5m | Percentage of failed poll attempts |
| `ingestion.events.lag_seconds` | > 120s | Time between real-world event and stat event ingestion |
| `ingestion.events.throughput` | < expected baseline | Stat events ingested per minute |
| `provider.health.status` | != HEALTHY | Provider health state change |
| `cost.monthly_spend_pct` | > 75% | Approaching cost budget |
| `cache.hit_rate` | < 80% | Cache is not reducing provider load effectively |
| `correction.count` | spike detection | Unusual number of corrections may indicate provider issue |

### Ingestion Dashboard (Admin)

The admin dashboard displays per-provider, per-sport:

- Last successful poll timestamp
- Events currently being tracked (with contest count)
- Error log (last 100 errors with provider response)
- Daily request count and estimated cost
- Stat event throughput graph (events/minute over last 24h)

---

## 12. Database Schema (Sports Data Tables)

```sql
-- Sporting events (tournaments, races, games)
CREATE TABLE sport_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id VARCHAR(255) NOT NULL,
  provider_id VARCHAR(100) NOT NULL,
  sport VARCHAR(50) NOT NULL,
  name VARCHAR(500) NOT NULL,
  venue VARCHAR(500),
  location VARCHAR(500),
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
  rounds INTEGER,
  field_locked BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider_id, external_id)
);

-- Provider ID mappings for participants
CREATE TABLE participant_provider_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id),
  provider_id VARCHAR(100) NOT NULL,
  external_id VARCHAR(255) NOT NULL,
  confidence VARCHAR(20) NOT NULL DEFAULT 'EXACT',
  mapped_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider_id, external_id)
);

-- Ingestion job tracking
CREATE TABLE ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type VARCHAR(50) NOT NULL,       -- SCHEDULE, PARTICIPANT, LIVE_SCORING, HISTORICAL
  provider_id VARCHAR(100) NOT NULL,
  sport VARCHAR(50) NOT NULL,
  event_id UUID REFERENCES sport_events(id),
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  records_processed INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  error_log JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Provider health snapshots (time-series, consider moving to NoSQL at scale)
CREATE TABLE provider_health_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL,
  error_rate DECIMAL(5,4),
  avg_latency_ms INTEGER,
  consecutive_failures INTEGER DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sport_events_sport_status ON sport_events(sport, status);
CREATE INDEX idx_sport_events_dates ON sport_events(start_date, end_date);
CREATE INDEX idx_ingestion_jobs_status ON ingestion_jobs(status, created_at);
CREATE INDEX idx_provider_health_log_time ON provider_health_log(provider_id, recorded_at);
```

---

## 13. Implementation Phases

### Phase 1 — Foundation (Before Phase 3 of main build plan)
- Implement `SportDataProvider` interface and `ProviderRegistry`
- Build first adapter (SportsDataIO for golf — simplest live scoring model)
- Schedule ingestion worker (cron-based)
- Participant ingestion worker
- Database schema and migrations
- Redis caching layer

### Phase 2 — Live Scoring Pipeline
- Live scoring ingestion worker with adaptive polling
- StatEvent message bus publishing (Redis Streams)
- Scoring engine subscription to stat event stream
- Stale score detection and UI indicator
- Provider health monitoring

### Phase 3 — Multi-Provider & Resilience
- Additional sport adapters (F1, NFL, NCAA, tennis, horse racing)
- Fallback provider registration and automatic failover
- Webhook receiver endpoint
- Data correction handling pipeline
- Cost tracking and budget alerts

### Phase 4 — Historical Data & Optimisation
- Historical data seeding pipeline
- Participant deduplication and cross-provider mapping
- Smart polling optimisation (contest-aware frequency)
- Ingestion admin dashboard
- Request batching and cost optimisation

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 06-001 | 1 | `SportDataProvider` Protocol interface | Not Started | |
| 06-002 | 1 | `ProviderRegistry` — register, lookup, health report | Not Started | |
| 06-003 | 1 | SportsDataIO golf adapter (first adapter) | Not Started | |
| 06-004 | 1 | Schedule ingestion worker (cron — daily event schedule pull) | Not Started | |
| 06-005 | 1 | Participant ingestion worker (cron — daily profiles/rankings) | Not Started | |
| 06-006 | 1 | `sport_events` database table + migrations | Not Started | |
| 06-007 | 1 | `participant_provider_mappings` table + migrations | Not Started | |
| 06-008 | 1 | `ingestion_jobs` tracking table | Not Started | |
| 06-009 | 1 | Redis caching layer (scores, schedules, profiles) | Not Started | |
| 06-010 | 2 | Live scoring ingestion worker with adaptive polling | Not Started | Sport-specific intervals |
| 06-011 | 2 | StatEvent normalisation and message bus publishing (Redis Streams) | Not Started | |
| 06-012 | 2 | Scoring engine subscription to stat event stream | Not Started | |
| 06-013 | 2 | Stale score detection and UI staleness indicator | Not Started | |
| 06-014 | 2 | Provider health monitoring (HEALTHY/DEGRADED/DOWN) | Not Started | |
| 06-015 | 2 | `provider_health_log` table | Not Started | |
| 06-016 | 3 | Sportradar F1 adapter | Not Started | |
| 06-017 | 3 | SportsDataIO NFL adapter | Not Started | |
| 06-018 | 3 | SportsDataIO NCAA basketball adapter | Not Started | |
| 06-019 | 3 | Sportradar tennis adapter | Not Started | |
| 06-020 | 3 | Equibase horse racing adapter | Not Started | |
| 06-021 | 3 | Fallback provider registration and automatic failover | Not Started | |
| 06-022 | 3 | Webhook receiver endpoint (`POST /api/v1/internal/webhooks/{provider_id}`) | Not Started | |
| 06-023 | 3 | Data correction handling pipeline (is_correction flag → recalculate) | Not Started | |
| 06-024 | 3 | Cost tracking and budget alerts per provider | Not Started | |
| 06-025 | 4 | Historical data seeding pipeline (last 3 seasons per sport) | Not Started | |
| 06-026 | 4 | Participant deduplication and cross-provider mapping | Not Started | |
| 06-027 | 4 | Smart polling optimisation (contest-aware frequency) | Not Started | |
| 06-028 | 4 | Ingestion admin dashboard (provider status, errors, costs) | Not Started | |
| 06-029 | 4 | Request batching and cost optimisation | Not Started | |

---

*Generated by Claude — PoolMaster Sports Data Provider Integration Plan v1.0*
