# Plan 64: SDK Functional Test Suite

## Summary

Create a new **SDK functional test suite** that exercises the full request/response stack through the generated hey-api client SDK, proving contract compliance from TypeScript types through HTTP serialization, Fastify routing, business logic, and persistence — then back through SDK deserialization to typed responses.

This plan is the canonical execution tracker for the functional API suite implementation work.

Plan 66 is the adoption and coordination companion:

- Plan 64 tracks framework and per-domain implementation slices
- Plan 66 tracks rollout decisions, rule ownership, CI adoption, and downstream suite retirement

This suite fills the gap between:
- **Unit tests** (mock dependencies, test logic in isolation)
- **DB integration tests** (use `app.inject()`, bypass HTTP and SDK layers)
- **Smoke tests** (black-box against deployed environments, no SDK, no type checking)

The SDK functional tests are **component tests** in microservice testing terminology — they test the **entire service** end-to-end: CRUD operations, multi-step use-case workflows, business rule enforcement, authorization behavior, error handling, and data integrity — all exercised through the same typed SDK that production clients use.

### What This Tests (Not Just Contracts)

This is not a contract-only test suite. It is a **full behavioral test suite** that happens to use the SDK as its interface. It tests:

1. **CRUD operations**: Create, read, update, delete for every domain object (leagues, contests, entries, squads, roster picks, etc.) — verifying the data round-trips correctly through the entire stack to the database and back.
2. **Use-case workflows**: Multi-step journeys that match documented plan use cases — e.g., "commissioner creates league → invites member → member joins → commissioner creates contest → member creates entry → draft runs → scoring calculates standings."
3. **Business rules**: Validation logic, uniqueness constraints, ownership enforcement, lifecycle state transitions (e.g., contest cannot be edited after lock, entry number auto-increments, one squad per user per league).
4. **Authorization**: Permission checks at every level — unauthenticated rejection, wrong-role rejection, wrong-league rejection, commissioner-only operations.
5. **Error behavior**: Structured error responses for 400, 401, 403, 404, 409 scenarios with correct error codes and shapes.
6. **Data integrity**: After a sequence of operations, query the results and verify the database state matches expectations — scores calculated correctly, standings positions assigned, prizes awarded, audit records created.

### Why This Is Better Than Smoke Tests

| Dimension | Current Smoke Tests | SDK Functional Tests |
|-----------|-------------------|---------------------|
| **Contract enforcement** | None — raw `fetch()` with manual assertions | TypeScript compiler enforces SDK types match API responses |
| **Environment** | Requires deployed services | Runs locally against in-process Fastify (real Postgres) |
| **Speed** | Slow (network, deployment pipeline) | Fast (localhost, same process) |
| **CI position** | Post-deploy only | Pre-push gate (like unit/integration tests) |
| **Failure signal** | "Something broke in production" | "This SDK operation doesn't match the API contract" |
| **Data strategy** | Creates data via raw fetch | Creates data via typed SDK operations |
| **Coverage** | No code coverage collection | Full coverage collection, merges with backend report |

### What This Subsumes

- **Contract test suites** (`api-contracts-web.integration.ts`, `api-contracts-root-admin.integration.ts`) — if the SDK compiles and the typed response is correct, the contract is proven. Separate `.safeParse()` contract tests become redundant.
- **Most API smoke tests** — the smoke suite can be reduced to a thin deployed-environment health check. The heavy use-case validation moves here where it runs faster and with stronger guarantees.

Important clarification:

- success-path contract coverage is largely subsumed by the SDK functional suite
- error-path contract coverage still requires explicit assertions on status and error-envelope shape
- shared helpers should make those error-envelope assertions easy and consistent

---

## Architecture

### Test Execution Model

```
┌─────────────────────────────────────────────────────────┐
│  Test Runner (Jest)                                      │
│                                                          │
│  ┌──────────────┐    HTTP (localhost:0)    ┌──────���────┐│
│  │  hey-api SDK  │ ◄─────────────────────► │  Fastify  ││
│  │  (typed ops)  │    real fetch()          │  (listen) ���│
│  └──────────────┘                          └─────┬─────┘│
│        ▲                                         │      │
│        │ TypeScript types                        │      │
│        │ enforce contract                        ▼      │
│                                            ┌───────────┐│
│                                            │  Prisma   ││
���                                            │  (real PG)││
│                                            └───────────┘│
└──────��─────────────────────────────��────────────────────┘
```

**Key difference from existing integration tests:** Instead of `app.inject()` (which bypasses HTTP serialization and the SDK), the test starts Fastify with `app.listen({ port: 0 })` to get a random available port, then configures the hey-api client to point at `http://localhost:{port}`.

This means the test exercises:
1. SDK operation function call with typed parameters
2. hey-api client serialization (body, headers, query params)
3. Real HTTP transport (localhost)
4. Fastify request parsing, validation, routing
5. Auth guard (real JWT validation)
6. Handler → service → repository → Prisma → Postgres
7. Response serialization through Fastify schema
8. hey-api client response deserialization
9. TypeScript type checking on the returned `data` object

### File Layout

```
tests/
├── functional/                          # NEW — SDK functional tests
│   ├── jest.config.js                   # Jest config for functional suite
│   ├── setup.ts                         # App lifecycle, SDK client setup, shared helpers
│   ├── builders.ts                      # Test data builders using SDK operations
│   ├── auth.functional.ts               # Auth use cases
│   ├── league-lifecycle.functional.ts   # League + membership + invitation use cases
│   ├── squad-management.functional.ts   # Squad creation + co-manager use cases
│   ├── contest-lifecycle.functional.ts  # Contest creation + configuration use cases
│   ├── entry-and-roster.functional.ts   # Entry creation + roster pick use cases
���   ├── draft-flow.functional.ts         # Draft session + pick submission use cases
│   ├── scoring.functional.ts            # Scoring recalculation + standings use cases
│   ├── history.functional.ts            # Completed contest history use cases
│   ├── consent.functional.ts            # Consent + age affirmation use cases
│   ├── notifications.functional.ts      # In-app notification use cases
│   └── admin.functional.ts             # Admin operations use cases
├── integration/                         # EXISTING — Fastify inject + Prisma
├── unit/                                # EXISTING — mocked unit tests
└── api/                                 # EXISTING — deployed smoke tests (to be reduced)
```

### Test Naming Convention

Files use `.functional.ts` suffix to distinguish from `.integration.ts` (inject-based) and `.test.ts` (unit) and `.smoke.ts` (deployed).

---

## Setup Infrastructure

### `tests/functional/setup.ts`

```typescript
import Fastify, { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createClient, createConfig } from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@hey-api/client-fetch';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

// Import all modules (same as integration helpers.ts)
import { authModule } from '../../packages/core-api/src/modules/auth/routes';
// ... all other module imports ...

const JWT_SECRET = 'poolmaster-dev-secret-change-in-production';

let app: FastifyInstance;
let prisma: PrismaClient;
let baseUrl: string;
let sdkClient: Client;

export function getApp(): FastifyInstance { return app; }
export function getPrisma(): PrismaClient { return prisma; }
export function getBaseUrl(): string { return baseUrl; }
export function getSdkClient(): Client { return sdkClient; }

/**
 * Create an SDK client configured for the test server with auth token.
 */
export function createAuthenticatedClient(accessToken: string): Client {
  const client = createClient(createConfig({
    baseUrl,
  }));
  client.interceptors.request.use((request) => {
    request.headers.set('Authorization', `Bearer ${accessToken}`);
    return request;
  });
  return client;
}

/**
 * Start Fastify on a random port and configure the SDK client.
 *
 * Decision:
 * - boot one shared app instance for the whole functional suite
 * - use suite-level setup/teardown rather than cold-starting per file
 * - keep `maxWorkers: 1` and enforce stronger cleanup/isolation discipline
 */
export async function setupFunctionalTests(): Promise<void> {
  prisma = new PrismaClient();
  await prisma.$connect();

  app = await buildTestApp(); // Same as integration helpers
  await app.listen({ port: 0 }); // Random available port

  const address = app.server.address();
  const port = typeof address === 'object' ? address?.port : 0;
  baseUrl = `http://localhost:${port}`;

  // Default unauthenticated SDK client
  sdkClient = createClient(createConfig({ baseUrl }));
}

export async function teardownFunctionalTests(): Promise<void> {
  await cleanupTestData();
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
}
```

Functional test setup should be built tenant-free from the start.

- Do not design the harness around `ensureTestTenant()` or tenant-scoped cleanup helpers.
- Use test-created identifiers and deterministic cleanup scopes that will survive Plan 63 without rework.
- If a temporary bridge to existing helper code is unavoidable during the pilot, keep it narrow and mark it as migration debt in the slice notes.

### `tests/functional/builders.ts`

Test data builders that use SDK operations to create data — proving the SDK works as part of setup.

Builders must fail loudly with descriptive setup errors if a prerequisite SDK operation does not return data.

```typescript
import { createAuthenticatedClient, getPrisma } from './setup';
import {
  registerUser, loginUser, createLeague, generateInviteLink,
  acceptInvitation, createContestManagement, createContestEntry,
} from '@poolmaster/shared/generated/hey-api';

export async function buildAuthenticatedUser(overrides?: {
  email?: string; displayName?: string; password?: string;
}): Promise<{ userId: string; email: string; token: string; client: Client }> {
  const email = overrides?.email ?? `func-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  const password = overrides?.password ?? 'FuncTest123!';

  // Register through SDK
  const { data: regData } = await registerUser({
    client: getSdkClient(),
    body: { email, password, displayName: overrides?.displayName ?? 'Func Test User' },
  });
  if (!regData) throw new Error('Builder: registerUser failed while creating authenticated user');

  // Login through SDK
  const { data: loginData } = await loginUser({
    client: getSdkClient(),
    body: { email, password },
  });
  if (!loginData) throw new Error('Builder: loginUser failed while creating authenticated user');

  const token = loginData.accessToken;
  const client = createAuthenticatedClient(token);

  return { userId: regData.user.id, email, token, client };
}

export async function buildLeagueWithOwner(overrides?: {
  leagueName?: string;
}): Promise<{ owner: AuthResult; league: LeagueResult; ownerClient: Client }> {
  const owner = await buildAuthenticatedUser();
  const { data } = await createLeague({
    client: owner.client,
    body: {
      name: overrides?.leagueName ?? `Func League ${Date.now()}`,
      visibility: 'PRIVATE',
      settings: { invitePolicy: 'COMMISSIONER_ONLY' },
    },
  });
  if (!data) throw new Error('Builder: createLeague failed while creating league owner context');
  return { owner, league: data.league, ownerClient: owner.client };
}

// Additional builders for: contest, entries, sport events, etc.
```

---

## Test File Structure (Use-Case Driven)

Each test file maps to documented use cases from plan companions. Tests walk complete user journeys through the SDK.

## Pilot Slice To Vet The Framework

Before building the full suite, prove the harness on a very small slice covering 1-2 stable API controllers and 1-3 high-signal tests.

This pilot is the canonical scope for Slice 64-A.

### Recommended Pilot Controllers

1. `auth`
- good for proving unauthenticated client setup, authenticated client creation, token handling, and SDK request/response typing

2. `account-consent`
- good for proving a small authenticated CRUD-style flow with persisted data and typed response assertions

### Recommended Pilot Tests

1. `auth.functional.ts`
- `register -> login -> fetch profile succeeds through the SDK`

2. `consent.functional.ts`
- `authenticated user records consent with age affirmation and can read it back`

3. `consent.functional.ts`
- `unauthenticated consent read/write is rejected with the expected status and error shape`

### What The Pilot Must Prove

- Fastify can be started on a random localhost port for the suite
- the generated SDK can target the ephemeral server successfully
- authenticated and unauthenticated SDK clients work correctly
- real HTTP serialization/deserialization is exercised, not `app.inject()`
- persisted state can be verified through follow-up SDK/API reads
- coverage merges correctly with the backend report
- the suite is reliable enough to run in local and CI flows

### Exit Criteria For Expanding Beyond The Pilot

Do not expand into the broader functional API suite until the pilot proves:

- stable app lifecycle setup/teardown
- stable database cleanup/isolation
- a workable authenticated-client helper pattern
- clear assertion style for success and error responses
- successful local and CI execution

### Example: `league-lifecycle.functional.ts`

```typescript
/**
 * SDK Functional Tests: League Lifecycle
 * Proves: Plan 37 — League as top-level boundary
 * Proves: Plan 44 — Commissioner administration
 */
import {
  createLeague, listLeagues, getLeague, updateLeagueSettings,
  generateInviteLink, acceptInvitation, listLeagueMembers,
  updateMemberRole, removeLeagueMember,
} from '@poolmaster/shared/generated/hey-api';
import { buildAuthenticatedUser, buildLeagueWithOwner } from './builders';

describe('League Lifecycle', () => {
  // Plan 37: Commissioner creates league
  it('commissioner creates a private league and sees it in their league list', async () => {
    const { client } = await buildAuthenticatedUser();
    const { data: createData } = await createLeague({
      client,
      body: { name: 'Masters Pool 2026', visibility: 'PRIVATE', settings: { invitePolicy: 'COMMISSIONER_ONLY' } },
    });

    expect(createData?.league.id).toBeDefined();
    expect(createData?.league.name).toBe('Masters Pool 2026');

    // TypeScript enforces: createData.league has all LeagueDto fields
    const { data: listData } = await listLeagues({ client });
    expect(listData?.leagues).toContainEqual(
      expect.objectContaining({ id: createData?.league.id }),
    );
  });

  // Plan 37: Member joins via invitation
  it('member accepts invite link and appears in league member list', async () => {
    const { ownerClient, league } = await buildLeagueWithOwner();

    // Commissioner generates invite link
    const { data: linkData } = await generateInviteLink({
      client: ownerClient,
      path: { id: league.id },
    });
    expect(linkData?.inviteCode).toBeDefined();

    // New user accepts invite
    const member = await buildAuthenticatedUser();
    const { data: acceptData } = await acceptInvitation({
      client: member.client,
      body: { inviteCode: linkData!.inviteCode },
    });
    expect(acceptData?.membership.role).toBe('MEMBER');

    // Commissioner sees member in list
    const { data: membersData } = await listLeagueMembers({
      client: ownerClient,
      path: { id: league.id },
    });
    expect(membersData?.members).toContainEqual(
      expect.objectContaining({ userId: member.userId }),
    );
  });

  // Plan 44: Commissioner promotes member
  it('commissioner promotes member to COMMISSIONER role', async () => { ... });

  // Negative: unauthorized user cannot create league
  it('unauthenticated request returns 401', async () => {
    const { error } = await createLeague({
      client: getSdkClient(), // no auth
      body: { name: 'Should Fail', visibility: 'PRIVATE', settings: { invitePolicy: 'COMMISSIONER_ONLY' } },
    });
    expect(error?.code).toBe('UNAUTHORIZED');
  });
});
```

---

## Required Test Coverage

Each file tests CRUD operations, use-case workflows, business rules, authorization, and error paths for its domain. The table below specifies minimum required test cases per file.

### `auth.functional.ts` — Plan 36

| Category | Test Cases |
|----------|-----------|
| **CRUD** | Register user, fetch profile, update profile |
| **Use Case** | Register → login → fetch profile → refresh token → use new token |
| **Business Rules** | Duplicate email rejected, weak password rejected, email format validated |
| **Auth** | Expired token returns 401, missing token returns 401, refresh with revoked token fails |
| **Error** | Login with wrong password returns structured error, register with existing email returns 409 |

### `league-lifecycle.functional.ts` — Plans 37, 44

| Category | Test Cases |
|----------|-----------|
| **CRUD** | Create league, list leagues, get league by ID, update league settings, delete league |
| **Use Case: Invite Flow** | Create league → generate invite link → second user accepts → both see membership → commissioner sees member list |
| **Use Case: Role Management** | Commissioner promotes member → member has new permissions → commissioner demotes → permissions revoked |
| **Use Case: Member Removal** | Commissioner removes member → member no longer in list → removed member cannot access league |
| **Business Rules** | Private league not visible to non-members, league name required, duplicate invite code rejected |
| **Auth** | Non-member cannot access league, MEMBER cannot promote/demote, only OWNER can delete league |
| **Error** | Get non-existent league returns 404, accept expired invite returns 400 |

### `squad-management.functional.ts` — Plan 37

| Category | Test Cases |
|----------|-----------|
| **CRUD** | Create squad, list squads in league, get squad detail, update squad name, deactivate squad |
| **Use Case: Co-Manager** | Create squad → invite co-manager → co-manager joins → both see squad → co-manager leaves |
| **Business Rules** | One squad per user per league enforced, squad name required, inactive squad cannot accept members |
| **Auth** | Non-league-member cannot create squad, non-squad-member cannot modify squad |
| **Error** | Second squad creation in same league returns 409, join non-existent squad returns 404 |

### `contest-lifecycle.functional.ts` — Plans 38, 53

| Category | Test Cases |
|----------|-----------|
| **CRUD** | Create contest, list contests in league, get contest detail, update contest, delete contest |
| **Use Case: Full Config** | Create contest from sport event → add scoring rules → add aggregation rule → add prize definitions → set lock timing → verify full configuration round-trips |
| **Use Case: Status Transitions** | Contest starts NOT_STARTED → transitions through lifecycle → reaches COMPLETED |
| **Business Rules** | Contest requires sport event, scoring rules validated against registry, aggregation rule one-per-contest, lock time must be future |
| **Auth** | MEMBER cannot create contest (COMMISSIONER required), non-league-member cannot view contest |
| **Error** | Create contest with invalid sport event returns 404, duplicate scoring rule sort order returns 400 |

### `entry-and-roster.functional.ts` — Plan 38

| Category | Test Cases |
|----------|-----------|
| **CRUD** | Create entry, list entries for contest, get entry detail, delete entry, create roster pick, list roster picks, delete roster pick |
| **Use Case: Entry Creation** | Member creates entry → auto-resolves squad → entry number assigned → entry appears in contest entry list |
| **Use Case: Multiple Entries** | Same squad creates second entry → entry numbers are sequential → both entries visible |
| **Use Case: Roster Building** | Create entry → add roster picks → verify picks reference sport event participants → verify unique constraint per entry |
| **Business Rules** | Duplicate sport event participant per entry rejected, entry status defaults to ACTIVE, deleted entry returns 404 on subsequent fetch |
| **Auth** | Non-squad-member cannot modify entry, non-league-member cannot create entry |
| **Error** | Pick non-existent participant returns 404, create entry in locked contest returns 400 |

### `draft-flow.functional.ts` — Plan 38

| Category | Test Cases |
|----------|-----------|
| **CRUD** | Create draft session, get draft room state, submit pick, get draft pick history |
| **Use Case: Snake Draft** | Start session → entries take turns → picks create roster picks + draft pick history → session completes when all picks made |
| **Business Rules** | Pick out of turn rejected, duplicate participant pick rejected, auto-pick on timeout, session state transitions (PENDING → LIVE → COMPLETE) |
| **Auth** | Only entry owner can submit picks for their entry |
| **Error** | Pick after session complete returns 400, pick non-existent participant returns 404 |

### `scoring.functional.ts` — Plan 51

| Category | Test Cases |
|----------|-----------|
| **CRUD** | Read entry scores, read participant score events, read standings |
| **Use Case: Recalculation** | Contest with entries and picks → trigger recalculation → verify totalScore updated on entries → verify standingsPosition assigned → verify participant scores match scoring rules |
| **Use Case: Prize Awards** | Configure prizes → recalculate → verify prize awards created for qualifying entries |
| **Business Rules** | Standings positions handle ties (same score = same rank), scores match configured scoring rules (GOLF_RELATIVE_TO_PAR, TEAM_WIN_POINTS, etc.), aggregation respects SUM_ALL vs SUM_TOP_N |
| **Data Integrity** | After recalculation: query entries directly and verify totalScore, standingsPosition, and ContestEntryParticipantScore records match expectations |

### `history.functional.ts` — Plans 41, 42

| Category | Test Cases |
|----------|-----------|
| **CRUD** | Get contest history summary, get contest standings, get entry roster detail, get prize payouts, get league-level results, get member-level results |
| **Use Case: Review Completed Contest** | Complete a contest → fetch summary → verify all entries with final standings → fetch roster detail → verify participant performance data |
| **Business Rules** | History only available for COMPLETED contests, history reflects final state (not intermediate) |
| **Auth** | League member can view history, non-member cannot |

### `consent.functional.ts` — Plan 58

| Category | Test Cases |
|----------|-----------|
| **CRUD** | Record consent, fetch consent history |
| **Use Case** | Register → record consent with age affirmation → verify consent in history → record updated consent version → verify both records in history |
| **Business Rules** | Consent type validated, age threshold recorded |

### `notifications.functional.ts`

| Category | Test Cases |
|----------|-----------|
| **CRUD** | List notifications, get unread count, mark notification read, mark all read, dismiss notification |
| **Business Rules** | Unread count decrements after mark-read, dismissed notifications excluded from list |

### `admin.functional.ts` — Plan 46

| Category | Test Cases |
|----------|-----------|
| **CRUD** | List users, get user detail, list providers, get provider detail, list contests (admin view) |
| **Use Case: Provider Operations** | Admin views provider health → triggers sync → verifies ingestion job created |
| **Auth** | Non-admin token rejected, VIEWER role cannot trigger mutations, SUPER_ADMIN can do everything |
| **Error** | Admin operations with user JWT (not admin JWT) return 401 |

---

## Jest Configuration

### `tests/functional/jest.config.js`

```javascript
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '../..',
  testMatch: ['<rootDir>/tests/functional/**/*.functional.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tests/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@poolmaster/shared/(.*)$': '<rootDir>/packages/shared/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFilesAfterFramework: [],
  testTimeout: 30_000,
  maxWorkers: 1, // Serial — shared database
  collectCoverageFrom: [
    '<rootDir>/packages/core-api/src/**/*.ts',
    '<rootDir>/packages/shared/**/*.ts',
    '!**/*.d.ts',
    '!**/dist/**',
    '!**/generated/**',
    '!**/node_modules/**',
  ],
};
```

### Global Setup/Teardown

Decision:

- use a shared suite-level app boot instead of cold-starting per file
- prefer Jest `globalSetup` / `globalTeardown` or an equivalent single-boot harness pattern
- keep per-file cleanup deterministic so shared-process leakage is caught early

Do not make each `.functional.ts` file boot and tear down its own Fastify instance unless the shared harness proves unworkable.

### Error-Envelope Assertion Pattern

Add a small shared helper for non-2xx SDK responses so error-path assertions stay explicit and consistent.

Example direction:

```typescript
expectErrorEnvelope(error, {
  status: 401,
  code: 'UNAUTHORIZED',
});
```

This is the preferred replacement for broad standalone contract suites on error paths.

---

## npm Scripts

Add to root `package.json`:

```json
{
  "test:service:functional-api": "jest --config tests/functional/jest.config.js --forceExit",
  "test:coverage:service:functional-api": "jest --config tests/functional/jest.config.js --forceExit --coverage --coverageReporters json-summary json lcovonly text-summary",
  "test:coverage:service:merged": "node scripts/run-backend-coverage.mjs"
}
```

Update `scripts/run-backend-coverage.mjs` to merge three sources:
1. Unit test coverage
2. DB integration test coverage
3. **SDK functional test coverage** (NEW)

---

## CI Integration

### Changes to `.github/workflows/ci.yml`

Add the functional test suite to the existing `test` job (which already has a Postgres service container):

```yaml
# After existing unit + integration test steps:
- name: Run SDK functional tests
  env:
    DATABASE_URL: postgresql://poolmaster:poolmaster@localhost:5432/poolmaster_test
    JWT_SECRET: poolmaster-dev-secret-change-in-production
  run: npm run test:coverage:service:functional-api

# Update coverage merge step to include functional coverage
- name: Build merged service coverage
  run: npm run test:coverage:service:merged
```

The functional tests run **pre-push** (same as unit and integration), not post-deploy like smoke tests.

---

## Local Development Workflow

### Required Gates on `codex-backend-refactor-lane`

Update `rules/workflow-rules.md` backend-first gates to include:

```
Required gates on that branch are:
  1. backend/shared typecheck
  2. backend/shared lint
  3. backend unit tests
  4. DB-backed integration tests
  5. service functional API tests             ← NEW
  6. merged service coverage via npm run test:coverage:service:merged
  7. OpenAPI export/validation when API shapes change
  ...
```

### Developer Commands

```bash
# Run just service functional API tests
npm run test:service:functional-api

# Run service functional API tests with coverage
npm run test:coverage:service:functional-api

# Run merged service coverage (unit + integration + functional API)
npm run test:coverage:service:merged

# Run a single functional test file
npx jest --config tests/functional/jest.config.js tests/functional/league-lifecycle.functional.ts
```

---

## Relationship to Existing Test Suites

### What Changes

| Suite | Before | After |
|-------|--------|-------|
| **Unit tests** | Unchanged | Unchanged — still test service logic with mocks |
| **DB integration tests** | Primary API test surface | Narrowed to repository-level and persistence-edge-case coverage |
| **SDK functional tests** | Does not exist | **Primary behavioral test surface** — CRUD, use-case workflows, business rules, auth, errors, data integrity |
| **Contract tests** | Required but missing | **Subsumed** — SDK type checking proves the contract; functional tests prove the behavior |
| **API smoke tests** | Use-case validation against deployed env | **Reduced** to thin deployment health check. Heavy use-case validation moves here. |
| **Browser E2E** | Unchanged | Unchanged — still validates UI flows in browser |

### What Gets Removed/Reduced

1. **Contract test suites** (`api-contracts-web.integration.ts`, `api-contracts-root-admin.integration.ts`) — no longer needed. The SDK functional tests prove the contract by using the SDK. If TypeScript compiles and the test passes, the contract is valid.

2. **API smoke tests** — reduce to a minimal deployed-environment health check:
   - `health.smoke.ts` — health endpoint returns 200
   - `auth-roundtrip.smoke.ts` — register + login + profile works on deployed env
   - `league-create.smoke.ts` — one league creation proves the deployed stack is wired
   - Remove `mvp-baseline.smoke.ts` and `contest-lifecycle.smoke.ts` (their coverage moves to functional suite)

3. **Some DB integration tests** — tests that duplicate what the functional suite proves through the SDK can be removed. Keep integration tests that:
   - Test repository methods directly (not through HTTP)
   - Test edge cases in persistence logic
   - Test database constraints and index behavior

---

## Implementation Slices

### Slice 64-A: Framework + Pilot (Do This First)

Goal: Establish the test infrastructure and prove it works end-to-end with the pilot scope:

- `auth`
- `account-consent`
- one shared-harness proof

**Step 1: Create Jest config** — `tests/functional/jest.config.js`

```javascript
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '../..',
  testMatch: ['<rootDir>/tests/functional/**/*.functional.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tests/tsconfig.json',
      // hey-api uses .js extensions in imports; ts-jest needs this:
      diagnostics: { ignoreDiagnostics: [2307] },
    }],
  },
  moduleNameMapper: {
    // Map @poolmaster/shared/* to source (not dist)
    '^@poolmaster/shared/(.*)$': '<rootDir>/packages/shared/$1',
    // Strip .js extensions from hey-api generated imports
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testTimeout: 30_000,
  maxWorkers: 1,
  collectCoverageFrom: [
    '<rootDir>/packages/core-api/src/**/*.ts',
    '<rootDir>/packages/shared/**/*.ts',
    '!**/*.d.ts',
    '!**/dist/**',
    '!**/generated/**',
    '!**/node_modules/**',
  ],
};
```

Key concerns:
- hey-api generated code uses `.js` extensions in relative imports (`./client/index.js`). The `moduleNameMapper` strips these for ts-jest.
- Node 23 has native `fetch` — no polyfill needed.
- `maxWorkers: 1` because tests share the database.

**Step 2: Create setup module** — `tests/functional/setup.ts`

This module:
1. Boots a real Fastify app with all modules (reuses the same `buildTestApp()` pattern from `tests/integration/helpers.ts`)
2. Calls `app.listen({ port: 0 })` to bind to a random port (unlike integration tests which use `inject`)
3. Creates a hey-api SDK client pointing at `http://localhost:{port}`
4. Exposes helpers: `getApp()`, `getPrisma()`, `getBaseUrl()`, `getSdkClient()`, `createAuthenticatedClient(token)`
5. Uses a shared suite-level boot pattern rather than per-file cold starts
6. Cleanup in `teardown` closes the server and cleans test data without tenant-scoped assumptions

Key difference from integration helpers: the Fastify app **listens on a real port** so the SDK's `fetch()` can reach it over HTTP.

**Step 3: Create builders module** — `tests/functional/builders.ts`

Initial builders (just enough for the pilot):
- `buildRegisteredUser(overrides?)` — calls `registerUser` SDK op, returns `{ userId, email, token, client }`
- `buildLeagueWithOwner(overrides?)` — calls `buildRegisteredUser` + `createLeague`, returns `{ owner, league, ownerClient }`

Builders use SDK operations (not Prisma) so they are themselves testing the create path.
Builders must fail loudly with descriptive setup errors if a prerequisite SDK operation does not return data.

**Step 4: Create pilot tests**

Pilot file set:

- `auth.functional.ts`
- `consent.functional.ts`

These files prove the framework by testing:

```
describe('SDK Functional: Auth')
  └── it('register -> login -> fetch profile succeeds through the SDK')

describe('SDK Functional: Consent')
  ├── it('authenticated user records consent with age affirmation and can read it back')
  └── it('unauthenticated consent read/write is rejected with the expected status and error shape')
```

This pilot is intentionally small. The broader league-lifecycle proof-of-concept moves to Slice 64-B.

**Step 5: Add npm scripts** — update root `package.json`

```json
"test:service:functional-api": "jest --config tests/functional/jest.config.js --forceExit",
"test:coverage:service:functional-api": "jest --config tests/functional/jest.config.js --forceExit --coverage --coverageReporters json-summary json lcovonly text-summary"
```

**Step 6: Update coverage merge from day one**

Update `scripts/run-backend-coverage.mjs` during the pilot slice so functional coverage is part of the merged report immediately rather than waiting until the final slice.

**Step 7: Verify it runs**

```bash
# Requires Postgres running (docker-compose.dev.yml or local)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster npm run test:service:functional-api
```

**Success criteria for Slice 64-A:**
- [ ] Jest config compiles and discovers `.functional.ts` files
- [ ] hey-api SDK imports resolve correctly (no `.js` extension errors)
- [ ] Fastify boots once and listens on a random port for the shared suite
- [ ] SDK client can reach the server via HTTP
- [ ] `registerUser` + `loginUser` + `getCurrentUser` works through SDK
- [ ] consent write/read works through SDK with persisted verification
- [ ] unauthenticated consent request returns error envelope (not crash)
- [ ] Coverage collection and merge work
- [ ] Pilot tests pass locally and in CI

---

### Slice 64-B: Core Domain Tests
- Expand `auth.functional.ts` — full auth CRUD + error paths
- Create `league-lifecycle.functional.ts` — league CRUD + invitation + member lifecycle
- `squad-management.functional.ts` — squad CRUD + co-manager workflow + one-per-league enforcement
- Expand `consent.functional.ts` — consent recording + history depth
- Expand builders as needed

### Slice 64-C: Contest Domain Tests
- `contest-lifecycle.functional.ts` — contest CRUD + configuration + scoring rules + prizes
- `entry-and-roster.functional.ts` — entry CRUD + roster picks + business rules
- `draft-flow.functional.ts` — draft session lifecycle + pick submission

### Slice 64-D: Scoring, History, Notifications
- `scoring.functional.ts` — recalculation + standings + data integrity
- `history.functional.ts` — completed contest queries
- `notifications.functional.ts` — notification CRUD

### Slice 64-E: Admin + Integration
- `admin.functional.ts` — admin operations + auth boundaries
- Update CI workflow
- Reduce smoke suite
- Update rules

---

## Rule Updates Required

When this plan is executed, update:

1. **`rules/testing-rules.md`** §2 (Test Layers) — add SDK Functional row to the backend table
2. **`rules/testing-rules.md`** §3 (Quality Gates) — add functional tests to required gates
3. **`rules/testing-rules.md`** §4 (Contract Testing) — note that SDK functional tests subsume contract suites
4. **`rules/testing-rules.md`** §6 (Smoke and E2E) — reduce smoke scope, reference functional suite for use-case coverage
5. **`rules/workflow-rules.md`** — update active quality gates and references once the suite is adopted
6. **`rules/model-change-rules.md`** — update test checklist to reference functional tests

Cross-rule/docs adoption is coordinated in Plan 66.

---

## Action Plan

| ID | Slice | Task | Status | Notes |
|---|---|---|---|---|
| 64-A01 | A | Create `tests/functional/jest.config.js` | Done | Added shared functional Jest config with `.js` extension remapping and dedicated functional tsconfig using DOM libs for generated hey-api types. |
| 64-A02 | A | Create `tests/functional/setup.ts` — shared app lifecycle, `listen({ port: 0 })`, SDK client factory | Done | Added shared server boot/teardown, SDK client helpers, deterministic email generation, and cleanup helpers keyed to functional test run ids. |
| 64-A03 | A | Create `tests/functional/builders.ts` — `buildRegisteredUser`, `buildLeagueWithOwner` | Done | Added builder helpers that use generated SDK operations and throw descriptive setup failures instead of null dereferences. |
| 64-A04 | A | Add `test:service:functional-api` and `test:coverage:service:functional-api` npm scripts | Done | Root `package.json` now exposes the service functional API test and coverage entry points. |
| 64-A05 | A | Create pilot `auth.functional.ts` and `consent.functional.ts` | Done | Pilot covers register-login-profile, consent write/read, and unauthenticated consent error paths through the generated SDK. |
| 64-A06 | A | Update `scripts/run-backend-coverage.mjs` to merge functional coverage from day one | Done | Added a dedicated functional coverage wrapper that instruments the spawned Fastify server with V8 coverage, converts it to Istanbul output, and merges it into the renamed `service` coverage report with real functional attribution. |
| 64-A07 | A | Verify pilot tests pass against local Postgres and CI | In Progress | Local Postgres pilot passes. CI integration for the functional suite remains part of later adoption work in Slice `64-E02`. |
| 64-B01 | B | Expand `auth.functional.ts` — full auth CRUD + token refresh + error paths | Not Started | |
| 64-B02 | B | Create `league-lifecycle.functional.ts` — league CRUD + invitation + member lifecycle | Not Started | Broader workflow moved here from the original proof-of-concept |
| 64-B03 | B | Create `squad-management.functional.ts` — CRUD + co-manager + one-per-league | Not Started | |
| 64-B04 | B | Expand `consent.functional.ts` — record + history depth | Not Started | |
| 64-C01 | C | Create `contest-lifecycle.functional.ts` — CRUD + config + scoring rules + prizes | Not Started | |
| 64-C02 | C | Create `entry-and-roster.functional.ts` — entry CRUD + roster picks + rules | Not Started | |
| 64-C03 | C | Create `draft-flow.functional.ts` — session lifecycle + pick submission | Not Started | |
| 64-D01 | D | Create `scoring.functional.ts` — recalculation + standings + data integrity | Not Started | |
| 64-D02 | D | Create `history.functional.ts` — completed contest queries | Not Started | |
| 64-D03 | D | Create `notifications.functional.ts` — notification CRUD | Not Started | |
| 64-E01 | E | Create `admin.functional.ts` — admin ops + auth boundaries | Not Started | |
| 64-E02 | E | Update CI workflow (`.github/workflows/ci.yml`) to run functional tests | Not Started | |
| 64-E03 | E | Reduce API smoke suite to thin deployment health checks | Not Started | |
| 64-E04 | E | Prune redundant integration tests once functional coverage replaces their signal | Not Started | Keep repository/persistence-edge coverage that still adds signal |
