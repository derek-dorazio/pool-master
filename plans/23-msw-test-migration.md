# Plan 23: Migrate to MSW (Mock Service Worker) for API Test Interception

## Problem

Tests mock `@/lib/api-client` at the module level via `vi.mock()`, which replaces the entire `api` object. The real `fetch` never fires, so path mismatches between frontend and backend are invisible to tests. We had a real bug where login called `/api/auth/login` but the backend served `/api/v1/auth/login` — tests passed because both the code and the test assertion had the same wrong path.

## Solution

Replace module-level API mocks with [MSW (Mock Service Worker)](https://mswjs.io/) which intercepts HTTP requests at the network level. The real `api-client.ts` code runs unmodified — MSW only intercepts the outgoing `fetch` request. If the frontend path doesn't match an MSW handler, the test fails immediately.

## How This Prevents Path Mismatches

1. **MSW intercepts real fetch calls.** `api-client.ts` constructs `${API_BASE}${path}` and calls `fetch()`. MSW intercepts at the network level.
2. **`onUnhandledRequest: 'error'` catches mismatches.** If a test triggers `/api/auth/login` but the handler is at `/api/v1/auth/login`, MSW throws: `"Found a request without a matching handler"`.
3. **Shared route constants** — both MSW handlers and the backend import from `packages/shared/src/api-routes.ts`.
4. **CI route sync check** catches drift even if someone adds a backend route without updating shared constants.

## Research Findings

### Current Mocking Patterns

**15 files mock `@/lib/api-client` directly** — these are the migration targets:
- 3 web integration tests (auth-flow, contest-create-flow, league-create-flow)
- 4 web page tests (login, register, contests/create, leagues/create)
- 1 admin hook test (use-contests-api)
- 7 admin page tests (flags, contests, tenants, users, config)

**12 files mock hook modules** (`vi.mock('@/hooks/use-*-api')`) — these mock React Query hook return values for pure UI tests. Keep as-is.

**~72 web + ~20 admin test files** are pure component/utility/store tests that don't touch the API. No change needed.

### Risk: Silent Fallback Mocks in Hooks

5 dashboard hooks (`use-active-contests`, `use-upcoming-drafts`, `use-my-leagues`, `use-recent-activity`, `use-highlights`) have try/catch blocks that return hardcoded mock data when the API fails. These hide path errors. Must be removed as part of migration.

---

## Action Plan

| ID | Phase | Task | Priority | Effort | Status | Notes |
|---|---|---|---|---|---|---|
| 23-001 | 0 | Install MSW in web and admin packages | P0 | S | Todo | `msw@^2.7` as devDependency |
| 23-002 | 0 | Create shared route constants (`packages/shared/src/api-routes.ts`) | P0 | M | Todo | Single source of truth for all API paths |
| 23-003 | 0 | Create web MSW handlers and server | P0 | L | Todo | `clients/web/src/test/msw/handlers.ts` + `server.ts` |
| 23-004 | 0 | Create admin MSW handlers and server | P0 | M | Todo | `clients/admin/src/test/msw/handlers.ts` + `server.ts` |
| 23-005 | 0 | Wire MSW into Vitest setup files | P0 | S | Todo | `beforeAll/afterEach/afterAll` + `onUnhandledRequest: 'error'` |
| 23-006 | 0 | Add MSW test-utils helpers | P1 | S | Todo | `mockApiError(route, status)`, `mockApiResponse(route, data)` |
| 23-007 | 1 | Migrate auth-flow integration test | P0 | M | Todo | Remove `vi.mock`, use MSW. Highest-value migration. |
| 23-008 | 1 | Migrate contest-create-flow integration test | P0 | M | Todo | Remove api-client mock, MSW for POST contests |
| 23-009 | 1 | Migrate league-create-flow integration test | P0 | M | Todo | Remove api-client mock, MSW for POST leagues |
| 23-010 | 2 | Migrate web auth page tests (login, register) | P1 | S | Todo | Remove api-client mock |
| 23-011 | 2 | Migrate web create page tests (contests, leagues) | P1 | M | Todo | Remove api-client mock, use `server.use()` for overrides |
| 23-012 | 3 | Migrate admin page tests (7 files) | P1 | L | Todo | Remove api-client mock portions from dual-mock files |
| 23-013 | 3 | Migrate admin hook test (use-contests-api) | P1 | S | Todo | Remove api-client mock |
| 23-014 | 4 | Remove try/catch fallback mocks from dashboard hooks | P0 | M | Todo | 5 hooks — move mock data to MSW handlers |
| 23-015 | 5 | Refactor backend to use shared route constants | P2 | M | Todo | `core-api/index.ts` derives prefixes from `API_ROUTES` |
| 23-016 | 5 | Add CI route sync check script | P2 | M | Todo | `scripts/check-route-sync.ts` — verifies MSW handlers match backend |

---

## Phase Details

### Phase 0: Infrastructure

**Install & setup:**
```bash
cd clients/web && npm install -D msw
cd clients/admin && npm install -D msw
```

**Shared route constants** (`packages/shared/src/api-routes.ts`):
```typescript
export const API_ROUTES = {
  auth: {
    login: '/api/v1/auth/login',
    register: '/api/v1/auth/register',
    refresh: '/api/v1/auth/refresh',
    me: '/api/v1/auth/me',
    profile: '/api/v1/auth/profile',
  },
  leagues: {
    list: '/api/v1/leagues',
    detail: (id: string) => `/api/v1/leagues/${id}`,
  },
  contests: {
    list: '/api/v1/contests',
    detail: (id: string) => `/api/v1/contests/${id}`,
  },
  billing: {
    plan: '/api/v1/billing/plan',
    plans: '/api/v1/billing/plans',
    usage: '/api/v1/billing/usage',
  },
  // ... all routes
} as const;
```

**MSW server setup** (`clients/web/src/test/msw/server.ts`):
```typescript
import { setupServer } from 'msw/node';
import { handlers } from './handlers';
export const server = setupServer(...handlers);
```

**Vitest setup** (`test-setup.ts`):
```typescript
import { server } from './test/msw/server';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### Phase 1: Migrate Integration Tests (Highest Value)

These 3 tests exercise real user flows and are most likely to catch path mismatches:

```typescript
// Before (hidden bug):
vi.mock('@/lib/api-client', () => ({
  api: { post: mockApiPost },
}));
expect(mockApiPost).toHaveBeenCalledWith('/auth/login', ...); // wrong path, test passes

// After (catches bug):
// No vi.mock — real api-client runs, real fetch fires, MSW intercepts
import { server } from '@/test/msw/server';
import { http, HttpResponse } from 'msw';

it('login error shows message', async () => {
  server.use(
    http.post(API_ROUTES.auth.login, () => {
      return HttpResponse.json({ error: 'Invalid' }, { status: 401 });
    }),
  );
  // render login page, fill form, submit — real fetch fires, MSW responds with 401
});
```

### Phases 2-3: Page & Admin Tests

Replace `vi.mock('@/lib/api-client')` with MSW. Files that dual-mock (hook mock + api-client mock) keep the hook mock for read operations and replace only the api-client mock for mutations.

### Phase 4: Remove Silent Fallback Mocks

Dashboard hooks like:
```typescript
// REMOVE THIS:
try {
  return await api.get<Contest[]>('/v1/contests/active');
} catch {
  return mockContests; // hides errors!
}

// REPLACE WITH:
return await api.get<Contest[]>('/v1/contests/active');
```

Move `mockContests` into the MSW default handler.

### Phases 5: Backend Sync & CI Check

Optional but recommended. A script that parses `core-api/index.ts` route registrations and verifies every MSW handler URL starts with a known backend prefix.

---

## Files to Create

| File | Purpose |
|------|---------|
| `packages/shared/src/api-routes.ts` | Single source of truth for API route paths |
| `clients/web/src/test/msw/handlers.ts` | Default MSW handlers for webapp tests |
| `clients/web/src/test/msw/server.ts` | MSW server instance for webapp |
| `clients/admin/src/test/msw/handlers.ts` | Default MSW handlers for admin tests |
| `clients/admin/src/test/msw/server.ts` | MSW server instance for admin |
| `scripts/check-route-sync.ts` | CI script to verify handler/backend route alignment |

## Tests NOT to Migrate (Keep vi.mock)

- Component tests that mock hooks (pure UI isolation)
- Store tests (pure state logic)
- Utility tests (pure functions)
- Tests that mock `react-router-dom`, `react-i18next`, `@tanstack/react-query`

~92 of 114 total test files remain unchanged.

## Estimated Effort

~3-4 developer days total across all phases. Phase 0-1 (infrastructure + integration tests) is ~1 day and delivers the highest value.
