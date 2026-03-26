# PoolMaster — Web Application Sitemap

This document defines the complete sitemap for the PoolMaster React web application. Each page maps to one or more backend service plans, ensuring full coverage of all user-facing functionality.

**Tech stack:** React 18+, TypeScript, React Router, TanStack Query, Zustand, shadcn/ui, TailwindCSS, Vite — see [React UI Rules](../../rules/react-ui-rules.md)

**Detailed page plans:** Each section below links to a dedicated page plan in this folder.

---

## Route Structure

```
/                                         → Landing / Marketing (unauthenticated)
/login                                    → Login
/register                                 → Registration
/forgot-password                          → Password reset
/callback                                 → Auth callback (Auth0/Cognito)

/dashboard                                → User home dashboard
/notifications                            → Notification centre

/leagues                                  → My leagues list
/leagues/create                           → League creation wizard
/leagues/:leagueId                        → League home (standings, upcoming, feed)
/leagues/:leagueId/settings               → League settings (commissioner)
/leagues/:leagueId/members                → Member management
/leagues/:leagueId/feed                   → League activity feed
/leagues/:leagueId/records                → League record book
/leagues/:leagueId/history                → League history (past seasons)

/contests/:contestId                      → Contest detail (standings, scores)
/contests/:contestId/standings            → Full standings / leaderboard
/contests/:contestId/scoring              → Score breakdown per entry
/contests/:contestId/results              → Final results (completed contests)
/contests/:contestId/head-to-head         → Head-to-head comparison
/contests/create                          → Contest creation wizard

/drafts/:draftId                          → Draft room (live or async)
/drafts/:draftId/results                  → Draft recap / results

/discover                                 → Public discovery hub
/discover/leagues                         → Browse public leagues
/discover/contests                        → Browse open contests

/settings                                 → User settings hub
/settings/profile                         → Profile & preferences
/settings/notifications                   → Notification preferences
/settings/timezone                        → Timezone & locale
/settings/privacy                         → Privacy & data controls

/billing                                  → Billing & subscription
/billing/plans                            → Plan selection / comparison
/billing/invoices                         → Invoice history

/privacy                                  → Privacy policy (public)
/terms                                    → Terms of service (public)
/responsible-gaming                       → Responsible gaming info (public)
/cookie-policy                            → Cookie policy (public)

/share/:shareId                           → Public share card view

/admin/...                                → Admin dashboard (see plan 11, separate SPA)
```

---

## Sitemap by Section

### 1. Authentication & Onboarding
**Page plan:** [01-webapp-auth.md](01-webapp-auth.md)
**Service plans:** 01 (Auth), 07 (Billing/Trial), 14 (i18n), 15 (Compliance)

| Route | Page | Description |
|---|---|---|
| `/` | Landing Page | Marketing, feature overview, CTA to register/login |
| `/login` | Login | Auth0/Cognito hosted login or embedded form |
| `/register` | Registration | Sign up with email/social, age verification (15), plan selection (07) |
| `/forgot-password` | Password Reset | Email-based password reset flow |
| `/callback` | Auth Callback | OAuth redirect handler |

---

### 2. Dashboard
**Page plan:** [02-webapp-dashboard.md](02-webapp-dashboard.md)
**Service plans:** 01 (Core API), 08 (Commissioner), 09 (Notifications), 04 (History)

| Route | Page | Description |
|---|---|---|
| `/dashboard` | Home Dashboard | My leagues summary, active contests, upcoming drafts, recent activity, notifications badge |

---

### 3. Leagues
**Page plan:** [03-webapp-leagues.md](03-webapp-leagues.md)
**Service plans:** 01 (Core API), 08 (Commissioner Tooling), 10 (Social), 04 (History), 06 (Participant Data)

| Route | Page | Description |
|---|---|---|
| `/leagues` | My Leagues | List of leagues user belongs to, with role badges |
| `/leagues/create` | League Creation Wizard | Multi-step: name, sport, invite policy, visibility, settings |
| `/leagues/:leagueId` | League Home | Dashboard for a league: active contests, standings snapshot, feed preview |
| `/leagues/:leagueId/settings` | League Settings | Commissioner config: rules, invite policy, visibility, danger zone |
| `/leagues/:leagueId/members` | Member Management | Invite, remove, change roles, pending invitations |
| `/leagues/:leagueId/feed` | League Feed | Activity feed with posts, reactions, threads, automated events |
| `/leagues/:leagueId/records` | League Records | All-time record book: best scores, most wins, streaks |
| `/leagues/:leagueId/history` | League History | Past seasons, contest archive, season summaries |

---

### 4. Contests
**Page plan:** [04-webapp-contests.md](04-webapp-contests.md)
**Service plans:** 01 (Core API), 02 (Draft Config), 02a (Contest Structures), 03 (Scoring), 04 (History), 06 (Participant Data), 08 (Commissioner)

| Route | Page | Description |
|---|---|---|
| `/contests/create` | Contest Creation Wizard | Sport, event, contest type, scoring rules, draft config, participant pool |
| `/contests/:contestId` | Contest Detail | Current standings, my entry, scoring status, contest info |
| `/contests/:contestId/standings` | Full Standings | Complete leaderboard with entry details, score breakdowns |
| `/contests/:contestId/scoring` | Score Breakdown | Per-entry scoring detail: which participants scored what |
| `/contests/:contestId/results` | Contest Results | Final results, winner, prize distribution (completed contests) |
| `/contests/:contestId/head-to-head` | Head-to-Head | Compare two entries side-by-side |

---

### 5. Draft Room
**Page plan:** [05-webapp-draft-room.md](05-webapp-draft-room.md)
**Service plans:** 02 (Draft Config), 06 (Participant Data), 13 (Search)

| Route | Page | Description |
|---|---|---|
| `/drafts/:draftId` | Draft Room | Live/async draft UI: pick board, available participants, my roster, timer, chat |
| `/drafts/:draftId/results` | Draft Recap | Post-draft summary: all picks by round, team rosters, analysis |

---

### 6. Standings & Scoring
**Page plan:** [06-webapp-standings-scoring.md](06-webapp-standings-scoring.md)
**Service plans:** 03 (Scoring Rules), 04 (History), 01 (Core API)

| Route | Page | Description |
|---|---|---|
| (Embedded in contest pages) | Leaderboard | Sortable standings table with rank, entry name, total score, movement |
| (Embedded in contest pages) | Score Timeline | Scoring progression over time, key moments |
| (Embedded in contest pages) | Participant Scorecard | Individual participant stat-to-score breakdown |

---

### 7. History & Analytics
**Page plan:** [07-webapp-history.md](07-webapp-history.md)
**Service plans:** 04 (History)

| Route | Page | Description |
|---|---|---|
| `/leagues/:leagueId/records` | Record Book | League records: best single-contest score, most wins, longest streak |
| `/leagues/:leagueId/history` | Season Archive | Past seasons with expandable contest results |
| `/contests/:contestId/results` | Contest Results | Final standings, winner highlight, scoring summary |
| `/contests/:contestId/head-to-head` | Rivalry View | Head-to-head record between two members across contests |

---

### 8. Social & Communication
**Page plan:** [08-webapp-social.md](08-webapp-social.md)
**Service plans:** 10 (Social/Communication), 09 (Notifications)

| Route | Page | Description |
|---|---|---|
| `/leagues/:leagueId/feed` | League Feed | Posts, threaded replies, reactions, polls, automated events |
| (Embedded in draft/contest) | Contest Chat | Ephemeral chat during live events |
| (Modal/drawer) | Direct Messages | 1-to-1 messaging between league members |
| `/share/:shareId` | Share Card | Public OG-image share card for social media |

---

### 9. Notifications
**Page plan:** [09-webapp-notifications.md](09-webapp-notifications.md)
**Service plans:** 09 (Notifications & Alerts)

| Route | Page | Description |
|---|---|---|
| `/notifications` | Notification Centre | Persistent inbox: all notifications, mark read, filter by type |
| `/settings/notifications` | Notification Preferences | Per-category opt-in/out, per-channel toggles, DND schedule |

---

### 10. Billing & Subscription
**Page plan:** [10-webapp-billing.md](10-webapp-billing.md)
**Service plans:** 07 (Billing & Subscription)

| Route | Page | Description |
|---|---|---|
| `/billing` | Billing Overview | Current plan, usage, next invoice, payment method |
| `/billing/plans` | Plan Comparison | Plan tiers with feature matrix, upgrade/downgrade CTAs |
| `/billing/invoices` | Invoice History | Past invoices with PDF download links |

---

### 11. Settings & Preferences
**Page plan:** [11-webapp-settings.md](11-webapp-settings.md)
**Service plans:** 14 (i18n), 15 (Compliance), 09 (Notifications)

| Route | Page | Description |
|---|---|---|
| `/settings` | Settings Hub | Navigation to all settings sub-pages |
| `/settings/profile` | Profile | Display name, avatar, email, password change |
| `/settings/notifications` | Notifications | (Same as notification preferences above) |
| `/settings/timezone` | Timezone & Locale | Timezone picker, date format, number format |
| `/settings/privacy` | Privacy & Data | Data export request, account deletion, consent management |

---

### 12. Discovery
**Page plan:** [12-webapp-discovery.md](12-webapp-discovery.md)
**Service plans:** 13 (Search & Discovery)

| Route | Page | Description |
|---|---|---|
| `/discover` | Discovery Hub | Featured leagues, trending contests, search bar |
| `/discover/leagues` | Browse Leagues | Public leagues with filters (sport, size, activity) |
| `/discover/contests` | Browse Contests | Open contests with filters (sport, type, event) |

---

### 13. Legal & Compliance
**Page plan:** [13-webapp-legal.md](13-webapp-legal.md)
**Service plans:** 15 (Responsible Gaming & Compliance)

| Route | Page | Description |
|---|---|---|
| `/privacy` | Privacy Policy | Full privacy policy, public |
| `/terms` | Terms of Service | Full ToS, public |
| `/responsible-gaming` | Responsible Gaming | Information page, self-exclusion link, resources |
| `/cookie-policy` | Cookie Policy | Cookie usage details |
| (Banner) | Cookie Consent | GDPR/CCPA cookie consent banner |

---

## Layout Structure

```
┌─────────────────────────────────────────────┐
│  Top Nav: Logo, Search, Notifications, User │
├──────────┬──────────────────────────────────┤
│          │                                  │
│  Sidebar │        Main Content              │
│  (auth)  │                                  │
│          │                                  │
│  - Dash  │                                  │
│  - Leagues│                                 │
│  - Discover│                                │
│  - Settings│                                │
│  - Billing │                                │
│          │                                  │
├──────────┴──────────────────────────────────┤
│  Footer: Links, Legal, Version              │
└─────────────────────────────────────────────┘
```

**Layouts:**
- **Public layout** — Landing, login, register, legal pages (no sidebar)
- **Authenticated layout** — Sidebar nav + top bar (dashboard, leagues, contests, settings)
- **Full-screen layout** — Draft room (maximise screen real estate)
- **Admin layout** — Separate SPA with admin-specific navigation (plan 11)

---

## Cross-Cutting Concerns

| Concern | Approach | Service Plan |
|---|---|---|
| **Authentication** | Auth0/Cognito, JWT in memory, refresh via httpOnly cookie | 01 |
| **Polling** | TanStack Query with 10-30s refetchInterval, ETag/304 support | 01 |
| **Error handling** | Error boundaries per route, toast notifications for API errors | — |
| **Loading states** | Skeleton screens (shadcn/ui Skeleton), Suspense boundaries | — |
| **Responsive design** | Mobile-first, breakpoints: sm/md/lg/xl, sidebar collapses to bottom nav | — |
| **Timezone display** | Dual timezone (user + league) where relevant | 14 |
| **i18n** | i18next with namespace-per-page, English only at launch | 14 |
| **Entitlements** | Feature gating via entitlement checks (plan limits) | 07 |
| **Analytics** | Plausible or PostHog (privacy-focused, no Google Analytics) | 01 |
| **Cookie consent** | Banner on first visit, consent stored, respect DNT | 15 |

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| W-001 | 1 | Create page plan: Authentication & Onboarding | Done | [01-webapp-auth.md](01-webapp-auth.md) |
| W-002 | 1 | Create page plan: Dashboard | Done | [02-webapp-dashboard.md](02-webapp-dashboard.md) |
| W-003 | 1 | Create page plan: Leagues | Done | [03-webapp-leagues.md](03-webapp-leagues.md) |
| W-004 | 1 | Create page plan: Contests | Done | [04-webapp-contests.md](04-webapp-contests.md) — 6 pages, 15 tasks (W-C-001 to W-C-015) |
| W-005 | 1 | Create page plan: Draft Room | Done | [05-webapp-draft-room.md](05-webapp-draft-room.md) — Full 4-panel layout, 5 draft types, 16 tasks |
| W-006 | 1 | Create page plan: Standings & Scoring | Done | [06-webapp-standings-scoring.md](06-webapp-standings-scoring.md) |
| W-007 | 1 | Create page plan: History & Analytics | Done | [07-webapp-history.md](07-webapp-history.md) |
| W-008 | 1 | Create page plan: Social & Communication | Done | [08-webapp-social.md](08-webapp-social.md) |
| W-009 | 1 | Create page plan: Notifications | Done | [09-webapp-notifications.md](09-webapp-notifications.md) |
| W-010 | 1 | Create page plan: Billing & Subscription | Done | [10-webapp-billing.md](10-webapp-billing.md) |
| W-011 | 1 | Create page plan: Settings & Preferences | Done | [11-webapp-settings.md](11-webapp-settings.md) |
| W-012 | 1 | Create page plan: Discovery | Done | [12-webapp-discovery.md](12-webapp-discovery.md) |
| W-013 | 1 | Create page plan: Legal & Compliance | Done | [13-webapp-legal.md](13-webapp-legal.md) |
| W-014 | 2 | Scaffold React app with Vite + React Router | Done | Vite + React 18 + TypeScript, 40 lazy-loaded route placeholders, `@/` path alias |
| W-015 | 2 | Implement shared layout components (public, auth, fullscreen) | Done | PublicLayout, AuthenticatedLayout (sidebar + topbar), FullscreenLayout (draft room) |
| W-016 | 2 | Set up TanStack Query provider + polling infrastructure | Done | QueryClientProvider in app.tsx, api-client.ts with JWT auth, 30s staleTime default |
| W-017 | 2 | Set up Zustand stores (auth, user preferences) | Done | auth-store.ts (user, tokens), preferences-store.ts (timezone, formats, sidebar) with localStorage persistence |
| W-018 | 2 | Set up i18next with namespace-per-page | Not Started | |
| W-019 | 3 | Implement auth pages (login, register, callback) | Not Started | Depends on W-015 |
| W-020 | 3 | Implement dashboard page | Not Started | Depends on W-016, W-017 |
| W-021 | 3 | Implement leagues list + creation wizard | Not Started | |
| W-022 | 3 | Implement contest detail + standings pages | Not Started | |
| W-023 | 3 | Implement draft room | Not Started | Most complex page |
| W-024 | 4 | Implement league feed + social features | Not Started | |
| W-025 | 4 | Implement notification centre + preferences | Not Started | |
| W-026 | 4 | Implement settings pages | Not Started | |
| W-027 | 4 | Implement billing pages | Not Started | |
| W-028 | 4 | Implement discovery pages | Not Started | |
| W-029 | 4 | Implement legal/compliance pages | Not Started | |
| W-030 | 5 | Implement history & analytics pages | Not Started | |
| W-031 | 5 | Implement share card public view | Not Started | |
| W-032 | 5 | Cross-browser testing and accessibility audit | Not Started | |

---

*PoolMaster Webapp Sitemap v1.0*
