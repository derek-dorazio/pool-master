# PoolMaster Admin — Auth & Home Dashboard

This plan covers the admin login flow (SSO + MFA) and the home dashboard page that provides an at-a-glance overview of platform health, key metrics, recent alerts, and recent audit activity. These are the first pages an admin sees when accessing the internal tooling surface.

**Related service plan tasks:** 11-001, 11-002, 11-003

**Related plans:**

- **11 — Admin Dashboard:** Authentication & access control, platform health, audit logging
- **01 — Architecture:** SSO provider integration (Okta/Google Workspace), JWT handling
- **00 — Admin Sitemap:** Route structure and layout conventions

---

## Pages

### 1. Admin Login

**Route:** `/admin/login`

**Purpose:** Authenticates internal staff via SSO (Okta or Google Workspace) with mandatory MFA. This is completely separate from the public app auth flow. On success, establishes an admin session and redirects to `/admin`.

**Key Components:**

| Component | Description |
|---|---|
| **AdminLoginForm** | Container for the login flow. Manages step state (SSO selection -> MFA challenge). |
| **SSOButton** | Large branded buttons for each SSO provider (Okta, Google Workspace). Initiates OAuth redirect. |
| **MFAChallenge** | 6-digit code input (auto-advancing single-digit fields). Includes "Resend code" link with cooldown timer. Shown after successful SSO return. |
| **ErrorAlert** | Inline banner for error states: SSO failed, MFA invalid/expired, account inactive/locked. Dismissible. |

**Data Requirements:**

- `POST /api/v1/admin/auth/sso` — Initiates SSO redirect to configured provider.
- `POST /api/v1/admin/auth/mfa` — Validates MFA code and returns admin JWT.
- `GET /api/v1/admin/auth/callback` — Handles SSO provider redirect with authorization code.
- Auth state check on mount: if valid admin session exists, redirect to `/admin`.
- Admin JWT stored in memory (Zustand) + httpOnly secure cookie for refresh token.
- **Query keys:** `['admin', 'auth', 'session']`

**User Interactions / Flows:**

1. Admin navigates to `/admin/login` -> sees SSO provider buttons.
2. Clicks SSO provider button -> redirected to Okta/Google Workspace.
3. Completes SSO authentication -> redirected back to `/admin/login` with authorization code.
4. MFA challenge screen appears -> admin enters 6-digit code from authenticator app.
5. On MFA success -> redirect to `/admin`.
6. On MFA failure -> error message, allow retry (max 3 attempts before lockout).
7. If account is inactive -> "Account inactive. Contact your administrator." error.
8. If SSO fails -> "SSO authentication failed. Please try again." error with retry button.

**Wireframe:**

```
+----------------------------------------------------------+
|                                                          |
|               [PoolMaster Admin Logo]                    |
|                                                          |
|              Internal Operations Portal                  |
|                                                          |
|   +--------------------------------------------------+   |
|   |                                                    |   |
|   |    [ Sign in with Okta          ]                  |   |
|   |                                                    |   |
|   |    [ Sign in with Google        ]                  |   |
|   |                                                    |   |
|   +--------------------------------------------------+   |
|                                                          |
|    Access restricted to authorized personnel.            |
|                                                          |
+----------------------------------------------------------+

--- After SSO success (MFA step): ---

+----------------------------------------------------------+
|                                                          |
|               [PoolMaster Admin Logo]                    |
|                                                          |
|              Multi-Factor Authentication                 |
|                                                          |
|   Enter the 6-digit code from your authenticator app.    |
|                                                          |
|   +--------------------------------------------------+   |
|   |   [ _ ] [ _ ] [ _ ] [ _ ] [ _ ] [ _ ]             |   |
|   +--------------------------------------------------+   |
|                                                          |
|   [           Verify Code           ]                    |
|                                                          |
|   Didn't receive a code? Resend (available in 30s)       |
|                                                          |
+----------------------------------------------------------+
```

**Loading / Error / Empty States:**

- **Loading:** Full-page spinner with "Authenticating..." text during SSO callback processing.
- **SSO Error:** ErrorAlert banner: "SSO authentication failed. Please try again." with retry button.
- **MFA Invalid:** ErrorAlert banner: "Invalid code. Please check and try again." (attempts remaining shown).
- **MFA Expired:** ErrorAlert banner: "Code expired. A new code has been sent."
- **Account Inactive:** ErrorAlert banner: "Your admin account is inactive. Contact a Super Admin."
- **Account Locked:** ErrorAlert banner: "Account locked after too many failed attempts. Contact a Super Admin."

---

### 2. Admin Home Dashboard

**Route:** `/admin`

**Purpose:** Provides a high-level overview of platform health, key business metrics, recent alerts, and recent admin activity. This is the first page admins see after login and serves as a launchpad for common tasks.

**Key Components:**

| Component | Description |
|---|---|
| **MetricCard** | Reusable card displaying a single KPI: label, current value, trend indicator (up/down arrow + percentage), and sparkline. Used for Active Tenants, Total Users, Active Contests, Live Drafts, Notification Delivery Rate. |
| **ServiceHealthRow** | Horizontal row of service status indicators. Each service shows a colored dot (green = healthy, yellow = degraded, red = down) with service name and last-checked timestamp. Services: core-api, scoring-service, draft-service, notification-service, sports-data-ingestor, billing-service. |
| **AlertItem** | Single alert entry with severity badge (Critical/Warning/Info), message text, timestamp, and "View" link. Critical alerts have red background highlight. |
| **AuditPreview** | Compact audit log row: timestamp, admin name, action performed, resource affected. Links to full audit log on click. |
| **QuickActionBar** | Row of shortcut buttons: "Search User", "Search Tenant", "View Provider Status". Each navigates to the corresponding admin page. |

**Data Requirements:**

- `GET /api/v1/admin/dashboard/metrics` — Returns key platform metrics (active tenants, total users, active contests, live drafts, notification delivery rate) with trend data.
- `GET /api/v1/admin/dashboard/health` — Returns service health statuses for all backend services.
- `GET /api/v1/admin/dashboard/alerts?limit=5` — Returns the 5 most recent platform alerts with severity.
- `GET /api/v1/admin/audit?limit=10` — Returns the 10 most recent admin audit log entries.
- **Query keys:**
  - `['admin', 'dashboard', 'metrics']` — refetch interval: 60s
  - `['admin', 'dashboard', 'health']` — refetch interval: 30s
  - `['admin', 'dashboard', 'alerts']` — refetch interval: 60s
  - `['admin', 'audit', 'recent']` — refetch interval: 60s
- **Polling:** Metrics refresh every 60 seconds, health status refreshes every 30 seconds.

**User Interactions / Flows:**

1. Admin lands on `/admin` -> sees metrics cards, health row, alerts, and audit preview.
2. Clicks a MetricCard -> navigates to the relevant detail page (e.g., Active Tenants -> `/admin/tenants`).
3. Clicks a service in ServiceHealthRow -> navigates to `/admin/health` with that service pre-filtered.
4. Clicks an AlertItem "View" link -> navigates to `/admin/health/alerts` with that alert highlighted.
5. Clicks an AuditPreview row -> navigates to `/admin/audit` with that entry highlighted.
6. Clicks a QuickActionBar button -> navigates to the corresponding page (`/admin/users`, `/admin/tenants`, `/admin/providers`).
7. Data refreshes automatically at configured intervals; no manual refresh needed.

**Wireframe:**

```
+----------------------------------------------------------+
| PoolMaster Admin   [Health: ●]           [Admin Name ▾]  |
+----------+-----------------------------------------------+
|          |                                               |
| Sidebar  |  Admin Dashboard                              |
|          |                                               |
| Dashboard|  +--------+ +--------+ +--------+ +--------+ |
| Tenants  |  | Active | | Total  | | Active | | Live   | |
| Users    |  |Tenants | | Users  | |Contests| | Drafts | |
| Contests |  | 142    | | 8,431  | | 67     | | 3      | |
| Providers|  | +2.1%  | | +5.3%  | | -1.4%  | | --     | |
| Flags    |  +--------+ +--------+ +--------+ +--------+ |
| Health   |                                               |
| Audit    |  +--------+                                   |
| Announce |  |Notif.  |                                   |
| Migrate  |  |Delivery|                                   |
|          |  | 99.2%  |                                   |
|          |  | -0.1%  |                                   |
|          |  +--------+                                   |
|          |                                               |
|          |  Service Health                               |
|          |  ● core-api  ● scoring  ● draft  ● notif     |
|          |  ● sports-data  ● billing                     |
|          |                                               |
|          |  Recent Alerts                                |
|          |  +--------------------------------------------+|
|          |  | [CRIT] Scoring service latency > 2s  10m  ||
|          |  | [WARN] Provider ESPN rate limit 80%  45m   ||
|          |  | [INFO] Deployment v2.4.1 complete    2h    ||
|          |  +--------------------------------------------+|
|          |                                               |
|          |  Recent Admin Activity                        |
|          |  +--------------------------------------------+|
|          |  | 10:32  jane@pm  Suspended tenant #42       ||
|          |  | 10:15  bob@pm   Changed plan: tenant #18   ||
|          |  | 09:58  jane@pm  Force logout user #1042    ||
|          |  +--------------------------------------------+|
|          |                                               |
|          |  Quick Actions                                |
|          |  [Search User] [Search Tenant] [Provider Status]|
|          |                                               |
+----------+-----------------------------------------------+
```

**Loading / Error / Empty States:**

- **Loading:** Skeleton cards for metrics (pulsing rectangles), skeleton rows for alerts and audit. ServiceHealthRow shows gray dots with "Checking..." labels.
- **Metrics Error:** MetricCard shows "Error loading" text with retry icon. Other sections remain functional.
- **Health Error:** ServiceHealthRow shows gray dots with "Unable to check" labels.
- **No Alerts:** AlertItem section shows "No recent alerts" with a green checkmark icon.
- **No Audit Entries:** AuditPreview section shows "No recent admin activity."
- **Partial Failure:** Each section loads independently; if one API fails, the others still render. Failed sections show inline error with "Retry" link.

---

## Cross-Cutting Concerns

- **Admin Layout:** All admin pages use the AdminLayout with persistent sidebar navigation, top bar with health indicator and admin user dropdown. Login page uses a minimal layout without sidebar.
- **Auth Guard:** All routes except `/admin/login` are wrapped in an `AdminAuthGuard` that checks for a valid admin JWT and redirects to login if missing or expired.
- **RBAC:** Dashboard is visible to all admin roles (Super Admin, Operations, Support, Data Ops, Viewer).
- **Audit Logging:** Login events (success, failure, MFA attempts) are automatically logged to the admin audit trail.
- **Responsive:** Desktop-only layout, minimum width 1024px. No mobile optimization.
- **Error Boundary:** Global error boundary wraps the dashboard content; toast notifications for transient API errors.

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| AA-001 | 1 | Build AdminLoginForm with SSO provider buttons and OAuth redirect flow | Partial | Login form exists with mock SSO; real SSO/MFA not integrated |
| AA-002 | 1 | Build MFAChallenge component with 6-digit input, resend logic, attempt tracking, and error states | Not Started | MFA challenge component not built |
| AA-003 | 2 | Build Admin Home Dashboard layout with MetricCard row and ServiceHealthRow | Done | |
| AA-004 | 2 | Build MetricCard component with value, trend indicator, sparkline, and click-through navigation | Done | |
| AA-005 | 2 | Build AlertItem list, AuditPreview list, and QuickActionBar with polling integration | Done | |
