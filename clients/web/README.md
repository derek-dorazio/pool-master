# PoolMaster — Web App

React + TypeScript single-page application. Built with Vite, TailwindCSS, shadcn/ui, TanStack Query, Zustand, and React Router.

## Quick Start

```bash
npm run dev --workspace=@poolmaster/web
# or: cd clients/web && npm run dev
```

Opens at http://localhost:5173. Proxies API calls to `http://localhost:3000`.

## Features

| Feature Area | Route(s) | Key Components |
|---|---|---|
| **Auth** | `/login`, `/register`, `/forgot-password` | Login form, 5-step registration wizard, age verification |
| **Dashboard** | `/dashboard` | Active contests (10s poll), upcoming drafts (countdown), leagues grid, activity feed, highlights |
| **Leagues** | `/leagues/*` | List (grid/list view), 4-step creation wizard, detail with 6 tabs, settings, members, feed, history, records |
| **Contests** | `/contests/*` | 7-step creation wizard, pre-draft/active/completed views, standings, scoring breakdown, head-to-head |
| **Draft Room** | `/drafts/:id` | Full-screen 4-panel layout (available, pick board, roster, chat). Snake, auction, tiered, pick'em, bracket variants |
| **Standings** | `/contests/:id/standings` | Sortable table, rank badges, movement arrows, score timeline chart, mobile view |
| **History** | `/leagues/:id/records`, `/leagues/:id/history` | Record book, season archive, contest results, H2H rivalry, personal stats |
| **Discovery** | `/discover/*` | Hub with sport tabs, browse leagues/contests, global search with tabs |
| **Notifications** | `/notifications` | Notification centre, preferences matrix, DND scheduler, push permission |
| **Settings** | `/settings/*` | Profile, password, linked accounts, timezone, privacy, consent, self-exclusion |
| **Billing** | `/billing/*` | Deferred (free launch) — entitlement gate ready |
| **Legal** | `/privacy`, `/terms`, `/cookie-policy`, `/responsible-gaming` | Full content pages with TOC sidebar, cookie banner |

## Architecture

```
src/
├── components/
│   ├── layouts/          # PublicLayout, AuthenticatedLayout, FullscreenLayout, LegalPage
│   └── ui/               # shadcn/ui primitives (Button, Card, Badge, Input, etc.)
├── features/
│   ├── dashboard/        # Dashboard widgets + hooks (7 components)
│   ├── draft-room/       # Draft room panels + variants (10 components)
│   ├── discovery/        # Discovery cards, search bar, hooks
│   ├── standings/        # Timeline chart, live badge, stale warning, mobile view
│   ├── history/          # Personal stats widget
│   ├── leagues/          # Join/leave flow, role guard, entitlement gate
│   ├── contests/         # Pre-draft view, polling hook, commissioner controls
│   ├── notifications/    # Bell, dropdown, list, preferences, DND, push permission
│   └── settings/         # Profile form, password, privacy, consent, data export
├── pages/                # One component per route (lazy-loaded)
├── stores/               # Zustand: auth, preferences
├── hooks/                # Shared hooks (useFormat, useToast)
├── lib/                  # API client, query client, i18n, formatters
├── locales/              # i18next JSON translations
└── routes/               # React Router configuration
```

## State Management

| Layer | Tool | What |
|---|---|---|
| Server state | TanStack Query | All API data, polling, caching |
| Client state | Zustand | Auth, sidebar, preferences |
| URL state | React Router | Route params, search params |
| Form state | React Hook Form + Zod | Validation, multi-step wizards |

## Testing

```bash
# E2E smoke tests (requires full stack running)
npx playwright test

# Install browsers (first time)
npx playwright install
```

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite 5 |
| Styling | TailwindCSS 3 + shadcn/ui (Radix) |
| State | TanStack Query 5 + Zustand 4 |
| Forms | React Hook Form 7 + Zod |
| Routing | React Router 6 (lazy loading) |
| i18n | i18next |
| Icons | Lucide React |
| E2E Tests | Playwright |
