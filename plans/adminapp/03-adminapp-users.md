# PoolMaster Admin — User Management Pages

This plan covers the user search, user detail, and user merge pages for the admin dashboard. These pages enable support and operations staff to look up any user across all tenants, inspect their profile, devices, auth history, and notifications, perform account actions (reset password, disable, force logout), and merge duplicate accounts.

**Related service plan tasks:** 11-008, 11-009, 11-010, 11-013

**Related plans:**

- **11 — Admin Dashboard:** User management, user merge tool, support operations
- **01 — Architecture:** Authentication, multi-tenant user model
- **09 — Notifications:** Push device registration, delivery logs
- **00 — Admin Sitemap:** Route structure and layout conventions

---

## Pages

### 1. User Search

**Route:** `/admin/users`

**Purpose:** Cross-tenant user search that allows admins to find any user on the platform by email, display name, user ID, or tenant name. This is the primary entry point for user support investigations.

**Key Components:**

| Component | Description |
|---|---|
| **UserSearchBar** | Full-width search input with placeholder "Search by email, display name, user ID, or tenant name...". Debounced input (300ms). Supports paste-and-search for user IDs. Search icon and clear button. |
| **UserResultsTable** | Results table with columns: Email, Display Name, Tenant(s), Last Login, Status (Active/Disabled). Rows are clickable (navigate to user detail). Tenant(s) column shows comma-separated tenant names if user belongs to multiple. |
| **UserRow** | Single result row. Status shown as colored badge (green = Active, red = Disabled). Tenant names are links to tenant detail pages. |

**Data Requirements:**

- `GET /api/v1/admin/users?search={query}&page&pageSize` — Cross-tenant user search. Returns paginated results matching email, display name, user ID, or tenant name.
- **Query keys:** `['admin', 'users', { search, page, pageSize }]`
- Response shape: `{ data: AdminUserResult[], total: number, page: number, pageSize: number }`
- Search is triggered after 2+ characters are typed (or immediately for user ID format).

**User Interactions / Flows:**

1. Admin navigates to `/admin/users` -> sees search bar with empty state.
2. Types a search query (email, name, ID, or tenant name) -> results appear after 300ms debounce.
3. Results show which tenant(s) each user belongs to (cross-tenant visibility).
4. Clicks a user row -> navigates to `/admin/users/:userId`.
5. Clicks a tenant name in the Tenant(s) column -> navigates to `/admin/tenants/:tenantId`.
6. Clears search -> returns to empty state.

**Wireframe:**

```
+----------------------------------------------------------+
| PoolMaster Admin   [Health: ●]           [Admin Name ▾]  |
+----------+-----------------------------------------------+
|          |                                               |
| Sidebar  |  Users                                        |
|          |                                               |
|          |  [Search by email, name, ID, or tenant... [x]]|
|          |                                               |
|          |  +--------------------------------------------+|
|          |  | Email          Name       Tenant(s)  Last  ||
|          |  |                                     Login  ||
|          |  |--------------------------------------------|
|          |  | jane@acme.com  Jane Doe   Acme Corp  2h ago||
|          |  |                            Active          ||
|          |  |--------------------------------------------|
|          |  | jane@beta.io   Jane S.    Beta LLC,  1d ago||
|          |  |                           Gamma Inc        ||
|          |  |                            Active          ||
|          |  |--------------------------------------------|
|          |  | jdoe@test.com  J. Doe    Delta Co   30d ago||
|          |  |                            Disabled         ||
|          |  +--------------------------------------------+|
|          |                                               |
|          |  Showing 1-25 of 3       [25▾] [< 1 >]       |
|          |                                               |
+----------+-----------------------------------------------+
```

**Loading / Error / Empty States:**

- **Loading:** Skeleton table rows (5 rows) with pulsing animation while search results are fetching.
- **Error:** Inline error above table: "Search failed. [Retry]". Search bar remains interactive.
- **Empty (no query):** Centered message: "Search for a user by email, display name, user ID, or tenant name." with a search icon.
- **Empty (no results):** "No users found matching '{query}'. Try a different search term."

---

### 2. User Detail

**Route:** `/admin/users/:userId`

**Purpose:** Comprehensive view of a single user's profile, tenant memberships, contest participation, devices, authentication events, and notification delivery history. Provides action controls for account management.

**Key Components:**

| Component | Description |
|---|---|
| **UserHeader** | Top section: display name (large), email, user ID (copyable), status badge (Active/Disabled). Breadcrumb: Users > {Display Name}. |
| **UserTabs** | Tab bar with 6 tabs: Overview, Tenants & Leagues, Contests, Devices, Auth Events, Notifications. Active tab reflected in URL hash. |
| **ProfileCard** | Key-value display: display name, email, auth provider (Email/Google/Apple), created date, last login, locale, timezone. Avatar thumbnail if set. |
| **TenantMembershipTable** | Table of tenant memberships: Tenant Name, Role (Owner/Admin/Member), Joined Date, Last Active. Expandable rows show league memberships within each tenant. Tenant names link to tenant detail. |
| **ContestTable** | Two sections: Active Contests and Completed Contests. Columns: Contest Name, Tenant, Sport, Type, Status, Rank. Click row -> contest detail. |
| **DeviceTable** | Table of registered push devices: Platform (iOS/Android/Web), Device Name, Last Active, Token Status (Active/Expired/Revoked). |
| **AuthEventLog** | Chronological list of auth events: Login (success/failure), Password Reset, MFA Enable/Disable, Session Invalidation. Each entry shows timestamp, event type, IP address, user agent. |
| **NotificationDeliveryLog** | Table of recent notification deliveries: Channel (Push/Email/SMS), Event Type, Status (Delivered/Failed/Pending), Timestamp. Expandable rows show delivery details (provider response, error message if failed). |
| **UserActionPanel** | Action dropdown or sidebar with administrative actions. Buttons are permission-gated. |

**Data Requirements:**

- `GET /api/v1/admin/users/:id` — Full user profile with overview data.
- `GET /api/v1/admin/users/:id/tenants` — Tenant memberships with league memberships nested.
- `GET /api/v1/admin/users/:id/contests?status={active|completed}&page&pageSize` — User's contest participation.
- `GET /api/v1/admin/users/:id/devices` — Registered push devices.
- `GET /api/v1/admin/users/:id/auth-events?page&pageSize` — Authentication event history.
- `GET /api/v1/admin/users/:id/notifications?page&pageSize` — Notification delivery log.
- `POST /api/v1/admin/users/:id/reset-password` — Sends password reset email to user.
- `POST /api/v1/admin/users/:id/force-logout` — Invalidates all active sessions.
- `POST /api/v1/admin/users/:id/disable` — Disables user account (body: `{ reason }`).
- `POST /api/v1/admin/users/:id/enable` — Re-enables user account.
- `POST /api/v1/admin/users/:id/send-email` — Sends admin email to user (body: `{ subject, body }`).
- **Query keys:**
  - `['admin', 'users', userId]` — user profile
  - `['admin', 'users', userId, 'tenants']`
  - `['admin', 'users', userId, 'contests', { status, page, pageSize }]`
  - `['admin', 'users', userId, 'devices']`
  - `['admin', 'users', userId, 'auth-events', { page, pageSize }]`
  - `['admin', 'users', userId, 'notifications', { page, pageSize }]`

**User Interactions / Flows:**

1. Admin arrives at user detail -> sees header with display name, email, status, and Overview tab active.
2. Overview tab shows ProfileCard with key user information.
3. Clicks "Tenants & Leagues" tab -> TenantMembershipTable loads. Expands a tenant row to see league memberships.
4. Clicks a tenant name -> navigates to `/admin/tenants/:tenantId`.
5. Clicks "Contests" tab -> sees active and completed contests. Clicks a contest -> navigates to `/admin/contests/:contestId`.
6. Clicks "Devices" tab -> DeviceTable loads showing all registered push devices.
7. Clicks "Auth Events" tab -> AuthEventLog loads with paginated login history and auth events.
8. Clicks "Notifications" tab -> NotificationDeliveryLog loads. Expands a row to see delivery details.
9. **Reset Password:** Clicks "Reset Password" -> confirmation modal ("Send reset email to {email}?") -> confirms -> email sent, toast notification.
10. **Force Logout:** Clicks "Force Logout" -> confirmation modal ("Invalidate all sessions for {name}?") -> confirms -> sessions invalidated, toast.
11. **Disable Account:** Clicks "Disable Account" -> modal with reason textarea (required) -> confirms -> account disabled, StatusBadge updates to red "Disabled".
12. **Enable Account:** Clicks "Enable Account" -> confirmation modal -> confirms -> account enabled, StatusBadge updates to green "Active".
13. **Send Admin Email:** Clicks "Send Admin Email" -> modal with subject and body fields -> confirms -> email sent, toast.

**Wireframe:**

```
+----------------------------------------------------------+
| PoolMaster Admin   [Health: ●]           [Admin Name ▾]  |
+----------+-----------------------------------------------+
|          |                                               |
| Sidebar  |  Users > Jane Doe                             |
|          |                                               |
|          |  Jane Doe              [Active]                |
|          |  jane@acme.com                                |
|          |  ID: usr_abc123 [copy]                         |
|          |                                               |
|          |  [Overview] [Tenants & Leagues] [Contests]    |
|          |  [Devices] [Auth Events] [Notifications]       |
|          |                                               |
|          |  +--- Overview Tab ---------------------------+|
|          |  |                                            ||
|          |  | Profile                                    ||
|          |  | Display Name: Jane Doe                     ||
|          |  | Email: jane@acme.com                       ||
|          |  | Auth Provider: Google                      ||
|          |  | Created: Jan 15, 2025                      ||
|          |  | Last Login: 2 hours ago                    ||
|          |  | Locale: en-US                              ||
|          |  | Timezone: America/New_York                 ||
|          |  +--------------------------------------------+|
|          |                                               |
|          |  Actions ▾                                    |
|          |  +--------------------+                       |
|          |  | Reset Password     |                       |
|          |  | Force Logout       |                       |
|          |  | Disable Account    |                       |
|          |  | Send Admin Email   |                       |
|          |  +--------------------+                       |
|          |                                               |
+----------+-----------------------------------------------+
```

**Loading / Error / Empty States:**

- **Loading (Detail):** Skeleton header (name, email, badge), skeleton profile card. Tabs visible but content area shows skeleton.
- **Loading (Tabs):** Each tab loads independently with skeleton content.
- **Error (Detail):** Full-page error: "Failed to load user. [Retry] [Back to Users]".
- **Error (Tab):** Inline error within tab: "Failed to load {tab name}. [Retry]".
- **User Not Found:** "User not found" page with "Back to Users" link.
- **Empty Tenants:** "This user is not a member of any tenants."
- **Empty Contests:** "No contest participation found."
- **Empty Devices:** "No registered devices."
- **Empty Auth Events:** "No authentication events recorded."
- **Empty Notifications:** "No notifications sent to this user."
- **Action Error:** Toast: "Failed to {action}. Please try again." Modal stays open for retry.
- **Action Success:** Toast: "{Action} completed successfully." Modal closes.

---

### 3. User Merge

**Route:** `/admin/users/merge`

**Purpose:** Allows admins to merge duplicate user accounts. Presents a two-column comparison of a primary account and a duplicate account, previews what data will be transferred, highlights conflicts, and executes the merge with a summary of results.

**Key Components:**

| Component | Description |
|---|---|
| **MergeLayout** | Two-column layout: Primary Account (left) and Duplicate Account (right). Centered arrow icon between columns indicating merge direction (right -> left). |
| **AccountPicker** | Search input within each column to find and select a user. Shows selected user's summary card (name, email, tenants, contest count) once selected. Includes "Clear" button to reset selection. |
| **MergePreview** | Panel below the two columns showing what will be transferred from the duplicate to the primary: league memberships, contest entries, history records, devices. Each category shows count and details. |
| **ConflictWarning** | Yellow warning banners shown when both accounts share a membership. E.g., "Both users are members of league 'NFL Pool 2025' in tenant 'Acme Corp'. The duplicate's entries will be merged under the primary account." |
| **MergeResult** | Post-merge summary panel: what was transferred, what was deactivated, new primary account state. Includes link to the primary user's detail page. |

**Data Requirements:**

- `GET /api/v1/admin/users?search={query}` — Reuses user search for account picker.
- `GET /api/v1/admin/users/merge/preview` — Preview merge results (body: `{ primaryUserId, duplicateUserId }`). Returns: transferable data counts, conflicts, warnings.
- `POST /api/v1/admin/users/merge` — Execute merge (body: `{ primaryUserId, duplicateUserId, conflictResolutions }`). Returns: merge result summary.
- **Query keys:**
  - `['admin', 'users', 'merge', 'preview', primaryUserId, duplicateUserId]`
  - Mutation for merge execution (no query key; invalidates user queries on success).

**User Interactions / Flows:**

1. Admin navigates to `/admin/users/merge` -> sees two empty account picker columns.
2. Searches and selects the primary account (left column) -> user summary card appears.
3. Searches and selects the duplicate account (right column) -> user summary card appears.
4. Once both are selected, MergePreview automatically loads showing data to be transferred.
5. If conflicts exist (e.g., both in same league), ConflictWarning banners appear with explanation.
6. Admin reviews the preview -> clicks "Merge Accounts" button.
7. Confirmation modal: "This will permanently merge {duplicate} into {primary}. This cannot be undone. Continue?"
8. On confirm -> merge executes -> MergeResult panel replaces the preview, showing what was transferred.
9. Admin clicks "View Primary Account" -> navigates to `/admin/users/:primaryUserId`.
10. Admin can click "Start New Merge" to reset the form.

**Wireframe:**

```
+----------------------------------------------------------+
| PoolMaster Admin   [Health: ●]           [Admin Name ▾]  |
+----------+-----------------------------------------------+
|          |                                               |
| Sidebar  |  Users > Merge Accounts                       |
|          |                                               |
|          |  +--- Primary Account ---+  +--- Duplicate ---+|
|          |  |                       |  |                  ||
|          |  | [Search user...    ]  |  | [Search user...] ||
|          |  |                       |  |                  ||
|          |  | Jane Doe          <------- Jane D.          ||
|          |  | jane@acme.com     |  |  | janed@gmail.com  ||
|          |  | Tenants: 1        |  |  | Tenants: 1       ||
|          |  | Contests: 12      |  |  | Contests: 3      ||
|          |  |                       |  |                  ||
|          |  +-----------------------+  +------------------+|
|          |                                               |
|          |  Merge Preview                                |
|          |  +--------------------------------------------+|
|          |  | Will be transferred to primary account:    ||
|          |  |   - 3 contest entries                      ||
|          |  |   - 1 league membership                    ||
|          |  |   - 15 history records                     ||
|          |  |   - 1 registered device                    ||
|          |  |                                            ||
|          |  | [!] Conflict: Both users are in league     ||
|          |  |     "NFL Pool 2025" (Acme Corp). Entries   ||
|          |  |     will be merged under primary.           ||
|          |  +--------------------------------------------+|
|          |                                               |
|          |  [     Merge Accounts     ]                   |
|          |                                               |
+----------+-----------------------------------------------+
```

**Loading / Error / Empty States:**

- **Loading (Preview):** Skeleton preview panel with pulsing rows while merge preview is calculated.
- **Error (Preview):** Inline error in preview area: "Failed to generate merge preview. [Retry]".
- **Error (Merge):** Toast: "Merge failed. No changes were made. [Retry]". Form state preserved.
- **Empty (No Selection):** Each column shows "Search for a user to select as the {primary/duplicate} account."
- **Empty (No Data to Transfer):** Preview shows "No data to transfer. The duplicate account has no leagues, contests, or devices."
- **Same User Selected:** Warning: "Cannot merge a user with themselves. Please select two different accounts."
- **Merge Success:** MergeResult panel: "Merge complete. {X} contest entries, {Y} league memberships, and {Z} history records were transferred to {Primary Name}. The duplicate account has been deactivated."

---

## Cross-Cutting Concerns

- **RBAC:** User search and detail are visible to admins with `user.view`. Edit actions (reset password, disable, force logout) require `user.edit`. Merge requires `user.merge`. Action buttons are hidden for admins without the required permission.
- **Audit Logging:** All mutating actions (reset password, force logout, disable, enable, send email, merge) are logged to the admin audit trail with admin ID, timestamp, reason, and affected user(s).
- **Merge Safety:** Merge operations are wrapped in a database transaction. If any step fails, the entire merge is rolled back. The duplicate account is soft-deleted (deactivated, not hard-deleted) so data can be recovered if needed.
- **URL State:** Search query, pagination, and active tab are reflected in URL params for deep linking.
- **Cross-Tenant Visibility:** User search and detail show data across all tenants. This is intentional for support workflows where a user may have accounts or memberships in multiple tenants.

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| AU-001 | 1 | Build UserSearchBar with debounced cross-tenant search and URL param sync | Not Started | |
| AU-002 | 1 | Build UserResultsTable with UserRow, status badges, tenant links, and pagination | Not Started | |
| AU-003 | 2 | Build UserHeader and UserTabs shell with URL hash routing for tab state | Not Started | |
| AU-004 | 2 | Build Overview tab (ProfileCard) and Tenants & Leagues tab (TenantMembershipTable with expandable rows) | Not Started | |
| AU-005 | 2 | Build Contests tab (active + completed sections), Devices tab (DeviceTable) | Not Started | |
| AU-006 | 2 | Build Auth Events tab (AuthEventLog) and Notifications tab (NotificationDeliveryLog with expandable rows) | Not Started | |
| AU-007 | 3 | Build user action modals: ResetPassword, ForceLogout, DisableAccount, EnableAccount, SendAdminEmail | Not Started | |
| AU-008 | 3 | Build MergeLayout with AccountPicker, MergePreview, ConflictWarning, and MergeResult components | Not Started | |
