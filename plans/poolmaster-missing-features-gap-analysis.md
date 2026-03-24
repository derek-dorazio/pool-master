# PoolMaster — Missing Feature Areas & Gap Analysis

## Overview

This document identifies the feature areas not yet covered by the existing PoolMaster planning documents. Each area represents a distinct domain that requires its own dedicated plan before or during implementation. Areas are grouped by priority: Critical (must be planned before build begins), Important (should be planned before the relevant phase), and Enhancement (can be planned and scoped later).

### Existing Plans (Already Completed)

| Plan Document | Coverage |
|---|---|
| `poolmaster-plan.md` | Architecture, domain model, tech stack, service topology, build phases |
| `poolmaster-draft-config-rules.md` | Snake, salary cap, and tiered draft formats, auto-pick, waiver wire |
| `poolmaster-scoring-rules.md` | Sport-specific scoring configs, stat schemas, scoring engine flow |
| `poolmaster-payouts-tiebreakers.md` | Prize pool construction, payout schedules, intermediate prizes, tiebreaker chains |
| `poolmaster-history-plan.md` | Contest history, league history, records, rivalries, analytics (luck/power ratings) |

---

## 🔴 Critical — Must Plan Before Build Begins

These four areas have deep architectural implications that touch almost every other part of the system. Decisions made here affect the data model, the service topology, the API contract, and the mobile client design. They should be planned before writing production code.

---

### 1. Notifications & Alerts System

**Why it's critical:** Notifications are the primary re-engagement mechanism for any fantasy sports platform. Getting them wrong is a top-3 cause of churn. The architecture plan names a Notification Service but never designs it. Every other service in the system — Draft, Scoring, Contest, League — needs to emit well-defined notification events, so the shape of this system must be established early.

**What needs to be planned:**

- **Channels:** Push notifications (APNs for iOS, FCM for Android), email (transactional and digest), in-app notification centre (persisted, dismissable), and SMS (optional, for draft clock urgency)
- **Notification event taxonomy:** Every triggerable event across the platform — draft clock warnings (5 min, 1 min, on-the-clock), it's-your-pick (async draft), score milestones (you've taken the lead, you've been overtaken), contest results (contest closed, you won, payout processed), weekly digest (league summary), commissioner announcements, contest opening/closing reminders, intermediate prize awarded
- **User preference model:** Per-channel opt-in/out per notification type. Users should be able to say "push me when it's my draft pick but only email me weekly summaries"
- **Commissioner override layer:** Commissioner can send league-wide announcements that bypass user preferences
- **Delivery tracking:** Sent, delivered, opened — for email; delivered, tapped — for push. Needed for engagement analytics and suppression logic
- **Suppression & rate limiting:** Prevent notification storms during live scoring events. Batch low-priority notifications into digests
- **Template system:** Notification copy is data-driven, not hardcoded. Templates support variable substitution (team name, score, prize amount) and are versioned
- **Scheduling:** Some notifications are time-based (24h before contest lock, 1h before draft starts) and need a job scheduler
- **Provider abstraction:** Swap SendGrid for SES, or OneSignal for direct APNs/FCM, without rewriting business logic

**Architectural impact:** Every service needs to emit events to the message bus that the Notification Service subscribes to. The event schema for notifications must be defined as part of the shared `packages/shared/events` package.

---

### 2. Social & Communication Layer

**Why it's critical:** Social features are a primary retention driver in fantasy sports. Sleeper built their dominant position largely on being the platform with the best social experience. Without this layer, PoolMaster is a score-tracking tool rather than a league home. The communication model also affects the real-time architecture (WebSocket channels for chat) and the data model (message storage, moderation flags).

**What needs to be planned:**

- **League message board / activity feed:** Persistent threaded posts at the league level. Commissioner pinned announcements. Members can post, reply, react (emoji reactions). Rich text or at minimum basic formatting
- **Contest-level chat:** Optional live chat during an active contest — particularly useful during live draft rooms and live scoring events. Can be a read-only feed of automated score events plus member commentary
- **Direct messaging:** Optional 1-to-1 messaging between league members for trade negotiations in season-long formats
- **Automated league activity events:** System-generated feed posts for notable moments — "Alex just took the lead in the Masters Pool", "Jordan won the Round 2 leader prize", "Draft complete — here are your rosters"
- **Weekly auto-generated league recap:** Commissioner-configurable automated digest sent weekly during active contests. Summarises standings, notable performances, records set, upcoming events
- **Share-to-social:** Generate shareable cards (OG image) for: winning a contest, setting a record, trophy awarded, final leaderboard. Cards are formatted for Twitter/X, Instagram, iMessage. Share URL resolves to a public (or invite-gated) view of the result
- **Push-to-notification integration:** Key social events (someone reacts to your post, commissioner posts an announcement) feed into the Notification System
- **Moderation:** Commissioner can delete posts and mute members. Platform admin can escalate to account suspension. Content policy enforcement hooks
- **Storage model:** Messages and feed events are high-volume append-only data. Good candidate for NoSQL or a dedicated time-series store rather than SQL

**Architectural impact:** Requires a dedicated WebSocket channel for league chat (separate from the draft room channel). Message storage and retrieval needs to be designed carefully for performance at scale — a busy league during a major golf tournament could generate hundreds of feed events per hour.

---

### 3. Platform Billing & Subscription Management (Tenant-Facing)

**Why it's critical:** This is the monetisation engine of the SaaS platform. Without a designed billing and entitlement system, you can't go to market commercially. It also has deep implications for every feature: any capability that is plan-gated requires the entitlement system to exist first, otherwise every feature ships as free and you can never introduce paid tiers without a major retrofit.

**What needs to be planned:**

- **Plan tiers:** Define the tier structure (e.g. Free / Starter / Pro / League+). For each tier, specify: max leagues, max members per league, max contests per season, sports available, draft types available, real-time features, history depth, analytics features, custom branding, support SLA
- **Entitlement model:** A decoupled entitlement service that the application queries to check feature access. Feature flags are driven by the tenant's current plan, not hardcoded. Adding a new gated feature or creating a new plan tier should require no code changes
- **Stripe integration:** Subscription creation, plan changes (upgrade/downgrade with proration), cancellation, payment method management, invoice generation, webhook handling for payment events
- **Billing cycles:** Monthly and annual options with appropriate discounting. Trial periods (e.g. 30-day free trial of Pro). How the trial-to-paid conversion flow works
- **Dunning:** Automated retry logic and communication for failed payments. Grace period before feature degradation. Final cancellation flow
- **Usage metering:** If any features are usage-based (e.g. overage leagues, additional storage for history), the metering and overage billing logic
- **Self-service portal:** Tenant admin can view their current plan, upcoming invoice, payment history, change plan, update payment method, and cancel — without contacting support
- **Enterprise / custom plans:** Path for large tenants who need custom pricing, SLAs, or white-label options. These may be manually managed outside Stripe
- **Commissioner vs tenant billing separation:** The tenant (organisation) holds the subscription. Individual league commissioners and members do not pay separately. Clarify how entry fees and prize pools (member-to-member money) are handled separately from the platform subscription fee
- **Revenue analytics:** MRR, ARR, churn rate, trial conversion rate, plan distribution — internal dashboard for the PoolMaster business

**Architectural impact:** A `PlanEntitlementService` must be available to all other services at request time (typically injected as middleware). The `Tenant` domain object needs a `plan_tier` and `subscription_status` that the entitlement service reads. All feature-gated code paths must call the entitlement service rather than checking plan tier directly.

---

### 4. Admin / Platform Operations Dashboard

**Why it's critical:** Your team needs tooling to operate the platform from day one. Without an admin dashboard, debugging production issues, supporting tenants, managing sports data integrations, and running operational tasks all require direct database access. This is dangerous and slow. The admin dashboard is also where platform-level configuration lives — sports data provider credentials, feature flag overrides, global announcements.

**What needs to be planned:**

- **Tenant management:** View all tenants, their plan tier, member count, active contest count, last activity. Ability to manually upgrade/downgrade plans, apply credits, suspend or delete accounts, impersonate a tenant admin for support purposes
- **User management:** Search users across tenants, view account details, reset passwords, force logout, merge duplicate accounts
- **Contest & results management:** View any contest in any league across any tenant. Ability to manually close a contest, override a result (e.g. data provider error), force-recalculate standings, trigger payout recalculation
- **Sports data provider management:** Configure provider credentials and webhooks, view ingestion health (last received event per sport, error rates, lag), manually trigger a re-ingestion for a specific event, map provider participant IDs to internal participant records
- **Feature flag management:** Enable/disable features globally or per tenant without a deployment. Override plan entitlements for specific tenants (e.g. beta access to new features)
- **Platform health dashboard:** Service uptime, error rates, queue depths, WebSocket connection counts, database performance, NoSQL throughput — all in one operational view
- **Audit log:** Every admin action is logged with actor, timestamp, and before/after state. Immutable audit trail for compliance
- **Global announcements:** Ability to push a banner or notification to all active users (e.g. scheduled maintenance, new feature launch)
- **Support tools:** View a tenant's full activity log, recent errors, recent notification delivery failures, to aid customer support investigations
- **Data migration tools:** Run controlled migrations, backfill analytics, re-compute history records — with dry-run mode and progress tracking

**Architectural impact:** The admin dashboard is a separate service with its own authentication (internal staff SSO, not the public auth system). It needs read access to all data stores and write access for specific override operations. All write operations must go through service APIs (not direct DB writes) to ensure business logic and audit logging are preserved.

---

## 🟡 Important — Plan Before the Relevant Build Phase

These areas have significant implications for specific phases of the build. They don't need to be planned before day one but should be fully designed before work on their respective phase begins.

---

### 5. Sports Data Provider Integration Layer

**Why it's important:** The entire scoring engine depends on reliable, normalised real-world sports data. The ingestion worker is named in the architecture but never designed. Decisions here affect: which sports are available at launch, how quickly scores update, how much a data outage degrades the user experience, and how much sports data costs in the operating budget.

**What needs to be planned:**

- **Provider evaluation and selection:** Compare SportsDataIO, Sportradar, the-odds-api, and sport-specific providers (PGA Tour official data, Formula1 official, NCAA data licensing). Evaluate: coverage, latency, cost, API quality, historical data depth
- **Adapter pattern implementation:** Each provider implements a `SportDataProvider` interface. The ingestion worker calls the interface, not the provider directly. Swapping providers requires only a new adapter, no business logic changes
- **Polling vs webhooks vs streaming:** Decide per sport based on provider capabilities and update frequency requirements. Golf rounds update every few minutes; F1 lap data updates every few seconds; NFL scoring updates every play. Different strategies for different sports
- **Schedule and fixture ingestion:** Contest setup relies on knowing upcoming events (which golf tournaments are scheduled, what the F1 calendar is). This is separate from live scoring data and needs its own ingestion pipeline
- **Participant data ingestion:** Player and participant profiles, world rankings, team rosters — ingested on a slower schedule (daily or weekly)
- **Stat normalisation:** Each provider has different field names and schemas. The adapter layer normalises to PoolMaster's internal `StatEvent` schema before publishing to the message bus
- **Provider outage handling:** What happens during a data outage? Stale score warnings to users, contest clock pausing, auto-recovery when data resumes
- **Data corrections:** Providers sometimes correct stats hours after an event (official scorer changes a ruling). How corrections propagate through the scoring engine and whether they trigger payout recalculations
- **Cost management:** Sports data APIs are expensive at scale. Caching strategy, request batching, and budget alerts are part of the integration design
- **Historical data:** For seeding the participant database and enabling history features on day one, historical data from providers needs to be ingested once during platform setup

---

### 6. Participant & Player Data Management

**Why it's important:** Participants (golfers, F1 drivers, NFL players, college basketball teams) are a first-class domain object. The draft, scoring, tiers, salary cap, and history features all reference participants. But the plan has never addressed how participants are created, maintained, enriched, or served to the user experience.

**What needs to be planned:**

- **Participant profile schema:** Name, sport, position/role, photo, metadata (world ranking, nationality, team affiliation), external provider IDs (for mapping ingested data), active/inactive/retired status
- **Participant ingestion and refresh:** How participant records are created and kept current from the sports data provider. New-season roster updates, retirements, team transfers
- **Injury and availability status:** Real-time injury/withdrawal flags sourced from the data provider. These feed into: auto-pick exclusion lists, commissioner warnings when configuring a contest pool, user alerts when a drafted participant is injured
- **World ranking and pricing feeds:** For salary cap contests, prices need to be auto-calculated from current world rankings or odds. The formula and refresh schedule for this
- **Participant search and filtering:** The UI experience for commissioners setting up a contest pool (filtering by ranking bracket, tier assignment) and for managers during a draft (search by name, filter by position, sort by price or projected score)
- **Season-specific participant metadata:** A golfer's world ranking in 2024 differs from 2025. Historical stats and pricing need to be associated with the season they occurred in
- **Participant deduplication:** Providers use different IDs. The same person may have entries from multiple providers. A canonical participant record with provider ID mappings
- **Photo and media management:** Participant photos are served to clients. Storage, CDN, fallback images for participants without photos

---

### 7. Mobile Client Architecture

**Why it's important:** Web, iOS, and Android are all planned from day one but the architecture plan only covers the backend. The mobile clients need their own architecture design — shared vs platform-specific code, the API contract they consume, offline behaviour, push notification registration, and deep linking. Getting this right early prevents expensive rewrites when the live draft room and real-time scoring features are built.

**What needs to be planned:**

- **Technology choice:** React Native (shared codebase with web where possible) vs native Swift/SwiftUI and Kotlin. Trade-offs around performance, platform feel, real-time WebSocket support, and push notification handling
- **API contract and versioning:** The mobile clients consume the same REST API as the web client. API versioning strategy so mobile apps (which update slower than web) don't break when the API evolves. Header-based versioning recommended
- **Authentication flow:** OAuth / JWT login, token refresh, secure storage of credentials on device (Keychain on iOS, EncryptedSharedPreferences on Android)
- **Offline behaviour and caching:** What works without a network connection? View-only access to last-known leaderboard and roster. What requires connectivity? Draft picks, score updates, notifications. Cache invalidation strategy
- **Push notification registration:** APNs device token and FCM registration token management. Token refresh, deregistration on logout, per-device preferences
- **Deep linking:** Notification taps should navigate to the correct in-app screen. A "it's your pick" push notification should open the draft room directly. A "contest result" notification should open the final standings. Universal links (iOS) and App Links (Android) configuration
- **Real-time WebSocket management:** Connection lifecycle on mobile — backgrounding, app resume, reconnection strategy, battery impact. Different behaviour needed for draft room (aggressive reconnect) vs live leaderboard (graceful degradation acceptable)
- **Draft room on mobile:** The live draft experience is the most complex real-time UI. Layout, timer display, pick queue management, and auto-pick UI all need mobile-specific design consideration
- **App Store compliance:** Apple App Store review guidelines are strict around real-money contests and gambling-adjacent features. Review the guidelines early and design the monetisation and entry fee flows accordingly

---

### 8. Commissioner Tooling (Consolidated Plan)

**Why it's important:** Commissioner capabilities are scattered across every other plan document — draft controls here, payout management there, contest config there. But the commissioner is the primary power user of PoolMaster. A bad commissioner experience means leagues don't get set up, contests don't launch, and the product fails. All commissioner capabilities need to be designed as a coherent, progressive workflow rather than a collection of isolated settings screens.

**What needs to be planned:**

- **League setup wizard:** Guided multi-step flow for creating a new league — name and settings, invite members, configure sports and seasons, set default scoring and payout rules. Designed to get a commissioner from signup to "first contest ready" in under 10 minutes
- **Contest setup wizard:** Per-contest configuration workflow — sport selection, participant pool configuration, draft type and mode, scoring rules (from template or custom), payout structure, intermediate prizes, tiebreaker chain, lock time. Should feel like filling in a form, not writing configuration code
- **Member management:** Invite by email or shareable link, remove a member, transfer commissioner role, set member roles (commissioner vs player vs viewer), manage membership requests for public leagues
- **In-season overrides:** The safety valve for when things go wrong — extend a pick deadline, undo a draft pick (with configurable undo window), manually adjust a team's score (data provider error), re-open a closed contest, reassign a team to a different member (when someone leaves mid-season)
- **League communication tools:** Post a pinned announcement to the league feed, send a notification to all league members, configure the automated weekly recap
- **Contest template library:** Save a contest configuration as a template so it can be reused each season or each week without reconfiguring from scratch. Share templates with other commissioners in the same tenant
- **Commissioner dashboard:** A single home screen for the commissioner showing: upcoming draft deadlines, contests needing attention, member activity, unread league messages, recent score alerts, and pending payout confirmations
- **Bulk operations:** Invite multiple members at once via CSV upload, configure multiple contests for an entire season at once, copy last season's configuration as the starting point for a new season
- **Audit trail:** Every commissioner action is logged — who changed what, when. Viewable by the commissioner so they can explain decisions to league members

---

## 🟢 Enhancement — Can Be Planned and Scoped Later

These areas improve the platform experience but do not block the core product from launching. They should be planned before the relevant feature is built but do not need plans before initial development begins.

---

### 9. Search & Discovery

Public pool browsing, participant search during drafts, and league discovery for new users. Includes: full-text search across participants (name, team, position), faceted filtering in the commissioner's contest setup UI, and a public contest directory for platforms that want to run open pools alongside private leagues.

**Key decisions to make:** Search technology (Elasticsearch vs PostgreSQL full-text vs Algolia), what is publicly discoverable vs invite-only, how to prevent spam or low-quality public leagues from polluting discovery.

---

### 10. Localisation & Internationalisation (i18n)

Multi-currency support is referenced in the payout plan but the broader i18n story has not been addressed. This covers: date and time formatting across timezones (critical for draft lock times and contest schedules), currency display and formatting, language/locale support for the UI, and region-specific legal compliance.

**Key decisions to make:** Which locales to support at launch, whether timezone is stored at the user level or the tenant level (or both), how multi-currency prize pools interact with the payout engine, whether the API returns localised strings or the client handles all localisation.

---

### 11. Responsible Gaming & Legal Compliance

Depending on the jurisdictions served and whether real-money prize pools are supported, there may be regulatory requirements. This is a wide area that intersects legal, product, and engineering.

**Topics to address:** Age verification for real-money contests, geographic restrictions (several US states restrict DFS-style contests), spending limits and self-exclusion tools, GDPR and CCPA compliance (right to access, right to erasure, data portability, consent management), cookie policy and tracking consent, terms of service enforcement and account suspension workflows, and data retention obligations.

**Key decision to make early:** Whether PoolMaster directly facilitates real-money prize pools (with associated regulatory burden) or positions itself as a purely social/management platform where any money changes hands informally outside the app. This decision significantly affects the compliance scope.

---

## Summary Table

| # | Feature Area | Priority | Complexity | Blocks |
|---|---|---|---|---|
| 1 | Notifications & Alerts System | 🔴 Critical | High | Async draft, live scoring UX, re-engagement |
| 2 | Social & Communication Layer | 🔴 Critical | Medium | League retention, activity feed, recap |
| 3 | Platform Billing & Subscription Mgmt | 🔴 Critical | High | Commercial launch, feature gating |
| 4 | Admin / Platform Operations Dashboard | 🔴 Critical | Medium | Day-one operations, support, data management |
| 5 | Sports Data Provider Integration | 🟡 Important | High | Phase 3 scoring engine, participant data |
| 6 | Participant & Player Data Management | 🟡 Important | Medium | Contest setup, drafts, salary cap pricing |
| 7 | Mobile Client Architecture | 🟡 Important | Medium | iOS and Android development start |
| 8 | Commissioner Tooling (Consolidated) | 🟡 Important | Medium | Coherent commissioner UX across all features |
| 9 | Search & Discovery | 🟢 Enhancement | Low-Medium | Public leagues, draft participant search |
| 10 | Localisation & i18n | 🟢 Enhancement | Medium | International tenants, timezone correctness |
| 11 | Responsible Gaming & Legal Compliance | 🟢 Enhancement | High | Real-money features, GDPR/CCPA, age gating |

---

## Recommended Planning Order

Based on architectural dependencies, the recommended sequence for creating the remaining plan documents is:

1. **Sports Data Provider Integration** — the scoring engine can't be tested without data; unblocks Phase 3 of the build plan
2. **Participant & Player Data Management** — depends on #1; required before any contest can be configured with a real participant pool
3. **Platform Billing & Subscription Management** — should be designed before Phase 1 code is written so entitlement checks can be built into the foundation
4. **Commissioner Tooling (Consolidated)** — the primary power-user UX surface; designing this reveals missing API requirements across all other services
5. **Notifications & Alerts System** — needed before the draft service ships; async draft is unusable without pick-reminder notifications
6. **Social & Communication Layer** — important for engagement but can launch without it; plan before Phase 4
7. **Admin / Platform Operations Dashboard** — can be built incrementally; plan the data model early, build the UI progressively
8. **Mobile Client Architecture** — plan before mobile development starts; does not block backend or web development
9. **Search & Discovery** — plan when approaching public pool / open contest features
10. **Localisation & i18n** — plan when first international tenant is onboarded
11. **Responsible Gaming & Legal Compliance** — plan before any real-money features go live; engage legal counsel early

---

*Generated by Claude — PoolMaster Missing Feature Areas & Gap Analysis v1.0*
