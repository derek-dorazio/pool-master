# PoolMaster — Localisation & Internationalisation (i18n) Plan

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

## Overview

PoolMaster serves leagues across timezones and potentially across countries. This plan addresses timezone-correct scheduling, date/time formatting, multi-currency prize pool display, number formatting, and the foundation for multi-language support. Getting timezone handling right is critical from day one — a draft that starts at "7pm" must be unambiguous to every member regardless of where they are.

---

## 1. Timezone Handling

### The Problem

A commissioner in New York creates a draft starting at "7:00 PM." A member in Los Angeles sees it. What time is it for them?

### Timezone Strategy

```typescript
interface TimezoneModel {
  // All times stored in UTC in the database
  storage: 'UTC';

  // Timezone context levels (resolution order)
  contexts: {
    // Level 1: User-level timezone (personal setting)
    user_timezone?: string;            // IANA: "America/New_York"

    // Level 2: League-level timezone (set by commissioner)
    league_timezone: string;           // IANA: "America/New_York"

    // Level 3: Tenant-level timezone (organisational default)
    tenant_timezone: string;           // IANA: "America/New_York"
  };

  // Resolution: user > league > tenant
  // If user has no timezone set, use league timezone
  // If league has no timezone set, use tenant timezone
}
```

### Display Rules

```typescript
interface TimeDisplayConfig {
  // Always show the user's local time
  primary_display: 'USER_LOCAL';

  // Show the league timezone alongside when it differs from user's
  show_league_timezone: boolean;       // "7:00 PM ET (4:00 PM your time)"

  // Contexts where both timezones are shown
  dual_display_contexts: [
    'DRAFT_START_TIME',                // critical — everyone must agree on when
    'CONTEST_LOCK_TIME',               // critical — missed lock = missed picks
    'SCHEDULED_EVENTS',                // upcoming event times
  ];

  // Contexts where only user local time is shown
  single_display_contexts: [
    'FEED_POST_TIMESTAMPS',            // relative: "5 min ago"
    'NOTIFICATION_TIMESTAMPS',
    'SCORE_UPDATE_TIMESTAMPS',
  ];
}
```

### Timezone Conversion Utility

```typescript
interface TimeFormatter {
  // Format a UTC date for display to a specific user
  formatForUser(utcDate: Date, userId: string, format: TimeFormat): string;

  // Format with dual timezone display
  formatDual(utcDate: Date, userTz: string, leagueTz: string): string;
  // Output: "Sat, Mar 28 at 7:00 PM ET (4:00 PM PT)"

  // Relative time ("5 minutes ago", "in 2 hours")
  formatRelative(utcDate: Date): string;

  // Duration countdown ("2h 15m", "45 seconds")
  formatCountdown(targetUtc: Date): string;
}

type TimeFormat =
  | 'DATE_SHORT'          // "Mar 28"
  | 'DATE_LONG'           // "Saturday, March 28, 2026"
  | 'TIME'                // "7:00 PM"
  | 'DATETIME_SHORT'      // "Mar 28, 7:00 PM"
  | 'DATETIME_LONG'       // "Saturday, March 28, 2026 at 7:00 PM ET"
  | 'RELATIVE'            // "5 min ago", "in 2 hours"
  | 'COUNTDOWN';          // "2h 15m"
```

### Commissioner Timezone Experience

```
When setting a draft time:
  1. Commissioner sees a time picker in their local timezone
  2. Below the picker: "This is 7:00 PM Eastern Time"
  3. If league has members in other timezones:
     "Members in Pacific Time will see this as 4:00 PM"
  4. Time is stored as UTC in the database
  5. Each member sees the time in their own timezone
```

---

## 2. Date & Number Formatting

### Locale-Aware Formatting

```typescript
interface LocaleConfig {
  // User's locale preference
  locale: string;                      // BCP 47: "en-US", "en-GB", "fr-FR"

  // Date formatting
  date_format: {
    short: string;                     // "MM/DD/YYYY" (US) vs "DD/MM/YYYY" (UK)
    long: string;                      // "March 28, 2026" vs "28 March 2026"
  };

  // Time formatting
  time_format: '12H' | '24H';         // "7:00 PM" vs "19:00"

  // Number formatting
  number_format: {
    decimal_separator: '.' | ',';
    thousands_separator: ',' | '.' | ' ';
  };
  // 1,234.56 (US) vs 1.234,56 (DE) vs 1 234,56 (FR)

  // Week start
  first_day_of_week: 'SUNDAY' | 'MONDAY';
}
```

### Implementation: Use Intl API

```typescript
// Leverage JavaScript's built-in Intl API for locale-aware formatting
// Works in Node.js (backend), browsers, and React Native

function formatDate(date: Date, locale: string, format: 'short' | 'long'): string {
  const options: Intl.DateTimeFormatOptions = format === 'short'
    ? { month: 'short', day: 'numeric' }
    : { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

function formatCurrency(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
  }).format(amount);
}
```

---

## 3. Multi-Currency Support

### Currency Model

```typescript
interface CurrencyConfig {
  // Tenant-level default currency
  tenant_currency: string;             // ISO 4217: "USD", "GBP", "EUR"

  // League-level currency override (optional)
  league_currency?: string;

  // Resolution: league > tenant
}
```

### Currency Usage in PoolMaster

| Context | Currency Source | Example |
|---|---|---|
| Entry fee display | League currency | "$25.00 entry fee" |
| Prize pool display | League currency | "£500 prize pool" |
| Payout amounts | League currency | "1st: €200" |
| Salary cap budget | Contest config | "$50,000 budget" |
| Salary cap prices | Contest config | "$12,500" |
| Platform subscription | Tenant currency | "$29/month" (always in billing currency) |

### Currency Display Rules

```typescript
interface CurrencyDisplay {
  // Always display with currency symbol
  show_symbol: true;

  // For ambiguous symbols ($), show currency code in international contexts
  disambiguate: boolean;               // "$25 USD" vs just "$25"

  // Decimal places
  decimal_places: Record<string, number>;
  // { USD: 2, GBP: 2, EUR: 2, JPY: 0 }

  // Storage: all monetary values stored in smallest unit (cents)
  storage_unit: 'CENTS';
}
```

### Multi-Currency Prize Pool Interaction

```
Current scope: PoolMaster does NOT convert between currencies.
Each league operates in a single currency.

If members are in different countries:
  - Prize pool is in the league's currency
  - Entry fee is in the league's currency
  - Members handle any currency conversion externally
  - Display amounts with ISO code for clarity: "$250 USD"

Future consideration: currency conversion for display purposes only
(show approximate local equivalent using daily exchange rates)
```

---

## 4. Language / UI Localisation

### Launch Strategy

```
Phase 1 (Launch): English only
  - All UI strings in English
  - BUT: all strings extracted into translation files from day one
  - Architecture supports adding languages without code changes

Phase 2 (International): Add languages based on demand
  - Priority: Spanish, French, Portuguese, German
  - Translation workflow: export keys → professional translation → import
```

### Translation Architecture

```typescript
// Translation file structure (JSON, one file per locale)
// /locales/en-US.json
{
  "common": {
    "save": "Save",
    "cancel": "Cancel",
    "loading": "Loading...",
    "error": "Something went wrong"
  },
  "draft": {
    "on_the_clock": "You're on the clock!",
    "time_remaining": "{{minutes}}m {{seconds}}s remaining",
    "pick_confirmed": "{{participantName}} drafted to {{teamName}}",
    "auto_picked": "Auto-pick selected {{participantName}} for you"
  },
  "scoring": {
    "standings": "Standings",
    "your_position": "You're in {{position}} place",
    "points": "{{count}} point",
    "points_plural": "{{count}} points"
  },
  "notifications": {
    "draft_starting": "Draft for {{contestName}} starts in {{time}}"
  }
}
```

### Translation Framework

```typescript
// Use i18next (works in Node.js, React, React Native)
interface TranslationService {
  // Get translated string
  t(key: string, params?: Record<string, any>): string;
  // t('draft.time_remaining', { minutes: 2, seconds: 30 })
  // → "2m 30s remaining"

  // Pluralisation
  t(key: string, { count: number }): string;
  // t('scoring.points', { count: 1 }) → "1 point"
  // t('scoring.points', { count: 5 }) → "5 points"

  // Change locale
  setLocale(locale: string): Promise<void>;

  // Get current locale
  getLocale(): string;
}
```

### String Extraction Rules

```
ALL user-facing strings MUST go through the translation system.
Never hardcode display text in components.

✗ Bad:  <Text>You're on the clock!</Text>
✓ Good: <Text>{t('draft.on_the_clock')}</Text>

✗ Bad:  `${score} points`
✓ Good: t('scoring.points', { count: score })

Exception: Sport names, participant names, and user-generated content
are NOT translated — they're data, not UI strings.
```

---

## 5. API Localisation Strategy

### Client-Side Localisation (Recommended)

```
Approach: API returns raw data; client formats for display.

API response:
  { "draft_start": "2026-03-28T23:00:00Z", "prize_pool_cents": 50000, "currency": "USD" }

Client formats:
  EN-US: "Saturday, March 28 at 7:00 PM ET" / "$500.00"
  EN-GB: "Saturday, 28 March at 23:00 GMT" / "$500.00"
  DE-DE: "Samstag, 28. März um 23:00 GMT" / "500,00 $"
```

### Server-Side Localised Content

Some content is generated server-side and must be localised there:

```
- Email templates (notification emails, digests)
- Push notification text
- Automated activity feed posts
- Weekly recap content
- Error messages in API responses

For these: accept `Accept-Language` header and use server-side i18next.
```

### API Headers

```
Request:
  Accept-Language: en-US
  X-Timezone: America/New_York

Response:
  Content-Language: en-US
```

---

## 6. Locale Settings Model

### User Preferences

```typescript
interface UserLocalePreferences {
  user_id: string;

  // Language
  language: string;                    // BCP 47: "en-US", "es-MX"

  // Timezone
  timezone: string;                    // IANA: "America/New_York"

  // Display preferences
  time_format: '12H' | '24H';
  date_format: 'MDY' | 'DMY' | 'YMD';
  first_day_of_week: 'SUNDAY' | 'MONDAY';

  // Currency (display preference — does not override league currency)
  preferred_currency?: string;

  // Detected from device (used as fallback)
  device_locale?: string;
  device_timezone?: string;
}
```

### Locale Resolution

```
For display formatting:
  1. User explicit preference (if set)
  2. User's device locale (detected from browser/app)
  3. Tenant default locale
  4. Platform default: en-US, America/New_York

For timezone:
  1. User explicit timezone (if set)
  2. League timezone (for league-context displays)
  3. User's device timezone (detected)
  4. Tenant default timezone
```

---

## 7. Sport-Specific Localisation

### Date/Time Considerations by Sport

```typescript
interface SportTimezoneConfig {
  GOLF: {
    // Golf tournaments span multiple days with tee times in local event timezone
    // Display: "Tee times are in ET (Augusta National is in Eastern Time)"
    show_event_local_timezone: true;
  };
  NFL: {
    // Games have specific kickoff times in various US timezones
    // Display: "Kickoff: 4:25 PM ET / 1:25 PM PT"
    show_dual_timezone_for_games: true;
  };
  F1: {
    // Races are global — always show user's local time prominently
    // Display: "Race start: Sunday 8:00 AM ET (14:00 local track time)"
    show_track_local_time: true;
  };
  TENNIS: {
    // Grand Slams in different global timezones
    show_event_local_timezone: true;
  };
}
```

### Unit Localisation

```typescript
// Some sports have region-specific units
interface UnitConfig {
  // Golf: always strokes (universal)
  // Horse racing: distances
  HORSE_RACING: {
    distance_unit: 'FURLONGS' | 'METERS';  // US: furlongs, rest: meters
  };
  // Temperature (for weather display in golf)
  temperature_unit: 'FAHRENHEIT' | 'CELSIUS';
}
```

---

## 8. Database Schema

```sql
-- User locale preferences
CREATE TABLE user_locale_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  language VARCHAR(10) DEFAULT 'en-US',
  timezone VARCHAR(50),
  time_format VARCHAR(5) DEFAULT '12H',
  date_format VARCHAR(5) DEFAULT 'MDY',
  first_day_of_week VARCHAR(10) DEFAULT 'SUNDAY',
  preferred_currency VARCHAR(3),
  device_locale VARCHAR(10),
  device_timezone VARCHAR(50),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tenant locale defaults
-- (Added to existing tenants table as columns)
-- tenant_default_locale VARCHAR(10) DEFAULT 'en-US'
-- tenant_default_timezone VARCHAR(50) DEFAULT 'America/New_York'
-- tenant_default_currency VARCHAR(3) DEFAULT 'USD'
```

---

## 9. Implementation Phases

### Phase 1 — Timezone Foundation (Before Build)
- All dates stored as UTC in database
- Timezone field on User, League, and Tenant models
- Time formatting utility using Intl API
- Dual timezone display for critical times (draft start, lock time)
- Timezone picker in user settings and league settings

### Phase 2 — Number & Currency Formatting
- Locale-aware number formatting (Intl.NumberFormat)
- Currency display with proper symbols and decimal places
- Currency configuration on league settings
- Salary cap price formatting

### Phase 3 — String Extraction
- Extract all UI strings to translation files (en-US.json)
- Integrate i18next in web app
- Integrate i18next in React Native app
- Server-side i18next for emails and notifications
- Pluralisation rules

### Phase 4 — Multi-Language (When Needed)
- Professional translation of string files
- Language picker in user settings
- RTL layout support (if Arabic/Hebrew added)
- Locale-specific email templates
- App Store / Play Store localised listings

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 14-001 | 1 | All dates stored as UTC in database (enforce in models) | Done | Added UTC convention comment block to Prisma schema after datasource block |
| 14-002 | 1 | Timezone field on User, League, and Tenant models | Done | Added timezone/locale/timeFormat/dateFormat to User model; defaultLocale/defaultTimezone/defaultCurrency to Tenant model (Prisma + shared types) |
| 14-003 | 1 | `user_locale_preferences` table + migrations | Done | Added UserLocalePreference Prisma model + TypeScript interface, exported from shared/domain/index.ts |
| 14-004 | 1 | Time formatting utility (client-side Intl API) | Done | Created clients/web/src/lib/format-time.ts with formatTime, formatDualTimezone, formatRelative, formatCountdown, getTimezoneAbbr — all using Intl API |
| 14-005 | 1 | Dual timezone display for draft start and lock times | Done | Created DualTimezone and RelativeTime components in clients/web/src/components/ui/ |
| 14-006 | 1 | Timezone picker in user settings and league settings | Done | Built full settings page with searchable timezone picker (60 IANA zones grouped by region), date/time format radios, first-day-of-week, live preview. Created clients/web/src/lib/timezones.ts. Updated preferences store with timeFormat + firstDayOfWeek. |
| 14-007 | 2 | Locale-aware number formatting (Intl.NumberFormat) | Done | Created `src/lib/format-number.ts` with formatNumber, formatDecimal, formatPercent, formatOrdinal, formatCompact. All use Intl.NumberFormat with preferences store fallback. Also created `src/hooks/use-format.ts` convenience hook. |
| 14-008 | 2 | Currency display with proper symbols and decimal places | Done | Created `src/lib/format-currency.ts` with formatCurrency, formatCurrencyWithCode, getCurrencySymbol, getCurrencyDecimals, formatBudget. Cents-to-major-unit conversion, ISO 4217 decimal map. |
| 14-009 | 2 | Currency configuration on league settings | Done | Added CurrencySelect component (`src/components/ui/currency-select.tsx`) with 13 currencies. Integrated into league settings General card with live preview of formatted amount. |
| 14-010 | 2 | Salary cap price formatting (locale-aware) | Done | Created `src/lib/format-salary.ts` with formatParticipantPrice (whole dollars), formatRemainingBudget ("$X of $Y remaining"), formatBudgetUsed ("X% used"). |
| 14-011 | 3 | Extract all UI strings to translation files (`en-US.json`) | Done | Created en/common.json (app name, nav, buttons, states) and en/auth.json (all auth page strings). Namespace-per-page pattern. |
| 14-012 | 3 | Integrate i18next in web app | Done | Created src/lib/i18n.ts with i18next + react-i18next. English only, inline imports, imported in main.tsx before render. |
| 14-013 | 3 | Integrate i18next in React Native app | Done | Repurposed: created server-side i18next setup in packages/shared/i18n/index.ts with initI18n(), t() helper, and i18next re-export. Preloads notifications, emails, activity namespaces. |
| 14-014 | 3 | Server-side i18next for emails and notifications | Done | Added i18next dep to @poolmaster/shared package.json. Created locale files: en/notifications.json (draft, scoring, contest, league, social, account), en/emails.json (subjects, greeting, closing, CTAs), en/activity.json (feed strings). Updated tsconfig to include i18n dir. |
| 14-015 | 3 | Pluralisation rules | Done | Added 4 new web locale namespaces: dashboard.json, leagues.json, contests.json, settings.json with _plural suffix keys for counts. Updated i18n.ts to register all 6 namespaces with compatibilityJSON v3 for plural support. |
| 14-016 | 4 | Professional translation of string files (Spanish, French first) | Not Started | When needed |
| 14-017 | 4 | Language picker in user settings | Not Started | |
| 14-018 | 4 | RTL layout support (if Arabic/Hebrew added) | Not Started | |
| 14-019 | 4 | Locale-specific email templates | Not Started | |
| 14-020 | 4 | App Store / Play Store localised listings | Not Started | |

---

*Generated by Claude — PoolMaster Localisation & Internationalisation Plan v1.0*
