# Ultimate Pool Manager — Bracket Contest Plan

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

## Overview

Bracket contests allow users to predict tournament outcomes by filling out a bracket (e.g., NCAA March Madness, NBA Playoffs, Champions League knockout). Users submit all predictions before the tournament begins, and points are awarded as each round resolves. This plan covers completing the bracket feature end-to-end: backend API, service layer, database persistence, webapp integration, admin management, and comprehensive testing.

**Supported bracket formats:**
- NCAA March Madness (64-team, 6 rounds)
- NBA Playoffs (16-team, 4 rounds)
- Champions League Knockout (16-team, 4 rounds)
- Tennis Grand Slams (128-player, 7 rounds)
- Any configurable bracket size

---

## 1. Current State (~45% complete)

### Already Built

| Component | File | Status |
|---|---|---|
| Domain types (BracketPrediction, BracketMatchPrediction) | `packages/shared/domain/types.ts` | Done |
| Enums (BRACKET_PICK_EM, BRACKET scoring engine) | `packages/shared/domain/enums.ts` | Done |
| Scoring config schemas (BracketRoundRule, UpsetBonus, Tiebreaker) | `packages/shared/domain/scoring-config.ts` | Done |
| NCAA scoring templates (4 variants) | `packages/core-api/src/modules/scoring/templates/ncaa.ts` | Done |
| Selection templates (NCAA-64, Tennis, Soccer, NBA) | `packages/core-api/src/modules/drafts/templates/selection-templates.ts` | Done |
| Bracket engine (validate, submit, scoreRound, leaderboard) | `packages/core-api/src/modules/drafts/engine/bracket-engine.ts` | Done |
| Bracket scoring (round points, upset bonus, series/score bonus) | `packages/core-api/src/modules/scoring/engine/bracket-scoring.ts` | Done |
| Prisma model (BracketPrediction with JSON predictions) | `packages/core-api/prisma/schema.prisma` | Done |
| Contest creation accepts BRACKET_PICK_EM | `packages/core-api/src/modules/contests/routes.ts` | Done |
| Bracket UI panel (visual bracket, selection, auto-fill) | `clients/web/src/features/draft-room/bracket-panel.tsx` | Partial (no API) |
| Unit tests for bracket engine | `tests/unit/draft-service/bracket-engine.test.ts` | Done |

### Gaps to Fill

| Component | Status |
|---|---|
| Bracket API routes (submit, get, standings, score-round) | Not Started |
| BracketService (orchestration + persistence) | Not Started |
| BracketPredictionRepository (Prisma data access) | Not Started |
| Bracket submission page (webapp) | Not Started |
| Bracket results/standings page (webapp) | Not Started |
| Bracket UI wired to API | Not Started |
| Admin bracket management (score rounds, view all predictions) | Not Started |
| Integration tests | Not Started |
| Smoke tests (API) | Not Started |
| E2E tests (Playwright) | Not Started |

---

## 2. Data Model

### Existing Prisma Model

```prisma
model BracketPrediction {
  id               String   @id @default(uuid()) @db.Uuid
  entryId          String   @unique @map("entry_id") @db.Uuid
  contestId        String   @map("contest_id") @db.Uuid
  predictions      Json     @default("[]")
  submittedAt      DateTime @default(now())
  tiebreakerValue  Int?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  entry   ContestEntry @relation(fields: [entryId], references: [id])
  contest Contest      @relation(fields: [contestId], references: [id])
  @@index([contestId])
  @@map("bracket_predictions")
}
```

### New Model: BracketRoundResult

Store actual tournament results per round for scoring:

```prisma
model BracketRoundResult {
  id            String   @id @default(uuid()) @db.Uuid
  contestId     String   @map("contest_id") @db.Uuid
  roundNumber   Int      @map("round_number")
  matchNumber   Int      @map("match_number")
  winnerId      String   @map("winner_id") @db.Uuid
  winnerSeed    Int?     @map("winner_seed")
  loserSeed     Int?     @map("loser_seed")
  seriesLength  Int?     @map("series_length")
  score         String?
  scoredAt      DateTime @default(now()) @map("scored_at") @db.Timestamptz
  contest Contest @relation(fields: [contestId], references: [id])
  @@unique([contestId, roundNumber, matchNumber])
  @@map("bracket_round_results")
}
```

---

## 3. Backend Implementation

### Phase 1: Repository Layer

**File:** `packages/core-api/src/modules/bracket/bracket-repository.ts`

```typescript
export class BracketRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async submitPrediction(entryId: string, contestId: string, predictions: BracketMatchPrediction[], tiebreakerValue?: number): Promise<BracketPrediction>;
  async getPrediction(entryId: string): Promise<BracketPrediction | null>;
  async getPredictionsByContest(contestId: string): Promise<BracketPrediction[]>;
  async updatePrediction(entryId: string, predictions: BracketMatchPrediction[]): Promise<BracketPrediction>;

  async saveRoundResult(contestId: string, result: { roundNumber: number; matchNumber: number; winnerId: string; winnerSeed?: number; loserSeed?: number; seriesLength?: number; score?: string }): Promise<void>;
  async getRoundResults(contestId: string, roundNumber?: number): Promise<BracketRoundResult[]>;
}
```

### Phase 2: Service Layer

**File:** `packages/core-api/src/modules/bracket/bracket-service.ts`

```typescript
export class BracketService {
  constructor(
    private readonly repository: BracketRepository,
    private readonly prisma: PrismaClient,
  ) {}

  // User operations
  async submitBracket(entryId: string, contestId: string, predictions: BracketMatchPrediction[], tiebreakerValue?: number): Promise<BracketPrediction>;
  async getMyPrediction(entryId: string): Promise<BracketPrediction | null>;
  async canSubmit(contestId: string): Promise<boolean>; // check lock time

  // Scoring operations (admin/system)
  async scoreRound(contestId: string, roundNumber: number, results: MatchResult[]): Promise<ScoringResult>;
  async getStandings(contestId: string): Promise<BracketStanding[]>;
  async getLeaderboard(contestId: string): Promise<BracketLeaderboardEntry[]>;

  // Admin operations
  async getAllPredictions(contestId: string): Promise<BracketPrediction[]>;
  async getBracketLayout(contestId: string): Promise<BracketLayout>;
  async getPopularPicks(contestId: string, roundNumber: number): Promise<PopularPick[]>;
}
```

**Validation rules:**
- Cannot submit after contest lock time
- One prediction per entry (upsert)
- All matchups must be filled
- Winner of each match must come from that match's participants
- Tiebreaker value required if contest config demands it

### Phase 3: API Routes

**File:** `packages/core-api/src/modules/bracket/routes.ts`

```
POST   /api/v1/contests/:contestId/bracket           → Submit bracket prediction
GET    /api/v1/contests/:contestId/bracket/mine       → Get my prediction
GET    /api/v1/contests/:contestId/bracket/standings   → Get bracket standings/leaderboard
GET    /api/v1/contests/:contestId/bracket/layout      → Get bracket layout (teams, seeds, rounds)
GET    /api/v1/contests/:contestId/bracket/results     → Get scored round results
GET    /api/v1/contests/:contestId/bracket/popular     → Popular picks per round (after lock)

// Admin routes
POST   /api/v1/admin/contests/:contestId/bracket/score-round  → Score a round (enter results)
GET    /api/v1/admin/contests/:contestId/bracket/predictions   → View all submitted predictions
GET    /api/v1/admin/contests/:contestId/bracket/analytics     → Pick distribution, upset impact
```

Register in `packages/core-api/src/index.ts`.

### Phase 4: Bracket Layout Service

**File:** `packages/core-api/src/modules/bracket/bracket-layout-service.ts`

Generates the bracket structure from the contest's participant pool:

```typescript
export class BracketLayoutService {
  // Build bracket from participant pool (seeded teams)
  async buildLayout(contestId: string): Promise<BracketLayout>;

  // Get bracket with current results overlaid
  async getLayoutWithResults(contestId: string): Promise<BracketLayoutWithResults>;
}

interface BracketLayout {
  totalRounds: number;
  totalTeams: number;
  rounds: BracketRound[];
}

interface BracketRound {
  roundNumber: number;
  roundName: string; // "Round of 64", "Sweet 16", etc.
  matchups: BracketMatchup[];
}

interface BracketMatchup {
  matchNumber: number;
  topSeed: { participantId: string; name: string; seed: number };
  bottomSeed: { participantId: string; name: string; seed: number };
  winner?: { participantId: string; name: string };
}
```

---

## 4. Webapp Implementation

### Phase 5: Bracket Submission Page

**File:** `clients/web/src/pages/contests/bracket.tsx`
**Route:** `/contests/:contestId/bracket`

- Full bracket visualization (reuse existing bracket-panel.tsx)
- Click team to advance through rounds
- Auto-fill by seed button
- Reset button
- Tiebreaker input (championship game total)
- Lock time countdown
- Submit button (disabled after lock time)
- Confirmation dialog before submit
- Success toast after submission

### Phase 6: Bracket Hooks

**File:** `clients/web/src/features/bracket/hooks/use-bracket.ts`

```typescript
export function useBracketLayout(contestId: string);     // GET layout
export function useMyBracketPrediction(contestId: string); // GET my prediction
export function useBracketStandings(contestId: string);   // GET standings
export function useBracketResults(contestId: string);     // GET round results
export function useSubmitBracket();                        // POST mutation
```

### Phase 7: Bracket Results/Standings Page

**File:** `clients/web/src/pages/contests/bracket-results.tsx`
**Route:** `/contests/:contestId/bracket/results`

- Bracket with actual results overlaid (green = correct, red = wrong)
- Standings table: rank, entry name, correct picks, total score
- Round-by-round breakdown per entry
- Popular picks chart (% who picked each team per matchup)
- My bracket vs actual comparison view

### Phase 8: Bracket Integration in Contest Detail

Update `clients/web/src/pages/contests/detail.tsx`:
- If contest is BRACKET_PICK_EM:
  - Show "Fill Out Bracket" CTA before lock time
  - Show "View Bracket" link after submission
  - Show bracket standings in standings tab
  - Show round-by-round results as they resolve

### Phase 9: Update Routes

Add bracket routes to `clients/web/src/routes/index.tsx`:
```
/contests/:contestId/bracket         → bracket submission page
/contests/:contestId/bracket/results → bracket results page
```

---

## 5. Admin Webapp Implementation

### Phase 10: Admin Bracket Management

**File:** `clients/admin/src/pages/contests/bracket.tsx`
**Route:** `/admin/contests/:contestId/bracket`

- View all submitted predictions (count, % filled)
- Score round form: for each matchup, select winner + optional series length/score
- "Score Round N" button with confirmation
- View bracket analytics: popular picks, upset impact
- Auto-score option (if results available from ingestion)

### Phase 11: Admin Bracket Hooks

**File:** `clients/admin/src/hooks/use-bracket-admin.ts`

```typescript
export function useBracketPredictions(contestId: string);  // GET all predictions
export function useBracketAnalytics(contestId: string);    // GET analytics
export function useScoreRound();                           // POST mutation
```

### Phase 12: Admin Routes

Add to `clients/admin/src/routes/index.tsx`:
```
/admin/contests/:contestId/bracket → admin bracket management
```

---

## 6. Testing

### Phase 13: Unit Tests

**File:** `tests/unit/core-api/bracket-service.test.ts`
- Test submitBracket validation (lock time, completeness, duplicate matchups)
- Test canSubmit (before/after lock)
- Test prediction upsert (update existing)
- Test tiebreaker requirement

**File:** `tests/unit/core-api/bracket-repository.test.ts`
- Test Prisma operations (submit, get, getByContest)
- Test round result save/retrieve
- Test unique constraints

**File:** `tests/unit/core-api/bracket-layout-service.test.ts`
- Test layout generation from 64, 32, 16 team pools
- Test seed ordering
- Test round name generation

### Phase 14: Integration Tests

**File:** `tests/integration/bracket-workflow.test.ts`
- Full workflow: create contest → submit bracket → score rounds → check standings
- Multiple entries submitting brackets
- Score round 1 → verify partial scores
- Score all rounds → verify final standings with tiebreaker
- Test lock time enforcement
- Test upset bonus calculation

### Phase 15: API Smoke Tests

**File:** `tests/api/bracket.smoke.ts`
- POST bracket submission returns 201
- GET my prediction returns submitted data
- GET standings returns ranked entries
- POST score-round updates standings
- GET layout returns valid bracket structure
- Verify 403 after lock time
- Verify 400 for incomplete bracket

### Phase 16: E2E Tests (Playwright)

**File:** `clients/web/e2e/bracket.spec.ts`
- Navigate to bracket contest
- Fill out bracket by clicking teams
- Use auto-fill by seed
- Submit bracket
- Verify submission confirmation
- View bracket results after scoring
- Check standings page
- Verify correct/incorrect pick highlighting

---

## 7. Scoring Variants

### Standard (NCAA March Madness)
| Round | Points |
|---|---|
| Round of 64 | 1 |
| Round of 32 | 2 |
| Sweet 16 | 4 |
| Elite Eight | 8 |
| Final Four | 16 |
| Championship | 32 |

### Upset Bonus
- Seed Difference: bonus = winner_seed - loser_seed (e.g., 15 over 2 = +13)
- Seed Multiplier: points = round_value × winner_seed (e.g., 15-seed correct in R1 = 15 pts)

### Series Length Bonus (NBA/NHL)
- Correct series length prediction: +1 or +2 bonus per correct prediction

### Correct Score Bonus (Soccer)
- Predict exact match score: +3 bonus

### Flat Scoring
- 1 point per correct pick regardless of round

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 20-001 | 1 | Add `BracketRoundResult` Prisma model + migration | Not Started | |
| 20-002 | 1 | Create `BracketRepository` (Prisma data access) | Not Started | |
| 20-003 | 2 | Create `BracketService` (submit, score, standings, canSubmit) | Not Started | |
| 20-004 | 2 | Create `BracketLayoutService` (generate bracket from participant pool) | Not Started | |
| 20-005 | 3 | Create bracket API routes (submit, get, standings, layout, results) | Not Started | |
| 20-006 | 3 | Create admin bracket API routes (score-round, predictions, analytics) | Not Started | |
| 20-007 | 3 | Register bracket module in core-api index.ts | Not Started | |
| 20-008 | 5 | Create bracket submission page (`/contests/:id/bracket`) | Not Started | |
| 20-009 | 6 | Create bracket hooks (use-bracket.ts) | Not Started | |
| 20-010 | 7 | Create bracket results/standings page | Not Started | |
| 20-011 | 8 | Integrate bracket into contest detail page (CTA, standings tab) | Not Started | |
| 20-012 | 9 | Add bracket routes to webapp router | Not Started | |
| 20-013 | 10 | Create admin bracket management page | Not Started | |
| 20-014 | 11 | Create admin bracket hooks (use-bracket-admin.ts) | Not Started | |
| 20-015 | 12 | Add admin bracket route to admin router | Not Started | |
| 20-016 | 13 | Unit tests: BracketService validation and business logic | Not Started | |
| 20-017 | 13 | Unit tests: BracketRepository Prisma operations | Not Started | |
| 20-018 | 13 | Unit tests: BracketLayoutService generation | Not Started | |
| 20-019 | 14 | Integration tests: full bracket workflow (submit → score → standings) | Not Started | |
| 20-020 | 14 | Integration tests: lock time enforcement and upset bonus | Not Started | |
| 20-021 | 15 | API smoke tests: all bracket endpoints | Not Started | |
| 20-022 | 16 | E2E tests: bracket submission and results (Playwright) | Not Started | |

---

*Ultimate Pool Manager — Bracket Contest Plan v1.0*
