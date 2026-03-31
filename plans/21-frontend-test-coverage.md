# Ultimate Pool Manager — Frontend Test Coverage Plan

> **Goal:** Increase frontend test coverage from ~19% (webapp) and ~13% (admin) to 50%+ overall, with emphasis on integration layers (API hooks, stores, data flow).

## Current State

| App | Source Files | Test Files | Coverage | Target |
|---|---|---|---|---|
| Webapp (`clients/web`) | 229 | 43 | ~19% | 50%+ |
| Admin (`clients/admin`) | 62 | 8 | ~13% | 50%+ |

### What's Already Tested

**Webapp (43 tests):**
- Stores: auth-store, notification-ui-store, preferences-store (100% store coverage)
- Utilities: format-currency, format-number, format-salary, format-time
- Dashboard hooks: all 5 tested (active-contests, highlights, my-leagues, recent-activity, upcoming-drafts)
- Contest hooks: use-contest, use-standings
- Notification hooks: use-notifications, use-unread-count, use-notification-actions
- Billing hooks: use-billing
- Discovery hooks: use-discovery
- Settings hooks: use-profile
- Components: cookie-banner

**Admin (8 tests):**
- Stores: admin-auth-store
- Hooks: use-admin-api (partial), use-announcements-api, use-flags-api, use-health-api, use-providers-api
- Pages: home, login

### Infrastructure
- **Test runner:** Vitest 4.1.2 (both apps)
- **Libraries:** @testing-library/react, @testing-library/user-event, @testing-library/jest-dom
- **Coverage:** v8 provider with lcov output
- **Test utils:** `renderHook()` wrapper with QueryClientProvider (both apps)
- **Config:** `vitest.config.ts` in both apps

---

## Testing Strategy

### Priority Tiers

1. **P0 — API Integration Layer (hooks):** Every hook that calls `api.get/post` or `adminApi.get/post` must be tested. This is the critical boundary between frontend and backend.
2. **P1 — State Management (stores):** Already at 100% — maintain.
3. **P2 — Utility Functions:** Pure functions are easy wins with high ROI.
4. **P3 — Key Components:** Components with business logic, forms, conditional rendering.
5. **P4 — Pages:** Page-level rendering tests to catch integration issues.

### Test Patterns

**Hook tests (API integration layer):**
```typescript
describe('useMyHook', () => {
  it('returns data on success', async () => {
    // Mock api.get to return expected data
    vi.spyOn(api, 'get').mockResolvedValue(mockData);
    const { result } = renderHook(() => useMyHook('id'));
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual(expectedShape);
  });

  it('falls back to mock data on API error', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useMyHook('id'));
    await waitFor(() => expect(result.current.data).toBeDefined());
    // Should still have data (fallback)
  });

  it('sends correct API path and params', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({});
    renderHook(() => useMyHook('test-id'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/v1/expected/path'));
  });
});
```

**Mutation hook tests:**
```typescript
describe('useSubmitBracket', () => {
  it('calls POST with correct payload', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ id: '123' });
    const { result } = renderHook(() => useSubmitBracket());
    await act(() => result.current.mutate(payload));
    expect(spy).toHaveBeenCalledWith('/v1/contests/abc/bracket', payload);
  });
});
```

**Component tests:**
```typescript
describe('MyComponent', () => {
  it('renders with data', () => {
    render(<MyComponent data={mockData} />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<MyComponent data={undefined} isLoading={true} />);
    expect(screen.getByText('Loading')).toBeInTheDocument();
  });

  it('handles user interaction', async () => {
    const onSubmit = vi.fn();
    render(<MyComponent onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalled();
  });
});
```

---

## Phase 1 — API Integration Layer: Untested Hooks (P0)

### Webapp Hooks (17 untested)

| ID | Test File | Hook(s) to Test | Tests Needed |
|---|---|---|---|
| FT-001 | `features/draft-room/hooks/use-draft.test.ts` | useDraftState, useAvailableParticipants, useMakePick | API calls, draft state shape, pick mutation, error fallback |
| FT-002 | `features/social/hooks/use-feed.test.ts` | useFeed, useCreatePost, useToggleReaction, usePinPost, useDeletePost, useCreateReply, useVotePoll | Feed pagination, post CRUD mutations, reaction toggle, cursor handling |
| FT-003 | `features/social/hooks/use-chat.test.ts` | useChatMessages, useSendChatMessage | Message list, send mutation, polling interval |
| FT-004 | `features/social/hooks/use-messages.test.ts` | useConversations, useConversationMessages, useSendMessage, useMarkRead | DM list, thread loading, send/read mutations |
| FT-005 | `features/social/hooks/use-share.test.ts` | useShareCard | Share data fetch, fallback |
| FT-006 | `features/social/hooks/use-recap.test.ts` | useWeeklyRecap | Recap data fetch, fallback |
| FT-007 | `features/notifications/hooks/use-notification-preferences.test.ts` | useNotificationPreferences, useUpdatePreferences | Preferences matrix, update mutation |
| FT-008 | `features/notifications/hooks/use-push-permission.test.ts` | usePushPermission | Permission state, request handler |
| FT-009 | `features/contests/hooks/use-contest-polling.test.ts` | useContestPolling | ETag support, polling interval, stale detection |
| FT-010 | `features/settings/hooks/use-consent.test.ts` | useConsent, useUpdateConsent | Consent data, update mutation |
| FT-011 | `features/settings/hooks/use-data-export.test.ts` | useExportStatus, useRequestExport | Export status polling, request mutation |
| FT-012 | `features/settings/hooks/use-linked-accounts.test.ts` | useLinkedAccounts, useLinkAccount, useUnlinkAccount | Account list, link/unlink mutations |
| FT-013 | `hooks/use-format.test.ts` | useFormat | Number/currency/percent formatting with locale |
| FT-014 | `hooks/use-toast.test.ts` | useToast, toast() | Toast creation, auto-dismiss, queue |

### Admin Hooks (4 untested)

| ID | Test File | Hook(s) to Test | Tests Needed |
|---|---|---|---|
| FT-015 | `hooks/use-audit-api.test.ts` | useAuditLog | Filter params, pagination, date range |
| FT-016 | `hooks/use-config-api.test.ts` | useScoringTemplates, useSelectionTemplates, usePushTriggers, useNotificationTemplates, useChannelDefaults, useRateLimits, usePollIntervals, useIngestionSchedule, useDunningConfig, useRetentionDefaults, useDigestConfig, useDigestPreview | All 12 config hooks, API paths, data shapes |
| FT-017 | `hooks/use-contests-api.test.ts` | useContestList, useContestDetail | Filter params, detail data shape |
| FT-018 | `hooks/use-migrations-api.test.ts` | useMigrations, useMigrationDetail | Migration list, run detail |

---

## Phase 2 — Utility Functions (P2)

### Webapp Utilities (4 untested)

| ID | Test File | Module to Test | Tests Needed |
|---|---|---|---|
| FT-019 | `lib/api-client.test.ts` | api.get, api.post, api.put, api.delete, ApiError | HTTP methods, auth header injection, error handling, 401/403/404/500 responses, JSON parsing |
| FT-020 | `lib/timezones.test.ts` | searchTimezones, getTimezonesByRegion, TIMEZONE_LIST | Search filtering, region grouping, data completeness |
| FT-021 | `lib/utils.test.ts` | cn() | Class merging, conditional classes, Tailwind merge |
| FT-022 | `lib/i18n.test.ts` | i18n initialization | Namespace loading, fallback language, interpolation |

### Admin Utilities (3 untested)

| ID | Test File | Module to Test | Tests Needed |
|---|---|---|---|
| FT-023 | `lib/api-client.test.ts` | adminApi.get, adminApi.post, etc. | Same as webapp but with admin_token |
| FT-024 | `lib/utils.test.ts` | cn() | Class merging |
| FT-025 | `lib/query-client.test.ts` | QueryClient config | Default options (staleTime, retry) |

---

## Phase 3 — Key Components with Business Logic (P3)

### Webapp Components

| ID | Test File | Component | Tests Needed |
|---|---|---|---|
| FT-026 | `features/dashboard/active-contests-card.test.tsx` | ActiveContestsCard | Renders contests, rank display, empty state, navigation |
| FT-027 | `features/dashboard/upcoming-drafts-card.test.tsx` | UpcomingDraftsCard | Countdown timer, draft room button disabled/enabled, empty state |
| FT-028 | `features/dashboard/my-leagues-summary.test.tsx` | MyLeaguesSummary | League cards, commissioner badge, "View all" link, empty state |
| FT-029 | `features/billing/usage-meter.test.tsx` | UsageMeter | Progress bar colors (green/amber/red), unlimited mode, percentage |
| FT-030 | `features/billing/plan-card.test.tsx` | PlanCard | Current plan badge, CTA button states, billing disabled "Coming Soon" |
| FT-031 | `features/billing/billing-feature-gate.test.tsx` | BillingFeatureGate | Shows children when enabled, fallback when disabled |
| FT-032 | `features/leagues/role-guard.test.tsx` | RoleGuard | Renders children for allowed roles, redirects for denied, loading state |
| FT-033 | `features/leagues/entitlement-gate.test.tsx` | EntitlementGate | Renders children when entitled, upgrade prompt when not |
| FT-034 | `features/leagues/join-leave-flow.test.tsx` | JoinLeaveFlow | Join/leave mutations, confirmation dialog |
| FT-035 | `features/notifications/notification-bell.test.tsx` | NotificationBell | Unread badge count, dropdown toggle, mark read |
| FT-036 | `features/social/post-card.test.tsx` | PostCard | Author, content, reactions, reply count, timestamp |
| FT-037 | `features/social/reaction-bar.test.tsx` | ReactionBar | Emoji display, toggle click, count update |
| FT-038 | `components/ui/confirm-dialog.test.tsx` | ConfirmDialog | Open/close, confirm/cancel callbacks, destructive variant |
| FT-039 | `components/ui/dual-timezone.test.tsx` | DualTimezone | Same tz shows once, different tz shows both |
| FT-040 | `components/ui/relative-time.test.tsx` | RelativeTime | "just now", "5m ago", "yesterday", full date |

### Admin Components

| ID | Test File | Component | Tests Needed |
|---|---|---|---|
| FT-041 | `components/ui/confirm-dialog.test.tsx` | ConfirmDialog | Same as webapp version |
| FT-042 | `pages/tenants/index.test.tsx` | TenantList | Filter bar, table rendering, pagination, sort |
| FT-043 | `pages/users/index.test.tsx` | UserSearch | Search input, results table, empty state |
| FT-044 | `pages/flags/index.test.tsx` | FlagList | Toggle switch, flag table, create button |
| FT-045 | `pages/health/index.test.tsx` | HealthDashboard | Service status dots, metrics cards, refresh indicator |

---

## Phase 4 — Page-Level Rendering Tests (P4)

### Webapp Pages

| ID | Test File | Page | Tests Needed |
|---|---|---|---|
| FT-046 | `pages/dashboard.test.tsx` | Dashboard | Renders all widgets, welcome message, quick actions |
| FT-047 | `pages/auth/login.test.tsx` | Login | Form validation, submit, error display, social login buttons |
| FT-048 | `pages/auth/register.test.tsx` | Register | Step navigation, field validation per step, age verification |
| FT-049 | `pages/billing/index.test.tsx` | BillingOverview | Plan card, usage meters, disabled banner |
| FT-050 | `pages/billing/plans.test.tsx` | PlanComparison | 4 plan cards, toggle monthly/annual, CTA states |
| FT-051 | `pages/leagues/create.test.tsx` | LeagueCreate | 3-step wizard, field validation, submit |
| FT-052 | `pages/contests/create.test.tsx` | ContestCreate | 7-step wizard, sport selection, type filtering |
| FT-053 | `pages/contests/detail.test.tsx` | ContestDetail | Status-adaptive content, standings snapshot, CTA buttons |
| FT-054 | `pages/settings/timezone.test.tsx` | TimezoneSettings | Timezone picker, format preview, save |
| FT-055 | `pages/settings/privacy.test.tsx` | PrivacySettings | Data export, account deletion, consent toggles |

### Admin Pages

| ID | Test File | Page | Tests Needed |
|---|---|---|---|
| FT-056 | `pages/tenants/detail.test.tsx` | TenantDetail | Tabs render, action dropdown, usage bars |
| FT-057 | `pages/users/detail.test.tsx` | UserDetail | Tabs render, action confirmations |
| FT-058 | `pages/contests/detail.test.tsx` | ContestDetail | Admin actions, standings tab, scoring data |
| FT-059 | `pages/flags/detail.test.tsx` | FlagDetail | Rollout slider, overrides table, resolution tester |
| FT-060 | `pages/config/notifications.test.tsx` | NotificationConfig | Trigger toggles, template edit, rate limit save |
| FT-061 | `pages/config/platform.test.tsx` | PlatformConfig | Poll intervals, ingestion schedule, dunning config |
| FT-062 | `pages/audit/index.test.tsx` | AuditLog | Filters, expandable rows, CSV export |

---

## Phase 5 — Integration Tests (Store ↔ Hook ↔ API)

| ID | Test File | Flow | Tests Needed |
|---|---|---|---|
| FT-063 | `integration/auth-flow.test.ts` | Login → store → API → redirect | Full auth flow: submit credentials, token stored, user set, redirect to dashboard |
| FT-064 | `integration/league-create-flow.test.ts` | Wizard → API → navigate | Complete wizard, POST league, navigate to new league ID |
| FT-065 | `integration/contest-create-flow.test.ts` | Wizard → API → navigate | Complete wizard, POST contest, navigate to new contest ID |
| FT-066 | `integration/billing-gate-flow.test.ts` | Entitlement check → gate → UI | API returns entitled/not, UI shows/hides features |
| FT-067 | `integration/notification-preferences-flow.test.ts` | Load prefs → toggle → save | Load matrix, toggle channel, save mutation, optimistic update |

---

## Coverage Projection

### Webapp (target: 50%+)

| Phase | New Test Files | Estimated Source Files Covered | Running Coverage |
|---|---|---|---|
| Current | 43 | 43 | 19% |
| Phase 1 (hooks) | +14 | +30 (hooks + their deps) | 32% |
| Phase 2 (utils) | +4 | +4 | 34% |
| Phase 3 (components) | +15 | +20 | 42% |
| Phase 4 (pages) | +10 | +15 | 49% |
| Phase 5 (integration) | +5 | +5 | **52%** |

### Admin (target: 50%+)

| Phase | New Test Files | Estimated Source Files Covered | Running Coverage |
|---|---|---|---|
| Current | 8 | 8 | 13% |
| Phase 1 (hooks) | +4 | +8 | 26% |
| Phase 2 (utils) | +3 | +3 | 31% |
| Phase 3 (components) | +5 | +8 | 44% |
| Phase 4 (pages) | +7 | +10 | **60%** |

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| FT-001 | 1 | Test use-draft hooks (state, available, pick mutation) | Not Started | Complex — draft state machine |
| FT-002 | 1 | Test use-feed hooks (CRUD, reactions, cursor pagination) | Not Started | 7 hooks in one file |
| FT-003 | 1 | Test use-chat hooks (messages, send) | Not Started | |
| FT-004 | 1 | Test use-messages hooks (DM conversations, send, mark read) | Not Started | |
| FT-005 | 1 | Test use-share hook | Not Started | |
| FT-006 | 1 | Test use-recap hook | Not Started | |
| FT-007 | 1 | Test use-notification-preferences hooks | Not Started | |
| FT-008 | 1 | Test use-push-permission hook | Not Started | |
| FT-009 | 1 | Test use-contest-polling hook (ETag, intervals) | Not Started | |
| FT-010 | 1 | Test use-consent hooks | Not Started | |
| FT-011 | 1 | Test use-data-export hooks | Not Started | |
| FT-012 | 1 | Test use-linked-accounts hooks | Not Started | |
| FT-013 | 1 | Test use-format hook | Not Started | |
| FT-014 | 1 | Test use-toast hook | Not Started | |
| FT-015 | 1 | Test admin use-audit-api hooks | Not Started | |
| FT-016 | 1 | Test admin use-config-api hooks (12 hooks) | Not Started | Largest single file |
| FT-017 | 1 | Test admin use-contests-api hooks | Not Started | |
| FT-018 | 1 | Test admin use-migrations-api hooks | Not Started | |
| FT-019 | 2 | Test webapp api-client (HTTP methods, auth, errors) | Done | 10 tests: GET/POST/PUT/DELETE, auth header, ApiError, 204 handling |
| FT-020 | 2 | Test timezones utility (search, regions) | Done | 7 tests: data completeness, search, region grouping |
| FT-021 | 2 | Test utils.ts cn() function | Done | 6 tests: merging, conditionals, Tailwind conflicts, arrays |
| FT-022 | 2 | Test i18n initialization | Done | 6 tests: init, language, namespaces, translation, fallback |
| FT-023 | 2 | Test admin api-client | Done | 8 tests: admin_token auth, HTTP methods, error handling |
| FT-024 | 2 | Test admin utils.ts | Done | 6 tests: same cn() coverage as webapp |
| FT-025 | 2 | Test admin query-client config | Done | 4 tests: QueryClient instance, staleTime, retry, refetch |
| FT-026 | 3 | Test ActiveContestsCard component | Not Started | |
| FT-027 | 3 | Test UpcomingDraftsCard component | Not Started | |
| FT-028 | 3 | Test MyLeaguesSummary component | Not Started | |
| FT-029 | 3 | Test UsageMeter component | Not Started | |
| FT-030 | 3 | Test PlanCard component | Not Started | |
| FT-031 | 3 | Test BillingFeatureGate component | Not Started | |
| FT-032 | 3 | Test RoleGuard component | Not Started | |
| FT-033 | 3 | Test EntitlementGate component | Not Started | |
| FT-034 | 3 | Test JoinLeaveFlow component | Not Started | |
| FT-035 | 3 | Test NotificationBell component | Not Started | |
| FT-036 | 3 | Test PostCard component | Done | 6 tests: author/content, timestamp, reactions, reply count, singular reply, announcement styling |
| FT-037 | 3 | Test ReactionBar component | Done | 4 tests: emoji buttons, counts, toggle handler, active highlighting |
| FT-038 | 3 | Test webapp ConfirmDialog component | Done | 6 tests: open/close, title/desc, confirm/cancel callbacks, destructive variant, custom label |
| FT-039 | 3 | Test DualTimezone component | Done | 4 tests: same tz single time, different tz both times, no abbr when same, Date object input |
| FT-040 | 3 | Test RelativeTime component | Done | 5 tests: just now, minutes, hours, days, title attribute |
| FT-041 | 3 | Test admin ConfirmDialog component | Done | 6 tests: same as webapp ConfirmDialog |
| FT-042 | 3 | Test admin TenantList page | Done | 6 tests: tenant names, plan badges, status badges, search input, filter dropdowns, total count |
| FT-043 | 3 | Test admin UserSearch page | Done | 5 tests: search input, empty state, results after search, email/name rows, heading |
| FT-044 | 3 | Test admin FlagList page | Done | 6 tests: flag names, monospace keys, toggle switches, create button, heading, type badges |
| FT-045 | 3 | Test admin HealthDashboard page | Done | 6 tests: service table, status indicators, infra cards, key metrics, heading, metric details |
| FT-046 | 4 | Test Dashboard page | Done | 5 tests: welcome message, quick actions bar, active contests, leagues, activity section |
| FT-047 | 4 | Test Login page | Done | 6 tests: email/password inputs, Log In button, social login buttons, forgot password link, sign up link, validation error on empty submit |
| FT-048 | 4 | Test Register page (multi-step) | Done | 4 tests: step 1 email/password/confirm fields, Next button, login link, 5-step progress indicators |
| FT-049 | 4 | Test BillingOverview page | Done | 4 tests: current plan card, usage meters, disabled billing banner, Upgrade link |
| FT-050 | 4 | Test PlanComparison page | Done | 4 tests: 4 plan cards, billing cycle toggle, FAQ section, Current Plan badge on active plan |
| FT-051 | 4 | Test LeagueCreate page | Done | 4 tests: step indicator (Basics/Access/Review), name input, Next button, Back button disabled on step 1 |
| FT-052 | 4 | Test ContestCreate page | Done | 4 tests: 7-step indicator, sport selector grid, Next button, step count display |
| FT-053 | 4 | Test ContestDetail page | Done | 4 tests: contest name, status badge, standings snapshot, action buttons |
| FT-054 | 4 | Test TimezoneSettings page | Done | 5 tests: timezone picker, date format options, time format options, format preview, Save button |
| FT-055 | 4 | Test PrivacySettings page | Done | 3 tests: data export card, account deletion card, consent manager |
| FT-056 | 4 | Test admin TenantDetail page | Done | 5 tests: tenant name, tabs (Overview/Members/Leagues/Contests/Activity), Actions dropdown, plan badge, status badge |
| FT-057 | 4 | Test admin UserDetail page | Done | 5 tests: user name+email, tabs, Actions dropdown, status badge, user ID display |
| FT-058 | 4 | Test admin ContestDetail page | Done | 5 tests: contest name, tabs (Standings/Scoring Data/Draft/Overrides/Admin Actions), sport badge, admin actions section, status badge |
| FT-059 | 4 | Test admin FlagDetail page | Done | 5 tests: flag key, global toggle, rollout section, overrides table, resolution tester |
| FT-060 | 4 | Test admin NotificationConfig page | Done | 4 tests: push triggers section, templates section, channel defaults section, rate limits section |
| FT-061 | 4 | Test admin PlatformConfig page | Done | 4 tests: poll intervals section, ingestion schedule section, dunning section, retention section |
| FT-062 | 4 | Test admin AuditLog page | Done | 5 tests: audit table with entries, filter bar, Export CSV button, timestamps+admin names, search input |
| FT-063 | 5 | Integration: auth login → store → redirect flow | Done | 4 tests: token stored+user set, navigate to /dashboard, error message on rejection, validation on empty submit |
| FT-064 | 5 | Integration: league create wizard → API → navigate | Done | 4 tests: POST with correct payload, navigate to new league, success toast, error toast |
| FT-065 | 5 | Integration: contest create wizard → API → navigate | Done | 4 tests: sport+event selection, contest type, POST /v1/contests, navigate to new contest |
| FT-066 | 5 | Integration: billing entitlement gate flow | Done | 5 tests: entitled renders children, not entitled shows upgrade, usage count, upgrade link, loading fail-open |
| FT-067 | 5 | Integration: notification preferences toggle → save | Done | 5 tests: page heading, 6 categories displayed, channel headers, loading skeleton, error state |

---

*Ultimate Pool Manager — Frontend Test Coverage Plan v1.0*
