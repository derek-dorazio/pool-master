# PoolMaster — Settings & Preferences

**Route:** `/settings` (hub), `/settings/profile`, `/settings/timezone`, `/settings/notifications`, `/settings/privacy`
**Layout:** Authenticated (sidebar + top nav)
**Maps to:** 14 (i18n/Localisation), 15 (Compliance), 09 (Notifications & Alerts)

The settings area gives users control over their profile, locale preferences, notification delivery, and privacy options. It is structured as a hub page with dedicated sub-pages for each category, keeping the interface clean and letting users navigate directly to the setting they need.

---

## 1. Settings Hub (`/settings`)

The hub is a navigation page that links to all settings sub-pages. It provides a high-level summary of each category so users can quickly identify where to go.

**Component:** `SettingsHub`
**File:** `clients/web/src/features/settings/settings-hub.tsx`

**Sub-components:**

### SettingsCard

A reusable card that represents a settings category on the hub page.

**Component:** `SettingsCard`
**File:** `clients/web/src/features/settings/settings-card.tsx`

**Props:**
- `title` — Category name (e.g. "Profile")
- `description` — Brief summary (e.g. "Manage your display name, email, and linked accounts")
- `icon` — Lucide icon component (e.g. `User`, `Bell`, `Globe`, `Shield`)
- `href` — Route to the sub-page
- `badge` — Optional badge text (e.g. "3 unread" for notifications)

**Cards displayed:**

| Card | Icon | Description | Route |
|---|---|---|---|
| Profile | `User` | Manage your display name, email, avatar, and linked accounts | `/settings/profile` |
| Notifications | `Bell` | Control what notifications you receive and how they are delivered | `/settings/notifications` |
| Timezone & Locale | `Globe` | Set your timezone, date format, and number format preferences | `/settings/timezone` |
| Privacy & Data | `Shield` | Export your data, manage consent preferences, or delete your account | `/settings/privacy` |

**Behaviour:**
- Rendered as a 2-column card grid on desktop, single column on mobile
- Each card is a clickable link (entire card surface is the click target)
- Cards use shadcn/ui `Card` with hover state (subtle border colour change)
- Notifications card shows unread notification count badge if > 0
- Keyboard accessible: cards are focusable and activated with Enter/Space

**API:** No dedicated API. Notification badge count reuses `GET /notifications/unread-count`.

---

## 2. Profile (`/settings/profile`)

The profile page lets users manage their identity and authentication settings.

**Component:** `ProfilePage`
**File:** `clients/web/src/features/settings/profile-page.tsx`

### ProfileForm

Editable form for basic profile fields.

**Component:** `ProfileForm`
**File:** `clients/web/src/features/settings/profile-form.tsx`

**Fields:**
- Display name — text input, required, 2-50 characters
- Email — text input, read-only if the user authenticated via SSO (Google/Apple); editable for email/password users with re-verification flow
- Bio — optional textarea, max 200 characters, with character count

**Validation:**
- Display name: required, min 2 chars, max 50 chars, trimmed
- Email: valid email format, uniqueness checked server-side on submit
- All validation uses `zod` schemas with `react-hook-form` resolver

**Behaviour:**
- Form is pre-populated from `GET /users/me`
- "Save Changes" button is disabled until the form is dirty and valid
- On submit: `PATCH /users/me` with changed fields only
- Success: toast notification "Profile updated"
- Error: inline field errors from API response (e.g. "Email already in use")
- SSO users see a muted info text below the email field: "Email is managed by your Google/Apple account"

**API:** `GET /users/me`, `PATCH /users/me`

---

### AvatarUpload

Component for uploading and cropping a profile avatar.

**Component:** `AvatarUpload`
**File:** `clients/web/src/features/settings/avatar-upload.tsx`

**Behaviour:**
- Displays current avatar as a circular 96px preview (falls back to initials if no avatar set)
- "Upload Photo" button opens a native file picker
- Accepted formats: JPEG, PNG, WebP; max file size 5 MB
- After selection, a crop dialog appears (circular crop area, zoom slider)
- Crop dialog uses a lightweight client-side cropper (e.g. `react-easy-crop`)
- On confirm: uploads cropped image as `multipart/form-data` to `POST /users/me/avatar`
- "Remove Photo" button (shown only when an avatar exists) calls `DELETE /users/me/avatar`
- Loading spinner shown on the avatar preview during upload
- Error: toast notification "Failed to upload avatar. Please try a smaller image."

**Validation (client-side):**
- File type check before upload (reject non-image files)
- File size check before upload (reject > 5 MB with inline error)

**API:** `POST /users/me/avatar` (multipart), `DELETE /users/me/avatar`

---

### PasswordChangeForm

Form for changing the user's password. Only rendered for email/password auth users (hidden for SSO-only users).

**Component:** `PasswordChangeForm`
**File:** `clients/web/src/features/settings/password-change-form.tsx`

**Fields:**
- Current password — password input, required
- New password — password input, required, min 8 characters
- Confirm new password — password input, must match new password

**Validation:**
- Current password: required
- New password: min 8 characters, at least one uppercase, one lowercase, one digit
- Confirm password: must match new password exactly
- Password strength indicator bar below the new password field (weak/fair/strong/very strong)

**Behaviour:**
- Form is initially collapsed behind a "Change Password" button to reduce visual noise
- On submit: `PUT /users/me/password`
- Success: toast "Password changed successfully", form fields cleared
- Error: "Current password is incorrect" shown inline below the current password field
- Rate limited: after 5 failed attempts, the form is disabled for 60 seconds with a countdown message

**API:** `PUT /users/me/password`

---

### LinkedAccounts

Manage connected third-party authentication providers.

**Component:** `LinkedAccounts`
**File:** `clients/web/src/features/settings/linked-accounts.tsx`

**Displayed per provider (Google, Apple):**
- Provider icon and name
- Connection status: "Connected" (green) or "Not connected" (muted)
- Connected email (if connected)
- Action button: "Disconnect" (if connected) or "Connect" (if not connected)

**Behaviour:**
- Data loaded from `GET /users/me/linked-accounts`
- "Connect" initiates the OAuth flow for the selected provider (opens popup/redirect)
- "Disconnect" shows a confirmation dialog: "Are you sure? You won't be able to sign in with [Provider] anymore."
- If the user has only one auth method (e.g. only Google, no password set), the "Disconnect" button is disabled with tooltip: "You must have at least one sign-in method. Set a password first."
- On successful connect/disconnect: invalidate the linked accounts query, show toast confirmation

**API:** `GET /users/me/linked-accounts`, `POST /users/me/linked-accounts/:provider/connect`, `DELETE /users/me/linked-accounts/:provider`

---

## 3. Timezone & Locale (`/settings/timezone`)

This page controls how dates, times, and numbers are displayed throughout the application. Settings here are stored as user preferences and applied globally. The selected timezone is sent via the `X-Timezone` header on all API calls, per plan 14.

**Component:** `TimezonePage`
**File:** `clients/web/src/features/settings/timezone-page.tsx`

### TimezonePicker

A searchable dropdown for selecting the user's preferred timezone.

**Component:** `TimezonePicker`
**File:** `clients/web/src/features/settings/timezone-picker.tsx`

**Behaviour:**
- Searchable combobox (shadcn/ui `Command` + `Popover`) listing all IANA timezones
- Timezones displayed as: "America/New_York (UTC-05:00)" with city name highlighted in search
- Grouped by region (Americas, Europe, Asia, etc.) when not searching
- "Use Detected" button next to the picker that auto-fills with the browser-detected timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`)
- If the detected timezone matches the current selection, the button is hidden
- Current selection shown as a chip/badge below the picker with the current local time in that timezone (updates every minute)

**API:** Client-side timezone list from `Intl` API; selection saved via `PATCH /users/me/preferences`

---

### DateFormatSelector

Radio group for selecting the preferred date display format.

**Component:** `DateFormatSelector`
**File:** `clients/web/src/features/settings/date-format-selector.tsx`

**Options:**
| Label | Format | Example |
|---|---|---|
| Month/Day/Year | `MM/DD/YYYY` | 03/26/2026 |
| Day/Month/Year | `DD/MM/YYYY` | 26/03/2026 |
| Year-Month-Day (ISO) | `YYYY-MM-DD` | 2026-03-26 |

**Behaviour:**
- Rendered as a shadcn/ui `RadioGroup` with the example shown inline next to each option
- Default selection: auto-detected from browser locale (`navigator.language`)
- Selection is immediately reflected in the FormatPreview component

---

### NumberFormatSelector

Radio group for selecting the preferred number display format.

**Component:** `NumberFormatSelector`
**File:** `clients/web/src/features/settings/number-format-selector.tsx`

**Options:**
| Label | Format | Example |
|---|---|---|
| Comma thousands, dot decimal | `1,000.00` | 1,234,567.89 |
| Dot thousands, comma decimal | `1.000,00` | 1.234.567,89 |
| Space thousands, comma decimal | `1 000,00` | 1 234 567,89 |

**Behaviour:**
- Rendered as a shadcn/ui `RadioGroup` with the example shown inline
- Default selection: auto-detected from browser locale
- Selection is immediately reflected in the FormatPreview component

---

### FormatPreview

Live preview panel showing how dates, times, and numbers will display with the current selections.

**Component:** `FormatPreview`
**File:** `clients/web/src/features/settings/format-preview.tsx`

**Preview items:**
- "Today's date" — formatted with the selected date format
- "Current time" — formatted in the selected timezone (updates every minute)
- "Example score" — a sample number (e.g. 1,234.56) formatted with the selected number format
- "Next draft" — a sample future date/time formatted with both date format and timezone

**Behaviour:**
- Rendered as a bordered preview box with a "Preview" label
- Updates in real-time as the user changes format/timezone selections (no save required to see changes)
- Uses muted background to visually distinguish it from the form controls

---

### Saving Timezone & Locale Preferences

All three selectors (timezone, date format, number format) share a single "Save Preferences" button at the bottom of the page.

**Behaviour:**
- Button is disabled until at least one preference has changed from its saved value
- On submit: `PATCH /users/me/preferences` with all three values
- Success: toast "Preferences saved", all formatted dates/times across the app update on next render
- The selected timezone is stored in a Zustand store (`useUserPreferencesStore`) and injected into the API client as an `X-Timezone` header on every request

**API:** `GET /users/me/preferences`, `PATCH /users/me/preferences`

### TanStack Query Keys

```typescript
const settingsKeys = {
  all: ['settings'] as const,
  profile: () => [...settingsKeys.all, 'profile'] as const,
  linkedAccounts: () => [...settingsKeys.all, 'linked-accounts'] as const,
  preferences: () => [...settingsKeys.all, 'preferences'] as const,
  consent: () => [...settingsKeys.all, 'consent'] as const,
};
```

---

## 4. Notification Preferences (`/settings/notifications`)

Notification preferences are covered in detail in `09-webapp-notifications.md`. This sub-page provides:

- **Category x Channel matrix:** Toggle notifications on/off per category (score updates, draft reminders, league announcements, etc.) and per channel (in-app, email, push)
- **Do Not Disturb schedule:** Set quiet hours during which no push notifications or emails are sent (e.g. 11 PM - 7 AM in the user's timezone)
- **Frequency controls:** Digest vs real-time for email notifications

The settings page renders the notification preferences form at `/settings/notifications`, which navigates from the Settings Hub card.

**API:** `GET /users/me/notification-preferences`, `PUT /users/me/notification-preferences`

---

## 5. Privacy & Data Controls (`/settings/privacy`)

The privacy page gives users control over their personal data in compliance with GDPR and CCPA requirements (per plan 15).

**Component:** `PrivacyPage`
**File:** `clients/web/src/features/settings/privacy-page.tsx`

### DataExportCard

Request a full export of personal data.

**Component:** `DataExportCard`
**File:** `clients/web/src/features/settings/data-export-card.tsx`

**Behaviour:**
- Card with explanatory text: "Request a copy of all your PoolMaster data. We'll prepare the export and email you a download link within 48 hours."
- "Request My Data" button
- On click: `POST /account/data-export`
- Success: button changes to "Export Requested" (disabled) with timestamp of request
- If an export is already pending: show "Export in progress — requested on [date]" with the button disabled
- Completed exports: show "Your last export is ready — [download link] (expires [date])" for 7 days after generation
- Rate limited: one export request per 7 days. If limit hit, show "You can request another export on [date]"
- Error: toast "Failed to request data export. Please try again."

**API:** `POST /account/data-export`, `GET /account/data-export/status`

---

### AccountDeletionCard

Permanently delete the user's account and all associated data.

**Component:** `AccountDeletionCard`
**File:** `clients/web/src/features/settings/account-deletion-card.tsx`

**Behaviour:**
- Card with warning text in a destructive-styled alert: "Deleting your account is permanent. All your leagues, contest entries, and history will be removed."
- "Delete My Account" button (shadcn/ui `Button` with `variant="destructive"`)
- On click: opens a multi-step confirmation dialog:
  1. **Step 1 — Consequences:** Lists what will be deleted (profile, contest entries, league memberships, draft history, payment history). Shows leagues where the user is the sole commissioner with a warning: "You are the only commissioner of [League Name]. Transfer commissioner role before deleting."
  2. **Step 2 — Confirmation:** User must type their display name to confirm. Text input with label: "Type your display name to confirm: [DisplayName]"
  3. **Step 3 — Waiting period:** Explains the 14-day grace period. "Your account will be deactivated immediately and permanently deleted after 14 days. You can cancel deletion by signing in within this period."
- On confirm: `POST /account/delete`
- Success: user is signed out and redirected to a confirmation page explaining the 14-day window
- If the user signs in during the 14-day period: show a banner "Your account is scheduled for deletion on [date]. [Cancel Deletion]"
- Cancel deletion: `POST /account/delete/cancel`

**API:** `POST /account/delete`, `POST /account/delete/cancel`

---

### ConsentManager

Manage opt-in/opt-out preferences for marketing and analytics.

**Component:** `ConsentManager`
**File:** `clients/web/src/features/settings/consent-manager.tsx`

**Toggle options:**
| Category | Description | Default |
|---|---|---|
| Marketing emails | Receive promotional emails about new features and contests | Off |
| Analytics | Allow anonymized usage data collection to improve the product | On |
| Third-party integrations | Share data with connected third-party services | Off |

**Behaviour:**
- Each option rendered as a labelled shadcn/ui `Switch` with description text
- Current values loaded from `GET /account/consent`
- Changes are auto-saved on toggle (no save button): `PUT /account/consent`
- Each toggle shows a brief loading spinner while saving
- Success: subtle checkmark animation on the toggle
- Error: toggle reverts to previous state, toast "Failed to update preference"
- Audit trail: each change is logged server-side with timestamp (not shown in UI)

**API:** `GET /account/consent`, `PUT /account/consent`

---

### CCPAToggle

"Do Not Sell My Personal Information" toggle for CCPA compliance.

**Component:** `CCPAToggle`
**File:** `clients/web/src/features/settings/ccpa-toggle.tsx`

**Behaviour:**
- Rendered as a prominent section with a heading: "California Consumer Privacy Act (CCPA)"
- Explanatory text: "If you are a California resident, you have the right to opt out of the sale of your personal information."
- Single `Switch` toggle: "Do Not Sell My Personal Information"
- On toggle: `PUT /account/consent` with `doNotSell: true/false`
- When enabled, a confirmation message is shown: "Your preference has been recorded. We do not sell your personal information."
- This toggle is only displayed if the user's detected locale is `en-US` or if they have previously interacted with it (to avoid confusion for non-US users while remaining accessible if needed)
- A "Learn More" link opens the privacy policy in a new tab

**API:** `PUT /account/consent` (same endpoint as ConsentManager, includes `doNotSell` field)

---

## Data Requirements

### API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `GET /users/me` | GET | Load profile data |
| `PATCH /users/me` | PATCH | Update display name, email, bio |
| `POST /users/me/avatar` | POST | Upload avatar (multipart/form-data) |
| `DELETE /users/me/avatar` | DELETE | Remove avatar |
| `PUT /users/me/password` | PUT | Change password |
| `GET /users/me/linked-accounts` | GET | List connected OAuth providers |
| `POST /users/me/linked-accounts/:provider/connect` | POST | Initiate OAuth connect |
| `DELETE /users/me/linked-accounts/:provider` | DELETE | Disconnect OAuth provider |
| `GET /users/me/preferences` | GET | Load timezone, date format, number format |
| `PATCH /users/me/preferences` | PATCH | Update locale preferences |
| `GET /users/me/notification-preferences` | GET | Load notification settings |
| `PUT /users/me/notification-preferences` | PUT | Update notification settings |
| `GET /account/consent` | GET | Load consent preferences |
| `PUT /account/consent` | PUT | Update consent preferences (incl. CCPA) |
| `POST /account/data-export` | POST | Request data export |
| `GET /account/data-export/status` | GET | Check export status |
| `POST /account/delete` | POST | Request account deletion |
| `POST /account/delete/cancel` | POST | Cancel pending account deletion |

---

## State Management

### Server State (TanStack Query)

All settings data is server state managed by TanStack Query. Profile, linked accounts, preferences, and consent data are each fetched independently and cached with appropriate stale times.

```typescript
// Preferences loaded once, rarely changes
useQuery({
  queryKey: settingsKeys.preferences(),
  queryFn: fetchPreferences,
  staleTime: Infinity,
});

// Consent toggles auto-save on change
const consentMutation = useMutation({
  mutationFn: updateConsent,
  onMutate: async (newConsent) => {
    // Optimistic update
    await queryClient.cancelQueries({ queryKey: settingsKeys.consent() });
    const previous = queryClient.getQueryData(settingsKeys.consent());
    queryClient.setQueryData(settingsKeys.consent(), newConsent);
    return { previous };
  },
  onError: (_err, _newConsent, context) => {
    // Revert on failure
    queryClient.setQueryData(settingsKeys.consent(), context?.previous);
  },
});
```

### Client State (Zustand)

**Store:** `useUserPreferencesStore`
**File:** `clients/web/src/stores/user-preferences-store.ts`

```typescript
interface UserPreferencesState {
  timezone: string;
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  numberFormat: '1,000.00' | '1.000,00' | '1 000,00';
  setTimezone: (tz: string) => void;
  setDateFormat: (fmt: string) => void;
  setNumberFormat: (fmt: string) => void;
}
```

**Purpose:** Synced from server on login/preferences load. Used by the API client to set the `X-Timezone` header and by formatting utilities throughout the app. Persisted to `localStorage` for offline access.

---

## Text Wireframe

```
Settings Hub (/settings)
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Logo]  PoolMaster          [Search...]       [Bell]  [Avatar]            │
├───────────┬─────────────────────────────────────────────────────────────────┤
│           │                                                                 │
│  Dashboard│  Settings                                                      │
│  Leagues  │                                                                 │
│  Discover │  ┌───────────────────────────┐ ┌───────────────────────────┐   │
│  Settings │  │ [User icon]               │ │ [Bell icon]               │   │
│  Billing  │  │ Profile                   │ │ Notifications             │   │
│           │  │ Manage your display name, │ │ Control what you receive  │   │
│           │  │ email, avatar, and linked │ │ and how it is delivered   │   │
│           │  │ accounts                  │ │                           │   │
│           │  └───────────────────────────┘ └───────────────────────────┘   │
│           │                                                                 │
│           │  ┌───────────────────────────┐ ┌───────────────────────────┐   │
│           │  │ [Globe icon]              │ │ [Shield icon]             │   │
│           │  │ Timezone & Locale         │ │ Privacy & Data            │   │
│           │  │ Set your timezone, date   │ │ Export your data, manage  │   │
│           │  │ format, and number format │ │ consent, or delete your   │   │
│           │  │ preferences               │ │ account                   │   │
│           │  └───────────────────────────┘ └───────────────────────────┘   │
│           │                                                                 │
├───────────┴─────────────────────────────────────────────────────────────────┤
│  Footer: About | Privacy | Terms | Responsible Gaming          v1.0.0      │
└─────────────────────────────────────────────────────────────────────────────┘

Profile (/settings/profile)
┌─────────────────────────────────────────────────────────────────────────────┐
│  Settings > Profile                                                        │
│                                                                             │
│  ┌─ Profile ────────────────────────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │  [ Avatar (96px) ]   [Upload Photo]  [Remove Photo]                  │  │
│  │                                                                       │  │
│  │  Display Name    [______________________]                             │  │
│  │  Email           [______________________]  (managed by Google)        │  │
│  │  Bio             [______________________]  142/200 characters         │  │
│  │                                                                       │  │
│  │                                          [Save Changes] (disabled)    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─ Password ───────────────────────────────────────────────────────────┐  │
│  │  [Change Password v]                                                  │  │
│  │  ┌──────────────────────────────────────────────────────────────┐    │  │
│  │  │ Current password    [________________]                       │    │  │
│  │  │ New password        [________________]                       │    │  │
│  │  │                     Strength: [====-------] Fair             │    │  │
│  │  │ Confirm password    [________________]                       │    │  │
│  │  │                                        [Update Password]     │    │  │
│  │  └──────────────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─ Linked Accounts ────────────────────────────────────────────────────┐  │
│  │  [G] Google    user@gmail.com           Connected    [Disconnect]    │  │
│  │  [A] Apple     Not connected                        [Connect]        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘

Timezone & Locale (/settings/timezone)
┌─────────────────────────────────────────────────────────────────────────────┐
│  Settings > Timezone & Locale                                              │
│                                                                             │
│  ┌─ Timezone ───────────────────────────────────────────────────────────┐  │
│  │  Timezone   [America/New_York (UTC-05:00)  v]  [Use Detected]       │  │
│  │  Current time in selected timezone: 2:34 PM EDT                      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─ Date Format ────────────────────────────────────────────────────────┐  │
│  │  (*) Month/Day/Year     03/26/2026                                   │  │
│  │  ( ) Day/Month/Year     26/03/2026                                   │  │
│  │  ( ) Year-Month-Day     2026-03-26                                   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─ Number Format ──────────────────────────────────────────────────────┐  │
│  │  (*) 1,000.00           1,234,567.89                                 │  │
│  │  ( ) 1.000,00           1.234.567,89                                 │  │
│  │  ( ) 1 000,00           1 234 567,89                                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─ Preview ────────────────────────────────────────────────────────────┐  │
│  │  Today's date:     03/26/2026                                        │  │
│  │  Current time:     2:34 PM EDT                                       │  │
│  │  Example score:    1,234.56                                          │  │
│  │  Next draft:       03/28/2026 at 7:00 PM EDT                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│                                          [Save Preferences] (disabled)     │
└─────────────────────────────────────────────────────────────────────────────┘

Privacy & Data (/settings/privacy)
┌─────────────────────────────────────────────────────────────────────────────┐
│  Settings > Privacy & Data                                                 │
│                                                                             │
│  ┌─ Consent Preferences ────────────────────────────────────────────────┐  │
│  │  Marketing emails                                          [ OFF ]   │  │
│  │  Receive promotional emails about new features and contests          │  │
│  │                                                                       │  │
│  │  Analytics                                                 [ ON  ]   │  │
│  │  Allow anonymized usage data collection to improve the product       │  │
│  │                                                                       │  │
│  │  Third-party integrations                                  [ OFF ]   │  │
│  │  Share data with connected third-party services                      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─ CCPA ───────────────────────────────────────────────────────────────┐  │
│  │  California Consumer Privacy Act (CCPA)                              │  │
│  │  If you are a California resident, you have the right to opt out    │  │
│  │  of the sale of your personal information.  [Learn More]            │  │
│  │                                                                       │  │
│  │  Do Not Sell My Personal Information                       [ OFF ]   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─ Data Export ────────────────────────────────────────────────────────┐  │
│  │  Request a copy of all your PoolMaster data. We'll prepare the      │  │
│  │  export and email you a download link within 48 hours.              │  │
│  │                                                                       │  │
│  │                                          [Request My Data]           │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─ Delete Account ─────────────────────────────────────────────────────┐  │
│  │  !! Deleting your account is permanent. All your leagues, contest   │  │
│  │  entries, and history will be removed.                               │  │
│  │                                                                       │  │
│  │                                         [Delete My Account]          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
clients/web/src/
├── features/settings/
│   ├── settings-hub.tsx                  # Hub page with card grid
│   ├── settings-card.tsx                 # Reusable settings category card
│   ├── profile-page.tsx                  # Profile sub-page
│   ├── profile-form.tsx                  # Display name, email, bio form
│   ├── avatar-upload.tsx                 # Avatar upload with crop dialog
│   ├── password-change-form.tsx          # Password change (email/password users only)
│   ├── linked-accounts.tsx              # Connected OAuth providers
│   ├── timezone-page.tsx                # Timezone & locale sub-page
│   ├── timezone-picker.tsx              # Searchable timezone combobox
│   ├── date-format-selector.tsx         # Date format radio group
│   ├── number-format-selector.tsx       # Number format radio group
│   ├── format-preview.tsx               # Live formatting preview panel
│   ├── privacy-page.tsx                 # Privacy & data sub-page
│   ├── data-export-card.tsx             # Data export request card
│   ├── account-deletion-card.tsx        # Account deletion with multi-step confirmation
│   ├── consent-manager.tsx              # Marketing/analytics opt-in toggles
│   ├── ccpa-toggle.tsx                  # CCPA "Do Not Sell" toggle
│   └── hooks/
│       ├── use-profile.ts              # TanStack Query hook for profile data
│       ├── use-linked-accounts.ts      # TanStack Query hook for OAuth providers
│       ├── use-preferences.ts          # TanStack Query hook for locale prefs
│       ├── use-consent.ts              # TanStack Query hook for consent data
│       ├── use-data-export-status.ts   # TanStack Query hook for export status
│       ├── use-update-profile.ts       # Mutation hook for profile updates
│       ├── use-update-password.ts      # Mutation hook for password change
│       ├── use-update-preferences.ts   # Mutation hook for locale prefs
│       └── use-update-consent.ts       # Mutation hook for consent toggles
├── stores/
│   └── user-preferences-store.ts       # Zustand: timezone, date/number format
```

---

## Loading & Error States

| Component | Loading State | Error State | Empty State |
|---|---|---|---|
| Settings Hub | Skeleton: 4 card placeholders | "Couldn't load settings" + retry | N/A (always 4 cards) |
| Profile Form | Skeleton: 3 input fields | "Couldn't load profile" + retry | N/A (always has data) |
| Avatar Upload | Spinner overlay on avatar | Toast: "Upload failed" | Initials fallback |
| Password Change | Button loading spinner | Inline error below field | N/A |
| Linked Accounts | Skeleton: 2 provider rows | "Couldn't load accounts" + retry | All providers show "Not connected" |
| Timezone Picker | Skeleton: 1 combobox | "Couldn't load preferences" + retry | Auto-detected defaults |
| Format Preview | Skeleton: 4 preview rows | Falls back to browser defaults | N/A |
| Data Export | Skeleton: 1 card | Toast: "Couldn't check export status" | "No exports requested" |
| Account Deletion | N/A (static content) | Toast: "Request failed" + retry | N/A |
| Consent Manager | Skeleton: 3 toggle rows | Toast: "Couldn't load preferences" | All toggles at defaults |

All skeleton screens use the shadcn/ui `Skeleton` component. Error states include a "Try again" button that calls `queryClient.invalidateQueries()` for the relevant query key.

---

## Responsive Behaviour

| Breakpoint | Layout |
|---|---|
| `sm` (< 640px) | Single column. Settings hub cards stack vertically. All form sections full-width. Avatar upload centered above form fields. |
| `md` (640-1023px) | Settings hub: 2-column card grid. Sub-pages: single column with comfortable padding. |
| `lg` (1024-1279px) | Settings hub: 2-column card grid. Sub-pages: centred content column (max-width 768px). |
| `xl` (>= 1280px) | Same as `lg` with wider margins. Content column remains max-width 768px for readability. |

---

## Accessibility

- Settings hub cards have `role="link"` and are keyboard focusable with visible focus rings
- All form inputs have associated `<label>` elements (not just placeholders)
- Password strength indicator has `aria-label="Password strength: Fair"` (dynamic)
- Consent toggles have `aria-checked` state and descriptive `aria-label` values
- Account deletion confirmation dialog uses `role="alertdialog"` with `aria-describedby` pointing to the consequences text
- Timezone combobox supports keyboard navigation (arrow keys, Enter to select, Escape to close)
- Format preview updates are wrapped in `aria-live="polite"` for screen readers
- All destructive actions (disconnect account, delete account) require explicit confirmation
- Colour is not the only indicator of connection status (text labels "Connected"/"Not connected" accompany the colour)

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| W-SET-001 | 1 | Settings hub layout — hub page with card grid navigation to sub-pages, responsive 2-column layout | Done | `settings-hub.tsx`, `settings-card.tsx` — 4-card grid (Profile, Notifications, Timezone, Privacy), responsive 2-col, notification unread badge |
| W-SET-002 | 1 | Profile form with avatar upload — display name, email, bio fields with zod validation; avatar upload with crop dialog and multipart upload | Done | `profile-page.tsx`, `profile-form.tsx`, `avatar-upload.tsx` — initials fallback, file type/size validation, SSO email read-only, char counter. Mock data in hooks |
| W-SET-003 | 1 | Password change form — current/new/confirm fields, strength indicator, collapsible section, rate limiting | Done | `password-change-form.tsx` — collapsible, 4-level strength bar (Weak/Fair/Strong/Very Strong), validation rules, form clear on success |
| W-SET-004 | 1 | Linked accounts management — Google/Apple OAuth connect/disconnect, safety check for last auth method, confirmation dialog | Done | `linked-accounts.tsx` — connect/disconnect with confirmation, last-method safety check disables disconnect, provider icons |
| W-SET-005 | 2 | Timezone picker with auto-detect — searchable IANA timezone combobox, browser detection with "Use Detected" button, current time display | Done | Already implemented in `pages/settings/timezone.tsx` — searchable grouped timezone list, auto-detect, preview |
| W-SET-006 | 2 | Date and number format selectors — radio groups for date/number format, live FormatPreview panel, save to user preferences, Zustand store sync | Done | Already implemented in `pages/settings/timezone.tsx` — date/time format radios, first-day-of-week, FormatPreview with Intl.DateTimeFormat |
| W-SET-007 | 2 | Privacy and data controls page — ConsentManager toggles with optimistic updates, CCPAToggle with locale-based visibility | Done | `privacy-page.tsx`, `consent-manager.tsx`, `ccpa-toggle.tsx` — Switch toggles, optimistic updates, CCPA visible for en-US locale only |
| W-SET-008 | 3 | Data export request flow — DataExportCard with request button, pending/completed status polling, rate limiting, download link display | Done | `data-export-card.tsx` — pending/ready/rate-limited states, download link, 7-day rate limit display |
| W-SET-009 | 3 | Account deletion flow with confirmation — multi-step dialog (consequences, name confirmation, waiting period), 14-day grace period, cancellation banner | Done | `account-deletion-card.tsx` — 3-step flow (consequences → type name → waiting period), destructive styling, alertdialog role, generated SDK request helper for deletion |
| W-SET-010 | 3 | Cookie preferences dialog — per-category toggles (necessary/functional/analytics) with backend consent recording via `POST /account/consent` | Done | `cookie-preferences.tsx` — necessary and functional are locked on, analytics persists to consent API, no fake toggle state |
| W-SET-011 | 3 | Self-exclusion dialog — cool-down period selector (24H/7D/30D/6M/1Y), typed "CONFIRM" confirmation, via `POST /account/self-exclusion` | Done | `self-exclusion-dialog.tsx` — supports temporary cool-down and longer self-exclusion paths, typed CONFIRM confirmation, active-exclusion status display |
| W-SET-012 | 3 | Session reminder config card — interval dropdown (30/60/90 min), auto-save toggle | Done | `session-reminder-card.tsx` — Switch toggle, interval dropdown, auto-save with toast, contract-aligned settings key invalidation |
| W-SET-013 | 3 | Activity limit config card — weekly contest limit input, auto-save | Done | `activity-limit-card.tsx` — Switch toggle, number input (1-100), auto-save with toast |

---

*PoolMaster Settings & Preferences Page Plan v1.1*
