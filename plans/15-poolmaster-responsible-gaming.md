# PoolMaster — Responsible Gaming & Legal Compliance Plan

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

## Overview

PoolMaster operates in the fantasy sports and pool management space, which intersects gambling regulation, data privacy law, and consumer protection requirements. This plan addresses age verification, geographic restrictions, responsible gaming tools, GDPR/CCPA compliance, data retention, terms of service enforcement, and the critical architectural decision of whether PoolMaster facilitates real-money transactions. Engaging legal counsel early is essential — this document provides the engineering framework, not legal advice.

---

## 1. Critical Decision: Real-Money Position

### Option A: Social Platform (Recommended for v1)

```
PoolMaster does NOT handle real money between members.

- Entry fees and prize pools are TRACKED but not COLLECTED
- Platform displays "Entry fee: $25" and "1st place prize: $200"
  but the actual money changes hands outside the app (Venmo, PayPal, cash)
- PoolMaster charges a SaaS subscription fee to the tenant (platform billing)
  which is a standard B2B SaaS transaction, NOT a gambling transaction

Implications:
  ✓ No money transmission licence required
  ✓ No state-by-state DFS licensing required
  ✓ No escrow or trust account requirements
  ✓ Dramatically reduced regulatory burden
  ✓ Apple/Google app store approval is simpler
  ✗ Commissioners must manage money collection manually
  ✗ No platform-enforced prize pool guarantee
```

### Option B: Integrated Payments (Future Consideration)

```
PoolMaster facilitates entry fee collection and prize disbursement
via Stripe Connect.

Implications:
  ✗ May require money transmission licences in some states
  ✗ Must comply with state-by-state DFS regulations
  ✗ Must maintain separate trust/escrow accounts for prize pools
  ✗ Apple App Store gambling entitlement required
  ✗ Significantly more complex compliance requirements
  ✓ Better user experience — everything in one place
  ✓ Platform can take a percentage of entry fees (revenue opportunity)

If pursued: requires dedicated legal review before implementation.
```

### Recommended Approach

```
v1: Option A — social platform, no real-money handling
Future: evaluate Option B based on market demand, legal readiness, and
        willingness to bear regulatory costs
```

---

## 2. Age Verification

### Requirements

| Context | Requirement | Enforcement |
|---|---|---|
| Platform access (social-only) | 13+ (COPPA compliance) | Self-declared date of birth at registration |
| Leagues with entry fees displayed | 18+ | Age verification at league join if entry_fee > 0 |
| Real-money transactions (Option B future) | 18+ (21+ in some states) | ID verification required |

### Implementation

```typescript
interface AgeVerification {
  // Level 1: Self-declaration (v1)
  self_declared: {
    collect_dob_at_registration: true;
    minimum_age: 13;
    block_if_under_age: true;
    store_dob: boolean;                // store only birth year for privacy, not full DOB
  };

  // Level 2: Enhanced verification (when entry fees are displayed)
  enhanced: {
    required_when: 'LEAGUE_HAS_ENTRY_FEE';
    method: 'DOB_CONFIRMATION';        // re-confirm DOB + checkbox attestation
    minimum_age: 18;
  };

  // Level 3: Identity verification (future, if real money)
  identity: {
    required_when: 'REAL_MONEY_TRANSACTION';
    provider: 'STRIPE_IDENTITY' | 'JUMIO' | 'ONFIDO';
    document_types: ['DRIVERS_LICENSE', 'PASSPORT', 'STATE_ID'];
    minimum_age: 18;                   // or 21 depending on jurisdiction
  };
}
```

### Age Gate Flow

```
Registration:
  1. User provides date of birth
  2. If age < 13: "Sorry, you must be 13 or older to use PoolMaster"
     → Do not create account, do not store data
  3. If age ≥ 13: account created, birth year stored
  4. If age < 18 and league has entry fees: show entry-fee leagues as view-only

Joining a league with entry fees:
  1. Check stored birth year
  2. If age < 18: "You must be 18+ to join leagues with entry fees"
  3. If age ≥ 18: proceed
```

---

## 3. Geographic Restrictions

### Fantasy Sports Legality by US State

```typescript
interface GeographicRestrictions {
  // States where DFS/fantasy contests with prizes may be restricted
  restricted_states: {
    // Fully restricted (no contests with displayed entry fees)
    blocked: ['MT', 'WA'];             // as of planning date — verify with counsel

    // Requires DFS operator licence
    licensed: ['MA', 'NY', 'VA', 'IN', 'CO', 'MD', 'TN'];

    // No specific DFS regulation (generally permitted)
    permitted: string[];               // remaining states
  };

  // Since PoolMaster v1 doesn't handle money, geographic restrictions
  // are less critical — but should be implemented as a framework for
  // when they become relevant

  enforcement: 'INFORMATIONAL' | 'BLOCKING';
  // v1: INFORMATIONAL — warn users, don't block
  // Future: BLOCKING — prevent restricted activities based on location
}
```

### Location Detection

```typescript
interface LocationDetection {
  // Methods (in priority order)
  methods: [
    // 1. User self-declared state (in profile)
    'PROFILE_STATE',

    // 2. IP geolocation (approximate)
    'IP_GEOLOCATION',

    // 3. Device GPS (if permitted — future, for real-money)
    'DEVICE_GPS',
  ];

  // IP geolocation provider
  ip_provider: 'MAXMIND' | 'IPINFO';

  // Caching
  cache_location_hours: 24;            // re-check daily
}
```

### Restriction Enforcement

```
v1 (social platform):
  - Collect user's state in profile (optional)
  - No blocking based on location
  - Display informational notice in restricted states:
    "Fantasy contests with entry fees may be restricted in your state.
     Check your local regulations."

Future (real money):
  - Require state in profile
  - Verify via IP geolocation
  - Block real-money contest creation in restricted states
  - Block real-money contest joining from restricted states
  - Allow non-monetary contests everywhere
```

---

## 4. Responsible Gaming Tools

Even without real-money handling, responsible gaming features demonstrate platform maturity and prepare for future regulation.

### Self-Exclusion

```typescript
interface SelfExclusion {
  // User can voluntarily exclude themselves
  user_id: string;
  exclusion_type: 'COOL_DOWN' | 'SELF_EXCLUSION';

  // Cool-down: temporary break
  cool_down: {
    duration: '24H' | '7D' | '30D';
    during_cool_down: {
      can_view_standings: true;
      can_draft: false;
      can_join_contests: false;
      can_create_contests: false;
    };
    auto_reactivate: true;
  };

  // Self-exclusion: longer-term
  self_exclusion: {
    duration: '6M' | '1Y' | 'INDEFINITE';
    during_exclusion: {
      can_view_standings: true;        // read-only access to existing contests
      can_draft: false;
      can_join_contests: false;
      can_create_contests: false;
      can_join_leagues: false;
    };
    reactivation: 'MANUAL_REQUEST';    // must contact support to reactivate
    // Cooling-off period: 7 days between reactivation request and actual reactivation
  };
}
```

### Activity Monitoring

```typescript
interface ActivityMonitoring {
  // Track engagement patterns (for future responsible gaming indicators)
  metrics_tracked: [
    'CONTESTS_JOINED_PER_WEEK',
    'TIME_SPENT_IN_APP_PER_DAY',
    'ENTRY_FEES_DISPLAYED_PER_MONTH',  // total entry fees in joined contests
  ];

  // Alerts (configurable by user)
  user_alerts: {
    weekly_contest_limit?: number;     // "Alert me if I join more than X contests/week"
    session_time_limit_minutes?: number; // "Remind me after X minutes in app"
  };

  // Session time reminder
  session_reminder: {
    enabled_by_default: false;
    default_interval_minutes: 60;      // "You've been playing for 1 hour"
    message: "You've been on PoolMaster for {{minutes}} minutes. Take a break?";
  };
}
```

### Responsible Gaming Information

```
In-app resources (accessible from settings):
  ├── "About Responsible Gaming" — educational content
  ├── Self-exclusion tool
  ├── Activity limits configuration
  ├── Session time reminder toggle
  └── External resources:
      ├── National Council on Problem Gambling: 1-800-522-4700
      ├── ncpgambling.org
      └── Gamblers Anonymous: gamblersanonymous.org
```

---

## 5. Data Privacy — GDPR Compliance

### Core GDPR Requirements

| Right | Implementation |
|---|---|
| **Right to Access** | User can export all their data |
| **Right to Rectification** | User can edit their profile data |
| **Right to Erasure** | User can request account deletion |
| **Right to Data Portability** | Export in machine-readable format (JSON) |
| **Right to Restrict Processing** | Pause account without deletion |
| **Right to Object** | Opt out of marketing, analytics |
| **Consent Management** | Explicit consent for data collection |

### Data Subject Access Request (DSAR)

```typescript
interface DataExport {
  // User requests their data: POST /api/v1/account/data-export
  request(userId: string): Promise<DataExportJob>;

  // Processing (async — may take up to 30 days per GDPR, target: 48 hours)
  process(jobId: string): Promise<DataExportResult>;
}

interface DataExportResult {
  user_id: string;
  export_format: 'JSON';
  files: {
    'profile.json': UserProfile;
    'leagues.json': LeagueMembership[];
    'contests.json': ContestParticipation[];
    'draft_picks.json': DraftPick[];
    'feed_posts.json': FeedPost[];
    'direct_messages.json': DirectMessage[];
    'notifications.json': NotificationPreferences;
    'scores_and_standings.json': ScoreHistory[];
    'devices.json': DeviceRegistration[];
    'audit_log.json': UserActivityLog[];
  };
  generated_at: Date;
  download_url: string;                // signed URL, expires in 7 days
}
```

### Right to Erasure (Account Deletion)

```typescript
interface AccountDeletion {
  // User requests deletion: POST /api/v1/account/delete
  request(userId: string, reason?: string): Promise<DeletionRequest>;

  // Waiting period (allow cancellation)
  waiting_period_days: 14;

  // Deletion process
  process(requestId: string): Promise<void>;
  // Steps:
  // 1. Anonymise profile: name → "Deleted User", email → hashed
  // 2. Delete personal data: DOB, photo, devices, preferences
  // 3. Preserve anonymised contest data (standings, scores)
  //    → needed for other users' history and league records
  // 4. Delete feed posts and DMs (or anonymise author)
  // 5. Deactivate all sessions and device tokens
  // 6. Cancel subscription (if any)
  // 7. Remove from search indices
  // 8. Send confirmation email to original address
  // 9. Log deletion in compliance audit trail

  // Data retained after deletion (anonymised)
  retained_anonymised: [
    'CONTEST_STANDINGS',               // "Deleted User — 245 points, 3rd place"
    'DRAFT_PICKS',                     // "Deleted User picked Scottie Scheffler"
    'LEAGUE_RECORDS',                  // historical records reference teams, not personal data
  ];

  // Data fully deleted
  fully_deleted: [
    'EMAIL', 'NAME', 'DOB', 'PHOTO',
    'DEVICES', 'PREFERENCES', 'NOTIFICATION_HISTORY',
    'DIRECT_MESSAGES', 'IP_ADDRESSES',
  ];
}
```

### Consent Management

```typescript
interface ConsentManagement {
  // Consent types
  consents: {
    // Required (cannot use platform without)
    terms_of_service: { required: true; version: string };
    privacy_policy: { required: true; version: string };

    // Optional
    marketing_email: { required: false; default: false };
    analytics_cookies: { required: false; default: false };
    third_party_sharing: { required: false; default: false };
    push_notifications: { required: false; default: true };
  };

  // Consent records (immutable log)
  record: {
    user_id: string;
    consent_type: string;
    granted: boolean;
    version: string;
    ip_address: string;
    user_agent: string;
    timestamp: Date;
  };
}
```

---

## 6. Data Privacy — CCPA Compliance

### CCPA Requirements (California)

```typescript
interface CCPACompliance {
  // "Do Not Sell My Personal Information" link
  do_not_sell: {
    enabled: true;
    // PoolMaster does not sell personal data, but must provide the opt-out mechanism
    link_in_footer: true;
    link_url: '/privacy/do-not-sell';
  };

  // Categories of personal information collected
  categories_collected: [
    'IDENTIFIERS',                     // name, email, DOB
    'INTERNET_ACTIVITY',               // usage logs, browsing history
    'GEOLOCATION',                     // IP-based location
    'INFERENCES',                      // analytics, scoring predictions
  ];

  // Right to know (similar to GDPR DSAR)
  right_to_know: {
    // Same data export as GDPR implementation
    implementation: 'SHARED_WITH_GDPR_DSAR';
  };

  // Right to delete (similar to GDPR erasure)
  right_to_delete: {
    implementation: 'SHARED_WITH_GDPR_ERASURE';
  };

  // Annual privacy notice update
  privacy_notice: {
    update_frequency: 'ANNUAL';
    last_updated: Date;
    notify_users_on_material_change: true;
  };
}
```

---

## 7. Cookie Policy & Tracking

### Cookie Categories

```typescript
interface CookiePolicy {
  categories: {
    // Strictly necessary (no consent needed)
    necessary: {
      session_cookie: { purpose: 'Authentication'; duration: 'SESSION' };
      csrf_token: { purpose: 'Security'; duration: 'SESSION' };
    };

    // Functional (consent recommended)
    functional: {
      timezone: { purpose: 'Display formatting'; duration: '1Y' };
      language: { purpose: 'UI language preference'; duration: '1Y' };
      theme: { purpose: 'Dark/light mode'; duration: '1Y' };
    };

    // Analytics (consent required in EU)
    analytics: {
      usage_tracking: { purpose: 'Product improvement'; duration: '1Y' };
      // Provider: Plausible (privacy-focused) or PostHog (self-hosted)
      // NOT Google Analytics (privacy concerns for EU users)
    };

    // Marketing (consent required)
    marketing: {
      // None in v1 — no third-party marketing trackers
    };
  };

  // Consent banner
  banner: {
    show_in_regions: ['EU', 'UK', 'CALIFORNIA'];
    default_accept_necessary_only: true;
    granular_opt_in: true;             // users can opt into individual categories
  };
}
```

---

## 8. Terms of Service Enforcement

### Account Suspension Model

```typescript
interface AccountEnforcement {
  // Warning levels
  levels: {
    WARNING: {
      action: 'SEND_WARNING_EMAIL';
      restrictions: 'NONE';
    };
    TEMPORARY_SUSPENSION: {
      action: 'DISABLE_ACCOUNT';
      duration: '7D' | '30D';
      restrictions: 'NO_LOGIN';
      appeal: 'EMAIL_SUPPORT';
    };
    PERMANENT_BAN: {
      action: 'DISABLE_ACCOUNT_PERMANENTLY';
      restrictions: 'NO_LOGIN';
      appeal: 'EMAIL_SUPPORT';         // must provide appeal path
      data_retention: '30D_THEN_DELETE';
    };
  };

  // Enforcement triggers
  triggers: [
    'CONTENT_POLICY_VIOLATION',        // reported and confirmed by admin
    'HARASSMENT',
    'FRAUD',                           // manipulating scores, impersonation
    'SPAM',                            // creating spam leagues/content
    'UNDERAGE_USER',                   // discovered to be under minimum age
    'LEGAL_REQUEST',                   // law enforcement request
  ];
}

interface SuspensionRecord {
  id: string;
  user_id: string;
  level: 'WARNING' | 'TEMPORARY_SUSPENSION' | 'PERMANENT_BAN';
  reason: string;
  trigger: string;
  enforced_by: string;                 // admin user ID
  starts_at: Date;
  ends_at?: Date;
  appeal_status?: 'NONE' | 'PENDING' | 'GRANTED' | 'DENIED';
  notes: string;
  created_at: Date;
}
```

---

## 9. Data Retention Policy

### Retention Schedule

| Data Type | Active Retention | After Account Deletion | Legal Basis |
|---|---|---|---|
| User profile | While account active | Anonymised immediately | Consent |
| Contest participation | While account active | Anonymised, retained for league history | Legitimate interest |
| Feed posts | While account active | Deleted or anonymised | Consent |
| Direct messages | 1 year | Deleted | Consent |
| Chat messages | 30 days post-contest | Deleted | Legitimate interest |
| Notification delivery logs | 90 days | Deleted | Legitimate interest |
| Payment/invoice records | 7 years | Retained (legal requirement) | Legal obligation |
| Consent records | 7 years | Retained (legal requirement) | Legal obligation |
| Audit logs | 3 years | Retained (compliance) | Legal obligation |
| Session/auth logs | 90 days | Deleted | Security |
| IP addresses | 90 days | Deleted | Security |
| Device tokens | While active | Deleted on logout/deletion | Consent |

### Automated Cleanup

```typescript
interface DataRetentionJobs {
  // Run daily at 03:00 UTC
  schedule: 'DAILY_0300_UTC';

  jobs: [
    {
      name: 'CLEANUP_EXPIRED_CHAT_MESSAGES';
      retention: '30_DAYS_POST_CONTEST';
      action: 'DELETE';
    },
    {
      name: 'CLEANUP_OLD_NOTIFICATION_LOGS';
      retention: '90_DAYS';
      action: 'DELETE';
    },
    {
      name: 'CLEANUP_OLD_SESSION_LOGS';
      retention: '90_DAYS';
      action: 'DELETE';
    },
    {
      name: 'CLEANUP_DELETED_ACCOUNTS';
      retention: '14_DAY_WAITING_PERIOD';
      action: 'ANONYMISE_AND_DELETE';
    },
    {
      name: 'CLEANUP_EXPIRED_DMS';
      retention: '1_YEAR';
      action: 'DELETE';
    },
  ];
}
```

---

## 10. Privacy by Design

### Data Minimisation

```
Principles applied across all features:
  1. Only collect data that is necessary for the feature
  2. Store DOB as birth year only (sufficient for age verification)
  3. Don't store full IP addresses longer than needed for security
  4. Use analytics that don't require personal data (Plausible, PostHog)
  5. Don't track user location unless specifically needed
  6. Don't expose user email to other league members (display names only)
```

### Encryption

```typescript
interface EncryptionPolicy {
  // Data at rest
  database: 'AES-256 (AWS RDS encryption)';
  file_storage: 'AES-256 (S3 server-side encryption)';
  backups: 'AES-256 (encrypted backups)';

  // Data in transit
  api: 'TLS 1.2+ (HTTPS only)';
  websocket: 'WSS (TLS encrypted WebSocket)';
  inter_service: 'TLS 1.2+ (service mesh or mutual TLS)';

  // Sensitive fields (additional application-level encryption)
  encrypted_fields: [
    'payment_method_details',          // handled by Stripe — we don't store raw card data
    'refresh_tokens',                  // encrypted in database
    'api_keys',                        // provider API keys encrypted at rest
  ];
}
```

---

## 11. Database Schema (Compliance Tables)

```sql
-- Consent records (immutable)
CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  consent_type VARCHAR(50) NOT NULL,
  granted BOOLEAN NOT NULL,
  version VARCHAR(20) NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
  -- No UPDATE or DELETE — append only
);

-- Data export requests
CREATE TABLE data_export_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  download_url TEXT,
  download_expires_at TIMESTAMPTZ,
  error TEXT
);

-- Account deletion requests
CREATE TABLE deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  scheduled_deletion_at TIMESTAMPTZ,   -- requested_at + 14 days
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

-- Self-exclusion records
CREATE TABLE self_exclusions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  exclusion_type VARCHAR(20) NOT NULL,
  duration VARCHAR(20) NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  reactivated_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE
);

-- Account enforcement (suspensions, bans)
CREATE TABLE account_enforcement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  level VARCHAR(30) NOT NULL,
  reason TEXT NOT NULL,
  trigger VARCHAR(50) NOT NULL,
  enforced_by UUID REFERENCES admin_users(id),
  starts_at TIMESTAMPTZ DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  appeal_status VARCHAR(20),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Data retention job runs
CREATE TABLE retention_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name VARCHAR(100) NOT NULL,
  records_processed INTEGER DEFAULT 0,
  records_deleted INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
  error TEXT
);

CREATE INDEX idx_consent_records_user ON consent_records(user_id, consent_type);
CREATE INDEX idx_export_requests_user ON data_export_requests(user_id, status);
CREATE INDEX idx_deletion_requests_user ON deletion_requests(user_id, status);
CREATE INDEX idx_self_exclusions_user ON self_exclusions(user_id, is_active);
CREATE INDEX idx_enforcement_user ON account_enforcement(user_id, created_at);
```

---

## 12. Compliance Checklist

### Before Launch

```
□ Privacy policy published and accessible from registration flow
□ Terms of service published with acceptance at registration
□ Cookie consent banner implemented for EU/UK/CA users
□ Age verification (DOB) at registration
□ Account deletion flow functional
□ Data export flow functional
□ Consent records being stored immutably
□ No personal data exposed to other users without consent
□ All data in transit encrypted (TLS)
□ All data at rest encrypted (AES-256)
□ Data retention cleanup jobs running
□ Responsible gaming information accessible
□ Self-exclusion tool functional
□ Geographic restriction framework in place (even if informational only)
□ Legal counsel has reviewed privacy policy and ToS
```

### Before Real-Money Features (Future)

```
□ State-by-state DFS regulation review completed with legal counsel
□ Required DFS operator licences obtained
□ Identity verification integrated
□ Geographic blocking implemented for restricted states
□ Separate trust/escrow accounts for prize pools
□ Enhanced age verification (ID check) for real-money users
□ Spending limits and activity monitoring active
□ Responsible gaming tools prominently displayed
□ Apple/Google gambling entitlements obtained
□ Tax reporting framework (1099 for US winnings over threshold)
□ Anti-money laundering (AML) controls if required
```

---

## 13. Implementation Phases

### Phase 1 — Foundation (Before Launch)
- Privacy policy and terms of service pages
- Age verification at registration (DOB collection)
- Cookie consent banner (EU/UK/California)
- Consent record storage
- Basic data export (JSON download)
- Account deletion with 14-day waiting period

### Phase 2 — Data Rights & Retention
- Full DSAR export (all data categories)
- Automated data retention cleanup jobs
- Anonymisation pipeline for deleted accounts
- Consent management UI in user settings
- "Do Not Sell" page (CCPA)

### Phase 3 — Responsible Gaming
- Self-exclusion tool (cool-down + long-term)
- Session time reminders
- Activity limit configuration
- Responsible gaming information page
- External resources and helpline links

### Phase 4 — Enforcement & Compliance
- Account suspension/ban framework
- Appeal workflow
- Admin enforcement tools
- Geographic restriction framework
- Compliance audit trail
- Retention job monitoring in admin dashboard

### Phase 5 — Real-Money Preparation (If Needed)
- Identity verification integration
- Geographic blocking for restricted states
- Enhanced spending limits
- Tax reporting framework
- Legal counsel engagement for DFS licensing

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 15-001 | 1 | Privacy policy page (published, accessible from registration) | Not Started | |
| 15-002 | 1 | Terms of service page (acceptance at registration) | Not Started | |
| 15-003 | 1 | Age verification at registration (DOB collection, 13+ check) | Not Started | |
| 15-004 | 1 | Cookie consent banner (EU/UK/California) | Not Started | |
| 15-005 | 1 | `consent_records` table (append-only, immutable) | Not Started | |
| 15-006 | 1 | Basic data export (JSON download of user's data) | Not Started | |
| 15-007 | 1 | `deletion_requests` table + account deletion flow (14-day wait) | Not Started | |
| 15-008 | 2 | Full DSAR export (all data categories: profile, contests, picks, DMs) | Not Started | |
| 15-009 | 2 | `retention_job_runs` table + automated cleanup jobs | Not Started | |
| 15-010 | 2 | Anonymisation pipeline for deleted accounts | Not Started | |
| 15-011 | 2 | Consent management UI in user settings | Not Started | |
| 15-012 | 2 | "Do Not Sell My Personal Information" page (CCPA) | Not Started | |
| 15-013 | 3 | `self_exclusions` table + self-exclusion tool (cool-down + long-term) | Not Started | |
| 15-014 | 3 | Session time reminders (configurable interval) | Not Started | |
| 15-015 | 3 | Activity limit configuration (contests/week, session time) | Not Started | |
| 15-016 | 3 | Responsible gaming information page + external resources | Not Started | |
| 15-017 | 4 | `account_enforcement` table + suspension/ban framework | Not Started | |
| 15-018 | 4 | Appeal workflow (request → review → grant/deny) | Not Started | |
| 15-019 | 4 | Admin enforcement tools (warn, suspend, ban) | Not Started | |
| 15-020 | 4 | Geographic restriction framework (informational for v1) | Not Started | |
| 15-021 | 4 | Compliance audit trail (admin dashboard view) | Not Started | |
| 15-022 | 4 | Retention job monitoring in admin dashboard | Not Started | |
| 15-023 | 5 | Identity verification integration (Stripe Identity or Jumio) | Not Started | If real-money features pursued |
| 15-024 | 5 | Geographic blocking for restricted states | Not Started | |
| 15-025 | 5 | Enhanced spending limits | Not Started | |
| 15-026 | 5 | Tax reporting framework (1099 for US winnings) | Not Started | |
| 15-027 | 5 | Legal counsel engagement for DFS licensing | Not Started | |

---

*Generated by Claude — PoolMaster Responsible Gaming & Legal Compliance Plan v1.0*
