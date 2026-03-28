# PoolMaster — Admin Dashboard Sitemap

The admin dashboard is a **separate SPA** from the public webapp, accessible only to internal PoolMaster operations staff. It provides tenant management, user support, contest operations, sports data monitoring, feature flags, platform health, and audit logging.

**Tech stack:** React 18+, TypeScript, React Router, TanStack Query, TailwindCSS, Recharts (for metrics charts)
**Auth:** Internal SSO (Okta/Google Workspace) + MFA — separate from public app auth
**Access:** VPN or IP-restricted, not exposed to the public internet
**Backend:** Same core-api Fastify services, admin-scoped endpoints under `/api/v1/admin`
**Service plan:** [11-poolmaster-admin-dashboard.md](../11-poolmaster-admin-dashboard.md)

---

## Route Structure

```
/admin                                    → Admin dashboard home
/admin/login                              → Admin SSO login

/admin/tenants                            → Tenant list
/admin/tenants/:tenantId                  → Tenant detail
/admin/tenants/:tenantId/impersonate      → Impersonation session

/admin/users                              → User search
/admin/users/:userId                      → User detail
/admin/users/merge                        → User merge tool

/admin/contests                           → Contest browser
/admin/contests/:contestId                → Contest detail + admin actions

/admin/providers                          → Sports data provider dashboard
/admin/providers/:providerId              → Provider detail + config
/admin/providers/ingestion                → Ingestion monitoring

/admin/flags                              → Feature flag management
/admin/flags/:flagKey                     → Feature flag detail + overrides

/admin/health                             → Platform health dashboard
/admin/health/errors                      → Error log viewer
/admin/health/alerts                      → Alert configuration

/admin/audit                              → Audit log viewer

/admin/announcements                      → Global announcements
/admin/announcements/create               → Create announcement

/admin/config                             → Configuration hub
/admin/config/templates                   → Template management
/admin/config/notifications               → Notification configuration
/admin/config/platform                    → Platform configuration

/admin/migrations                         → Migration runner
/admin/migrations/:runId                  → Migration run detail
```

---

## Sitemap by Section

### 1. Admin Auth & Home
**Page plan:** [01-adminapp-auth-home.md](01-adminapp-auth-home.md)
**Service plan tasks:** 11-001, 11-002, 11-003

| Route | Page | Description |
|---|---|---|
| `/admin/login` | Admin Login | SSO login (Okta/Google Workspace) + MFA |
| `/admin` | Admin Home | Overview dashboard — key platform metrics, alerts, recent audit entries |

---

### 2. Tenant Management
**Page plan:** [02-adminapp-tenants.md](02-adminapp-tenants.md)
**Service plan tasks:** 11-004, 11-005, 11-006

| Route | Page | Description |
|---|---|---|
| `/admin/tenants` | Tenant List | Searchable, filterable table of all tenants with plan, members, status |
| `/admin/tenants/:tenantId` | Tenant Detail | Full tenant view: subscription, usage, leagues, activity, billing, health |
| `/admin/tenants/:tenantId/impersonate` | Impersonation | Launch impersonation session (task 11-025) |

---

### 3. User Management
**Page plan:** [03-adminapp-users.md](03-adminapp-users.md)
**Service plan tasks:** 11-008, 11-009, 11-010, 11-013

| Route | Page | Description |
|---|---|---|
| `/admin/users` | User Search | Cross-tenant search by email, name, ID, tenant |
| `/admin/users/:userId` | User Detail | User profile, tenants, leagues, devices, auth events, notifications |
| `/admin/users/merge` | User Merge | Merge duplicate accounts, preview + confirm |

---

### 4. Contest Operations
**Page plan:** [04-adminapp-contests.md](04-adminapp-contests.md)
**Service plan tasks:** 11-011, 11-012

| Route | Page | Description |
|---|---|---|
| `/admin/contests` | Contest Browser | Browse any contest across all tenants, filter by status/sport/tenant |
| `/admin/contests/:contestId` | Contest Detail | Standings, scoring data, draft status, overrides, admin actions |

---

### 5. Sports Data Providers
**Page plan:** [05-adminapp-providers.md](05-adminapp-providers.md)
**Service plan tasks:** 11-014, 11-015, 11-016, 11-017

| Route | Page | Description |
|---|---|---|
| `/admin/providers` | Provider Dashboard | All providers with status, error rate, latency, last event |
| `/admin/providers/:providerId` | Provider Detail | Config, credentials (masked), webhooks, health thresholds, cost |
| `/admin/providers/ingestion` | Ingestion Monitor | Active jobs, recent errors, per-sport throughput |

---

### 6. Feature Flags
**Page plan:** [06-adminapp-feature-flags.md](06-adminapp-feature-flags.md)
**Service plan tasks:** 11-018, 11-019, 11-020

| Route | Page | Description |
|---|---|---|
| `/admin/flags` | Flag List | All feature flags with global status, rollout %, override count |
| `/admin/flags/:flagKey` | Flag Detail | Edit flag, tenant overrides, rollout config, audit history |

---

### 7. Platform Health
**Page plan:** [07-adminapp-health.md](07-adminapp-health.md)
**Service plan tasks:** 11-021, 11-022, 11-023, 11-024

| Route | Page | Description |
|---|---|---|
| `/admin/health` | Health Dashboard | Service statuses, infrastructure metrics, key business metrics |
| `/admin/health/errors` | Error Log | Recent errors with stack traces, request IDs, filtering |
| `/admin/health/alerts` | Alert Config | Threshold configuration for Slack/PagerDuty alerts |

---

### 8. Audit Log
**Page plan:** [08-adminapp-audit.md](08-adminapp-audit.md)
**Service plan tasks:** 11-007

| Route | Page | Description |
|---|---|---|
| `/admin/audit` | Audit Log Viewer | Filterable, searchable audit trail with CSV export |

---

### 9. Announcements & Migrations
**Page plan:** [09-adminapp-announcements-migrations.md](09-adminapp-announcements-migrations.md)
**Service plan tasks:** 11-025, 11-026, 11-027, 11-028, 11-029, 11-030

| Route | Page | Description |
|---|---|---|
| `/admin/announcements` | Announcements | Active/scheduled announcements, create new |
| `/admin/announcements/create` | Create Announcement | Form: type, severity, targeting, scheduling |
| `/admin/migrations` | Migration Runner | Available migrations, active runs, history |
| `/admin/migrations/:runId` | Migration Detail | Progress bar, error log, cancel button |

---

## Layout Structure

```
┌─────────────────────────────────────────────────────┐
│  PoolMaster Admin    [Health: ●]    [Admin Name ▾]  │
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│ Sidebar  │         Main Content                     │
│          │                                          │
│ Dashboard│                                          │
│ Tenants  │                                          │
│ Users    │                                          │
│ Contests │                                          │
│ Providers│                                          │
│ Flags    │                                          │
│ Health   │                                          │
│ Audit    │                                          │
│ Announce │                                          │
│ Migrate  │                                          │
│          │                                          │
└──────────┴──────────────────────────────────────────┘
```

- **Admin layout** — always-visible sidebar, top bar with health indicator and admin user menu
- **Impersonation banner** — yellow bar at top when impersonating a tenant: "Impersonating: {tenant} [End Session]"

---

## Cross-Cutting Concerns

| Concern | Approach |
|---|---|
| **Auth** | SSO via Okta/Google Workspace, MFA required, JWT with admin claims |
| **RBAC** | All routes check admin permissions via `requireAdminPermission` preHandler |
| **Audit** | All mutating actions automatically logged via admin-audit-hook |
| **Polling** | Health dashboard: 30s, provider status: 30s, everything else on-demand |
| **Error handling** | Global error boundary, toast for API errors |
| **Responsive** | Desktop-first (admin tool, not mobile), min-width 1024px |

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| A-001 | 1 | Create page plan: Admin Auth & Home | Done | [01-adminapp-auth-home.md](01-adminapp-auth-home.md) |
| A-002 | 1 | Create page plan: Tenant Management | Done | [02-adminapp-tenants.md](02-adminapp-tenants.md) |
| A-003 | 1 | Create page plan: User Management | Done | [03-adminapp-users.md](03-adminapp-users.md) |
| A-004 | 1 | Create page plan: Contest Operations | Done | [04-adminapp-contests.md](04-adminapp-contests.md) |
| A-005 | 1 | Create page plan: Sports Data Providers | Done | [05-adminapp-providers.md](05-adminapp-providers.md) |
| A-006 | 1 | Create page plan: Feature Flags | Done | [06-adminapp-feature-flags.md](06-adminapp-feature-flags.md) |
| A-007 | 1 | Create page plan: Platform Health | Done | [07-adminapp-health.md](07-adminapp-health.md) |
| A-008 | 1 | Create page plan: Audit Log | Done | [08-adminapp-audit.md](08-adminapp-audit.md) |
| A-009 | 1 | Create page plan: Announcements & Migrations | Done | [09-adminapp-announcements-migrations.md](09-adminapp-announcements-migrations.md) |
| A-010 | 2 | Scaffold admin SPA with Vite + React Router | Done | Created clients/admin with Vite, React Router (basename=/admin), TanStack Query, Tailwind, 22 lazy-loaded route placeholders, all config files |
| A-011 | 2 | Implement admin layout + sidebar + auth | Done | AdminLayout with 240px fixed sidebar (10 nav items with lucide icons, NavLink active state), top bar with health dot + user dropdown, auth guard redirect, impersonation banner placeholder; AdminLoginLayout for login page; AdminAuthStore with zustand |
| A-012 | 3 | Implement tenant list + detail pages | Not Started | |
| A-013 | 3 | Implement user search + detail pages | Not Started | |
| A-014 | 3 | Implement contest browser + detail pages | Not Started | |
| A-015 | 4 | Implement provider dashboard pages | Not Started | |
| A-016 | 4 | Implement feature flag pages | Not Started | |
| A-017 | 4 | Implement health dashboard pages | Not Started | |
| A-018 | 4 | Implement audit log viewer | Not Started | |
| A-019 | 5 | Implement announcements pages | Not Started | |
| A-020 | 5 | Implement migration runner pages | Not Started | |
| A-021 | 5 | Implement configuration management pages | Done | Config hub, template management, notification config, platform config pages; use-config-api hooks with mock data; 4 new routes + sidebar nav item |

---

*PoolMaster Admin Dashboard Sitemap v1.0*
