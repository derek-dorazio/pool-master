# Webapp Test Coverage Plan

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

## Context

The webapp (`clients/web`) has 146 .tsx files but only 5 test files covering ~3%. The admin app (`clients/admin`) has 38 .tsx files with zero tests. This plan increases coverage to ~70%+ for the webapp and establishes testing for the admin app, prioritized by test ROI.

---

## Current State

| App | Files | Test Files | Tests | Coverage |
|-----|-------|-----------|-------|----------|
| **Webapp** | 146 .tsx | 5 | 20 | ~3% |
| **Admin** | 38 .tsx | 0 | 0 | 0% |

Vitest + React Testing Library is set up for the webapp. Admin has no testing infrastructure.

---

## Tier 1: Stores + Utilities (pure logic, no rendering)

Fastest to write — pure functions and state management. No DOM, no mocking.

### Webapp Stores
| Test File | Source | Tests |
|-----------|--------|-------|
| `src/stores/auth-store.test.ts` | `auth-store.ts` | setUser, clearUser, setLoading, isAuthenticated derived state |
| `src/stores/preferences-store.test.ts` | `preferences-store.ts` | setTimezone, setDateFormat, toggleSidebar, localStorage persistence |
| `src/stores/notification-ui-store.test.ts` | `notification-ui-store.ts` | toggleDropdown, setActiveCategory, dismissPushBanner |

### Webapp Utilities
| Test File | Source | Tests |
|-----------|--------|-------|
| `src/lib/format-currency.test.ts` | `format-currency.ts` | formatCurrency, getCurrencySymbol, getCurrencyDecimals, edge cases |
| `src/lib/format-number.test.ts` | `format-number.ts` | Number formatting with locales |
| `src/lib/format-salary.test.ts` | `format-salary.ts` | Salary cap formatting |
| `src/lib/format-time.test.ts` | `format-time.ts` | Time formatting, relative time |

### Admin Bootstrap + Store
| File | Action |
|------|--------|
| `clients/admin/package.json` | Add vitest, testing-library, jsdom, coverage-v8 |
| `clients/admin/vitest.config.ts` | New — same pattern as webapp |
| `clients/admin/tsconfig.json` | Add vitest/globals, jest-dom types |
| `clients/admin/src/test-setup.ts` | New — jest-dom matchers |
| `clients/admin/src/stores/admin-auth-store.test.ts` | setAdminUser, clearAdminUser, role/permissions |

**Estimated: ~8 test files, ~40 tests**

---

## Tier 2: Hooks (core business logic)

Test hook logic with `renderHook()` from React Testing Library. Mock API calls via TanStack Query's `QueryClient` wrapper.

### Webapp Hooks
| Test File | Source | Key Tests | Status |
|-----------|--------|-----------|--------|
| `features/settings/hooks/use-profile.test.ts` | `use-profile.ts` | useProfile query, mock data shape | Done |
| `features/notifications/hooks/use-notifications.test.ts` | `use-notifications.ts` | List query, filtering by category, pagination pages | Done |
| `features/notifications/hooks/use-notification-preferences.test.ts` | `use-notification-preferences.ts` | Fetch prefs, save prefs mutation | |
| `features/notifications/hooks/use-unread-count.test.ts` | `use-unread-count.ts` | Count query, grouped breakdown | Done |
| `features/notifications/hooks/use-notification-actions.test.ts` | `use-notification-actions.ts` | Mark read, mark all read mutations | Done |
| `features/billing/hooks/use-billing.test.ts` | `use-billing.ts` | Plan data, tier list, usage stats | Done |
| `features/discovery/hooks/use-discovery.test.ts` | `use-discovery.ts` | Trending leagues, popular contests, sport filter | Done |
| `features/dashboard/hooks/use-active-contests.test.ts` | `use-active-contests.ts` | Active contests query, mock data shape | Done |
| `features/dashboard/hooks/use-highlights.test.ts` | `use-highlights.ts` | Season highlights query, season record shape | Done |
| `features/dashboard/hooks/use-my-leagues.test.ts` | `use-my-leagues.ts` | Leagues summary query, mock data shape | Done |
| `features/dashboard/hooks/use-recent-activity.test.ts` | `use-recent-activity.ts` | Activity feed query, mock data shape | Done |
| `features/dashboard/hooks/use-upcoming-drafts.test.ts` | `use-upcoming-drafts.ts` | Upcoming drafts query, mock data shape | Done |
| `features/contests/hooks/use-contest.test.ts` | `use-contest.ts` | Contest query, myEntry/topEntries, disabled when no id | Done |
| `features/contests/hooks/use-standings.test.ts` | `use-standings.ts` | Standings entries, rank order, disabled when no id | Done |

### Admin Hooks
| Test File | Source | Key Tests |
|-----------|--------|-----------|
| `src/hooks/use-admin-api.test.ts` | `use-admin-api.ts` | Metrics, tenant list, user search, filtering/sorting |
| `src/hooks/use-flags-api.test.ts` | `use-flags-api.ts` | Flag list, toggle, create |
| `src/hooks/use-health-api.test.ts` | `use-health-api.ts` | Service health queries |

**Estimated: ~15 test files, ~60 tests**

---

## Tier 3: Complex Interactive Components

Components with significant logic — forms, state management, timers, grids.

### Webapp Components
| Test File | Source | Key Tests |
|-----------|--------|-----------|
| `features/notifications/preferences-matrix.test.tsx` | `preferences-matrix.tsx` | Checkbox grid render, column toggles, debounced save |
| `features/settings/profile-form.test.tsx` | `profile-form.tsx` | Form validation, submit, dirty tracking |
| `features/settings/password-change-form.test.tsx` | `password-change-form.tsx` | Validation, mismatch, submit |
| `features/settings/avatar-upload.test.tsx` | `avatar-upload.tsx` | File type/size validation, upload |
| `features/social/compose-box.test.tsx` | `compose-box.tsx` | Text input, poll toggle, dynamic options |
| `features/draft-room/draft-header.test.tsx` | `draft-header.tsx` | Timer countdown, interval cleanup |
| `features/dashboard/active-contests-card.test.tsx` | `active-contests-card.tsx` | Render contests, empty state |
| `features/dashboard/upcoming-drafts-card.test.tsx` | `upcoming-drafts-card.tsx` | Render drafts, countdown |
| `features/dashboard/quick-actions-bar.test.tsx` | `quick-actions-bar.tsx` | Button renders, click handlers |
| `features/notifications/notification-item.test.tsx` | `notification-item.tsx` | Render, mark-read click, category icon |
| `features/notifications/bulk-actions.test.tsx` | `bulk-actions.tsx` | Select all, mark read, delete |
| `features/leagues/role-guard.test.tsx` | `role-guard.tsx` | Renders children for allowed role, hides for denied |

### Admin Components
| Test File | Source | Key Tests |
|-----------|--------|-----------|
| `pages/announcements/create.test.tsx` | `create.tsx` | Form state, preview sync, severity |

**Estimated: ~13 test files, ~55 tests**

---

## Tier 4: Pages and Auth Flows

Page-level integration tests — routing, data loading, layout composition.

### Webapp Pages
| Test File | Source | Key Tests |
|-----------|--------|-----------|
| `pages/auth/login.test.tsx` | `login.tsx` | Form render, validation, submit |
| `pages/auth/register.test.tsx` | `register.tsx` | Form render, validation, submit |
| `pages/settings/index.test.tsx` | `settings/index.tsx` | Settings hub renders cards |
| `pages/settings/profile.test.tsx` | `settings/profile.tsx` | Profile page renders form |
| `pages/settings/privacy.test.tsx` | `settings/privacy.tsx` | Privacy cards render |
| `pages/notifications.test.tsx` | `notifications.tsx` | Notification centre page |
| `pages/dashboard.test.tsx` | `dashboard.tsx` | Dashboard widgets render |
| `pages/not-found.test.tsx` | `not-found.tsx` | 404 page renders |

### Admin Pages
| Test File | Source | Key Tests |
|-----------|--------|-----------|
| `pages/login.test.tsx` | `login.tsx` | Admin login form |
| `pages/home.test.tsx` | `home.tsx` | Admin dashboard renders |

**Estimated: ~10 test files, ~40 tests**

---

## CI Updates

### Add admin test job to `.github/workflows/ci.yml`
```yaml
test-admin:
  runs-on: ubuntu-latest
  needs: lint-typecheck
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - run: npm ci
    - name: Run admin tests with coverage
      run: cd clients/admin && npx vitest run --coverage
```

Update `publish-images` needs: `[test, test-webapp, test-admin, build]`

---

## Coverage Targets

| Milestone | Webapp | Admin | Total Tests |
|-----------|--------|-------|-------------|
| **After Tier 1** | ~15% | ~10% | ~60 |
| **After Tier 2** | ~35% | ~25% | ~120 |
| **After Tier 3** | ~55% | ~35% | ~175 |
| **After Tier 4** | ~70% | ~50% | ~215 |

---

## Implementation Order

1. Tier 1: Stores + utilities (webapp + admin bootstrap)
2. Tier 2: Hooks
3. Tier 3: Complex components
4. Tier 4: Pages

Each tier is independently committable and adds incremental CI value.

---

## Files to Create/Modify

### Tier 1
- `clients/web/src/stores/*.test.ts` (3 files)
- `clients/web/src/lib/format-*.test.ts` (4 files)
- `clients/admin/package.json` (add test deps)
- `clients/admin/vitest.config.ts` (new)
- `clients/admin/tsconfig.json` (add types)
- `clients/admin/src/test-setup.ts` (new)
- `clients/admin/src/stores/admin-auth-store.test.ts` (1 file)
- `.github/workflows/ci.yml` (add test-admin job)

### Tiers 2-4
- ~38 additional test files across both apps
