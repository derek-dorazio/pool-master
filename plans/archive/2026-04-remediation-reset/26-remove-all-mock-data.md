# Plan 26: Remove All Mock Data from Application Code

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

## Problem

Multiple pages and hooks contain hardcoded mock data that is returned instead of calling real APIs. This means:
- Dashboard shows real data (2 leagues) but the leagues page shows fake data (4 leagues)
- Pages never hit the backend — bugs in API integration are invisible
- Users see stale/fake data that doesn't match their actual account
- Tests pass against mock data, not real behavior

## Prerequisite: Plan 23 (MSW) Must Be Implemented First

Before removing mock data from application code, MSW must be in place so tests continue to pass. Currently many tests rely on the mock data in hooks (via try/catch fallbacks or `initialData`). After removal:
- Hooks call real APIs → fail in test environment (no backend running)
- MSW intercepts those calls → returns test data at the network level
- Tests pass without any mock data in production code

**Sequence: Plan 23 (MSW setup) → Plan 26 (remove mocks) → Plan 25 (SDK generation)**

## Inventory: Mock Data in Application Code

### Pages with hardcoded mock data (return fake data, never call API):

| File | Mock Constants | Real API Endpoint |
|------|---------------|-------------------|
| `pages/leagues/index.tsx` | `mockLeagues` (4 leagues) | `GET /api/v1/leagues` |
| `pages/leagues/detail.tsx` | `mockLeague`, `mockContests`, `mockMembersDetail` | `GET /api/v1/leagues/:id` |
| `pages/leagues/members.tsx` | `mockMembers`, `mockPendingInvites` | `GET /api/v1/leagues/:id/members` |
| `pages/leagues/records.tsx` | `mockRecords` | `GET /api/v1/leagues/:id/history/records` |
| `pages/leagues/history.tsx` | `mockSeasons` | `GET /api/v1/leagues/:id/history` |

### Hooks with try/catch fallback mocks:

| File | Mock Constants | Real API Endpoint |
|------|---------------|-------------------|
| `features/notifications/hooks/use-notifications.ts` | `mockNotifications` | `GET /api/v1/notifications` |
| `features/notifications/hooks/use-notification-preferences.ts` | `defaultPreferences` | `GET /api/v1/notifications/preferences` |
| `features/notifications/hooks/use-unread-count.ts` | `mockUnreadCounts` | `GET /api/v1/notifications/unread-count` |
| `features/discovery/hooks/use-discovery.ts` | `mockLeagues`, `mockContests` | `GET /api/v1/search/discover/*` |
| `features/contests/hooks/use-standings.ts` | `mockStandings` | `GET /api/v1/contests/:id/standings` |

### Pages with inline mock data (not in hooks):

| File | Mock Usage |
|------|-----------|
| `pages/contests/detail.tsx` | Check for inline mock data |
| `pages/contests/standings.tsx` | Check for inline mock data |
| `pages/discover/*.tsx` | May reference discovery hook mocks |
| `pages/billing/*.tsx` | Check for inline mock data |

## Action Plan

| ID | Phase | Task | Priority | Status | Notes |
|---|---|---|---|---|---|
| **Phase 0: MSW Infrastructure (Plan 23)** | | | | | |
| 26-001 | 0 | Install MSW in web and admin packages | P0 | Todo | `msw@^2.7` |
| 26-002 | 0 | Create shared MSW handlers with default responses | P0 | Todo | One handler per API endpoint group |
| 26-003 | 0 | Wire MSW into Vitest setup (`onUnhandledRequest: 'error'`) | P0 | Todo | All tests that hit APIs need MSW |
| 26-004 | 0 | Verify all existing tests pass with MSW active | P0 | Todo | MSW should not break existing tests |
| **Phase 1: Remove page-level mock data** | | | | | |
| 26-005 | 1 | Fix `pages/leagues/index.tsx` — call `GET /api/v1/leagues` | P0 | Todo | Remove `mockLeagues`, use `useMyLeagues` or create `useLeaguesList` |
| 26-006 | 1 | Fix `pages/leagues/detail.tsx` — call `GET /api/v1/leagues/:id` | P0 | Todo | Remove `mockLeague`, `mockContests`, `mockMembersDetail` |
| 26-007 | 1 | Fix `pages/leagues/members.tsx` — call `GET /api/v1/leagues/:id/members` | P0 | Todo | Remove `mockMembers`, `mockPendingInvites` |
| 26-008 | 1 | Fix `pages/leagues/records.tsx` — call real API | P1 | Todo | Remove `mockRecords` |
| 26-009 | 1 | Fix `pages/leagues/history.tsx` — call real API | P1 | Todo | Remove `mockSeasons` |
| **Phase 2: Remove hook-level mock data** | | | | | |
| 26-010 | 2 | Fix `use-notifications.ts` — remove `mockNotifications` + try/catch | P0 | Todo | |
| 26-011 | 2 | Fix `use-notification-preferences.ts` — remove `defaultPreferences` + try/catch | P0 | Todo | |
| 26-012 | 2 | Fix `use-unread-count.ts` — remove `mockUnreadCounts` + try/catch | P0 | Todo | |
| 26-013 | 2 | Fix `use-discovery.ts` — remove all mock data | P0 | Todo | Replace with real search API calls |
| 26-014 | 2 | Fix `use-standings.ts` — remove `mockStandings` | P0 | Todo | Call `GET /api/v1/contests/:id/standings` |
| **Phase 3: Audit and remove remaining mocks** | | | | | |
| 26-015 | 3 | Audit all pages in `pages/contests/` for mock data | P0 | Todo | |
| 26-016 | 3 | Audit all pages in `pages/billing/` for mock data | P0 | Todo | |
| 26-017 | 3 | Audit all pages in `pages/discover/` for mock data | P0 | Todo | |
| 26-018 | 3 | Audit all pages in `pages/settings/` for mock data | P0 | Todo | |
| 26-019 | 3 | Audit all hooks in `features/` for try/catch fallbacks | P0 | Todo | |
| 26-020 | 3 | Run `grep -rn "mock\|Mock\|MOCK\|initialData\|fallback" --include="*.ts" --include="*.tsx"` on `src/` and fix all hits | P0 | Todo | Final sweep |
| **Phase 4: Update tests with MSW handlers** | | | | | |
| 26-021 | 4 | Update league page tests to use MSW | P0 | Todo | Tests mock the API via MSW, not inline data |
| 26-022 | 4 | Update notification tests to use MSW | P0 | Todo | |
| 26-023 | 4 | Update discovery tests to use MSW | P0 | Todo | |
| 26-024 | 4 | Update standings tests to use MSW | P0 | Todo | |
| 26-025 | 4 | Update contest page tests to use MSW | P0 | Todo | |
| 26-026 | 4 | Full test suite verification | P0 | Todo | All 1,393+ tests must pass |
| **Phase 5: Component error/empty state handling** | | | | | |
| 26-027 | 5 | Add error states to all pages that currently show mock data | P0 | Todo | isError → show error message + retry button |
| 26-028 | 5 | Add empty states to all pages | P0 | Todo | Empty array → show "No items yet" message |
| 26-029 | 5 | Add loading states to pages missing them | P1 | Todo | isLoading → show skeleton/spinner |

## Implementation Pattern

### Before (BANNED):
```typescript
const mockLeagues = [{ id: 'fake-1', name: 'Fake League' }];

function useLeagues() {
  return useQuery({
    queryKey: ['leagues'],
    queryFn: async () => mockLeagues,  // NEVER calls API
    initialData: mockLeagues,          // Prevents API call
  });
}
```

### After (REQUIRED):
```typescript
import { clientPath, API_ROUTES } from '@poolmaster/shared/api-routes';
import type { LeagueListResponse, LeagueSummaryDto } from '@poolmaster/shared/dto';

function useLeagues() {
  return useQuery({
    queryKey: ['leagues'],
    queryFn: async (): Promise<LeagueSummaryDto[]> => {
      const res = await api.get<LeagueListResponse>(clientPath(API_ROUTES.leagues.list));
      return res.leagues;
    },
  });
}
```

### Test (MSW):
```typescript
// In test file or MSW handlers
import { http, HttpResponse } from 'msw';
server.use(
  http.get('/api/v1/leagues', () => {
    return HttpResponse.json({
      leagues: [
        { id: 'test-1', name: 'Test League', memberCount: 5, activeContestCount: 1 },
      ],
    });
  }),
);
```

## Estimated Effort

| Phase | Effort |
|-------|--------|
| 0: MSW setup | 1 day |
| 1: Page mock removal | 1 day |
| 2: Hook mock removal | 0.5 day |
| 3: Audit + remaining | 0.5 day |
| 4: Test updates | 1 day |
| 5: Error/empty states | 0.5 day |

**Total: ~4.5 days. Critical path: Phase 0 → Phase 1+2 → Phase 4**
