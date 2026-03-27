# PoolMaster — Legal & Compliance Pages

This plan covers the legal, privacy, and responsible gaming pages for the PoolMaster React webapp. These pages ensure regulatory compliance (GDPR, CCPA, COPPA) and promote responsible platform usage. Most pages are publicly accessible; interactive features like self-exclusion and DSAR tracking require authentication.

**Related service plans:**

- **01 — Architecture & Auth:** Session management, account lifecycle, user data storage
- **07 — Billing:** Subscription data referenced in data export/deletion requests
- **09 — Notifications:** Session time reminder delivery, self-exclusion confirmation emails
- **14 — i18n:** All user-facing legal strings externalized for localization
- **15 — Responsible Gaming & Compliance:** Backend compliance endpoints, consent storage, self-exclusion logic, DSAR processing

---

## Pages

### 1. Privacy Policy

**Route:** `/privacy`

**Purpose:** Public-facing privacy policy page that explains how PoolMaster collects, uses, stores, and shares user data. Must be accessible without authentication so prospective users can review it before registration.

**Key Components:**

- **LegalPage** — Shared layout wrapper for long-form legal content. Provides consistent page chrome, max-width container, and responsive typography optimized for readability.
- **TableOfContents** — Sticky sidebar navigation generated from document headings. Highlights the currently visible section using Intersection Observer. Collapses to a dropdown on mobile viewports.
- **LastUpdated** — Displays the document's last-modified date at the top of the page in a muted badge. Format: "Last updated: March 15, 2026".

**Data Requirements:**

- No authenticated API calls required.
- Content sourced from static markdown files or a headless CMS. Rendered at build time (SSG) or fetched on mount if CMS-backed.
- No user-specific data displayed.

**User Interactions / Flows:**

1. User navigates to `/privacy` -> full privacy policy renders with table of contents sidebar.
2. User clicks a heading in the table of contents -> page scrolls to that section smoothly.
3. User scrolls through the document -> table of contents highlights the current section.
4. On mobile -> table of contents collapses to a sticky dropdown at the top of the content area.

**Wireframe:**

```
+----------------------------------------------------------+
| [Logo]                          [Log In]  [Get Started]  |
+----------------------------------------------------------+
|                                                          |
|  +------------+  +----------------------------------+   |
|  | Contents   |  | Privacy Policy                   |   |
|  |            |  | Last updated: March 15, 2026     |   |
|  | > Intro    |  |                                  |   |
|  |   Data We  |  | 1. Introduction                  |   |
|  |   Collect  |  | PoolMaster ("we", "us") operates |   |
|  |   How We   |  | the poolmaster.com website and   |   |
|  |   Use It   |  | mobile applications...           |   |
|  |   Sharing  |  |                                  |   |
|  |   Cookies  |  | 2. Data We Collect               |   |
|  |   Rights   |  | We collect the following types   |   |
|  |   Contact  |  | of information...                |   |
|  |            |  |                                  |   |
|  +------------+  +----------------------------------+   |
|                                                          |
+----------------------------------------------------------+
| Terms | Privacy | Contact           (c) 2026 PoolMaster  |
+----------------------------------------------------------+
```

---

### 2. Terms of Service

**Route:** `/terms`

**Purpose:** Public-facing terms of service that govern platform usage. Uses the same layout as the privacy policy. Supports versioning so users can review previous versions when the terms are updated.

**Key Components:**

- **LegalPage** — Shared layout wrapper (same as privacy policy).
- **TableOfContents** — Sticky sidebar navigation (same behavior as privacy policy).
- **LastUpdated** — Last-modified date badge.
- **VersionSelector** — Dropdown that lists previous versions of the terms by effective date. Selecting a previous version loads that version's content with a banner indicating it is no longer current.
- **ArchivedBanner** — Alert banner shown when viewing a non-current version: "You are viewing an archived version of our Terms of Service. The current version is effective as of [date]." Includes a link to the current version.

**Data Requirements:**

- No authenticated API calls required.
- Content sourced from static markdown files or headless CMS, with versioned documents stored by effective date.
- Version list may be a static manifest file or CMS query.

**User Interactions / Flows:**

1. User navigates to `/terms` -> current terms of service render with table of contents.
2. User clicks the version selector dropdown -> sees a list of previous versions by effective date.
3. User selects a previous version -> archived content loads with the ArchivedBanner at the top.
4. User clicks "View current version" in the banner -> returns to the latest terms.

**Wireframe:**

```
+----------------------------------------------------------+
| [Logo]                          [Log In]  [Get Started]  |
+----------------------------------------------------------+
|                                                          |
|  +------------+  +----------------------------------+   |
|  | Contents   |  | Terms of Service                 |   |
|  |            |  | Last updated: Feb 1, 2026        |   |
|  | > Intro    |  | Version: [Current v3 ▼]          |   |
|  |   Account  |  |                                  |   |
|  |   Conduct  |  | 1. Acceptance of Terms           |   |
|  |   Content  |  | By accessing or using PoolMaster |   |
|  |   Payment  |  | you agree to be bound by these   |   |
|  |   Termina- |  | terms...                         |   |
|  |   tion     |  |                                  |   |
|  |   Liabil-  |  | 2. Account Registration          |   |
|  |   ity      |  | You must provide accurate and    |   |
|  |   Contact  |  | complete information...           |   |
|  |            |  |                                  |   |
|  +------------+  +----------------------------------+   |
|                                                          |
+----------------------------------------------------------+
```

---

### 3. Cookie Policy

**Route:** `/cookie-policy`

**Purpose:** Explains the types of cookies PoolMaster uses, organized by category. Provides a link to open the cookie consent preferences dialog so users can modify their choices at any time.

**Key Components:**

- **LegalPage** — Shared layout wrapper.
- **TableOfContents** — Sidebar navigation for cookie categories and sections.
- **CookieCategorySection** — Repeated section for each cookie category. Displays category name, description, whether cookies in this category can be disabled, and a table of specific cookies with name, provider, purpose, and expiry.
- **ManagePreferencesLink** — Button or link that opens the CookiePreferencesDialog (same dialog used by the cookie consent banner).

**Cookie Categories:**

| Category | Description | User Can Disable |
|---|---|---|
| **Essential** | Required for basic site functionality (session, CSRF, auth tokens) | No |
| **Functional** | Remember user preferences (language, timezone, theme) | Yes |
| **Analytics** | Usage tracking and performance monitoring (e.g., Google Analytics, PostHog) | Yes |
| **Marketing** | Advertising and cross-site tracking (if applicable in future) | Yes |

**Data Requirements:**

- No authenticated API calls required.
- Static content describing each cookie. Cookie inventory maintained as a data file or CMS entry.

**User Interactions / Flows:**

1. User navigates to `/cookie-policy` -> sees categorized cookie information.
2. User reads through categories and individual cookie descriptions.
3. User clicks "Manage Cookie Preferences" -> CookiePreferencesDialog opens as a modal overlay.
4. User adjusts toggles and saves -> preferences updated in localStorage and via `POST /consent`.

**Wireframe:**

```
+----------------------------------------------------------+
| [Logo]                          [Log In]  [Get Started]  |
+----------------------------------------------------------+
|                                                          |
|  Cookie Policy                                           |
|  Last updated: Jan 10, 2026                              |
|                                                          |
|  PoolMaster uses cookies to provide and improve our      |
|  services. This page explains what cookies we use and    |
|  why.                                                    |
|                                                          |
|  [ Manage Cookie Preferences ]                           |
|                                                          |
|  ---------------------------------------------------    |
|                                                          |
|  Essential Cookies (Always Active)                       |
|  Required for the site to function properly.             |
|                                                          |
|  | Cookie   | Provider    | Purpose        | Expiry |   |
|  |----------|-------------|----------------|--------|   |
|  | session  | PoolMaster  | Session ID     | 24h    |   |
|  | csrf     | PoolMaster  | CSRF token     | 1h     |   |
|                                                          |
|  ---------------------------------------------------    |
|                                                          |
|  Functional Cookies                                      |
|  Remember your preferences and settings.                 |
|                                                          |
|  | Cookie   | Provider    | Purpose        | Expiry |   |
|  |----------|-------------|----------------|--------|   |
|  | locale   | PoolMaster  | Language pref  | 1y     |   |
|  | theme    | PoolMaster  | Dark/light     | 1y     |   |
|                                                          |
|  ---------------------------------------------------    |
|                                                          |
|  Analytics Cookies                                       |
|  ...                                                     |
|                                                          |
+----------------------------------------------------------+
```

---

### 4. Cookie Consent Banner

**Route:** N/A — Global component rendered at the application root.

**Purpose:** Displays a consent banner on the user's first visit to comply with GDPR and CCPA cookie regulations. Allows users to accept all cookies, reject non-essential cookies, or open a detailed preferences dialog to configure per-category consent.

**Key Components:**

- **CookieBanner** — Fixed-position banner at the bottom of the viewport. Displays a brief message about cookie usage with three action buttons. Hidden once the user makes a choice. Re-shown only if consent preferences are cleared.
- **CookiePreferencesDialog** — Modal dialog opened from either the banner's "Manage Preferences" button or the cookie policy page. Contains per-category toggles with descriptions. Essential cookies are always on and cannot be toggled off (toggle is disabled with explanatory text).
- **CategoryToggle** — Individual toggle row within the preferences dialog. Shows category name, description, and an on/off switch. Essential category toggle is locked on.

**Data Requirements:**

- Consent state checked on mount from `localStorage` key `cookie_consent`.
- If no consent record exists, banner is shown.
- On user action:
  - Store preferences in `localStorage` as JSON: `{ essential: true, functional: boolean, analytics: boolean, marketing: boolean, timestamp: ISO8601 }`.
  - `POST /consent` — Sends consent record to the backend for audit trail. Payload includes user ID (if authenticated, otherwise anonymous session ID), consent choices, and timestamp.
- Banner does not block page interaction (no overlay behind it), but it does persist until dismissed.

**User Interactions / Flows:**

1. User visits any page for the first time -> CookieBanner appears at the bottom of the screen.
2. User clicks "Accept All" -> all categories set to true, banner dismissed, consent recorded.
3. User clicks "Reject Non-Essential" -> only essential set to true, all others false, banner dismissed, consent recorded.
4. User clicks "Manage Preferences" -> CookiePreferencesDialog opens.
5. In the dialog, user toggles individual categories -> clicks "Save Preferences" -> choices saved, dialog closes, banner dismissed.
6. User later visits `/cookie-policy` and clicks "Manage Cookie Preferences" -> same dialog opens for adjustment.

**Wireframe:**

```
+----------------------------------------------------------+
|                                                          |
|              (Page content visible above)                 |
|                                                          |
+----------------------------------------------------------+
| We use cookies to improve your experience. See our       |
| Cookie Policy for details.                               |
|                                                          |
| [Reject Non-Essential] [Manage Preferences] [Accept All] |
+----------------------------------------------------------+

--- Manage Preferences Dialog: ---

+----------------------------------------------------------+
|  Cookie Preferences                              [X]     |
|                                                          |
|  Choose which cookies you'd like to allow.               |
|                                                          |
|  +----------------------------------------------------+ |
|  | Essential Cookies              [=====ON] (locked)   | |
|  | Required for basic site functionality.              | |
|  +----------------------------------------------------+ |
|  | Functional Cookies             [====OFF]            | |
|  | Remember your preferences and settings.             | |
|  +----------------------------------------------------+ |
|  | Analytics Cookies              [====OFF]            | |
|  | Help us understand how you use the site.            | |
|  +----------------------------------------------------+ |
|  | Marketing Cookies              [====OFF]            | |
|  | Used for targeted advertising.                      | |
|  +----------------------------------------------------+ |
|                                                          |
|                           [Save Preferences]             |
+----------------------------------------------------------+
```

---

### 5. Responsible Gaming

**Route:** `/responsible-gaming`

**Purpose:** Provides information about healthy gaming habits and gives users tools to manage their participation. Includes self-exclusion, session time reminders, activity limits, and links to external support resources. The informational content is publicly accessible; interactive tools require authentication.

**Key Components:**

- **ResponsibleGamingPage** — Page wrapper with an introductory section explaining PoolMaster's commitment to responsible gaming, followed by tool cards for authenticated users.
- **SelfExclusionCard** — Card component with explanation of self-exclusion and a "Self-Exclude" button. Clicking the button opens a confirmation dialog with a cool-down period selector.
  - **SelfExclusionDialog** — Confirmation modal with:
    - Cool-down period options: 1 week, 1 month, 6 months, indefinite.
    - Warning text explaining that during exclusion the user cannot enter contests, create pools, or access competitive features.
    - "Confirm Self-Exclusion" button requiring the user to type "CONFIRM" to proceed.
    - Cancel button.
- **SessionReminderConfig** — Card that lets authenticated users configure periodic session time reminders. Dropdown or number input for reminder interval (e.g., "Remind me after 1 hour", "2 hours", "4 hours", or "Off"). Current setting displayed.
- **ActivityLimitConfig** — Card that lets authenticated users set a weekly contest entry limit. Number input with current limit displayed. Setting to 0 or blank means unlimited.
- **ResourceLinks** — Section with external links to responsible gaming organizations:
  - National Council on Problem Gambling (ncpgambling.org)
  - Gamblers Anonymous (gamblersanonymous.org)
  - 1-800-GAMBLER helpline
  - International equivalents as appropriate

**Data Requirements:**

- Informational content: no API calls required (static content, publicly visible).
- Self-exclusion: `POST /account/self-exclusion` — Payload: `{ period: "1_week" | "1_month" | "6_months" | "indefinite" }`. Returns confirmation and effective dates. Requires authentication.
- Session reminders: `PUT /account/session-reminder` — Payload: `{ intervalMinutes: number | null }`. Requires authentication. Current setting fetched from user profile.
- Activity limits: `PUT /account/activity-limits` — Payload: `{ weeklyContestLimit: number | null }`. Requires authentication. Current setting fetched from user profile.
- User settings fetched via `GET /account/settings` on page mount (if authenticated).

**User Interactions / Flows:**

1. Any user navigates to `/responsible-gaming` -> sees informational content and resource links.
2. Authenticated user scrolls to self-exclusion section -> clicks "Self-Exclude" -> SelfExclusionDialog opens.
3. User selects a cool-down period -> types "CONFIRM" -> clicks "Confirm Self-Exclusion" -> account is restricted, confirmation shown.
4. Authenticated user adjusts session reminder interval -> setting saved on change (debounced) or on blur.
5. Authenticated user sets a weekly contest entry limit -> setting saved on change (debounced) or on blur.
6. Unauthenticated user sees the tool cards in a disabled/locked state with a prompt to log in.

**Wireframe:**

```
+----------------------------------------------------------+
| [Logo]                          [Log In]  [Get Started]  |
+----------------------------------------------------------+
|                                                          |
|  Responsible Gaming                                      |
|                                                          |
|  At PoolMaster, we believe gaming should be fun and      |
|  safe. We provide tools to help you stay in control      |
|  of your participation.                                  |
|                                                          |
|  +----------------------------------------------------+ |
|  | Self-Exclusion                                      | |
|  |                                                    | |
|  | Need a break? You can temporarily or permanently   | |
|  | exclude yourself from competitive features.        | |
|  |                                                    | |
|  |                        [ Self-Exclude ]            | |
|  +----------------------------------------------------+ |
|                                                          |
|  +----------------------------------------------------+ |
|  | Session Time Reminders                              | |
|  |                                                    | |
|  | Get a notification after a set time on the          | |
|  | platform to help you manage your screen time.      | |
|  |                                                    | |
|  | Remind me after: [ 2 hours ▼ ]                     | |
|  +----------------------------------------------------+ |
|                                                          |
|  +----------------------------------------------------+ |
|  | Weekly Contest Limits                               | |
|  |                                                    | |
|  | Set a maximum number of contest entries per week.   | |
|  |                                                    | |
|  | Max entries per week: [ 10 ]                        | |
|  +----------------------------------------------------+ |
|                                                          |
|  ---------------------------------------------------    |
|                                                          |
|  Need Help?                                              |
|                                                          |
|  - National Council on Problem Gambling                  |
|    ncpgambling.org                                       |
|  - Gamblers Anonymous                                    |
|    gamblersanonymous.org                                 |
|  - 1-800-GAMBLER (1-800-426-2537)                       |
|                                                          |
+----------------------------------------------------------+
```

---

### 6. Age Gate (Embedded in Registration)

**Route:** N/A — Rendered as Step 3 of the `/register` flow (see 01-webapp-auth.md).

**Purpose:** Ensures users meet the minimum age requirement before creating an account. Users must be 13 or older for platform access (COPPA compliance). Users under 18 are flagged in the system for future real-money feature restrictions.

**Key Components:**

- **AgeGate** — Wrapper component that orchestrates the age verification step. Contains the DOB picker and handles validation logic.
- **DOBPicker** — Date of birth input using three separate dropdowns (month, day, year) for clarity and accessibility. Year range starts at current year minus 100 and ends at current year minus 13 (to hint at the requirement). Alternatively, a single date input with a calendar picker can be used if the design system supports it.
- **AgeBlockedMessage** — Displayed when the entered date of birth indicates the user is under 13. Shows a friendly but clear message: "Sorry, you must be at least 13 years old to use PoolMaster." No account is created, and the user cannot proceed. Includes a link back to the landing page.

**Validation Rules:**

| Age | Behavior |
|---|---|
| Under 13 | Blocked. AgeBlockedMessage displayed. Registration cannot proceed. No data is stored. |
| 13-17 | Allowed. Account flagged as minor. Future real-money features will be restricted. |
| 18+ | Allowed. Full access to all platform features. |

**Data Requirements:**

- No API call at this step; DOB is validated client-side.
- DOB is submitted as part of the registration payload and recorded via `POST /api/compliance/age-verify` after account creation.
- DOB is stored securely and used for age-gated feature access decisions.

**User Interactions / Flows:**

1. User reaches Step 3 of registration -> DOBPicker is displayed.
2. User selects month, day, and year -> client calculates age.
3. If age >= 13 -> "Next" button is enabled, user can proceed to Step 4.
4. If age < 13 -> AgeBlockedMessage replaces the form. "Next" button is removed. "Back to Home" link is shown.
5. If age is 13-17 -> user proceeds but a note is displayed: "Some features may be restricted for users under 18."

**Wireframe:**

```
+----------------------------------------------------------+
|                                                          |
|   (1)--------(2)--------(*3*)-------(4)--------(5)      |
|  Account    Profile      Age       Terms      Plan       |
|    [✓]       [✓]        [*]        [ ]        [ ]        |
|                                                          |
|  +--------------------------------------------------+   |
|  |                                                    |   |
|  |  Step 3: Verify Your Age                          |   |
|  |                                                    |   |
|  |  You must be at least 13 years old to use          |   |
|  |  PoolMaster.                                       |   |
|  |                                                    |   |
|  |  Date of Birth:                                    |   |
|  |  [Month ▼]  [Day ▼]  [Year ▼]                     |   |
|  |                                                    |   |
|  +--------------------------------------------------+   |
|                                                          |
|                  [Back]   [Next ->]                       |
+----------------------------------------------------------+

--- If under 13: ---

+----------------------------------------------------------+
|  +--------------------------------------------------+   |
|  |                                                    |   |
|  |              [warning icon]                        |   |
|  |                                                    |   |
|  |  Sorry, you must be at least 13 years old to      |   |
|  |  use PoolMaster.                                   |   |
|  |                                                    |   |
|  |  For more information, visit our Privacy Policy.   |   |
|  |                                                    |   |
|  |              [ Back to Home ]                      |   |
|  |                                                    |   |
|  +--------------------------------------------------+   |
+----------------------------------------------------------+
```

---

### 7. Data Subject Access Request (DSAR) Status

**Route:** N/A — Embedded within `/settings/privacy` (the user's privacy settings page).

**Purpose:** Displays the status of a user's data export or data deletion request. Users can request their data under GDPR/CCPA "right of access" and "right to erasure" provisions. This component tracks the progress of those requests and provides download links when ready.

**Key Components:**

- **DSARStatus** — Container component that fetches and displays the user's active DSAR requests. Shows an empty state if no requests are pending.
- **StatusTimeline** — Vertical timeline showing the progression of a request through its stages: Submitted, Processing, Ready/Completed. Each stage shows a timestamp when reached. The current stage is highlighted.
- **DownloadLink** — Shown when a data export request reaches "Ready" status. Provides a secure, time-limited download link for the exported data archive (ZIP). Link expires after 72 hours.
- **RequestActions** — Buttons to initiate new requests: "Request Data Export" and "Request Account Deletion". Each opens a confirmation dialog before submission. Disabled if a request of that type is already in progress.

**DSAR Request Lifecycle:**

| Status | Description |
|---|---|
| **Pending** | Request submitted, awaiting processing. |
| **Processing** | System is gathering and packaging data (export) or preparing deletion. |
| **Ready** | Data export is available for download. Link valid for 72 hours. |
| **Completed** | Deletion is complete, or export has been downloaded/expired. |
| **Failed** | Request could not be completed. User can retry. |

**Data Requirements:**

- `GET /account/dsar` — Fetches the user's DSAR requests with statuses. Returns an array of requests.
- `POST /account/dsar/export` — Initiates a data export request.
- `POST /account/dsar/delete` — Initiates a data deletion request. Requires the user to confirm by entering their password.
- `GET /account/dsar/:id/download` — Returns a signed download URL for the exported data archive.
- Polling: TanStack Query refetches DSAR status every 30 seconds while a request is in "Pending" or "Processing" state.

**User Interactions / Flows:**

1. User navigates to `/settings/privacy` -> DSARStatus section is visible.
2. No active requests -> empty state with "Request Data Export" and "Request Account Deletion" buttons.
3. User clicks "Request Data Export" -> confirmation dialog -> confirmed -> request submitted, status shows "Pending".
4. Status transitions to "Processing" -> timeline updates automatically via polling.
5. Status transitions to "Ready" -> download link appears. User clicks to download ZIP archive.
6. After download or 72 hours -> status transitions to "Completed".
7. User clicks "Request Account Deletion" -> confirmation dialog with password entry -> confirmed -> request submitted.
8. Deletion completes -> user is logged out and account is removed.

**Wireframe:**

```
+----------------------------------------------------------+
|  Privacy Settings                                        |
|                                                          |
|  ---------------------------------------------------    |
|                                                          |
|  Your Data Requests                                      |
|                                                          |
|  +----------------------------------------------------+ |
|  | Data Export Request                                 | |
|  |                                                    | |
|  |  * Submitted — Mar 20, 2026 at 3:15 PM            | |
|  |  |                                                 | |
|  |  * Processing — Mar 20, 2026 at 3:18 PM           | |
|  |  |                                                 | |
|  |  o Ready (current)                                 | |
|  |                                                    | |
|  |  [ Download Your Data ] (expires in 48 hours)      | |
|  +----------------------------------------------------+ |
|                                                          |
|  [Request Data Export]  [Request Account Deletion]       |
|                                                          |
+----------------------------------------------------------+
```

---

## Cross-Cutting Concerns

- **Shared Legal Layout:** The LegalPage component provides a consistent layout for all long-form legal content pages (Privacy Policy, Terms of Service, Cookie Policy). It includes the public navigation bar, a max-width content container with readable line lengths, the TableOfContents sidebar, and the standard footer.
- **Public vs. Authenticated:** Privacy Policy, Terms of Service, Cookie Policy, and the informational portion of Responsible Gaming are all publicly accessible without authentication. Self-exclusion, session reminders, activity limits, and DSAR status require authentication; unauthenticated users see locked states with login prompts.
- **Cookie Consent Integration:** The CookieBanner and CookiePreferencesDialog are global components mounted at the app root. They must load before any non-essential cookies or tracking scripts are initialized. Analytics and marketing scripts should be conditionally loaded based on consent state.
- **i18n:** All user-facing strings are externalized via `i18next`. Legal documents may have locale-specific versions (e.g., `privacy-en-US.md`, `privacy-de-DE.md`). The cookie consent banner text must be translated for all supported locales.
- **Accessibility:** Legal pages use semantic heading hierarchy (`h1` through `h4`) for screen reader navigation. The TableOfContents uses `nav` with `aria-label="Table of contents"`. Cookie consent banner uses `role="alert"` and is keyboard-navigable. Toggle switches in the preferences dialog and responsible gaming tools use proper `aria-checked` states.
- **Mobile Responsive:** Legal pages collapse the TableOfContents sidebar into a sticky dropdown on viewports narrower than 768px. The CookieBanner stacks buttons vertically on small screens. Self-exclusion and settings cards use full-width layout on mobile.
- **SEO and Crawlability:** Legal pages should be server-rendered or statically generated so search engines can index them. Include `<meta>` tags for description and `<link rel="canonical">` to avoid duplicate content if multiple URL variants exist.

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| W-LG-001 | 1 | Build shared LegalPage layout component with TableOfContents sidebar, LastUpdated badge, and responsive collapse behavior | Done | LegalPage + LegalSection with Intersection Observer TOC |
| W-LG-002 | 1 | Build Privacy Policy page (`/privacy`) with markdown/CMS content rendering and Intersection Observer-based TOC highlighting | Done | 11 sections covering data collection, rights, retention, CCPA |
| W-LG-003 | 1 | Build Terms of Service page (`/terms`) with VersionSelector dropdown and ArchivedBanner for previous versions | Done | 13 sections including no-real-money clause. Version selector deferred |
| W-LG-004 | 1 | Build Cookie Policy page (`/cookie-policy`) with CookieCategorySection components and per-cookie tables | Done | 3 cookie categories with per-cookie tables |
| W-LG-005 | 1 | Build CookieBanner global component with Accept All, Reject Non-Essential, and Manage Preferences actions; persist consent to localStorage | Done | Fixed bottom banner with Accept All / Necessary Only. localStorage persistence |
| W-LG-006 | 1 | Build CookiePreferencesDialog with per-category CategoryToggle switches and backend consent recording via `POST /consent` | Not Started | Granular per-category dialog deferred |
| W-LG-007 | 2 | Build Responsible Gaming information page (`/responsible-gaming`) with introductory content and ResourceLinks section | Done | Self-exclusion info, activity limits, session reminders, 3 helpline resources |
| W-LG-008 | 2 | Build SelfExclusionCard and SelfExclusionDialog with cool-down period selector and "CONFIRM" typed confirmation via `POST /account/self-exclusion` | Not Started | Info cards built; interactive dialog deferred to settings page |
| W-LG-009 | 2 | Build AgeGate component with DOBPicker (month/day/year dropdowns), client-side age validation, and AgeBlockedMessage for under-13 users | Not Started | Backend API ready; UI deferred to registration flow |
| W-LG-010 | 2 | Build DSARStatus component with StatusTimeline, DownloadLink, and RequestActions; integrate polling via TanStack Query for in-progress requests | Not Started | Backend API ready; UI deferred to settings/privacy page |
| W-LG-011 | 2 | Build SessionReminderConfig card with interval dropdown and auto-save via `PUT /account/session-reminder` | Not Started | |
| W-LG-012 | 2 | Build ActivityLimitConfig card with weekly contest limit input and auto-save via `PUT /account/activity-limits` | Not Started | |
